# High Availability

> **Edition: Enterprise**

## Overview

Leader-based clustering with state replication for failover. Agents form a cluster with one leader and N followers using a modified Bully election algorithm. The leader owns eBPF programs and coordinates state replication across 13 domain categories over unary gRPC calls. Split-brain detection and resolution ensure consistent behavior during network partitions.

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

The leader replicates state to followers across **13 domain categories**. Every
call on the peer service is unary - a delta or a snapshot goes out as one request
and the follower answers with one acknowledgement - so a replication round is a
sequence of calls rather than an open stream, and a follower that dropped off
rejoins by asking for a snapshot rather than by resuming a channel:

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

- **StateDelta**: a `ReplicationHeader(leader_id, term, category, sequence_number, timestamp_ms)` plus a payload. Every state provider that ships with the product answers with the **whole state of its category**, not with the rows that changed since a sequence: the `since_seq` argument is accepted and ignored. A delta is therefore a state dump that carries a sequence number, and applying one replaces the follower's copy of that category rather than amending it. That is what makes a missed delta recoverable without a snapshot, and it is why a follower behind by ten deltas is behind by one payload's worth of work.
- **StateSnapshot**: the same full state dump, sent on initial sync or recovery, and the thing that unlocks delta acceptance for a category.
- **SequenceNumber(u64)**: monotonic per `(term, category)`, and it counts deltas a follower took rather than deltas the leader built.
- **Change detection**: providers keep a content hash of the payload they last got a peer to accept, and stay silent while the state hashes the same. The hash moves on acceptance, so a send that failed is offered again on the next tick instead of being suppressed as unchanged.

### Replication Flow

1. **Leader**: collects state from `ReplicableStateProvider` instances (one per category)
2. For each payload: check the bandwidth limit, number it as the next sequence, and send it to all followers via `HaReplicationTransport`
3. **Follower**: validates the delta (snapshot received, non-stale term, no sequence gap inside the term) then applies it via `ReplicableStateConsumer`
4. Returns `ReplicationAck(node_id, term, category, applied_seq)`
5. The leader advances the sequence and moves the provider's hash **only when at least one peer acknowledged**. The rule is one peer rather than a majority because this is state replication to N followers rather than a consensus log: a leader that numbered a delta nobody took would leave every follower permanently behind a sequence describing nothing. A round in which no peer accepted logs a warning, leaves the sequence where it was, and offers the same payload again on the next tick.

A follower that missed entries is told so rather than left to guess: a delta whose sequence jumps past the next expected one **inside the same term** is refused with a sequence-gap error, the way a stale term already is. A jump under a new term is accepted, because a new leader restarts the numbering.

### Initial Sync

When a follower joins:

1. For each category without `snapshot_received`: request a snapshot from a peer
2. The peer provides full state via `ReplicableStateProvider::snapshot()`
3. Follower applies the snapshot and marks `snapshot_received = true`
4. It now accepts deltas for that category

Initial sync counts as done only when at least one peer answered with a snapshot. Reaching no peer at all is an error, logged at ERROR and returned to the caller, and the node keeps reporting itself unsynced; a partial answer is logged at WARN and also leaves the node unsynced. `GET /api/v1/ha/replication` carries this as `initial_sync_complete`, and its `synced` flag is false while no category has any progress at all rather than reading true off an empty map.

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

### Promotion replaces the datapath, it does not adopt one

A promotion always loads a fresh datapath, even when a program from a previous
generation is still attached to the interface. Adopting the existing attachment
would leave the node running the previous generation's programs while the
services handed out on this activation hold the new generation's maps: writes
succeed, reads return nothing, and the node looks healthy while enforcing
nothing. A reload costs a few hundred milliseconds on a promotion that already
takes seconds.

Anything still attached after a step-down is therefore reported rather than
reused. The agent reads the interface's attachment state back from the kernel
after detaching and warns about what is left, so the cause is logged on the node
that failed to clean up rather than discovered on the node promoted after it.

Two consequences are visible to an operator:

- Packet mirroring is bound to the datapath generation that is actually running.
  On a standby, or on a leader mid-teardown, a mirror request is refused with
  "packet mirroring is unavailable: the eBPF datapath is not active on this
  node" instead of being accepted and capturing nothing.
- Alerts follow the promotion. A promoted leader serves `/api/v1/alerts`,
  forwards to SIEM, and arms automated response for the datapath it just loaded.

### State Bridge

13 provider/consumer pairs (`ha_state_bridge.rs`) connect HA replication to OSS application services:

- Each pair wraps an OSS `AppService` (Firewall, IDS, IPS, ThreatIntel, RateLimit, L7, DDoS, DLP, DNS, NAT, LB, QoS, Routing)
- Snapshot/delta payloads serialized as JSON via serde
- Change detection via hash comparison avoids unnecessary replication

## Active-Active Multi-Interface

Standard HA is active-passive: one leader runs eBPF, followers are standby. Active-active mode allows **both nodes to run eBPF programs on their own assigned interfaces**, splitting traffic processing across the cluster.

### HaMode

| Mode | Behavior |
|------|----------|
| `ActivePassive` | Default. One leader owns all eBPF programs, followers are standby |
| `ActiveActive` | Every node loads eBPF programs for the interfaces assigned to it, leader or not |

### Interface Assignment

`InterfaceAssignment` maps network interfaces to specific nodes. A node is named by the address its peers reach it on, not by the node identifier the agent mints on first boot: that identifier is a UUID persisted under `data_dir`, so an operator writing this file has no way to know it.

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  ha:
    mode: active-active
    peers:
      - 10.0.0.2:9443               # what this node calls its peer
    listen_addr: "0.0.0.0:9443"     # what this node binds
    advertised_addr: "10.0.0.1:9443" # what its peers reach this node on
    interface_assignments:          # a list, one entry per node
      - address: "10.0.0.1:9443"
        interfaces: [eth0, eth1]
      - address: "10.0.0.2:9443"
        interfaces: [eth2, eth3]
    takeover_on_failure: true
```

The `interface_assignments` block is identical on every node of the cluster. What
differs per node is `advertised_addr`, which is how a node recognises its own
entry, and `peers`, which lists the others.

`advertised_addr` is deliberately separate from `listen_addr`: the listener
usually binds a wildcard, so what a node listens on and what its peers call it
are different strings, and a node that matched its own assignment against the
wildcard would match nothing while reporting itself configured.

The agent refuses to start in `active-active` mode if `advertised_addr` is unset,
if no assignment carries it, or if an assignment names an address that is neither
this node nor one of `peers`. Each of those is a configuration that would
otherwise leave a node driving no traffic while reporting itself healthy.

### Behavior

- On startup in `ActiveActive` mode, each node loads eBPF programs **only** for its assigned interfaces, whether or not it wins the election: leadership decides which node sends heartbeats, not which node carries traffic
- The leader still coordinates state replication and elections; both nodes process traffic independently on their interfaces
- **Peer failure** with `takeover_on_failure: true`: the surviving node reloads its datapath for its own interfaces plus the failed node's, and records what it borrowed. Repeating the check while the peer stays down changes nothing, so a long outage is one handover rather than one per heartbeat round
- **Peer recovery**: the surviving node releases only what it recorded as borrowed and reloads for its own interfaces. An interface it owns in its own right is never handed back, and a node that borrowed nothing tears nothing down
- A change of interface set is a reload of the datapath rather than a per-interface attach, because the eBPF loader owns one pinned generation per host. The interfaces this node owns are detached and re-attached along with the borrowed ones, which costs a sub-second gap on them
- In `active-passive` mode (default), `interface_assignments` and `advertised_addr` are ignored and behavior matches leader-only eBPF attachment

## Graceful Degradation

Controls agent behavior when it loses contact with its peer and enters a degraded state (e.g., network partition, peer crash).

### DegradationPolicy

| Policy | Behavior |
|--------|----------|
| `Continue` | Default. Keep running normally with a warning. Accept configuration changes. |
| `ReadOnly` | Keep current eBPF rules active. Reject configuration changes via the API (returns `503 Service Unavailable`). |
| `FailClosed` | Everything `ReadOnly` does, plus a deny-all posture on the datapath. Only the anti-lockout ports stay reachable. |

### ClusterHealth

| State | Meaning |
|-------|---------|
| `Healthy` | All peers reachable, replication up to date |
| `Degraded` | One or more peers unreachable, operating under degradation policy |
| `Isolated` | No peers reachable, node is completely alone |

### Behavior

**Degradation entry** is evaluated at the end of every heartbeat round, so the
peer failures that round recorded are part of the judgement. The node writes the
new `cluster_health` and, on a transition out of `Healthy`, applies the
configured policy.

**Continue** logs a warning and changes nothing. Configuration updates are
accepted and the datapath is untouched. This is the right answer for a
deployment that would rather let the two halves diverge than stop, and it is the
default because stopping is the surprising outcome.

**ReadOnly** refuses every state-changing request for as long as the node is
degraded. `GET`, `HEAD` and `OPTIONS` are served normally, so an operator
diagnosing the partition can still read everything. Any other method answers
`503 Service Unavailable`, including a method the agent does not recognise: a
verb nobody classified is treated as a write rather than waved through, which is
the same split the rate limiter and the role check use.

```json
{
  "error": "cluster in read-only degraded mode",
  "code": "HA_READ_ONLY_DEGRADED"
}
```

The eBPF programs stay loaded and traffic keeps flowing: only the configuration
stops moving. The reason to refuse at all is that an isolated node cannot
replicate, so a rule written to it is a rule the rest of the cluster does not
have, and when the partition heals the two halves disagree about what the policy
is. A refusal at the moment of the change beats a divergence discovered later.

#### The one exemption

Everything under `/api/v1/ha` stays writable while the posture is in force. It
carries the manual failover command, which is the one write that exists to get a
degraded cluster out of the state being reported on, so refusing it would mean
the posture had removed its own remedy. The routes concerned are the six listed
under [High availability](../../api-reference/rest-api-enterprise.md#high-availability),
and the prefix matches before the query string, so a request carrying parameters
is exempt on the same terms.

The list is one prefix compiled into the agent and pinned by a test. There is no
configuration key that adds a second, deliberately: an exemption is a route that
may write a rule the rest of the cluster will not have, and the only reason this
one is safe is that failover changes cluster membership rather than policy.

Nothing else is exempt, and in particular the exemption is not a way round
authorization. The role check answers first, so a caller with no permission on a
route reads that they have no permission rather than that the cluster is
degraded; a `503` means the call would otherwise have gone through.

#### When the posture does not apply

The refusal is only ever raised by a node that has an HA configuration. A
deployment with no `high_availability` block has no cluster to be partitioned
from, so the check is skipped rather than evaluated and answered healthy, and no
request on such an agent can receive `HA_READ_ONLY_DEGRADED`.

`Continue` never raises it either. It is the default, so an agent that has HA
configured but has not chosen a policy keeps accepting changes through a
partition.

**FailClosed** does everything `ReadOnly` does, and additionally closes the
datapath. It applies only from `Isolated`, never from `Degraded`: a node that can
still see part of the cluster has not lost its view of the policy.

The posture is not a flip of the default policy. The XDP firewall passes
`ESTABLISHED` and `RELATED` flows before it consults the default policy, so
flipping that byte to `drop` would leave every connection that already existed
running - which is exactly the traffic the policy exists to stop. What is
installed instead is a pair of stateless catch-all deny rules, one per address
family, matching every connection state:

| Rule ID | Matches |
|---------|---------|
| `fail-closed-deny-all-v4` | `0.0.0.0/0`, any protocol, any connection state |
| `fail-closed-deny-all-v6` | `::/0`, any protocol, any connection state |

Two rules rather than one, because a rule carrying no address is loaded into the
IPv4 array only. Both are `system` rules, so the API cannot delete them while the
posture is in force, and they are named rather than generated so
`ebpfsentinel-agent firewall list` on a closed node says why nothing is getting
through. The default policy byte is set to `drop` as well, for the packets that
reach the datapath before the rule scan.

The posture also forces `firewall.mode` to `block` for its duration. In `alert`
mode every `deny` is rewritten into a log line on the way to the map, so a node
configured for alerting would have installed a deny-all that dropped nothing at
all. The configured mode is restored when the posture is lifted, along with the
rules that were loaded before it and the anti-lockout setting.

#### Reaching a node that has closed its datapath

A node in the deny-all posture must still be recoverable, so **anti-lockout is
forced on for the duration of the posture**, whatever
`firewall.anti_lockout.enabled` says, and restored to its configured value on
exit. The anti-lockout ports (`22`, `8080` and `50051` by default) keep their
`pass` rules and stay reachable.

This is forced rather than respected because of who enters the posture. An
operator who disables anti-lockout and writes a deny-all rule has made a choice
about their own access. This posture is entered by the cluster, on a schedule,
in response to a partition nobody was watching - and a node that cut its own
management access on the way in would need a physical visit to get back.

What is forced is the `enabled` flag alone. The ports and interfaces stay exactly
as configured, so narrowing the way in is done there rather than by turning
anti-lockout off:

| `firewall.anti_lockout` | What stays reachable while the posture is in force |
|---|---|
| `interfaces: []` (default) | The listed ports, on every interface |
| `interfaces: [mgmt0]` | The listed ports, on `mgmt0` only |
| `ports: []` | Nothing. The node closes completely and needs console access |

A deployment that sets `ports: []` has chosen a node it cannot reach over the
network while partitioned. That is a supportable choice for an appliance with
out-of-band access, and it is the one case where the posture does not leave a way
back in.

**Recovery**: when a peer becomes reachable again the node resyncs state via
snapshot replication and leaves degraded mode. Writes are accepted again, and if
the deny-all posture was installed it is lifted - the rules, the mode and the
anti-lockout setting that were in force before it are put back, rather than
recomputed from configuration, so changes made through the API since boot are not
lost. Lifting is attempted on every recovery rather than only where this process
installed the posture, because a node that restarted while closed has no memory
of installing one and would otherwise never open again.

### Configuration

```yaml
enterprise:
  ha:
    degradation_policy: continue   # continue | read-only | fail-closed
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

`HaPeerService` carries the cluster's own traffic on `listen_addr`
(`0.0.0.0:9443` by default), with connection pooling on the client side:

| RPC | Description |
|-----|-------------|
| `RequestVote` | Election vote request/response |
| `Heartbeat` | Leader heartbeat + ack |
| `ReplicateDelta` | Push incremental state update |
| `ReplicateSnapshot` | Push full state snapshot |
| `RequestSnapshot` | Follower requests initial sync |

The message shapes, the wire tags and what each call does to the node that
receives it are in the [gRPC API reference](../../api-reference/grpc-api.md).

:::warning The peer port is a trust boundary

This channel carries no authentication and no TLS. Whatever can open a TCP
connection to the port can force a leadership change or replace a node's
firewall, IPS and blocklist state. Bind `listen_addr` to the interface that
carries peer traffic, allow the port from the peer addresses only, and never
expose it to a client network or an ingress.

:::

## Configuration

```yaml
enterprise:
  ha:
    enabled: true
    mode: active-passive                    # active-passive | active-active
    peers:
      - 10.0.0.2:9443
      - 10.0.0.3:9443
    heartbeat_ms: 1000
    failure_threshold: 3
    max_replication_bandwidth: 104857600    # bytes/s (optional)
    replication_interval_ms: 200
    split_brain_policy: prefer_active       # prefer_active | prefer_standby | fence
    listen_addr: 0.0.0.0:9443               # what this node binds
    advertised_addr: "10.0.0.1:9443"        # what peers reach it on (active-active mode only)
    data_dir: /var/lib/ebpfsentinel/ha
    interface_assignments:                  # active-active mode only (list, one entry per node)
      - address: "10.0.0.1:9443"
        interfaces: [eth0, eth1]
      - address: "10.0.0.2:9443"
        interfaces: [eth2, eth3]
    takeover_on_failure: true               # active-active: take over peer interfaces on failure
    degradation_policy: continue            # continue | read-only | fail-closed
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable HA clustering |
| `peers` | list | `[]` | Peer addresses (required when enabled) |
| `heartbeat_ms` | u64 | `1000` | Heartbeat interval (must be > 0) |
| `failure_threshold` | u32 | `3` | Missed heartbeats before failover (must be > 0) |
| `max_replication_bandwidth` | u64 | - | Optional bandwidth cap in bytes/sec |
| `replication_interval_ms` | u64 | `200` | Replication tick interval |
| `split_brain_policy` | enum | `prefer_active` | Split-brain resolution policy |
| `listen_addr` | string | `0.0.0.0:9443` | gRPC listen address this node binds |
| `advertised_addr` | string | `""` | The address peers reach this node on, and the name its assignment carries (required in active-active mode) |
| `data_dir` | string | `/var/lib/ebpfsentinel/ha` | Persistent state directory |
| `mode` | enum | `active-passive` | HA mode: `active-passive` or `active-active` |
| `interface_assignments` | list | `[]` | Per-node `{address, interfaces}` entries, identical on every node (active-active mode only) |
| `takeover_on_failure` | bool | `false` | Take over peer interfaces on failure (active-active mode only) |
| `degradation_policy` | enum | `continue` | Behavior when peer is lost: `continue`, `read-only`, `fail-closed` |

Validation: `heartbeat_ms > 0`, `failure_threshold > 0`, `peers` non-empty when enabled, `listen_addr` and `data_dir` non-empty, and no interface assigned to two nodes. When `mode` is `active-active`, `interface_assignments` and `advertised_addr` must both be set, one assignment must carry this node's `advertised_addr`, and every other assignment address must appear in `peers`.

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/ha/status` | viewer | high-availability | Cluster status (node_id, role, term, leader_id, peer_count, ebpf_active, ha_mode, cluster_health, degradation_policy, is_degraded). |
| `GET` | `/api/v1/ha/peers` | viewer | high-availability | Peer list with addresses. |
| `POST` | `/api/v1/ha/failover` | operator | high-availability | Manual failover (leader only, 409 Conflict if not leader or no peers). |
| `GET` | `/api/v1/ha/replication` | viewer | high-availability | Per-category replication status (leader_seq, synced and initial_sync_complete flags). |
| `GET` | `/api/v1/ha/interfaces` | viewer | high-availability | Interface assignments and ownership status (active_active mode). |
| `GET` | `/api/v1/ha/health` | viewer | high-availability | Cluster health (ha_mode, cluster_health, degradation_policy, is_degraded). |

## Feature Gating

High Availability requires a valid license with the `high-availability` feature. Without a license, the agent runs standalone with no clustering.
