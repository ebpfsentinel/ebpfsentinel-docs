# gRPC API Reference

Port: `50051` (configurable via `agent.grpc_port`)

## Service and Messages

The section below is generated from `proto/ebpfsentinel/v1/alerts.proto`. Edit
the proto, not this page.

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

## Usage

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

## Authentication

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

## Health Check

Standard gRPC health checking protocol:

```bash
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

## Reflection

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

## Scope

eBPFsentinel is **REST-first**: all CRUD operations (firewall rules, rate limit policies, NAT rules, LB services, etc.) are managed via the [REST API](rest-api.md). gRPC is used exclusively for **real-time alert streaming** (`AlertStreamService`), providing server-push event delivery for SIEM integrations and monitoring dashboards.

## Proto File

The proto file is at `proto/ebpfsentinel/v1/alerts.proto` in the repository.
