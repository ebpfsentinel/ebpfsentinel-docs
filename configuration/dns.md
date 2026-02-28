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
      refresh_interval: 3600
  reputation:
    enabled: true
    auto_block_threshold: 0.8  # Block domains scoring above this
    decay_rate: 0.01           # Score decay per hour
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
| `decay_rate` | `float` | `0.01` | Score decay per hour |

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
      refresh_interval: 3600
  reputation:
    enabled: true
    auto_block_threshold: 0.8
    decay_rate: 0.01
```
