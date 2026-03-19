# High Availability

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Leader-based clustering with state replication for failover. Agents form a cluster with one leader and N followers using a modified Bully election algorithm. The leader owns eBPF programs and coordinates state replication across 13 domain categories via gRPC streaming. Split-brain detection and resolution ensure consistent behavior during network partitions.

## Cluster Roles

| Role | Description |
|------|-------------|
| **Leader** | Active node, owns eBPF programs, sends heartbeats, replicates state |
| **Candidate** | Participating in leader election |
| **Follower** | Standby node, receives replicated state, monitors leader heartbeat |

## Node Identity

Each node has a persistent **UUIDv7 node ID** stored in `{data_dir}/node_id` (created on first startup via `FileNodeIdStore`). UUIDv7 is time-ordered and used for deterministic tiebreaking in elections.

## Leader Election

Modified **Bully algorithm** with monotonic `Term(u64)` counter:

### Election Flow

1. Node starts as `Follower`
2. On heartbeat timeout (`elapsed_ms ≥ heartbeat_ms × failure_threshold`):
   - Increment term
   - Transition to `Candidate`
   - Vote for self
   - Send `VoteRequest(candidate_id, term)` to all peers
3. Collect responses:
   - Count granted votes (including self-vote)
   - Majority required: `total_nodes / 2 + 1`
   - **Won**: votes ≥ majority → become Leader, activate eBPF, emit FailoverEvent
   - **Lost**: peer has higher term, or higher node_id denied vote (Bully tiebreak) → acknowledge that leader
   - **Inconclusive**: insufficient responses → retry
4. Leader sends `Heartbeat(leader_id, term)` to all peers at `heartbeat_ms` interval
5. Follower receives heartbeat → resets timeout, stays Follower
6. Peer heartbeat with higher term → leader steps down, deactivates eBPF

### Vote Granting

`should_grant_vote(state, request)`:

- Rejects stale terms (`request.term < current_term`)
- Grants higher terms (always)
- Same term: grants if no prior vote **or** `candidate_id > previously voted_for` (Bully)

## State Replication

The leader replicates state to followers via gRPC streaming across **13 domain categories**:

| Category | Replicated State |
|----------|-----------------|
| `FirewallRules` | Firewall rules |
| `IdsThresholds` | IDS detection rules |
| `IpsRules` | IPS blocking rules |
| `ThreatIntelIpSets` | Threat intelligence IOC sets |
| `RateLimitPolicies` | Rate limit policies |
| `L7Rules` | Layer 7 filtering rules |
| `DdosPolicies` | Anti-DDoS policies |
| `DlpPatterns` | DLP patterns |
| `DnsBlocklist` | DNS blocklists |
| `NatRules` | NAT rules (DNAT/SNAT/NPTv6) |
| `LbServices` | Load balancer services |
| `QosConfig` | QoS pipes/queues/classifiers |
| `RoutingGateways` | Routing gateways |

### Replication Model

- **StateDelta**: incremental update with `ReplicationHeader(leader_id, term, category, sequence_number, timestamp_ms)` + payload
- **StateSnapshot**: full state dump for initial sync or recovery
- **SequenceNumber(u64)**: monotonic per `(term, category)`
- **Change detection**: providers track content hash (`DefaultHasher`) to emit deltas only on actual changes

### Replication Flow

1. **Leader**: collects deltas from `ReplicableStateProvider` instances (one per category)
2. For each delta: check bandwidth limit → increment sequence → send to all followers via `HaReplicationTransport`
3. **Follower**: validates delta (snapshot received, non-stale term, sequence ordering) → applies via `ReplicableStateConsumer`
4. Returns `ReplicationAck(node_id, term, category, applied_seq)`

### Initial Sync

When a follower joins:

1. For each category without `snapshot_received`: request snapshot from leader
2. Leader provides full state via `ReplicableStateProvider::snapshot()`
3. Follower applies snapshot, marks `snapshot_received = true`
4. Now accepts incremental deltas for that category

### Bandwidth Limiting

Optional bandwidth limiter resets each second. Returns error if `current_bytes + delta_size > max_bytes_per_sec`.

### Lag Detection

Replication status reports per-follower progress. Warning logged if follower is more than **10 sequences** behind leader (`LAG_THRESHOLD`).

## Split-Brain Resolution

When the leader detects a peer also claiming leadership (via `HeartbeatAck(role=Leader)`):

| Policy | Behavior |
|--------|----------|
| `PreferActive` | Keep node with **higher** UUIDv7 (deterministic) |
| `PreferStandby` | Keep node with **lower** UUIDv7 |
| `Fence` | Both nodes deactivate eBPF and step down |

Actions:

| Result | Effect |
|--------|--------|
| `NoConflict` | No split-brain detected |
| `ResolvedToNode(id)` | Losing node deactivates eBPF, transitions to Follower |
| `FenceBothNodes` | Both deactivate eBPF, both step down |

## eBPF Lifecycle

The HA subsystem controls eBPF program attachment tied to leadership:

| Adapter | Purpose |
|---------|---------|
| `OssEbpfActivator` | Calls `runtime::load_ebpf_programs()` on promotion, `runtime::detach_ebpf()` on demotion |
| `LoggingFailoverEmitter` | Logs failover events at WARN level with full details |
| `FileNodeIdStore` | Persists UUIDv7 node ID to disk |

### State Bridge

13 provider/consumer pairs (`ha_state_bridge.rs`) connect HA replication to OSS application services:

- Each pair wraps an OSS `AppService` (Firewall, IDS, IPS, ThreatIntel, RateLimit, L7, DDoS, DLP, DNS, NAT, LB, QoS, Routing)
- Snapshot/delta payloads serialized as JSON via serde
- Change detection via hash comparison avoids unnecessary replication

## Active-Active Multi-Interface (E7.4)

Standard HA is active-passive: one leader runs eBPF, followers are standby. Active-active mode allows **both nodes to run eBPF programs on their own assigned interfaces**, splitting traffic processing across the cluster.

### HaMode

| Mode | Behavior |
|------|----------|
| `ActivePassive` | Default. One leader owns all eBPF programs, followers are standby |
| `ActiveActive` | Both nodes load eBPF programs for their assigned interfaces |

### Interface Assignment

`InterfaceAssignment` maps network interfaces to specific nodes:

```yaml
enterprise:
  ha:
    mode: active_active
    interface_assignments:
      node-a-uuid:
        - eth0
        - eth1
      node-b-uuid:
        - eth2
        - eth3
    takeover_on_failure: true
```

### Behavior

- On startup in `ActiveActive` mode, each node loads eBPF programs **only** for its assigned interfaces
- The leader still coordinates state replication and elections; both nodes process traffic independently on their interfaces
- **Peer failure** with `takeover_on_failure: true`: the surviving node activates eBPF on the failed node's interfaces in addition to its own
- **Peer recovery**: the recovered node reclaims its assigned interfaces; the surviving node releases the taken-over interfaces and detaches their eBPF programs
- In `ActivePassive` mode (default), `interface_assignments` is ignored and behavior matches existing leader-only eBPF attachment

## Graceful Degradation (E7.5)

Controls agent behavior when it loses contact with its peer and enters a degraded state (e.g., network partition, peer crash).

### DegradationPolicy

| Policy | Behavior |
|--------|----------|
| `Continue` | Default. Keep running normally with a warning. Accept configuration changes. |
| `ReadOnly` | Keep current eBPF rules active. Reject configuration changes via the API (returns `503 Service Unavailable`). |
| `FailClosed` | Block all traffic by loading a deny-all eBPF rule until the peer is restored. |

### ClusterHealth

| State | Meaning |
|-------|---------|
| `Healthy` | All peers reachable, replication up to date |
| `Degraded` | One or more peers unreachable, operating under degradation policy |
| `Isolated` | No peers reachable, node is completely alone |

### Behavior

- **Degradation entry**: triggered when heartbeat timeout fires and no peer responds. The node transitions `cluster_health` to `Degraded` or `Isolated` and applies the configured `degradation_policy`.
- **Continue**: logs a warning, no behavioral change. Config updates are accepted.
- **ReadOnly**: current eBPF programs remain loaded. API mutations (`POST`, `PUT`, `DELETE` on config endpoints) return `503`. Read endpoints remain available.
- **FailClosed**: a deny-all eBPF rule is loaded, dropping all traffic. This is the most conservative option for security-critical deployments.
- **Recovery**: when the peer becomes reachable again, the node auto-resyncs state via snapshot replication and exits degraded mode. If `FailClosed` was active, the deny-all rule is removed and normal eBPF programs are restored.

### Configuration

```yaml
enterprise:
  ha:
    degradation_policy: continue   # continue | read_only | fail_closed
```

## Failover Events

`FailoverEvent` records leadership changes:

| Field | Description |
|-------|-------------|
| `event_type` | `AutomaticFailover`, `ManualFailover`, `NodeRecovery`, `InterfaceTakeover`, `DegradationEntered`, `DegradationExited` |
| `old_leader` | Previous leader node ID |
| `new_leader` | New leader node ID |
| `term` | Election term |
| `trigger` | `HeartbeatTimeout`, `ManualApi`, `Recovery`, `InterfaceTakeover`, `Degradation` |
| `timestamp_ms` | Event timestamp |

## gRPC Service

`HaPeerGrpcService` implements 5 RPC methods with connection pooling:

| RPC | Description |
|-----|-------------|
| `request_vote` | Election vote request/response |
| `heartbeat` | Leader heartbeat + ack |
| `replicate_delta` | Push incremental state update |
| `replicate_snapshot` | Push full state snapshot |
| `request_snapshot` | Follower requests initial sync |

## Configuration

```yaml
enterprise:
  ha:
    enabled: true
    mode: active_passive                    # active_passive | active_active
    peers:
      - 10.0.0.2:9443
      - 10.0.0.3:9443
    heartbeat_ms: 1000
    failure_threshold: 3
    max_replication_bandwidth: 104857600    # 100 MB/s (optional)
    replication_interval_ms: 200
    split_brain_policy: prefer_active       # prefer_active | prefer_standby | fence
    listen_addr: 0.0.0.0:9443
    data_dir: /var/lib/ebpfsentinel/ha
    interface_assignments:                  # active_active mode only
      node-a-uuid:
        - eth0
        - eth1
      node-b-uuid:
        - eth2
        - eth3
    takeover_on_failure: true               # active_active: take over peer interfaces on failure
    degradation_policy: continue            # continue | read_only | fail_closed
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable HA clustering |
| `peers` | list | `[]` | Peer addresses (required when enabled) |
| `heartbeat_ms` | u64 | `1000` | Heartbeat interval (must be > 0) |
| `failure_threshold` | u32 | `3` | Missed heartbeats before failover (must be > 0) |
| `max_replication_bandwidth` | u64 | — | Optional bandwidth cap in bytes/sec |
| `replication_interval_ms` | u64 | `200` | Replication tick interval |
| `split_brain_policy` | enum | `prefer_active` | Split-brain resolution policy |
| `listen_addr` | string | `0.0.0.0:9443` | gRPC listen address |
| `data_dir` | string | `/var/lib/ebpfsentinel/ha` | Persistent state directory |
| `mode` | enum | `active_passive` | HA mode: `active_passive` or `active_active` |
| `interface_assignments` | map | `{}` | Per-node interface list (active_active mode only) |
| `takeover_on_failure` | bool | `true` | Take over peer interfaces on failure (active_active mode only) |
| `degradation_policy` | enum | `continue` | Behavior when peer is lost: `continue`, `read_only`, `fail_closed` |

Validation: `heartbeat_ms > 0`, `failure_threshold > 0`, `peers` non-empty when enabled, `listen_addr` and `data_dir` non-empty. When `mode` is `active_active`, `interface_assignments` must be non-empty.

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/ha/status` | Cluster status (node_id, role, term, leader_id, peer_count, ebpf_active, ha_mode, cluster_health, degradation_policy, is_degraded) |
| `GET` | `/api/v1/ha/peers` | Peer list with addresses |
| `POST` | `/api/v1/ha/failover` | Manual failover (leader only, 409 Conflict if not leader or no peers) |
| `GET` | `/api/v1/ha/replication` | Per-category replication status (leader_seq, synced flag) |
| `GET` | `/api/v1/ha/interfaces` | Interface assignments and ownership status (active_active mode) |
| `GET` | `/api/v1/ha/health` | Cluster health (ha_mode, cluster_health, degradation_policy, is_degraded) |

## Feature Gating

High Availability requires a valid license with the `high-availability` feature. Without a license, the agent runs standalone with no clustering.
