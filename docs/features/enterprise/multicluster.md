# Multi-Cluster Federation

> **Edition: Enterprise**

## Overview

Federated management across multiple eBPFsentinel clusters or standalone agents. A designated management cluster coordinates policy distribution (with dry-run support and per-cluster overrides), health monitoring with configurable thresholds, and alert aggregation with deduplication. State is persisted in redb for crash recovery.

## Architecture

```
Management Cluster
  ├── Federation Registry (redb-backed cluster store)
  │     ├── register / unregister clusters
  │     └── health monitoring (background task)
  ├── Policy Distribution (push to members, dry-run, overrides)
  │     └── Distribution History (last 1,000 results)
  └── Alert Aggregation (deduplication, broadcast, persistent store)
        └── Rolling Buffer (10,000 alerts) + Dedup Set (100,000 event IDs)

Member Cluster 1 ──── heartbeat ────► Management
Member Cluster 2 ──── heartbeat ────► Management
Member Cluster N ──── heartbeat ────► Management
```

## Cluster Registration

Members register with the management cluster:

```json
POST /api/v1/federation/clusters
{
  "name": "production-east",
  "api_endpoint": "https://east.internal:9443",
  "tls_fingerprint": "sha256:abcdef...",
  "agent_version": "v2026.6.1",
  "active_policies": ["default-firewall"]
}
```

Validation:
- Name and endpoint must be non-empty
- No duplicate endpoints across registered clusters
- Cluster assigned a UUIDv7 ID, status set to `Online`

## Cluster Health

Members send periodic heartbeats. Health status is derived from heartbeat freshness:

| State | Condition | Default Threshold |
|-------|-----------|-------------------|
| **Online** | Heartbeat within interval | < 90s since last heartbeat |
| **Degraded** | No heartbeat beyond degraded threshold | 90–180s |
| **Offline** | No heartbeat beyond offline threshold | > 180s |

### Health Monitor

A background task runs every `heartbeat_interval_secs` (default 30s):

1. Calculate elapsed time since each cluster's last heartbeat
2. Evaluate health status using thresholds
3. For unhealthy clusters: probe via `GET {endpoint}/api/v1/federation/status`
4. Update cluster state from probe response (or mark as degraded/offline on failure)
5. Persist updated state to redb

### Heartbeat Payload

```json
POST /api/v1/federation/heartbeat
{
  "cluster_id": "uuid",
  "status": "online",
  "agent_version": "v2026.6.1",
  "active_policies": ["default-firewall", "dlp-pci"]
}
```

## Policy Distribution

Push security policies to member clusters with optional per-cluster overrides and dry-run validation.

### Policy Types

| Type | Description |
|------|-------------|
| `firewall` | Firewall rules |
| `ids` | Intrusion detection rules |
| `ips` | Intrusion prevention rules |
| `ratelimit` | Rate limiting policies |
| `threatintel` | Threat intelligence feeds |
| `l7` | Layer 7 filtering rules |
| `ddos` | Anti-DDoS policies |
| `dlp` | DLP patterns |

### Push Request

```json
POST /api/v1/federation/policies/push
{
  "policy": {
    "id": "block-known-bad",
    "name": "Block Known Bad IPs",
    "policy_type": "firewall",
    "payload": { ... },
    "target_clusters": []           // empty = all clusters
  },
  "overrides": [
    {
      "cluster_id": "uuid-of-east",
      "override_payload": { ... }   // merged with base policy
    }
  ],
  "dry_run": false
}
```

### Distribution Status

| Status | Description |
|--------|-------------|
| `Pending` | Not yet processed |
| `Applied` | Successfully applied (includes `applied_at_ms`) |
| `Failed` | Error during push (includes `error` message) |
| `DryRunOk` | Dry-run validation passed |
| `DryRunFailed` | Dry-run validation failed |

Distribution history retains the last **1,000** results.

### Transport

`HttpClusterTransport` communicates with member clusters:

- `POST {endpoint}/api/v1/federation/policies/apply` for policy push
- `GET {endpoint}/api/v1/federation/status` for health checks
- Timeouts: 5s connect, 10s request
- Optional CA certificate for mTLS

### Policy Apply (Member Receiver)

Member clusters expose `POST /api/v1/federation/policies/apply`. On receipt the
member maps `policy_type` to the matching local engine
(firewall / ids / ips / ratelimit / threatintel / l7 / ddos / dlp), applies the
policy payload (a JSON array of that engine's rules), and responds:

- **Apply is atomic**: the member snapshots current state before applying and
  rolls back to the snapshot if the apply fails (fail closed), so a bad push
  never leaves the engine half-configured.
- **Dry-run** (`dry_run: true`) validates the payload shape without touching the
  datapath, reporting `DryRunOk` / `DryRunFailed`.
- **Per-cluster overrides** replace the policy payload for that member.
- The member reports its actually-applied policy set in its heartbeat and at
  `GET /api/v1/federation/status`, so the management can detect drift between
  pushed and enforced policies.

## Alert Aggregation

Alerts from member clusters are collected, deduplicated, and stored at the management level.

### Deduplication

- Each alert has a UUIDv7 `event_id` for deduplication
- Seen set capacity: **100,000** event IDs (FIFO eviction when exceeded)
- Rolling alert buffer: **10,000** alerts in memory (FIFO eviction)
- Broadcast channel (capacity 1,024) for real-time subscribers

### Persistent Alert Store

Optional `RedbFederatedAlertStore` with composite key `{timestamp_ms:020}:{event_id}` for chronological ordering. Supports:

- `save_alerts()` — persist batch
- `load_recent(limit)` — newest first
- `count()` / `count_since(timestamp_ms)` — for overview statistics

### Alert Ingestion

```json
POST /api/v1/federation/alerts
{
  "alerts": [
    {
      "event_id": "uuid",
      "cluster_id": "uuid",
      "cluster_name": "production-east",
      "severity": "high",
      "component": "ids",
      "message": "SQL injection detected",
      "source_ip": "10.0.1.50",
      "dest_ip": "10.0.2.100",
      "timestamp_ms": 1709913600000,
      "metadata": { ... }
    }
  ]
}

// Response
{ "ingested": 5, "duplicates": 2 }
```

### Alert Query

`GET /api/v1/federation/alerts?cluster_id=...&severity=high&component=ids&limit=50`

All filters are optional. Prefers persistent store if available (loads 4× limit for filtering headroom), falls back to in-memory buffer.

## Federation Overview

`GET /api/v1/federation/overview` returns fleet-wide statistics:

```json
{
  "total_clusters": 5,
  "online": 4,
  "degraded": 1,
  "offline": 0,
  "total_alerts": 12500,
  "alerts_last_hour": 42
}
```

## Persistence

Federation state is stored in **redb** (embedded key-value store):

| Table | Key | Value |
|-------|-----|-------|
| `federation_clusters` | UUID string | JSON-serialized Cluster |
| `federation_alerts` | `{timestamp:020}:{event_id}` | JSON-serialized FederatedAlert |

## Configuration

### Management Cluster

```yaml
enterprise:
  multi_cluster:
    enabled: true
    is_management: true
    ca_cert: /etc/ebpfsentinel/cluster-ca.pem
    heartbeat_interval_secs: 30
    degraded_threshold_secs: 90
    offline_threshold_secs: 180
    data_dir: /var/lib/ebpfsentinel/federation
```

### Member Cluster

```yaml
enterprise:
  multi_cluster:
    enabled: true
    is_management: false
    management_endpoint: https://management.internal:9443
    ca_cert: /etc/ebpfsentinel/cluster-ca.pem
    heartbeat_interval_secs: 30
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable federation |
| `is_management` | bool | `false` | Whether this node is the management cluster |
| `management_endpoint` | string | — | Management cluster URL (for members) |
| `ca_cert` | string | — | CA certificate for mTLS between clusters |
| `heartbeat_interval_secs` | u64 | `30` | Heartbeat interval |
| `degraded_threshold_secs` | u64 | `90` | Seconds until degraded status |
| `offline_threshold_secs` | u64 | `180` | Seconds until offline status |
| `data_dir` | string | `/var/lib/ebpfsentinel/federation` | Persistent state directory |
| `mtls` | object | — | Mutual-TLS enforcement (see below). Absent/disabled keeps the legacy plain-HTTP behaviour |

## Mutual TLS (mTLS)

By default federation routes are served on the plain enterprise API. Enabling
`mtls` moves them to a **dedicated client-cert-required listener**: the TLS
handshake itself authenticates the peer (a cluster without a CA-signed client
certificate cannot connect), and the management cluster **pins** each member's
presented client-cert SHA-256 fingerprint against the value recorded at
registration. The transport presents the node's client certificate on every
inter-cluster call.

```yaml
enterprise:
  multi_cluster:
    enabled: true
    is_management: true
    ca_cert: /etc/ebpfsentinel/cluster-ca.pem
    mtls:
      enabled: true
      listen_port: 9444            # dedicated mTLS federation listener
      ca_cert_path: /etc/ebpfsentinel/cluster-ca.pem
      server_cert_path: /etc/ebpfsentinel/node-server.pem
      server_key_path: /etc/ebpfsentinel/node-server.key
      client_cert_path: /etc/ebpfsentinel/node-client.pem
      client_key_path: /etc/ebpfsentinel/node-client.key
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Turn on mTLS enforcement |
| `listen_port` | u16 | `9444` | Port for the client-cert-required federation listener |
| `ca_cert_path` | string | — | PEM CA that signs all cluster certs (verifies both peers) |
| `server_cert_path` | string | — | PEM server cert chain presented to peers |
| `server_key_path` | string | — | PEM server private key |
| `client_cert_path` | string | — | PEM client cert presented when calling peers |
| `client_key_path` | string | — | PEM client private key |

### Migration (phased rollout)

`mtls` defaults **off**, so an existing unauthenticated federation keeps working
after upgrade. To migrate without downtime:

1. Issue a server + client certificate per node from a shared CA (the enterprise
   `tls_ca` tooling can generate them).
2. Distribute the CA + per-node certs and add the `mtls` block (`enabled: false`
   initially) to every node.
3. Flip `mtls.enabled: true` on all nodes and restart. Federation traffic moves
   to the `listen_port` listener; the plain-HTTP federation routes are withdrawn.
   Members re-register over mTLS, advertising their real client-cert fingerprint
   (replacing the legacy `auto-registered` placeholder), which the management
   pins on subsequent heartbeats.

## REST API

### Management Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/federation/clusters` | Register member cluster (201, 409 on duplicate endpoint) |
| `GET` | `/api/v1/federation/clusters` | List member clusters (summaries) |
| `GET` | `/api/v1/federation/clusters/{id}` | Cluster details (404 if not found) |
| `DELETE` | `/api/v1/federation/clusters/{id}` | Unregister cluster (204) |
| `GET` | `/api/v1/federation/overview` | Federation-wide status |
| `POST` | `/api/v1/federation/policies/push` | Distribute policy (with dry_run, overrides) |
| `GET` | `/api/v1/federation/policies/history` | Distribution history (last 1,000) |
| `POST` | `/api/v1/federation/alerts` | Ingest alerts from members |
| `GET` | `/api/v1/federation/alerts` | Query federated alerts (filters: cluster_id, severity, component, limit) |

### Member Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/federation/heartbeat` | Send heartbeat to management (204) |
| `POST` | `/api/v1/federation/policies/apply` | Apply a pushed policy locally (atomic, dry-run aware; 422 on failure) |
| `GET` | `/api/v1/federation/status` | Federation health + applied-policy set (health-probe target) |

## Feature Gating

Multi-Cluster Federation requires a valid license with the `multi-cluster` feature. Without a license, the agent operates standalone with no federation capabilities.
