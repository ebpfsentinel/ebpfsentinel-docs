# Load Balancer Configuration

The `loadbalancer` section configures L4 (TCP/UDP/TLS passthrough) load balancing services with backend pools, health checks, and balancing algorithms.

## Reference

```yaml
loadbalancer:
  enabled: true                          # Enable/disable load balancer
  services:
    - id: "service-id"                   # Unique service identifier (max 64 chars)
      name: "human-readable-name"        # Display name
      protocol: "tcp"                    # tcp, udp, or tls_passthrough
      listen_port: 443                   # Frontend port
      algorithm: "round_robin"           # round_robin, weighted, ip_hash, least_conn
      enabled: true                      # Administrative enable flag
      backends:
        - id: "backend-id"              # Unique backend identifier within service
          addr: "10.0.1.10"             # Backend IP (IPv4 or IPv6)
          port: 443                     # Backend port
          weight: 1                     # Traffic weight (higher = more traffic)
          enabled: true                 # Administrative enable flag
      health_check:                     # Optional health probe
        target: "10.0.1.10"            # Probe target address
        protocol: "tcp"                # tcp or icmp
        interval_secs: 10             # Probe interval
        timeout_secs: 5               # Probe timeout
        failure_threshold: 3          # Failures before marking unhealthy
        recovery_threshold: 2         # Successes before marking healthy
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable load balancer |
| `services` | `[LbService]` | `[]` | List of load balancer service definitions |

### LbService

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique service identifier (max 64 characters) |
| `name` | `string` | Yes | Human-readable service name |
| `protocol` | `string` | Yes | `tcp`, `udp`, or `tls_passthrough` |
| `listen_port` | `integer` | Yes | Frontend port to listen on (1-65535) |
| `algorithm` | `string` | Yes | `round_robin`, `weighted`, `ip_hash`, `least_conn` |
| `enabled` | `bool` | No | Enable/disable this service (default: `true`) |
| `backends` | `[LbBackend]` | Yes | At least one backend required |
| `health_check` | `LbHealthCheck` | No | Optional backend health probe |

### LbBackend

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique backend identifier within the service |
| `addr` | `string` | Yes | Backend IP address (IPv4 or IPv6) |
| `port` | `integer` | Yes | Backend port (1-65535) |
| `weight` | `integer` | No | Traffic weight, must be > 0 (default: `1`) |
| `enabled` | `bool` | No | Enable/disable this backend (default: `true`) |

### LbHealthCheck

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `target` | `string` | Required | Probe target address |
| `protocol` | `string` | `tcp` | `tcp` or `icmp` |
| `interval_secs` | `integer` | `10` | Seconds between probes |
| `timeout_secs` | `integer` | `5` | Seconds before probe timeout |
| `failure_threshold` | `integer` | `3` | Consecutive failures before marking unhealthy |
| `recovery_threshold` | `integer` | `2` | Consecutive successes before marking healthy |

## Limits

- Maximum **64 services**
- Each service must have at least **1 backend**
- Service and backend IDs: max **64 characters**, must not be empty
- Backend weight must be **> 0**
- Listen port must be **> 0**

## Examples

### HTTPS load balancer — TLS passthrough

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-https
      name: web-https
      protocol: tls_passthrough
      listen_port: 443
      algorithm: round_robin
      backends:
        - id: web-1
          addr: "10.0.1.10"
          port: 443
          weight: 1
        - id: web-2
          addr: "10.0.1.11"
          port: 443
          weight: 1
        - id: web-3
          addr: "10.0.1.12"
          port: 443
          weight: 2
      health_check:
        target: "10.0.1.10"
        protocol: tcp
        interval_secs: 10
        timeout_secs: 5
        failure_threshold: 3
        recovery_threshold: 2
```

### DNS cluster — UDP round-robin

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-dns
      name: dns-cluster
      protocol: udp
      listen_port: 53
      algorithm: round_robin
      backends:
        - id: dns-1
          addr: "10.0.2.10"
          port: 53
        - id: dns-2
          addr: "10.0.2.11"
          port: 53
```

### Database pool — TCP least-connections

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-db
      name: postgres-cluster
      protocol: tcp
      listen_port: 5432
      algorithm: least_conn
      backends:
        - id: db-primary
          addr: "10.0.3.10"
          port: 5432
          weight: 3
        - id: db-replica-1
          addr: "10.0.3.11"
          port: 5432
          weight: 1
        - id: db-replica-2
          addr: "10.0.3.12"
          port: 5432
          weight: 1
      health_check:
        target: "10.0.3.10"
        protocol: tcp
        interval_secs: 5
        timeout_secs: 3
        failure_threshold: 2
        recovery_threshold: 2
```

### Sticky sessions — IP hash

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-app
      name: app-sticky
      protocol: tcp
      listen_port: 8080
      algorithm: ip_hash
      backends:
        - id: app-1
          addr: "10.0.4.10"
          port: 8080
        - id: app-2
          addr: "10.0.4.11"
          port: 8080
```

### Weighted traffic split

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-canary
      name: canary-deploy
      protocol: tcp
      listen_port: 80
      algorithm: weighted
      backends:
        - id: stable
          addr: "10.0.5.10"
          port: 80
          weight: 9
        - id: canary
          addr: "10.0.5.11"
          port: 80
          weight: 1
```
