# Fleet Management

> **Edition: Enterprise** | **Status: Shipped**

## Overview

REST API for fleet-wide agent management. Provides agent registration with persistent identity, heartbeat with live rule/config aggregation, identity introspection, config version tracking, and network flow graph visualization. Designed for consumption by K8s operators, Ansible, Terraform, or any fleet management tool.

Gated by the `FleetManagement` license feature.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/agent/register` | None | Register agent, get UUIDv7 identity + token |
| POST | `/api/v1/agent/heartbeat` | Token | Report status, receive aggregated health |
| GET | `/api/v1/agent/identity` | Token | Full agent identity with capabilities |
| GET | `/api/v1/agent/config/version` | Token | Config SHA-256 hash + reload timestamp |
| GET | `/api/v1/flows/graph` | Token | Network flow graph from conntrack data |

## Agent Registration

**POST** `/api/v1/agent/register`

Registers the agent and returns a persistent identity. Idempotent: re-registering with the same `name` updates labels/endpoint but preserves the `agent_id` and `token`.

### Request

```json
{
  "name": "prod-node-01",
  "labels": {
    "env": "production",
    "region": "eu-west-1",
    "cluster": "k8s-main"
  },
  "api_endpoint": "https://10.0.1.5:8443",
  "tls_fingerprint": "sha256:a1b2c3..."
}
```

Only `name` is required. All other fields are optional.

### Response

```json
{
  "agent_id": "019538a2-7f3b-7def-8123-456789abcdef",
  "name": "prod-node-01",
  "registered_at": 1709913600,
  "token": "e3b0c44298fc1c149afbf4c8996fb924..."
}
```

- `agent_id`: UUIDv7 (time-ordered, globally unique)
- `token`: SHA-256 of `"{agent_id}:{timestamp}"` — used for heartbeat authentication
- `registered_at`: Unix epoch seconds

### Idempotency

| Scenario | Behavior |
|----------|----------|
| Same `name` | Updates labels/endpoint/capabilities, keeps `agent_id` + `token` |
| Different `name` | Creates new identity (replaces previous) |
| Empty `name` | Returns 400 Bad Request |

### Capability Auto-Detection

On registration, the agent introspects its own service state and populates `capabilities`:

All 13 OSS domains: `firewall`, `ips`, `l7`, `ratelimit`, `threatintel`, `ids`, `conntrack`, `ddos`, `dlp`, `nat`, `loadbalancer`, `qos`, `dns`.

### Identity Persistence

When `data_dir` is configured, the agent writes `agent-identity.json` to disk after each registration. On startup, the persisted identity is loaded so the agent retains its `agent_id` across restarts.

```
{data_dir}/agent-identity.json
```

## Agent Heartbeat

**POST** `/api/v1/agent/heartbeat`

Aggregates live agent status in < 5 ms (all in-memory reads).

### Request

```json
{
  "agent_id": "019538a2-7f3b-7def-8123-456789abcdef"
}
```

### Response

```json
{
  "status": "healthy",
  "uptime_seconds": 86400,
  "ebpf_loaded": true,
  "active_rules": {
    "firewall": 42,
    "ids": 15,
    "ips": 8,
    "l7": 12,
    "ratelimit": 5
  },
  "metrics_snapshot": {
    "packets_total": 0,
    "alerts_total": 0,
    "cpu_percent": 0.0,
    "memory_bytes": 0
  },
  "agent_version": "0.0.0-dev",
  "config_version": "a1b2c3d4e5f6...",
  "pending_changes": false
}
```

- `active_rules`: Live rule counts from each domain engine (firewall, IDS, IPS, L7, ratelimit)
- `config_version`: SHA-256 hex of serialized YAML config
- `metrics_snapshot`: Reserved for future enrichment (Prometheus metrics are write-only; scrape `/metrics` for live counters)
- `pending_changes`: Whether config changes are pending application

Returns 401 if `agent_id` does not match the registered identity.

## Agent Identity

**GET** `/api/v1/agent/identity`

Full introspection of the registered agent.

### Response

```json
{
  "agent_id": "019538a2-7f3b-7def-8123-456789abcdef",
  "name": "prod-node-01",
  "labels": { "env": "production" },
  "api_endpoint": "https://10.0.1.5:8443",
  "agent_version": "0.0.0-dev",
  "enterprise": true,
  "capabilities": ["firewall", "ips", "ids", "conntrack", "dns"],
  "ebpf_programs": [
    { "name": "xdp-firewall", "loaded": true },
    { "name": "xdp-ratelimit", "loaded": true },
    { "name": "tc-ids", "loaded": true },
    { "name": "tc-threatintel", "loaded": true },
    { "name": "tc-dns", "loaded": true },
    { "name": "tc-conntrack", "loaded": true },
    { "name": "tc-nat-ingress", "loaded": false },
    { "name": "tc-nat-egress", "loaded": false },
    { "name": "tc-qos", "loaded": false },
    { "name": "tc-scrub", "loaded": false },
    { "name": "uprobe-dlp", "loaded": false }
  ],
  "tls": {
    "enabled": true,
    "pq_mode": "Hybrid"
  },
  "registered_at": 1709913600,
  "uptime_seconds": 86400
}
```

- `enterprise`: Always `true` for enterprise agents
- `ebpf_programs`: All 11 known eBPF programs with their load status
- `tls.pq_mode`: Post-quantum TLS mode (`Disabled`, `Preferred`, `Hybrid`, `Required`)

Returns 404 if the agent has not been registered.

## Config Version

**GET** `/api/v1/agent/config/version`

Lightweight endpoint (< 100 bytes response) for config drift detection.

### Response

```json
{
  "config_version": "a1b2c3d4e5f6...",
  "last_reload": 1709913600,
  "pending_changes": false
}
```

- `config_version`: SHA-256 hex of the serialized YAML config
- `last_reload`: Unix epoch of when the config was last loaded (startup time)

Fleet managers can poll this endpoint to detect config drift across agents by comparing `config_version` hashes.

## Network Flow Graph

**GET** `/api/v1/flows/graph`

Builds a directed graph of network flows from connection tracking data.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_nodes` | usize | 500 | Maximum number of IP nodes in the graph |
| `min_bytes` | u64 | none | Minimum total bytes (fwd + rev) per connection |
| `protocol` | u8 | none | Filter by IP protocol (6 = TCP, 17 = UDP) |
| `limit` | usize | 10000 | Maximum connections to read from conntrack |

### Response

```json
{
  "nodes": [
    { "ip": "10.0.1.5", "bytes": 1500000, "flows": 42 },
    { "ip": "10.0.2.10", "bytes": 800000, "flows": 15 }
  ],
  "edges": [
    {
      "src": "10.0.1.5",
      "dst": "10.0.2.10",
      "protocol": 6,
      "bytes": 1500000,
      "flows": 42,
      "first_seen": 1709900000000,
      "last_seen": 1709913600000
    }
  ]
}
```

### Graph Construction

1. Connections are read from the conntrack table (up to `limit`)
2. Filtered by `protocol` and `min_bytes` if specified
3. Aggregated by `(src_ip, dst_ip, protocol)` — multiple connections between the same pair are merged
4. Sorted by bytes descending
5. Capped at `max_nodes` unique IPs (edges requiring new IPs beyond the cap are dropped)

Nodes and edges are both sorted by bytes descending.

## Configuration

```yaml
enterprise:
  fleet:
    enabled: true
    data_dir: /var/lib/ebpfsentinel/fleet
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable fleet management endpoints |
| `data_dir` | string | none | Directory for persisting agent identity (optional) |

### Validation

- `data_dir` cannot be an empty string when set (rejected at startup)
- Directory is created automatically if it does not exist

## Prometheus Metrics

All fleet operations are instrumented under the `ebpfsentinel_ent_` prefix:

| Metric | Type | Description |
|--------|------|-------------|
| `fleet_registrations` | Counter | Agent registrations processed |
| `fleet_heartbeats` | Counter | Agent heartbeats received |
| `fleet_identity_queries` | Counter | Identity queries served |
| `fleet_config_version_queries` | Counter | Config version queries served |
| `fleet_flow_graph_queries` | Counter | Flow graph queries served |

## Domain Architecture

```
enterprise-domain/src/fleet/
├── mod.rs          # Module declaration
├── entity.rs       # DTOs: RegistrationRequest, HeartbeatResponse, FlowGraph, etc.
├── engine.rs       # FleetEngine: registration, idempotency, config hashing
├── error.rs        # FleetError: NotRegistered, InvalidRequest
└── flow_graph.rs   # FlowGraphBuilder: connection aggregation + graph construction
```

The handler (`enterprise-adapters/src/http/fleet_handler.rs`) bridges domain logic with OSS `ServiceHandles` for live rule counts and conntrack data.

## Integration Patterns

### Ansible / Terraform

```bash
# Register
curl -X POST http://agent:8444/api/v1/agent/register \
  -d '{"name":"node-01","labels":{"env":"prod"}}'

# Heartbeat (cron every 30s)
curl -X POST http://agent:8444/api/v1/agent/heartbeat \
  -d '{"agent_id":"019538a2-..."}'

# Config drift check
curl http://agent:8444/api/v1/agent/config/version
```

### Kubernetes Operator

The operator watches `EBPFSentinelAgent` CRDs and calls:
1. `/api/v1/agent/register` on pod creation
2. `/api/v1/agent/heartbeat` via liveness probe
3. `/api/v1/agent/config/version` to detect config drift and trigger rolling updates
