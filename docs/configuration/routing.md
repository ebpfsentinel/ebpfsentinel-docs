# Policy Routing Configuration

Multi-WAN gateway management with health checks and automatic default-route failover. See [Policy Routing](../features/routing.md) for the feature overview.

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
```

Gateway names and ids must be unique, `gateway_ip` must be an IPv4 next hop, and `protocol` must be `icmp` or `tcp:<port>`. The agent refuses to start on any of these rather than degrading silently, because the values are written straight into the host routing table.

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

When `primary` fails 3 consecutive health checks, the agent rewrites the default route through `backup`. When `primary` recovers (2 consecutive successes), the route goes back.

Rewriting the routing table is a `CAP_NET_ADMIN` operation: a rootless agent proxies it through its warden, so failover needs no extra capability on the agent itself.

### Backup Link Kept Out of Service

A metered link that should only carry traffic when everything else is down is just the highest priority value:

```yaml
routing:
  enabled: true
  gateways:
    - id: 1
      name: fiber
      interface: eth0
      gateway_ip: "10.0.0.1"
      priority: 10
      health_check:
        target: "8.8.8.8"

    - id: 2
      name: lte
      interface: wwan0
      gateway_ip: "10.2.0.1"
      priority: 200
      health_check:
        target: "1.1.1.1"
        interval_secs: 60
```

A gateway can also be taken out of the rotation without deleting it by setting `enabled: false`; it stays configured and is never elected.
