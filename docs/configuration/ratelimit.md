# Rate Limiting Configuration

The `ratelimit` section configures DDoS protection rules with four available algorithms. For SYN-flood mitigation (SYN cookies), see [DDoS protection](ddos.md) — it is configured under `ddos`, not as a rate-limit algorithm.

Every source address gets its own token bucket in the kernel. There are three ways to set the size of that bucket, checked in this order:

1. a **country tier**, which covers whole countries through an LPM trie and matches IPv4 and IPv6;
2. a **rule**, which overrides the defaults for exactly one source host;
3. the **section defaults**, which apply to every source no rule names.

So the general case needs no rule at all: `default_rate` and `default_burst` already give each unnamed source its own bucket. A rule exists to single out one host.

## Reference

```yaml
ratelimit:
  enabled: false                         # Enable/disable rate limiting (default: false)
  default_rate: 1000                     # Default PPS for unmatched IPs
  default_burst: 2000                    # Default burst capacity for unmatched IPs
  default_algorithm: token_bucket        # Default algorithm for unmatched IPs
  rules:
    - id: "rule-id"
      rate: 10000                        # Packets per second
      burst: 20000                       # Burst capacity
      algorithm: token_bucket            # Algorithm choice
      src_ip: "10.0.0.20/32"             # Source host this rule limits (required)
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable/disable rate limiting |
| `default_rate` | `integer` | `1000` | Default packets per second for unmatched source IPs |
| `default_burst` | `integer` | `2000` | Default burst capacity for unmatched source IPs |
| `default_algorithm` | `string` | `token_bucket` | Default algorithm for unmatched source IPs |
| `country_tiers` | `[CountryTier]` | `[]` | Per-country rate limit tiers enforced via kernel LPM maps |
| `rules` | `[Rule]` | `[]` | Rate limit rules (max 10,240) |

### Rule

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Yes | — | Unique identifier |
| `rate` | `integer` | Yes | — | Packets per second |
| `burst` | `integer` | Yes | — | Burst capacity |
| `algorithm` | `string` | No | `token_bucket` | See algorithms below |
| `action` | `string` | No | `drop` | Action when the limit is exceeded: `drop` or `pass` |
| `src_ip` | `string` | Yes | — | Source host this rule limits, as a bare address or a `/32` |
| `interfaces` | `[string]` | No | — | Restrict the rule to specific interfaces or interface groups |
| `enabled` | `bool` | No | `true` | Enable or disable this rule |

`src_ip` names one host and nothing else. The kernel config map (`RATELIMIT_CONFIG`) is an exact-match hash on the packet's 32-bit source address, so a shorter prefix such as `10.0.0.0/8` would match a single address rather than the range, and an IPv6 source would match no entry at all. Both are refused at config load, as is `0.0.0.0`, which is the key the section defaults occupy. To limit a range or an IPv6 source, use `country_tiers`, which resolves to CIDRs and carries an IPv6 trie.

Two rules naming the same source are also refused: one source carries one bucket, so the second would silently replace the first.

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

> SYN-cookie forging (FNV-1a SYN cookies via `XDP_TX`) is a SYN-flood mitigation configured under [`ddos.syn_protection`](ddos.md), not a `ratelimit` algorithm. `algorithm: syn_cookie` is rejected at config load.

## Examples

### Multi-algorithm setup with defaults

```yaml
ratelimit:
  enabled: true
  default_rate: 1000
  default_burst: 2000
  default_algorithm: token_bucket
  rules:
    # A backup host that legitimately bursts: raise its ceiling.
    - id: backup-host
      rate: 10000
      burst: 20000
      algorithm: token_bucket
      src_ip: 10.0.0.20
    # A scraper hammering the edge: far below the default.
    - id: scraper
      rate: 100
      burst: 200
      algorithm: sliding_window
      src_ip: 203.0.113.10
```

### Country-based tiers

```yaml
ratelimit:
  enabled: true
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
