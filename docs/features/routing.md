# Policy Routing

eBPFsentinel supports multi-WAN failover: each gateway is probed independently, and the agent installs the best usable gateway as the host default route. Selection is health first, then priority, so a link going down moves traffic to the next path without operator action.

## Gateways

Each gateway represents an outbound network path:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | u8 | — | Unique gateway ID (0–255) |
| `name` | string | — | Human-readable name (e.g., `wan1`) |
| `interface` | string | — | Network interface (e.g., `eth1`) |
| `gateway_ip` | string | — | Next-hop IP address |
| `priority` | u32 | 100 | Lower values preferred |
| `enabled` | bool | true | Enable/disable without removing |
| `health_check` | object | — | Optional health probe configuration |

## Health Checks

Each gateway can have an independent health probe:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `target` | string | `8.8.8.8` | IP or hostname to probe |
| `protocol` | string | `icmp` | `icmp` or `tcp:<port>` |
| `interval_secs` | u32 | 10 | Probe interval |
| `timeout_secs` | u32 | 5 | Probe timeout |
| `failure_threshold` | u32 | 3 | Consecutive failures before marking down |
| `recovery_threshold` | u32 | 2 | Consecutive successes before marking healthy |

## Gateway States

| State | Description |
|-------|-------------|
| `healthy` | All probes passing |
| `degraded` | Partial packet loss detected (includes loss percentage) |
| `down` | Failed health checks exceed threshold |

The routing engine automatically fails over to the next-priority healthy gateway when a gateway goes down, and fails back when it recovers.

## What Failover Changes

Electing a gateway is only half the job: the agent then rewrites the host default route (`0.0.0.0/0 via <gateway_ip> dev <interface>` in the main table) so the kernel forwards through the elected path. Writing the routing table needs `CAP_NET_ADMIN`; a rootless agent asks its warden to perform the write instead.

The route is written only when the election changes, and a write that fails (missing capability, unreachable warden, unknown interface) is logged and retried on the next probe. When every gateway is down the last programmed route is left in place — there is no better path to switch to — and a `WAN_ALL_DOWN` alert is raised.

Selection is health and priority only. Per-destination or per-country gateway choice is not part of the OSS routing engine.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/routing/status` | Enabled status and gateway count |
| GET | `/api/v1/routing/gateways` | List gateways with current health status |
| GET | `/api/v1/routing/routes` | Default route currently in effect (empty when no gateway is usable) |
| POST | `/api/v1/routing/gateways` | Add a gateway |
| DELETE | `/api/v1/routing/gateways/{id}` | Remove a gateway |

See [REST API Reference](../api-reference/rest-api.md) for details.
