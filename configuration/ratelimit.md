# Rate Limiting Configuration

The `ratelimit` section configures DDoS protection rules with five available algorithms.

## Reference

```yaml
ratelimit:
  default_rate: 1000           # Default PPS for unmatched IPs
  default_burst: 2000          # Default burst capacity for unmatched IPs
  default_algorithm: token_bucket  # Default algorithm for unmatched IPs
  rules:
    - id: "rule-id"
      rate: 10000              # Packets per second
      burst: 20000             # Burst capacity
      algorithm: token_bucket  # Algorithm choice
      scope: per_ip            # per_ip or global
      src_ip: "10.0.0.0/8"    # Source CIDR filter (optional)
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `default_rate` | `integer` | `1000` | Default packets per second for unmatched source IPs |
| `default_burst` | `integer` | `2000` | Default burst capacity for unmatched source IPs |
| `default_algorithm` | `string` | `token_bucket` | Default algorithm for unmatched source IPs |
| `country_tiers` | `[CountryTier]` | `[]` | Per-country rate limit tiers enforced via kernel LPM maps |
| `rules` | `[Rule]` | `[]` | Rate limit rules (max 1024) |

### Rule

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Yes | — | Unique identifier |
| `rate` | `integer` | Yes | — | Packets per second |
| `burst` | `integer` | Yes | — | Burst capacity |
| `algorithm` | `string` | Yes | — | See algorithms below |
| `scope` | `string` | No | `per_ip` | `per_ip` or `global` |
| `src_ip` | `string` | No | — | Source CIDR filter (only apply to matching IPs) |

### CountryTier

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tier_id` | `integer` | Yes | Tier identifier (1–15) |
| `country_codes` | `[string]` | Yes | ISO 3166-1 alpha-2 country codes assigned to this tier |
| `rate` | `integer` | Yes | Packets per second for this tier |
| `burst` | `integer` | Yes | Burst capacity for this tier |
| `algorithm` | `string` | No | Algorithm (default: `token_bucket`) |
| `action` | `string` | No | `drop` or `pass` (default: `drop`) |

Country tiers are resolved to CIDRs via GeoIP at startup and config reload, then loaded into dedicated kernel LPM Trie maps (`RL_LPM_SRC_V4`, `RL_LPM_SRC_V6`). The LPM lookup runs before per-IP rule matching.

## Algorithms

| Algorithm | Value | Description |
|-----------|-------|-------------|
| Token Bucket | `token_bucket` | Tokens refill at fixed rate; each packet consumes one |
| Fixed Window | `fixed_window` | Counter resets at fixed intervals |
| Sliding Window | `sliding_window` | Weighted average of current and previous windows |
| Leaky Bucket | `leaky_bucket` | Packets drain at fixed rate |
| SYN Cookie | `syn_cookie` | `bpf_tcp_gen_syncookie` for SYN flood mitigation |

## Examples

### Multi-algorithm setup with defaults

```yaml
ratelimit:
  default_rate: 1000
  default_burst: 2000
  default_algorithm: token_bucket
  rules:
    - id: global-limit
      rate: 10000
      burst: 20000
      algorithm: token_bucket
      scope: per_ip
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

### Country-based tiers

```yaml
ratelimit:
  default_rate: 1000
  default_burst: 2000
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
    - tier_id: 3
      country_codes: [US, CA, GB, DE, FR]
      rate: 5000
      burst: 10000
```
