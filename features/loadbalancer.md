# L4 Load Balancer

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: xdp-loadbalancer** | **Domain: loadbalancer**

## Overview

eBPFsentinel includes a built-in L4 load balancer for TCP, UDP, and TLS passthrough traffic. Incoming connections are distributed across backend pools using XDP for wire-speed packet redirection. Four balancing algorithms are supported, with per-backend health checks and weighted traffic distribution.

## How It Works

### Two-Layer Architecture

1. **Kernel-side (eBPF)** — An XDP program performs fast-path packet rewriting: destination IP/port is replaced with the selected backend, and checksums are updated inline. This happens before the kernel allocates an SKB, achieving maximum throughput.
2. **Userspace (LB Engine)** — Manages service definitions, runs backend selection algorithms, tracks connection counts for least-connections balancing, and processes health check results to mark backends healthy or unhealthy.

### Protocols

| Protocol | Behavior |
|----------|----------|
| **TCP** | Full L4 load balancing with connection tracking |
| **UDP** | Stateless per-packet distribution |
| **TLS Passthrough** | Forwards encrypted TLS traffic without termination — backends handle TLS |

### Balancing Algorithms

| Algorithm | Description |
|-----------|-------------|
| **Round Robin** | Cycles through healthy backends sequentially |
| **Weighted** | Cumulative weight distribution — higher weight = more traffic |
| **IP Hash** | FNV-1a hash of client address for sticky sessions |
| **Least Connections** | Selects the healthy backend with the fewest active connections |

### Backend Health Checks

Optional per-service health probes monitor backend availability:

- **Protocols**: TCP connect or ICMP ping
- **Configurable intervals**: probe frequency, timeout, failure/recovery thresholds
- **State transitions**: backends transition between `healthy` and `unhealthy` based on consecutive probe results

```
            ┌─────────┐
            │ Healthy │ ← initial state
            └────┬────┘
                 │ consecutive failures >= failure_threshold
                 ▼
            ┌───────────┐
            │ Unhealthy │ ← removed from selection pool
            └─────┬─────┘
                  │ consecutive successes >= recovery_threshold
                  ▼
            ┌─────────┐
            │ Healthy │ ← restored to selection pool
            └─────────┘
```

### Engine Limits

- Maximum 64 services
- Maximum 4 backends per service (eBPF map constraint)
- Backend IDs and service IDs: max 64 characters

## Configuration

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-https
      name: web-https
      protocol: tls_passthrough
      listen_port: 443
      algorithm: round_robin
      enabled: true
      backends:
        - id: web-1
          addr: "10.0.1.10"
          port: 443
          weight: 1
          enabled: true
        - id: web-2
          addr: "10.0.1.11"
          port: 443
          weight: 1
          enabled: true
      health_check:
        target: "10.0.1.10"
        protocol: tcp
        interval_secs: 10
        timeout_secs: 5
        failure_threshold: 3
        recovery_threshold: 2
```

See [Configuration: Load Balancer](../configuration/loadbalancer.md) for the full reference.

## CLI Usage

```bash
# View load balancer status (enabled, service count)
ebpfsentinel-agent lb status

# List all services
ebpfsentinel-agent lb services

# View a specific service (backends, health, connections)
ebpfsentinel-agent lb service lb-https

# Add a service from inline JSON
ebpfsentinel-agent lb add --json '{
  "id": "lb-api",
  "name": "api-pool",
  "protocol": "tcp",
  "listen_port": 8080,
  "algorithm": "least_conn",
  "backends": [
    {"id": "api-1", "addr": "10.0.1.20", "port": 8080, "weight": 1},
    {"id": "api-2", "addr": "10.0.1.21", "port": 8080, "weight": 1}
  ]
}'

# Delete a service by ID
ebpfsentinel-agent lb delete lb-api

# JSON output for scripting
ebpfsentinel-agent --output json lb status
ebpfsentinel-agent --output json lb services
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/lb/status` | Load balancer status (enabled, service count) |
| GET | `/api/v1/lb/services` | List all services with summary |
| GET | `/api/v1/lb/services/{id}` | Service detail with backends, health status, connections |
| POST | `/api/v1/lb/services` | Create a service (requires `admin` role) |
| DELETE | `/api/v1/lb/services/{id}` | Delete a service (requires `admin` role) |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/xdp-loadbalancer/` | XDP kernel-side packet rewriting |
| `ebpf-common` | `crates/ebpf-common/src/loadbalancer.rs` | Shared `#[repr(C)]` types (service/backend map entries) |
| `domain` | `crates/domain/src/loadbalancer/` | LB engine (entity, engine, error) — selection algorithms + health |
| `ports` | `crates/ports/src/secondary/loadbalancer_map_port.rs` | eBPF map port trait |
| `application` | `crates/application/src/lb_service_impl.rs` | App service (engine + eBPF sync) |
| `adapters` | `crates/adapters/src/ebpf/lb_map_manager.rs` | eBPF map adapter |
| `adapters` | `crates/adapters/src/http/lb_handler.rs` | HTTP handler (5 endpoints) |
| `infrastructure` | `crates/infrastructure/src/config/loadbalancer.rs` | Config parsing |

## Metrics

- `ebpfsentinel_rules_loaded{domain="loadbalancer"}` — number of loaded services
