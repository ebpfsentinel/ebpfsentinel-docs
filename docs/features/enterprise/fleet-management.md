# Fleet Management

> **Edition: Enterprise**

## Overview

REST API for fleet-wide agent management. Provides agent registration with persistent identity, heartbeat with live rule/config aggregation, identity introspection, config version tracking, and network flow graph visualization. Designed for consumption by K8s operators, Ansible, Terraform, or any fleet management tool.

Gated by the `FleetManagement` license feature.

## Endpoints

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `POST` | `/api/v1/agent/register` | operator | fleet-management | Register agent, get UUIDv7 identity + token. |
| `POST` | `/api/v1/agent/heartbeat` | operator | fleet-management | Report status, receive aggregated health. |
| `GET` | `/api/v1/agent/identity` | viewer | fleet-management | Full agent identity with capabilities. |
| `GET` | `/api/v1/agent/config/version` | viewer | fleet-management | Config SHA-256 hash, when it was applied, whether the file has moved since. |
| `GET` | `/api/v1/flows/graph` | viewer | fleet-management | Network flow graph from conntrack data. |

### What authenticates what

Two different credentials are in play, and neither substitutes for the other.

| Credential | Where it travels | Which routes require it |
|------------|------------------|-------------------------|
| The API credential (`Authorization: Bearer <token>` or `X-API-Key: <key>`) | HTTP header | All five, whenever `auth.enabled: true` |
| The agent token minted by registration | The `token` field of the heartbeat request body | `POST /api/v1/agent/heartbeat` only |

With `auth.enabled: true` these endpoints require the API credential like every
other enterprise endpoint, registration included: enrolment is not a bootstrap
exemption, so provision the fleet credential before the first `register` call.

The agent token is a second, narrower proof, and it is checked on the heartbeat
alone. It is what distinguishes this agent from anything else holding the same
API credential, so a fleet-wide read credential cannot be used to heartbeat as a
named node. `agent_id` is not a credential and is never treated as one: it is
returned by `GET /api/v1/agent/identity` and it appears in the log lines the
fleet writes.

The other three routes carry no per-agent proof, because none of them asserts an
identity: `register` mints the first token and so cannot require one, while
`identity`, `config/version` and `flows/graph` are reads of this agent's own
state by whoever already holds the API credential.

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

- `agent_id`: UUIDv7 (time-ordered, globally unique). Not a secret: it is published by `GET /api/v1/agent/identity`
- `token`: 32 random bytes as 64 lowercase hex characters, read from the operating system's random source. It is what the heartbeat is held to, it relates to nothing else the agent publishes, and it is returned exactly once per registration, so store it when you receive it
- `registered_at`: Unix epoch seconds

The token is not derived from `agent_id`, `registered_at` or any other field this
API returns. An agent upgraded from a build that did derive it replaces the
stored token with a random one the first time it starts, once, and logs that it
did; a fleet manager holding the old value gets 401 on the next heartbeat and
must register again to obtain the new one.

### Idempotency

| Scenario | Behavior |
|----------|----------|
| Same `name` | Updates labels/endpoint/capabilities, keeps `agent_id` + `token` |
| Different `name` | Creates new identity (replaces previous) |
| Empty `name` | Returns 400 Bad Request |

### Capability Auto-Detection

On registration, the agent reads its own configuration and reports the sections it has enabled. A capability is claimed when its section carries `enabled: true`, so the list answers what this agent runs rather than what the product offers, and two agents on the same fleet report different lists.

One capability per OSS domain: `firewall`, `ids`, `ips`, `l7`, `ratelimit`, `threatintel`, `conntrack`, `ddos`, `dlp`, `nat`, `loadbalancer`, `qos`, `dns`.

An agent running only a firewall and DNS inspection reports two:

```json
{ "capabilities": ["firewall", "dns"] }
```

An agent with every section disabled reports an empty list. That is a working agent inspecting nothing, and it is meant to be visible as such.

### Identity Persistence

When `data_dir` is configured, the agent writes `agent-identity.json` to disk after each registration. On startup, the persisted identity is loaded so the agent retains its `agent_id` and its token across restarts.

```
{data_dir}/agent-identity.json
```

The file holds the token, so it is a credential file and is written like one:
mode `0600`, and `0700` on the directory when the agent is the one that created
it. A `data_dir` the operator laid out keeps the mode the operator chose, so
check it if you provision that directory yourself. The write goes to a temporary
file beside the target and is renamed into place, so a machine losing power
mid-write comes back with the previous identity rather than with half of the new
one.

## Agent Heartbeat

**POST** `/api/v1/agent/heartbeat`

Aggregates live agent status in < 5 ms (all in-memory reads).

### Request

```json
{
  "agent_id": "019538a2-7f3b-7def-8123-456789abcdef",
  "token": "9f2a4c81d0e75b3648af1c9e2d05b7a3c48e1f60b92d7a5c3e08f14b6d29a7c5"
}
```

Both fields are required. `token` is the value registration returned.

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

- `status`: The agent's health, judged over its datapath
- `active_rules`: Live rule counts from each domain engine (firewall, IDS, IPS, L7, ratelimit)
- `config_version`: SHA-256 hex of the serialized YAML configuration the running datapath was built from
- `metrics_snapshot`: Reserved for future enrichment (Prometheus metrics are write-only; scrape `/metrics` for live counters)
- `pending_changes`: Whether the configuration file on disk has been edited since that datapath was built

Returns 401 with `{"error": "agent identifier or token not recognised"}` when the
identifier is not the registered one, when the token is not the one registration
handed back, or when no token was sent at all. One message covers all three, so a
caller learns nothing from which of them it got wrong.

### Health

`status` is one of three words, and it is a judgement over the datapath rather than over the HTTP surface: an agent answering this request while nothing is attached is exactly the failure the word exists to make visible.

| `status` | What it means |
|----------|---------------|
| `healthy` | The datapath is loaded and every program that reported a state is attached |
| `degraded` | The datapath is loaded and at least one program is not attached. The agent is protecting part of what it was asked to protect |
| `unhealthy` | No datapath. The agent is answering requests and inspecting nothing |

A node whose NAT programs failed to attach reports:

```json
{
  "status": "degraded",
  "ebpf_loaded": true
}
```

A node that came up with no datapath at all reports:

```json
{
  "status": "unhealthy",
  "ebpf_loaded": false
}
```

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
  "capabilities": ["firewall", "ids", "conntrack", "nat", "dns"],
  "ebpf_programs": [
    { "name": "tc-conntrack", "loaded": true },
    { "name": "tc-dns", "loaded": true },
    { "name": "tc-ids", "loaded": true },
    { "name": "tc-nat-egress", "loaded": true },
    { "name": "tc-nat-ingress", "loaded": false },
    { "name": "xdp-firewall", "loaded": true }
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
- `ebpf_programs`: The programs this agent attempted to load, each with its own load state, sorted by name
- `tls.pq_mode`: Post-quantum TLS mode (`Disabled`, `Preferred`, `Hybrid`, `Required`)

Each entry carries that program's own state, so a node whose NAT ingress program was rejected while its firewall attached reports `tc-nat-ingress: false` beside `xdp-firewall: true`, and the heartbeat above it reports `degraded`.

The list is what the datapath registered rather than a fixed catalogue: a program this build never attempted is absent rather than reported as `false`, and an agent that loaded nothing returns an empty list. The same states are readable per program on `/metrics` as `ebpfsentinel_ebpf_program_status`, under the same names.

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

- `config_version`: SHA-256 hex of the serialized YAML configuration the running datapath was built from
- `last_reload`: Unix epoch of when that configuration was applied, which is startup
- `pending_changes`: Whether the configuration file on disk has been edited since

`pending_changes` means the same thing here as it does on the heartbeat, and both routes compute it the one way: the file named by `--config` is loaded at the moment you ask, and its hash compared with the one being enforced. It is `false` on a freshly started agent, and `false` again for a file that no longer parses, because a configuration this agent would refuse is not a change waiting to be applied.

The hash is taken over the configuration the file parses to rather than over its bytes, so reformatting it or adding a comment is not drift.

The enterprise agent applies its configuration once, at startup: unlike the OSS agent it has no file watcher, no `SIGHUP` reload and no `/api/v1/config/reload` route, so `pending_changes: true` means a restart is outstanding rather than a reload.

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
3. Aggregated by `(src_ip, dst_ip, protocol)` - multiple connections between the same pair are merged
4. Sorted by bytes descending
5. Capped at `max_nodes` unique IPs (edges requiring new IPs beyond the cap are dropped)

Nodes and edges are both sorted by bytes descending.

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

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
| `ebpfsentinel_ent_fleet_registrations_total` | Counter | Agent registrations processed |
| `ebpfsentinel_ent_fleet_heartbeats_total` | Counter | Agent heartbeats received |
| `ebpfsentinel_ent_fleet_identity_queries_total` | Counter | Identity queries served |
| `ebpfsentinel_ent_fleet_config_version_queries_total` | Counter | Config version queries served |
| `ebpfsentinel_ent_fleet_flow_graph_queries_total` | Counter | Flow graph queries served |

## Domain Architecture

```
enterprise-domain/src/fleet/
├── mod.rs          # Module declaration
├── entity.rs       # DTOs: RegistrationRequest, HeartbeatResponse, FlowGraph, etc.
├── engine.rs       # FleetEngine: registration, idempotency, config hashing
├── error.rs        # FleetError: NotRegistered, NotAuthenticated, InvalidRequest
└── flow_graph.rs   # FlowGraphBuilder: connection aggregation + graph construction
```

The handler (`enterprise-adapters/src/http/fleet_handler.rs`) bridges domain logic with OSS `ServiceHandles` for live rule counts and conntrack data.

## Integration Patterns

### Ansible / Terraform

```bash
# Register, keeping both halves of the answer: the token is returned once
curl -X POST http://agent:8444/api/v1/agent/register \
  -H "X-API-Key: $EBPFSENTINEL_API_KEY" \
  -d '{"name":"node-01","labels":{"env":"prod"}}' \
  | jq -r '.agent_id, .token' > /etc/ebpfsentinel/fleet-identity

# Heartbeat (cron every 30s)
curl -X POST http://agent:8444/api/v1/agent/heartbeat \
  -H "X-API-Key: $EBPFSENTINEL_API_KEY" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"token\":\"${AGENT_TOKEN}\"}"

# Config drift check
curl -H "X-API-Key: $EBPFSENTINEL_API_KEY" \
  http://agent:8444/api/v1/agent/config/version
```

### Kubernetes Operator

A controller watching `EBPFSentinelAgent` CRDs uses the three routes as:
1. `/api/v1/agent/register` on pod creation, storing the returned token in a `Secret`
2. `/api/v1/agent/heartbeat` on a timer, reading that token back. Not a liveness probe: a probe carries no request body, so it can present no token and would be refused
3. `/api/v1/agent/config/version` to detect config drift and trigger rolling updates
