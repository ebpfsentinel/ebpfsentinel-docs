# Threat Intelligence Configuration

The `threatintel` section configures external OSINT feeds for IOC-based threat detection. Feeds are **source-agnostic** — any HTTP/HTTPS endpoint serving IP lists in plaintext, CSV, or JSON format works through field mappings.

## Reference

```yaml
threatintel:
  enabled: true                    # Enable/disable the entire domain
  mode: alert                      # Global mode: "alert" or "block"

  feeds:
    - id: "feed-id"                # Unique identifier (required)
      name: "Human Name"           # Display name (required)
      url: "https://..."           # Feed URL, http:// or https:// only (required)
      format: plaintext            # plaintext, csv, json (default: plaintext)
      enabled: true                # Per-feed enable/disable (default: true)
      refresh_interval_secs: 3600  # Seconds between re-fetches (default: 3600)
      max_iocs: 500000             # Max IOCs to load from this feed (default: 500000)
      default_action: block        # Per-feed override: "alert" or "block" (inherits global mode)
      min_confidence: 0            # Minimum confidence to accept (0-100, default: 0)
      auth_header: "Key: value"    # Optional HTTP header for authenticated feeds

      # Field mapping (CSV and JSON feeds only):
      ip_field: "ip"               # Column name or JSON field for IP address
      confidence_field: "score"    # Column/field for confidence score (optional)
      category_field: "type"       # Column/field for threat category (optional)
      separator: ","               # CSV field separator (default: ",")
      comment_prefix: "#"          # Lines starting with this are skipped (plaintext/CSV)
      skip_header: false           # Skip first line as header (CSV, default: false)
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable/disable threat intelligence |
| `mode` | `string` | `"alert"` | Global enforcement mode. `"alert"` = log matches, pass traffic. `"block"` = drop traffic to/from IOC-listed IPs |
| `country_confidence_boost` | `map<string, integer>` | `{}` | Per-country confidence adjustment (ISO 3166-1 alpha-2 → signed integer). Positive values increase IOC confidence for traffic from listed countries, negative values decrease it. Values are clamped to 0–100 after adjustment |
| `feeds` | `[Feed]` | `[]` | List of feed configurations |

### Feed

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Yes | — | Unique feed identifier |
| `name` | `string` | Yes | — | Human-readable feed name |
| `url` | `string` | Yes | — | Feed URL. Must use `http://` or `https://` (SSRF prevention) |
| `format` | `string` | No | `"plaintext"` | Data format: `plaintext`, `txt`, `text`, `csv`, `json` |
| `enabled` | `bool` | No | `true` | Enable/disable this feed |
| `refresh_interval_secs` | `integer` | No | `3600` | Seconds between re-fetches. Must be > 0 |
| `max_iocs` | `integer` | No | `500000` | Maximum IOCs to load. Excess entries are truncated |
| `default_action` | `string` | No | inherits `mode` | Per-feed override: `"alert"` or `"block"` |
| `min_confidence` | `integer` | No | `0` | Minimum confidence (0-100). IOCs below this are rejected |
| `auth_header` | `string` | No | — | HTTP header sent with requests. Format: `"Header-Name: value"` |

### Field Mapping (CSV / JSON)

These fields configure how the parser extracts IOC data from structured feeds. They are ignored for `plaintext` format.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ip_field` | `string` | `"ip"` | Column name (CSV) or field name (JSON) containing the IP address |
| `confidence_field` | `string` | — | Column/field for confidence score. If absent, confidence defaults to 100 |
| `category_field` | `string` | — | Column/field for threat category (see values below). If absent, defaults to `other` |
| `separator` | `char` | `","` | Field separator for CSV feeds |
| `comment_prefix` | `string` | — | Lines starting with this prefix are skipped (e.g. `"#"`, `";"`) |
| `skip_header` | `bool` | `false` | Skip the first line (CSV column header) |

### Category Values

The `category_field` is normalized to one of:

| Feed value | Maps to | Description |
|-----------|---------|-------------|
| `malware`, `mal` | Malware | Malware distribution |
| `c2`, `c&c`, `command-and-control`, `botnet` | C2 | Command & control |
| `scanner`, `scan` | Scanner | Network scanning |
| `spam`, `spammer` | Spam | Spam sources |
| anything else | Other | Uncategorized |

## How Feed Parsing Works

### Plaintext

One IP per line. Lines starting with `comment_prefix` (default: `#`) are skipped. Only the first whitespace-separated token is taken (inline comments are allowed). CIDR entries (containing `/`) are skipped. All IOCs receive confidence=100.

```
# This is a comment
192.168.1.1         # Inline comment OK
10.0.0.0/8          # CIDR — skipped
203.0.113.42
```

### CSV

Field values are extracted by column name (via header) or by position. The header is auto-detected if `skip_header: true`.

```csv
dst_ip,port,malware,confidence
198.51.100.1,443,emotet,95
203.0.113.55,80,trickbot,80
```

With config:
```yaml
format: csv
ip_field: dst_ip
category_field: malware
confidence_field: confidence
skip_header: true
```

### JSON

Expects a top-level JSON array. Each element is an object with fields matching the mapping.

```json
[
  {"indicator": "198.51.100.1", "type": "malware", "pulse_count": 12},
  {"indicator": "203.0.113.55", "type": "c2", "pulse_count": 5}
]
```

With config:
```yaml
format: json
ip_field: indicator
category_field: type
confidence_field: pulse_count
```

## Deduplication

When the same IP appears in multiple feeds, the **highest-confidence** entry wins. This happens at two levels:

1. **Within a feed**: during parsing, last occurrence wins
2. **Across feeds**: during engine reload, highest confidence wins

## Cross-Domain Integration

### DNS Blocklist → Threat Intel Maps

When a domain in the DNS blocklist resolves to an IP, that IP is **automatically injected** into the threat intel kernel map. This bridges domain-level intelligence with IP-level kernel enforcement:

```yaml
dns:
  blocklist:
    - domain: "*.malware-cdn.com"
      action: block
      # When *.malware-cdn.com resolves to 198.51.100.42,
      # that IP is auto-injected into THREATINTEL_IOCS.
      # Removed when DNS TTL expires (+grace period).
```

### Threat Intel → Domain Reputation

Each IOC match contributes a `CtiMatch` factor with weight **0.8** to the domain reputation score. If the score exceeds `auto_block_threshold` (default 0.8), the domain is auto-blocked.

### GeoIP → Threat Intel (confidence boost)

The `country_confidence_boost` setting adjusts IOC confidence based on the source IP's country:

```yaml
threatintel:
  country_confidence_boost:
    RU: 10       # +10 confidence for IOCs from Russia
    CN: 5        # +5 for China
    KP: 15       # +15 for North Korea
```

## Examples

### Minimal — single plaintext feed

```yaml
agent:
  interfaces: [eth0]

threatintel:
  enabled: true
  mode: alert
  feeds:
    - id: et-compromised
      name: Emerging Threats Compromised
      url: https://rules.emergingthreats.net/blockrules/compromised-ips.txt
      format: plaintext
      refresh_interval_secs: 3600
```

### Multiple feeds with mixed formats

```yaml
threatintel:
  enabled: true
  mode: block

  feeds:
    # Plaintext — IP blocklist, daily refresh
    - id: spamhaus-drop
      name: Spamhaus DROP
      url: https://www.spamhaus.org/drop/drop.txt
      format: plaintext
      comment_prefix: ";"
      refresh_interval_secs: 86400

    # CSV — botnet C2 tracker, high confidence only
    - id: feodo-tracker
      name: Feodo Tracker Botnet C2
      url: https://feodotracker.abuse.ch/downloads/ipblocklist.csv
      format: csv
      ip_field: dst_ip
      category_field: malware
      skip_header: true
      min_confidence: 75
      refresh_interval_secs: 1800

    # JSON — authenticated API, alert-only override
    - id: otx-malicious
      name: AlienVault OTX
      url: https://otx.alienvault.com/api/v1/indicators/export
      format: json
      ip_field: indicator
      confidence_field: pulse_count
      category_field: type
      auth_header: "X-OTX-API-KEY: your-key-here"
      default_action: alert      # Override global "block" for this feed
      min_confidence: 3
      max_iocs: 100000
      refresh_interval_secs: 3600
```

### Alert mode with confidence filtering

```yaml
threatintel:
  enabled: true
  mode: alert

  feeds:
    - id: custom-internal
      name: Internal IOC Feed
      url: https://soc.internal.corp/api/iocs.csv
      format: csv
      ip_field: ip_address
      confidence_field: score
      category_field: classification
      separator: ";"
      comment_prefix: "#"
      skip_header: true
      min_confidence: 50         # Ignore low-confidence entries
      max_iocs: 10000
      auth_header: "Authorization: Bearer internal-token"
      refresh_interval_secs: 300 # Every 5 minutes
```
