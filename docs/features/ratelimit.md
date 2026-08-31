# Rate Limiting

> **Edition: OSS** | **eBPF Program: xdp-ratelimit**

## Overview

XDP-based rate limiting provides DDoS protection with four algorithms, per-CPU lock-free buckets, and kernel-side timer maintenance. The rate limiter runs at XDP speed and is typically invoked via tail-call from the firewall, avoiding a separate program attachment.

## How It Works

### Algorithms

| Algorithm | Description | Best For |
|-----------|-------------|----------|
| **Token Bucket** | Tokens refill at a fixed rate; each packet consumes one | Bursty traffic with average rate control |
| **Fixed Window** | Counter resets at fixed intervals | Simple rate caps per time window |
| **Sliding Window** | Weighted average of current and previous windows | Smoother rate enforcement |
| **Leaky Bucket** | Packets queue and drain at a fixed rate | Constant output rate |

SYN-flood mitigation (kernel-issued SYN cookie forging via `XDP_TX`) is configured under [`ddos.syn_protection`](ddos.md), not as a rate-limit algorithm. `algorithm: syn_cookie` is rejected at config load.

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

### Interface Groups

Rate limit rules can be scoped to specific interface groups using the `interfaces` field. For example, you can enforce stricter rate limits on WAN-facing interfaces while allowing higher rates on internal interfaces. Rules without an `interfaces` field are floating and apply to all interfaces. See [Interface Groups](interface-groups.md).

### Buckets, Defaults and Rules

Each source address gets its own bucket, keyed on the packet's 32-bit source in a per-CPU hash map. The bucket's size comes from one of three places, checked in this order: a country tier, then a rule naming that exact source, then the section defaults.

The defaults are stored under key `{src_ip: 0}` and cover every source no rule names, so the general case needs no rule at all. A rule exists to single out one host, and its `src_ip` must therefore be a single IPv4 address: the map is an exact-match hash, so a shorter prefix would match one address rather than the range, and IPv6 would match nothing. Both are refused at config load. Use `country_tiers` for ranges and for IPv6.

### Per-Country Rate Limit Tiers (LPM)

Country-specific rate limits are enforced via dedicated kernel-side LPM Trie maps (`RL_LPM_SRC_V4`, `RL_LPM_SRC_V6`). Each tier maps a set of country codes to a rate limit profile (rate, burst, algorithm, action). The LPM lookup runs **before** per-IP rule matching — if a source IP falls within a country tier's CIDR range, the tier's config is used instead.

Tier configurations are stored in `RL_TIER_CONFIG` (an eBPF Array map, up to 16 tiers). Country CIDRs are resolved from the GeoIP database and loaded at startup and config reload.

```yaml
ratelimit:
  country_tiers:
    - tier_id: 1
      country_codes: [RU, CN]
      rate: 200
      burst: 400
      algorithm: token_bucket
      action: drop

    - tier_id: 2
      country_codes: [KP, IR, SY]
      rate: 50
      burst: 100
      algorithm: token_bucket
      action: drop

    - tier_id: 3
      country_codes: [US, CA, GB, DE, FR]
      rate: 5000
      burst: 10000
      algorithm: token_bucket
      action: drop
```

## Configuration

```yaml
ratelimit:
  default_rate: 1000           # PPS for every source no rule names
  default_burst: 2000          # Burst for every source no rule names
  default_algorithm: token_bucket
  rules:
    - id: backup-host
      rate: 10000              # Packets per second
      burst: 20000             # Burst capacity
      algorithm: token_bucket
      src_ip: 10.0.0.20        # One source host, required
    - id: scraper
      rate: 100
      burst: 200
      algorithm: sliding_window
      src_ip: 203.0.113.10
```

Maximum **10,240 rules**.

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
  "src_ip": "203.0.113.10"
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
| `agent` | `crates/agent/src/http/ratelimit_handler.rs` | HTTP handler |

## Metrics

- `ebpfsentinel_packets_total{interface="RATELIMIT_METRICS", action="dropped"}` - packets dropped by the rate limiter. The same map carries `matched`, `errors`, `events_dropped`, `total_seen` and `mtu_exceeded`
- `ebpfsentinel_rules_loaded{component="ratelimit"}` - number of loaded rate limit rules
- `ebpfsentinel_packet_processing_duration_seconds{program="ratelimit"}` - rate limit event dispatch latency
