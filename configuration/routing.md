# Policy Routing Configuration

Multi-WAN gateway management with health checks and GeoIP routing. See [Policy Routing](../features/routing.md) for the feature overview.

## Configuration

```yaml
routing:
  enabled: false
  gateways:
    - id: 1
      name: wan1
      interface: eth0
      gateway_ip: "192.168.1.1"
      priority: 10
      health_check:
        target: "8.8.8.8"
        protocol: icmp
        interval_secs: 10
        timeout_secs: 5
        failure_threshold: 3
        recovery_threshold: 2

    - id: 2
      name: wan2
      interface: eth1
      gateway_ip: "192.168.2.1"
      priority: 20
      health_check:
        target: "1.1.1.1"
        protocol: "tcp:443"
        interval_secs: 15
      preferred_for_countries: [US, CA]
```

## Reference

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable policy routing |
| `gateways` | list | `[]` | Gateway definitions |

### Gateway Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | u8 | — | Unique gateway ID (0–255) |
| `name` | string | — | Human-readable name |
| `interface` | string | — | Network interface |
| `gateway_ip` | string | — | Next-hop IP address |
| `priority` | u32 | `100` | Selection priority (lower = preferred) |
| `enabled` | bool | `true` | Enable/disable without removing |
| `health_check` | object | — | Optional health probe |
| `preferred_for_countries` | list | — | ISO 3166-1 alpha-2 country codes for GeoIP routing |

### Health Check Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `target` | string | `8.8.8.8` | IP or hostname to probe |
| `protocol` | string | `icmp` | `icmp` or `tcp:<port>` (e.g., `tcp:443`) |
| `interval_secs` | u32 | `10` | Seconds between probes |
| `timeout_secs` | u32 | `5` | Probe timeout |
| `failure_threshold` | u32 | `3` | Consecutive failures before marking gateway down |
| `recovery_threshold` | u32 | `2` | Consecutive successes before marking gateway healthy |

## Examples

### Simple Failover

Two WAN links with automatic failover:

```yaml
routing:
  enabled: true
  gateways:
    - id: 1
      name: primary
      interface: eth0
      gateway_ip: "10.0.0.1"
      priority: 10
      health_check:
        target: "8.8.8.8"

    - id: 2
      name: backup
      interface: eth1
      gateway_ip: "10.1.0.1"
      priority: 20
      health_check:
        target: "1.1.1.1"
```

When `primary` fails 3 consecutive health checks, traffic automatically routes through `backup`. When `primary` recovers (2 consecutive successes), traffic returns.

### GeoIP Routing

Route traffic through geographically appropriate gateways:

```yaml
routing:
  enabled: true
  gateways:
    - id: 1
      name: us-transit
      interface: eth0
      gateway_ip: "10.0.0.1"
      priority: 10
      preferred_for_countries: [US, CA, MX]
      health_check:
        target: "8.8.8.8"

    - id: 2
      name: eu-transit
      interface: eth1
      gateway_ip: "10.1.0.1"
      priority: 10
      preferred_for_countries: [DE, FR, GB, NL]
      health_check:
        target: "1.1.1.1"
```
