# Policy Routing

eBPFsentinel supports multi-WAN policy routing with per-gateway health monitoring, weighted priority selection, and GeoIP-based gateway preference. The routing engine selects the best available gateway based on health status, priority, and optional country-based affinity.

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
| `preferred_for_countries` | list | — | Country codes for GeoIP-based routing |

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

## GeoIP Gateway Preference

Gateways can declare `preferred_for_countries` — a list of ISO 3166-1 alpha-2 country codes. When the [GeoIP enrichment](geoip.md) engine resolves a destination IP to a country, the routing engine preferentially selects a gateway that lists that country, falling back to priority-based selection if no match.

## Integration

- **Firewall**: Policy routing rules in the XDP firewall reference gateway IDs for per-rule routing decisions
- **GeoIP**: Country-aware gateway selection for geo-routed traffic
- **DDoS**: Auto-blackhole routes for attack traffic

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/routing/status` | Enabled status and gateway count |
| GET | `/api/v1/routing/gateways` | List gateways with current health status |

See [REST API Reference](../api-reference/rest-api.md) for details.
