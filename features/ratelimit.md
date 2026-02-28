# Rate Limiting

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: xdp-ratelimit**

## Overview

XDP-based rate limiting provides DDoS protection with five algorithms, per-CPU lock-free buckets, and kernel-side timer maintenance. The rate limiter runs at XDP speed and is typically invoked via tail-call from the firewall, avoiding a separate program attachment.

## How It Works

### Algorithms

| Algorithm | Description | Best For |
|-----------|-------------|----------|
| **Token Bucket** | Tokens refill at a fixed rate; each packet consumes one | Bursty traffic with average rate control |
| **Fixed Window** | Counter resets at fixed intervals | Simple rate caps per time window |
| **Sliding Window** | Weighted average of current and previous windows | Smoother rate enforcement |
| **Leaky Bucket** | Packets queue and drain at a fixed rate | Constant output rate |
| **SYN Cookie** | `bpf_tcp_gen_syncookie` for SYN flood mitigation | TCP SYN flood protection |

### Kernel-Side Implementation

- **PerCPU Hash maps** — lock-free per-IP counters (no cross-CPU contention)
- **`bpf_timer`** — periodic bucket expiration and cleanup without userspace intervention
- **`bpf_get_prandom_u32`** — jitter for timer-based operations to avoid thundering herd
- **Suspend-aware timestamps** via `bpf_ktime_get_boot_ns`

### Tail-Call Integration

The rate limiter is invoked via `PROG_ARRAY` tail-call from `xdp-firewall`:

```
Packet → xdp-firewall → (XDP_PASS) → tail_call → xdp-ratelimit → XDP_PASS/XDP_DROP
```

The firewall writes metadata (rule ID, flags) that the rate limiter can read for per-rule rate decisions.

### Default Rate

When a source IP doesn't match any specific rule, the **default rate** applies. This is stored in the eBPF map with key `{src_ip: 0}` and enforced at wire speed.

## Configuration

```yaml
ratelimit:
  default_rate: 1000           # Default PPS for unmatched IPs
  default_burst: 2000          # Default burst for unmatched IPs
  default_algorithm: token_bucket  # Default algorithm for unmatched IPs
  rules:
    - id: global-limit
      rate: 10000              # Packets per second
      burst: 20000             # Burst capacity
      algorithm: token_bucket
      scope: per_ip
      src_ip: "10.0.0.0/8"    # CIDR filter (optional)
    - id: syn-protection
      rate: 100
      burst: 200
      algorithm: syn_cookie
      scope: per_ip
    - id: api-ratelimit
      rate: 1000
      burst: 2000
      algorithm: sliding_window
      scope: per_ip
```

Maximum **1024 rules**.

See [Configuration: Rate Limiting](../configuration/ratelimit.md) for the full reference.

## CLI Usage

```bash
# List rate limit rules
ebpfsentinel-agent ratelimit list

# Add a rule
ebpfsentinel-agent ratelimit add --json '{
  "id": "emergency-throttle",
  "rate": 500,
  "burst": 1000,
  "algorithm": "token_bucket",
  "scope": "per_ip"
}'

# Delete a rule
ebpfsentinel-agent ratelimit delete emergency-throttle
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ratelimit/rules` | List rate limit rules |
| POST | `/api/v1/ratelimit/rules` | Create a rate limit rule |
| DELETE | `/api/v1/ratelimit/rules/{id}` | Delete a rate limit rule |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/xdp-ratelimit/` | XDP kernel program |
| `domain` | `crates/domain/src/ratelimit/` | Rate limit engine (entity, engine, error) |
| `ports` | `crates/ports/src/primary/ratelimit.rs` | Port trait |
| `application` | `crates/application/src/ratelimit_service_impl.rs` | App service |
| `adapters` | `crates/adapters/src/http/ratelimit_handler.rs` | HTTP handler |

## Metrics

- `ebpfsentinel_packets_total{interface, verdict="rate_limited"}` — packets dropped by rate limiter
- `ebpfsentinel_rules_loaded{domain="ratelimit"}` — number of loaded rate limit rules
- `ebpfsentinel_processing_duration_seconds{domain="ratelimit"}` — rate limit evaluation latency
