# gRPC API Reference

Two services speak gRPC across this product, and they exist for opposite
reasons. `AlertStreamService` is a client-facing read stream served by both
agents. `HaPeerService` is a peer-to-peer control channel between the nodes of
one enterprise HA cluster, and nothing outside that cluster has any business
calling it.

## Services at a glance

| Service | Agent | Port | Called by | Licence feature |
|---------|-------|------|-----------|-----------------|
| `ebpfsentinel.v1.AlertStreamService` | open source and enterprise | `50051` | clients, SIEMs, dashboards | none |
| `ebpfsentinel.enterprise.v1.HaPeerService` | enterprise | `9443` | the other nodes of the same HA cluster | `high-availability` |

## Alert streaming

Port: `50051` (configurable via `agent.grpc_port`). Served whatever the licence
carries, and by the enterprise agent as well as the open-source one.

The section below is generated from `proto/ebpfsentinel/v1/alerts.proto` in the
agent repository. Edit the proto, not this page.

<!-- BEGIN GENERATED MESSAGES -->

### AlertStreamService

Real-time alert streaming service.

```protobuf
rpc StreamAlerts(StreamAlertsRequest) returns (stream AlertEvent);
```

`StreamAlerts`: Server-streaming RPC: client subscribes and receives alerts in real time.

### StreamAlertsRequest

Request to subscribe to the alert stream with optional filters.

4 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `min_severity` | `string` | Optional severity filter (e.g. "high", "critical"). Empty = all severities. |
| 2 | `component` | `string` | Optional component filter (e.g. "ids", "dlp", "threatintel"). Empty = all components. |
| 3 | `mitre_tactic` | `string` | Optional MITRE ATT&CK tactic filter (e.g. "exfiltration"). Empty = all tactics. |
| 4 | `mitre_technique_id` | `string` | Optional MITRE ATT&CK technique ID filter (e.g. "T1041"). Empty = all techniques. |

### AlertEvent

A single alert event streamed to the client.

37 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `id` | `string` | Unique alert identifier. |
| 2 | `timestamp_ns` | `uint64` | Wall-clock timestamp in nanoseconds since UNIX epoch. |
| 3 | `component` | `string` | Originating component (e.g. "ids", "dlp", "threatintel"). |
| 4 | `severity` | `string` | Alert severity: "low", "medium", "high", "critical". |
| 5 | `rule_id` | `string` | Matched rule ID. |
| 6 | `action` | `string` | Action taken: "alert" or "block". |
| 7 | `src_addr` | `repeated uint32` | Source IP address as four big-endian uint32 words. IPv4: [v4, 0, 0, 0]. IPv6: full 128-bit address. |
| 8 | `dst_addr` | `repeated uint32` | Destination IP address (same encoding as src_addr). |
| 9 | `src_port` | `uint32` | Source port. |
| 10 | `dst_port` | `uint32` | Destination port. |
| 11 | `protocol` | `uint32` | IP protocol number (6=TCP, 17=UDP, etc.). |
| 12 | `message` | `string` | Human-readable alert message. |
| 13 | `is_ipv6` | `bool` | True if the addresses are IPv6. |
| 14 | `false_positive` | `bool` | Whether this alert has been marked as a false positive. |
| 15 | `src_domain` | `string` | Reverse-DNS domain for source IP (empty if not resolved). |
| 16 | `dst_domain` | `string` | Reverse-DNS domain for destination IP (empty if not resolved). |
| 17 | `src_domain_score` | `double` | Reputation score for source domain (0.0=clean, 1.0=malicious, -1 if absent). |
| 18 | `dst_domain_score` | `double` | Reputation score for destination domain (-1 if absent). |
| 31 | `src_geo` | `string` | GeoIP location for source IP (empty if not resolved). |
| 32 | `dst_geo` | `string` | GeoIP location for destination IP (empty if not resolved). |
| 19 | `confidence` | `int32` | ThreatIntel: IOC confidence score (0-100, -1 if absent). |
| 20 | `threat_type` | `string` | ThreatIntel: threat category (malware, c2, scanner, spam, other). Empty if absent. |
| 21 | `data_type` | `string` | DLP: data category (pci, pii, credentials, custom). Empty if absent. |
| 22 | `pid` | `uint32` | DLP: process ID that triggered the alert (0 if absent). |
| 23 | `tgid` | `uint32` | DLP: thread group ID (0 if absent). |
| 24 | `direction` | `int32` | DLP: direction (0=write, 1=read, -1 if absent). |
| 25 | `matched_domain` | `string` | IDS: matched domain name for domain-aware rules. Empty if absent. |
| 26 | `attack_type` | `string` | DDoS: attack type (SynFlood, UdpAmplification, etc.). Empty if absent. |
| 27 | `peak_pps` | `uint64` | DDoS: peak packets per second observed (0 if absent). |
| 28 | `current_pps` | `uint64` | DDoS: current smoothed packets per second / EWMA (0 if absent). |
| 29 | `mitigation_status` | `string` | DDoS: mitigation status (Detecting, Active, Mitigated, Expired). Empty if absent. |
| 30 | `total_packets` | `uint64` | DDoS: total packets in attack (0 if absent). |
| 33 | `mitre_technique_id` | `string` | MITRE ATT&CK technique ID (e.g. "T1071", "T1499.001"). Empty if absent. |
| 34 | `mitre_technique_name` | `string` | MITRE ATT&CK technique name (e.g. "Application Layer Protocol"). Empty if absent. |
| 35 | `mitre_tactic` | `string` | MITRE ATT&CK tactic in kebab-case (e.g. "command-and-control"). Empty if absent. |
| 36 | `ja4_fingerprint` | `string` | JA4 TLS ClientHello fingerprint (e.g. "t13d1516h2_8daaf6152771_02713d6af862"). Empty if absent. |
| 37 | `container` | [`ContainerIdentity`](#containeridentity) | Container / Kubernetes provenance resolved from the event's cgroup_id. Unset for host-namespace processes (nothing to attribute). |

### ContainerIdentity

Container and Kubernetes provenance for an alert, resolved from the originating process's cgroup_id. Mirrors the HTTP alert DTO's container block. The Kubernetes fields are populated only when a k8s enricher attached pod metadata.

6 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `runtime` | `string` | Detected runtime (docker, containerd, crio, podman, unknown). |
| 2 | `id` | `string` | Container ID. |
| 3 | `cgroup_path` | `string` | cgroup path the resolver matched. |
| 4 | `namespace` | `string` | Kubernetes namespace (empty unless a k8s enricher attached metadata). |
| 5 | `pod` | `string` | Kubernetes pod name (empty unless a k8s enricher attached metadata). |
| 6 | `container_name` | `string` | Kubernetes container name (empty unless a k8s enricher attached metadata). |

<!-- END GENERATED MESSAGES -->
### Usage

```bash
# All alerts
grpcurl -plaintext localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts

# Only critical IDS alerts
grpcurl -plaintext -d '{"min_severity":"critical","component":"ids"}' \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts

# Filter by MITRE ATT&CK tactic
grpcurl -plaintext -d '{"mitre_tactic":"exfiltration"}' \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts

# Filter by MITRE ATT&CK technique ID
grpcurl -plaintext -d '{"mitre_technique_id":"T1041"}' \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts

# With TLS
grpcurl -cacert server.crt localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

### Authentication

gRPC supports the same authentication methods as the REST API.

**Bearer token (JWT):** Pass via the `authorization` metadata header:

```bash
grpcurl -plaintext -H "authorization: Bearer <JWT>" \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

**API key:** Pass via the `x-api-key` metadata header:

```bash
grpcurl -plaintext -H "x-api-key: sk-admin-key" \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

The server checks `authorization` metadata first. If absent, it falls back to `x-api-key`. Bearer tokens must have valid JWT structure (three Base64-encoded parts separated by dots).

### Health Check

Standard gRPC health checking protocol:

```bash
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

### Reflection

gRPC server reflection is **disabled by default**. To enable it, set `agent.grpc_reflection` in your configuration:

```yaml
agent:
  grpc_reflection: true
```

Once enabled:

```bash
# List available services
grpcurl -plaintext localhost:50051 list

# Describe a service
grpcurl -plaintext localhost:50051 describe ebpfsentinel.v1.AlertStreamService
```

When reflection is disabled, `grpcurl list` will return an error. Use the proto file directly with `-proto` instead.

## HA peer service

Port: `9443` (configurable via `enterprise.ha.listen_addr`). Mounted by the
enterprise agent only, when the licence carries `high-availability` and
`enterprise.ha.enabled` is set. Neither condition met means nothing listens on
the port at all.

This is **not a client API**. The only legitimate caller is another node of the
same HA cluster: the RPCs carry leader elections and state replication between
peers, and the addresses that may call them are exactly the ones listed in
`enterprise.ha.peers` on each node.

### What each call does to the node that receives it

| RPC | Effect on the receiving node |
|-----|------------------------------|
| `RequestVote` | Grants or refuses a vote; a vote granted for a term ahead of its own makes it a follower and clears the leader it knew |
| `Heartbeat` | Accepts the caller as leader for that term, reverts to follower, resets the failover timer and answers with its own role |
| `ReplicateDelta` | Applies an incremental change to one category of runtime state - firewall rules, IPS rules, blocklists, NAT and QoS among them |
| `ReplicateSnapshot` | Replaces one whole category of runtime state with the payload |
| `RequestSnapshot` | Reads out a full snapshot of one category of its own state |

`ReplicateDelta`, `ReplicateSnapshot` and `RequestSnapshot` answer
`UNIMPLEMENTED` when replication is not configured.

### Trust boundary

The peer channel carries no authentication and no TLS: the server is a plain
tonic listener and the peer clients dial `http://`. Everything the table above
describes is therefore available to whatever can open a TCP connection to the
port - forcing a leadership change with `RequestVote`, installing firewall or
IPS rules with `ReplicateSnapshot`, or reading a node's rule set out with
`RequestSnapshot`.

Treat `9443` the way you would treat a database replication port:

- Bind it to the interface that carries peer traffic rather than to `0.0.0.0`,
  by setting `enterprise.ha.listen_addr` to that address.
- Allow it from the HA peer addresses and from nothing else, at the host
  firewall or the network policy.
- Never expose it to a client network, an ingress or the internet.
- Keep the peer set on a network segment you would be willing to give root on
  every node in the cluster to, because that is what reaching the port grants.

The HTTP API that *reports* on HA - `/api/v1/ha/status`, `/api/v1/ha/peers`,
`/api/v1/ha/failover` and the rest - is a different surface on port `8444` with
authentication and RBAC in front of it. See
[Enterprise REST API](rest-api-enterprise.md).

### Messages

The section below is generated from
`proto/ebpfsentinel/enterprise/v1/ha.proto` in the enterprise repository. Edit
the proto, not this page.

<!-- BEGIN GENERATED ENTERPRISE MESSAGES -->

### HaPeerService

Peer-to-peer control channel between the nodes of one HA cluster. Never a client API: the only caller is another node of the same cluster.

```protobuf
rpc RequestVote(VoteRequest) returns (VoteResponse);
rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResponse);
rpc ReplicateDelta(ReplicateDeltaRequest) returns (ReplicationAckResponse);
rpc ReplicateSnapshot(ReplicateSnapshotRequest) returns (ReplicationAckResponse);
rpc RequestSnapshot(SnapshotRequest) returns (ReplicateSnapshotRequest);
```

`RequestVote`: A candidate asks this node for its vote in the term it names.

`Heartbeat`: The leader tells this node it is still alive, and learns this node's role.

`ReplicateDelta`: The leader pushes an incremental state update for one category.

`ReplicateSnapshot`: The leader pushes a full state snapshot for one category.

`RequestSnapshot`: A follower asks for a full snapshot of one category to catch up with.

### VoteRequest

A candidate's request for one node's vote.

2 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `candidate_id` | `string` | The candidate's node ID, a UUID. A value that does not parse is rejected. |
| 2 | `term` | `uint64` | The term the candidate is standing in. |

### VoteResponse

One node's answer to a candidate.

3 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `voter_id` | `string` | The answering node's ID. |
| 2 | `term` | `uint64` | The term the answering node is on, which may be ahead of the candidate's. |
| 3 | `granted` | `bool` | Whether the vote was granted. |

### HeartbeatRequest

The leader's periodic liveness message.

2 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `leader_id` | `string` | The leader's node ID, a UUID. A value that does not parse is rejected. |
| 2 | `term` | `uint64` | The term the leader is serving. |

### HeartbeatResponse

One node's acknowledgement of a heartbeat.

3 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `node_id` | `string` | The answering node's ID. |
| 2 | `term` | `uint64` | The term the answering node is on. |
| 3 | `role` | `string` | The answering node's role: `leader`, `follower` or `candidate`. |

### ReplicateDeltaRequest

An incremental state update pushed by the leader.

6 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `leader_id` | `string` | The leader's node ID, a UUID. |
| 2 | `term` | `uint64` | The term the leader is serving. A stale term is refused. |
| 3 | `category` | [`StateCategory`](#statecategory) | Which slice of state this update belongs to. |
| 4 | `seq` | `uint64` | Position in the per-category sequence. Gaps make the follower ask for a snapshot rather than apply the update. |
| 5 | `timestamp_ms` | `uint64` | When the leader produced the update, in milliseconds since UNIX epoch. |
| 6 | `payload` | `bytes` | The encoded update. Opaque on the wire and decoded by the category's own applier. |

### ReplicateSnapshotRequest

A full state snapshot for one category. Also the reply to RequestSnapshot.

7 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `leader_id` | `string` | The sending node's ID, a UUID. |
| 2 | `term` | `uint64` | The term the snapshot was taken in. |
| 3 | `category` | [`StateCategory`](#statecategory) | Which slice of state the snapshot covers. |
| 4 | `seq` | `uint64` | The sequence number the snapshot is current as of. |
| 5 | `timestamp_ms` | `uint64` | When the snapshot was taken, in milliseconds since UNIX epoch. |
| 6 | `payload` | `bytes` | The encoded snapshot. |
| 7 | `compressed` | `bool` | Whether the payload is compressed. |

### ReplicationAckResponse

A follower's acknowledgement of a delta or a snapshot.

4 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `node_id` | `string` | The acknowledging node's ID. |
| 2 | `term` | `uint64` | The term the acknowledging node is on. |
| 3 | `category` | [`StateCategory`](#statecategory) | Which slice of state was applied. |
| 4 | `applied_seq` | `uint64` | The highest sequence number now applied for that category. |

### SnapshotRequest

A follower's request for a full snapshot of one category.

2 fields, in declaration order. The number is the wire tag and never changes.

| # | Field | Type | Description |
|---|-------|------|-------------|
| 1 | `node_id` | `string` | The asking node's ID. |
| 2 | `category` | [`StateCategory`](#statecategory) | Which slice of state to snapshot. |

### StateCategory

The slice of runtime state a replication message carries. One category is replicated independently of the others, with its own sequence numbers.

14 values. The number is the wire value and never changes.

| # | Value | Description |
|---|-------|-------------|
| 0 | `STATE_CATEGORY_UNSPECIFIED` | Never sent. A message carrying it is rejected. |
| 1 | `STATE_CATEGORY_DNS_BLOCKLIST` |  |
| 2 | `STATE_CATEGORY_IDS_THRESHOLDS` |  |
| 3 | `STATE_CATEGORY_THREAT_INTEL_IP_SETS` |  |
| 4 | `STATE_CATEGORY_FIREWALL_RULES` |  |
| 5 | `STATE_CATEGORY_RATE_LIMIT_POLICIES` |  |
| 6 | `STATE_CATEGORY_IPS_RULES` |  |
| 7 | `STATE_CATEGORY_L7_RULES` |  |
| 8 | `STATE_CATEGORY_DDOS_POLICIES` |  |
| 9 | `STATE_CATEGORY_DLP_PATTERNS` |  |
| 10 | `STATE_CATEGORY_NAT_RULES` |  |
| 11 | `STATE_CATEGORY_LB_SERVICES` |  |
| 12 | `STATE_CATEGORY_QOS_CONFIG` |  |
| 13 | `STATE_CATEGORY_ROUTING_GATEWAYS` |  |

### SplitBrainPolicyProto

How a node resolves a split brain. Declared for a future peer exchange of the policy and carried by no message today, so a node learns it from its own `split_brain_policy` configuration key rather than from a peer.

4 values. The number is the wire value and never changes.

| # | Value | Description |
|---|-------|-------------|
| 0 | `SPLIT_BRAIN_POLICY_UNSPECIFIED` | Never sent. |
| 1 | `SPLIT_BRAIN_POLICY_PREFER_ACTIVE` | The node that was already active keeps the lead. |
| 2 | `SPLIT_BRAIN_POLICY_PREFER_STANDBY` | The standby takes the lead. |
| 3 | `SPLIT_BRAIN_POLICY_FENCE` | Neither node leads until the partition heals. |

<!-- END GENERATED ENTERPRISE MESSAGES -->

## Scope

eBPFsentinel is **REST-first**: all CRUD operations (firewall rules, rate limit
policies, NAT rules, LB services, etc.) are managed via the
[REST API](rest-api.md). Client-facing gRPC is used exclusively for
**real-time alert streaming** (`AlertStreamService`), providing server-push
event delivery for SIEM integrations and monitoring dashboards. The enterprise
`HaPeerService` is not part of that surface: it is machinery between cluster
nodes, and no integration should call it.

## Proto Files

| Proto | Repository | Package |
|-------|------------|---------|
| `proto/ebpfsentinel/v1/alerts.proto` | agent | `ebpfsentinel.v1` |
| `proto/ebpfsentinel/enterprise/v1/ha.proto` | enterprise agent | `ebpfsentinel.enterprise.v1` |
