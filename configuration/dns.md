# DNS Intelligence Configuration

The `dns` section configures DNS caching, domain blocklists, and reputation scoring.

## Reference

```yaml
dns:
  cache_size: 100000           # Maximum cache entries
  cache_ttl: 3600              # Default TTL in seconds
  blocklist:
    - domain: "malware.example.com"
      action: block            # block or log
    - domain: "*.ad-network.com"
      action: block
  feeds:
    - name: "feed-name"
      url: "https://..."
      format: plaintext
      refresh_interval_secs: 3600
  reputation:
    enabled: true
    auto_block_threshold: 0.8  # Block domains scoring above this
    decay_half_life_hours: 24  # Exponential decay half-life in hours
    max_tracked_domains: 50000 # Maximum domains tracked for reputation
    auto_block_enabled: false  # Enable automatic blocking of high-score domains
    auto_block_ttl_secs: 3600  # TTL for auto-blocked domains in seconds
    doh_resolvers: []          # DNS-over-HTTPS resolver URLs for encrypted DNS detection
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cache_size` | `integer` | `100000` | Maximum DNS cache entries |
| `cache_ttl` | `integer` | `3600` | Default cache TTL in seconds |
| `blocklist` | `[BlocklistEntry]` | `[]` | Inline domain blocklist |
| `feeds` | `[Feed]` | `[]` | External blocklist feeds |
| `reputation` | `Reputation` | — | Domain reputation settings |

### BlocklistEntry

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `domain` | `string` | Yes | Domain pattern (exact, wildcard `*`, or regex) |
| `action` | `string` | Yes | `block` or `log` |

### Reputation

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable domain reputation scoring |
| `auto_block_threshold` | `float` | `0.8` | Auto-block domains above this score |
| `decay_half_life_hours` | `u64` | `24` | Exponential decay half-life in hours |
| `max_tracked_domains` | `usize` | `50000` | Maximum domains tracked for reputation |
| `auto_block_enabled` | `bool` | `false` | Enable automatic blocking of high-score domains |
| `auto_block_ttl_secs` | `u64` | `3600` | TTL for auto-blocked domains in seconds |
| `doh_resolvers` | `[string]` | `[]` | DNS-over-HTTPS resolver URLs for encrypted DNS detection |
| `high_risk_countries` | `[string]` | `[]` | ISO 3166-1 alpha-2 country codes. Domains resolving to IPs in listed countries receive a `HighRiskCountry` reputation factor (weight 0.4), accelerating their path toward the auto-block threshold |

## Examples

### Blocklist with feeds and reputation

```yaml
dns:
  cache_size: 50000
  blocklist:
    - domain: "malware.example.com"
      action: block
    - domain: "*.ad-network.com"
      action: block
    - domain: "*.tracking.com"
      action: log
  feeds:
    - name: abuse-ch-domains
      url: "https://urlhaus.abuse.ch/downloads/hostfile/"
      format: plaintext
      refresh_interval_secs: 3600
  reputation:
    enabled: true
    auto_block_threshold: 0.8
    decay_half_life_hours: 24
    max_tracked_domains: 50000
    auto_block_enabled: false
    auto_block_ttl_secs: 3600
    doh_resolvers: []
    high_risk_countries: [RU, CN, KP, IR]
```
