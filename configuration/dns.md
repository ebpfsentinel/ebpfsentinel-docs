# DNS Intelligence Configuration

The `dns` section configures DNS caching, domain blocklists, and reputation scoring.

## Reference

```yaml
dns:
  enabled: true                       # Enable/disable DNS intelligence (default: true)
  cache:
    max_entries: 100000               # Maximum cache entries
    min_ttl_secs: 60                  # Floor applied to record TTLs
    purge_interval_secs: 30           # Expired-entry sweep interval
  blocklist:
    domains:                          # Inline blocked domain patterns
      - "malware.example.com"
      - "*.ad-network.com"
    action: block                     # block, alert, or log (section-wide)
    inject_target: threatintel        # threatintel, firewall, or ips
    grace_period_secs: 300            # Grace period before enforcement
    feeds:                            # External blocklist feeds
      - name: "feed-name"
        url: "https://..."
        format: plaintext             # plaintext or hosts
        refresh_interval_secs: 3600
  reputation:
    enabled: false
    auto_block_threshold: 0.8         # Block domains scoring above this
    auto_block_enabled: false         # Enable automatic blocking of high-score domains
    auto_block_ttl_secs: 3600         # TTL for auto-blocked domains in seconds
    decay_half_life_hours: 24         # Exponential decay half-life in hours
    max_tracked_domains: 50000        # Maximum domains tracked for reputation
    high_risk_countries: [RU, CN]     # ISO 3166-1 alpha-2 codes
  doh_resolvers: []                   # DNS-over-HTTPS resolver URLs for encrypted DNS detection
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the DNS module |
| `cache` | `Cache` | see below | DNS cache settings |
| `blocklist` | `Blocklist` | see below | Domain blocklist settings |
| `reputation` | `Reputation` | see below | Domain reputation settings |
| `doh_resolvers` | `[string]` | `[]` | DNS-over-HTTPS resolver URLs (host or URL) used to detect encrypted DNS |

### Cache

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_entries` | `integer` | `100000` | Maximum DNS cache entries |
| `min_ttl_secs` | `integer` | `60` | Minimum TTL floor applied to cached records |
| `purge_interval_secs` | `integer` | `30` | Interval between expired-entry sweeps |

### Blocklist

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `domains` | `[string]` | `[]` | Inline domain patterns (exact or wildcard `*`) |
| `action` | `string` | `block` | Section-wide action: `block`, `alert`, or `log` |
| `inject_target` | `string` | `threatintel` | Where blocked domains/IPs are injected: `threatintel`, `firewall`, or `ips` |
| `grace_period_secs` | `integer` | `300` | Grace period before a newly blocked domain is enforced |
| `feeds` | `[Feed]` | `[]` | External blocklist feeds |

### Feed

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Feed identifier |
| `url` | `string` | Yes | — | Feed source URL |
| `format` | `string` | No | `plaintext` | `plaintext` (one domain per line) or `hosts` (hosts-file format) |
| `refresh_interval_secs` | `integer` | No | `3600` | Seconds between refreshes |

### Reputation

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable domain reputation scoring |
| `auto_block_threshold` | `float` | `0.8` | Auto-block domains scoring above this |
| `auto_block_enabled` | `bool` | `false` | Enable automatic blocking of high-score domains |
| `auto_block_ttl_secs` | `integer` | `3600` | TTL for auto-blocked domains in seconds |
| `decay_half_life_hours` | `integer` | `24` | Exponential decay half-life in hours |
| `max_tracked_domains` | `integer` | `50000` | Maximum domains tracked for reputation |
| `high_risk_countries` | `[string]` | `[]` | ISO 3166-1 alpha-2 country codes. Domains resolving to IPs in listed countries receive a `HighRiskCountry` reputation factor (weight 0.4), accelerating their path toward the auto-block threshold |

## Examples

### Blocklist with feeds and reputation

```yaml
dns:
  cache:
    max_entries: 50000
  blocklist:
    domains:
      - "malware.example.com"
      - "*.ad-network.com"
      - "*.tracking.com"
    action: block
    inject_target: threatintel
    feeds:
      - name: abuse-ch-domains
        url: "https://urlhaus.abuse.ch/downloads/hostfile/"
        format: hosts
        refresh_interval_secs: 3600
  reputation:
    enabled: true
    auto_block_threshold: 0.8
    auto_block_enabled: false
    auto_block_ttl_secs: 3600
    decay_half_life_hours: 24
    max_tracked_domains: 50000
    high_risk_countries: [RU, CN, KP, IR]
  doh_resolvers: []
```
