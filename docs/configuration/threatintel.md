# Threat Intelligence Configuration

The `threatintel` section configures external OSINT feeds for IOC-based threat detection. Feeds are **source-agnostic** - any HTTP/HTTPS endpoint serving indicators in plaintext, CSV, JSON, or STIX 2.1 bundle format works through field mappings.

## Reference

```yaml
threatintel:
  enabled: true                    # Enable/disable the entire domain
  mode: alert                      # Global mode: "alert" or "block"

  feeds:
    - id: "feed-id"                # Unique identifier (required)
      name: "Human Name"           # Display name (required)
      url: "https://..."           # Feed URL, http:// or https:// only (required)
      format: plaintext            # plaintext, csv, json, stix (default: plaintext)
      enabled: true                # Per-feed enable/disable (default: true)
      refresh_interval_secs: 3600  # Seconds between re-fetches (default: 3600)
      max_iocs: 500000             # Max IOCs to load from this feed (default: 500000)
      default_action: block        # "alert" or "block" for this feed only, overriding the global mode
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
| `country_confidence_boost` | `map<string, integer>` | `{}` | Per-country confidence adjustment (ISO 3166-1 alpha-2 → signed integer). Positive values increase IOC confidence for traffic from listed countries, negative values decrease it. Values are clamped to 0-100 after adjustment |
| `feeds` | `[Feed]` | `[]` | List of feed configurations |
| `max_entries` | `integer` | derived | Capacity of the kernel IOC tables (IPv4 and IPv6 each, plus their bloom filters), 4,096 to 4,194,304. When unset it is the enabled feeds' `max_iocs` added up and rounded up to a power of two, and a configuration with no feed gets the floor rather than the tables' former fixed million slots. Locked kernel memory, about 80 bytes per slot per table, is paid at load whether the slots are used or not. Applies at the next agent start; a value changed by a reload is reported, not applied |

### Feed

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Yes | - | Unique feed identifier |
| `name` | `string` | Yes | - | Human-readable feed name |
| `url` | `string` | Yes | - | Feed URL. Must use `http://` or `https://` (SSRF prevention) |
| `format` | `string` | No | `"plaintext"` | Data format: `plaintext`, `txt`, `text`, `csv`, `json`, `stix` |
| `enabled` | `bool` | No | `true` | Enable/disable this feed |
| `refresh_interval_secs` | `integer` | No | `3600` | Seconds between re-fetches. Must be > 0 |
| `max_iocs` | `integer` | No | `500000` | Maximum IOCs to load. Excess entries are truncated |
| `default_action` | `string` | No | - | `"alert"` or `"block"` (`monitor` and `observe` are accepted as `alert`, `enforce` as `block`). Enforcement mode for this feed's indicators only. Absent, the feed follows the global `mode`. See below |
| `min_confidence` | `integer` | No | `0` | Minimum confidence (0-100). IOCs below this are rejected |
| `auth_header` | `string` | No | - | HTTP header sent with requests. Format: `"Header-Name: value"` |

Every IOC from every feed is loaded into one kernel map, and each entry carries
its own enforcement flag. The top-level `mode` sets that flag for every
indicator whose feed does not override it, and `default_action` sets it for the
indicators of the feed that carries it: a feed on `default_action: alert` under
`mode: block` logs its matches while the rest of the estate drops, and a feed on
`default_action: block` under `mode: alert` drops its own while the rest logs.
Where a packet matches on both source and destination, the stronger of the two
actions applies. An indicator added through the API, or left behind by a feed
removed from the configuration, follows the global `mode`. The key is documented
here and nowhere else, since a second statement of it is a second place to go
stale.

### Field Mapping (CSV / JSON)

These fields configure how the parser extracts IOC data from structured feeds. They are ignored for `plaintext` format.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ip_field` | `string` | `"ip"` | Column name (CSV) or field name (JSON) containing the IP address |
| `confidence_field` | `string` | - | Column/field for confidence score. If absent, confidence defaults to 100 |
| `category_field` | `string` | - | Column/field for threat category (see values below). If absent, defaults to `other` |
| `separator` | `char` | `","` | Field separator for CSV feeds |
| `comment_prefix` | `string` | - | Lines starting with this prefix are skipped (e.g. `"#"`, `";"`) |
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
10.0.0.0/8          # CIDR - skipped
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

### STIX 2.1

Expects a STIX 2.1 bundle (`{"type": "bundle", "objects": [...]}`). The parser extracts indicators from multiple object types and distributes them to the appropriate engines:

| STIX Object | Extracted Data | Target Engine |
|-------------|---------------|---------------|
| `indicator` (SDO) | IPs from pattern (`[ipv4-addr:value = '...']`) | Threat Intel |
| `indicator` (SDO) | Domains from pattern (`[domain-name:value = '...']`) | DNS Blocklist + Domain Reputation |
| `indicator` (SDO) | URLs from pattern (`[url:value = '...']`) | L7 Firewall |
| `ipv4-addr` / `ipv6-addr` (SCO) | IP address directly | Threat Intel (confidence=50) |
| `domain-name` (SCO) | Domain name directly | DNS Blocklist (confidence=50) |
| `malware` / `attack-pattern` / `threat-actor` (SDO) | Threat type enrichment | Via `relationship` objects |
| `relationship` (SRO) | Links indicator to malware/attack-pattern | Overrides `indicator_types` mapping |

**Supported pattern forms:** `[type:value = '...']` (simple equality). Compound patterns (`AND`, `OR`) are supported for multiple values. Complex STIX patterning operators (`LIKE`, `MATCHES`, `IN`) are not supported.

**Temporal filtering:** Indicators with `valid_until` in the past are automatically skipped.

**Source tagging:** Domain patterns injected from STIX feeds are tagged with `stix:<feed-id>`, enabling bulk cleanup on feed refresh via `remove_patterns_by_source`.

**`indicator_types` mapping:**

| STIX indicator type | Maps to |
|--------------------|---------|
| `malicious-activity`, `malware` | Malware |
| `command-and-control`, `botnet` | C2 |
| `compromised`, `anomalous-activity` | Scanner |
| `unwanted` | Spam |
| anything else | Other |

```yaml
threatintel:
  feeds:
    - id: misp-stix
      name: MISP STIX Feed
      url: https://misp.internal.corp/feeds/stix2.1/bundle.json
      format: stix
      refresh_interval_secs: 1800
      min_confidence: 40
      auth_header: "Authorization: Bearer misp-api-key"
```

## CrowdSec

`threatintel.crowdsec` connects the agent to a CrowdSec local API, in two directions that are switched on separately. Both are off by default.

```yaml
threatintel:
  enabled: true
  mode: block
  crowdsec:
    enabled: false                 # Read the bans in force (default: false)
    lapi_url: "http://127.0.0.1:8080"
    bouncer_key: "..."             # From `cscli bouncers add ebpfsentinel`
    refresh_interval_secs: 60      # Seconds between reads, at least 60 (default: 60)
    max_decisions: 100000          # Most bans loaded at once (default: 100000)
    default_action: block          # Optional, "alert" or "block"; inherits `mode`
    report:
      enabled: false               # Write the agent's own blocks back (default: false)
      machine_id: "ebpfsentinel"   # From `cscli machines add ebpfsentinel`
      password: "..."
      interval_secs: 60            # Seconds between reports, at least 10 (default: 60)
      decision_duration: "4h"      # Optional: also ban the source for this long
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Read the decision list as a bouncer. Each ban on one address becomes an indicator in the `crowdsec` feed, matched in the kernel like any other |
| `lapi_url` | `string` | - | Base address of the local API, `http://` or `https://`, without credentials. Unlike a feed it may be on the host or the local network; cloud metadata addresses are still refused |
| `bouncer_key` | `string` | - | The bouncer's API key, sent as `X-Api-Key`. Masked as `***` wherever the configuration is shown |
| `refresh_interval_secs` | `integer` | `60` | Seconds between reads of `GET /v1/decisions?type=ban`, at least 60 |
| `max_decisions` | `integer` | `100000` | Most bans loaded. Counted into the IOC table capacity when `max_entries` is unset |
| `default_action` | `string` | `mode` | `"alert"` or `"block"` for a banned address |
| `report.enabled` | `bool` | `false` | Report the agent's own blocks to the local API as a machine |
| `report.machine_id` | `string` | - | The machine registered for the agent |
| `report.password` | `string` | - | Its password. Masked as `***` wherever the configuration is shown |
| `report.interval_secs` | `integer` | `60` | Seconds between reports, at least 10 |
| `report.decision_duration` | `string` | none | `4h`, `30m` or `1h30m`. When set, every reported source also carries a ban of that length, which the local API hands to every bouncer it serves. Absent, the report is recorded and bans nothing |

**What is read.** Only bans on a single address: a decision of scope `Ip`, or a `Range` that is one address (`/32`, `/128`). A captcha, a throttle, a wider range, a country or an AS is left out and counted in the log line each read writes, because the kernel table holds addresses. An empty answer (`null`) empties the feed. The local API follows the same rules as a feed otherwise: no redirect is followed, the body is depth-limited, and the read keeps the previous set when it fails.

**What is sent, and what is not.** With `report.enabled`, the agent sends, once per interval, one alert per blocked source and component: the source address, the scenario `ebpfsentinel/<component>` (`ebpfsentinel/ids`, `ebpfsentinel/firewall`, ...), how many times it was blocked and the first and last time. Nothing else leaves the host: no destination address or port, no rule, no payload, no hostname, no interface and no configuration. Only blocks qualify: an alert in `alert` mode, an alert marked as a false positive, a source on a private, loopback or link-local address, and a match on a threat-intelligence indicator (which may have come from CrowdSec in the first place) are never reported. At most 1,000 sources are held per interval; a report that fails is dropped rather than queued, and the next one carries whatever is still being blocked.

A reload changes the address, key and limits of the reading half, provided the feed fetcher is already running (the agent started with at least one feed or with CrowdSec enabled); the refresh period and every reporting setting apply at the next agent start.

## Security Validation

Feed fetching and parsing enforce several security constraints:

- **URL validation (SSRF prevention)**: feed URLs must use `http://` or `https://` schemes. URLs resolving to private (RFC 1918), loopback, link-local, or multicast IP addresses are rejected. HTTP redirects are not followed.
- **Auth header validation**: the `auth_header` value is validated against CRLF injection (`\r\n` sequences are rejected).
- **JSON depth limit**: JSON feed parsing is limited to 64 nesting levels to prevent stack exhaustion.
- **YAML config size limit**: threat intel YAML configuration is limited to 10 MiB.

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
    domains:
      - "*.malware-cdn.com"
    action: block
    inject_target: threatintel
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

### Minimal - single plaintext feed

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
    # Plaintext - IP blocklist, daily refresh
    - id: spamhaus-drop
      name: Spamhaus DROP
      url: https://www.spamhaus.org/drop/drop.txt
      format: plaintext
      comment_prefix: ";"
      refresh_interval_secs: 86400

    # CSV - botnet C2 tracker, high confidence only
    - id: feodo-tracker
      name: Feodo Tracker Botnet C2
      url: https://feodotracker.abuse.ch/downloads/ipblocklist.csv
      format: csv
      ip_field: dst_ip
      category_field: malware
      skip_header: true
      min_confidence: 75
      refresh_interval_secs: 1800

    # JSON - authenticated API, alert-only override
    - id: otx-malicious
      name: AlienVault OTX
      url: https://otx.alienvault.com/api/v1/indicators/export
      format: json
      ip_field: indicator
      confidence_field: pulse_count
      category_field: type
      auth_header: "X-OTX-API-KEY: your-key-here"
      default_action: alert      # This feed only logs its matches; the global "block" governs the rest
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
