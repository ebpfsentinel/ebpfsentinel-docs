# GeoIP Configuration

The `geoip` section configures IP-to-location enrichment using MaxMind GeoLite2 or GeoIP2 databases. When enabled, alerts are enriched with geographic and ASN information for source and destination IPs.

## Reference

```yaml
geoip:
  enabled: true                                # Enable/disable GeoIP enrichment
  source:
    mode: "file"                               # maxmind_account, url, or file
    city_path: "/opt/geoip/GeoLite2-City.mmdb" # Path to City database (file mode)
    asn_path: "/opt/geoip/GeoLite2-ASN.mmdb"   # Path to ASN database (file mode, optional)
  refresh_interval_hours: 24                   # Download again every N hours (download modes)
  database_dir: "/var/lib/ebpfsentinel/geoip"  # Storage directory for downloaded databases
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable GeoIP enrichment |
| `source` | `GeoIpSource` | Required | Database provisioning mode |
| `refresh_interval_hours` | `integer` | `24` | Hours between two downloads in `maxmind_account` and `url` modes, where it is at least 1, and between two re-extractions of the `geoip`, `bgp_asn` and `interface_group` aliases in every mode; only `file` mode accepts `0`, which stops the re-extraction |
| `database_dir` | `string` | `/var/lib/ebpfsentinel/geoip` | Directory `maxmind_account` and `url` download into; must be writable by the agent |

### GeoIpSource - Mode: `maxmind_account`

Auto-download databases from the MaxMind API using account credentials.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `string` | Yes | Must be `maxmind_account` |
| `account_id` | `string` | Yes | MaxMind account ID |
| `license_key` | `string` | Yes | MaxMind license key |
| `edition_ids` | `[string]` | No | Database editions to download (default: `["GeoLite2-City", "GeoLite2-ASN"]`) |

### GeoIpSource - Mode: `url`

Download databases from arbitrary URLs. Supports raw `.mmdb` files and `.tar.gz` archives (auto-extracted).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `string` | Yes | Must be `url` |
| `city_url` | `string` | Yes | URL for the City database |
| `asn_url` | `string` | No | URL for the ASN database |

### GeoIpSource - Mode: `file`

Load databases from local `.mmdb` files. No network access required.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `string` | Yes | Must be `file` |
| `city_path` | `string` | Yes | Path to City `.mmdb` file |
| `asn_path` | `string` | No | Path to ASN `.mmdb` file |

## Validation

- `source` is required when `enabled: true`
- `maxmind_account` mode: `account_id`, `license_key`, and `edition_ids` must not be empty
- `url` mode: `city_url` must not be empty
- `maxmind_account` and `url` modes: `database_dir` must not be empty and `refresh_interval_hours` must be at least 1
- `file` mode: `city_path` must not be empty
- `license_key` is masked in sanitized config output (`***`)

## Downloads and refresh

In `maxmind_account` and `url` modes the agent downloads the databases into
`database_dir` at start-up, before the first lookup, then again every
`refresh_interval_hours`, and swaps the new database in without a restart: a
lookup sees the database before the refresh or the one after it. A download
replaces a file only once it opens as a database, so a failed, truncated or
non-database answer (an error page from a proxy) leaves the previous file in
use and is logged. When the start-up download fails, the agent serves what a
previous run left in `database_dir`; with nothing there, enrichment is off
until the next refresh succeeds.

Country and ASN lists in aliases are expanded from the database loaded when
the alias is resolved; a refreshed database reaches them at the next periodic alias
refresh.

## Examples

### MaxMind account (auto-download)

```yaml
geoip:
  enabled: true
  source:
    mode: maxmind_account
    account_id: "123456"
    license_key: "your-license-key"
    edition_ids:
      - GeoLite2-City
      - GeoLite2-ASN
  refresh_interval_hours: 24
  database_dir: "/var/lib/ebpfsentinel/geoip"
```

Free GeoLite2 accounts: [maxmind.com/en/geolite2/signup](https://www.maxmind.com/en/geolite2/signup)

### Self-hosted mirror (URL)

```yaml
geoip:
  enabled: true
  source:
    mode: url
    city_url: "https://mirror.internal/GeoLite2-City.mmdb"
    asn_url: "https://mirror.internal/GeoLite2-ASN.mmdb"
  refresh_interval_hours: 12
  database_dir: "/var/lib/ebpfsentinel/geoip"
```

### Local files (air-gapped)

```yaml
geoip:
  enabled: true
  source:
    mode: file
    city_path: "/opt/geoip/GeoLite2-City.mmdb"
    asn_path: "/opt/geoip/GeoLite2-ASN.mmdb"
```

### City database only (no ASN)

```yaml
geoip:
  enabled: true
  source:
    mode: file
    city_path: "/opt/geoip/GeoLite2-City.mmdb"
```

Alerts will include country/city information but no ASN data.

## Cross-Domain Integration

When GeoIP is enabled, other domains can use country information for enforcement decisions. No additional GeoIP configuration is needed - each domain configures its own country-aware features:

| Domain | Config Key | Description |
|--------|-----------|-------------|
| DDoS | `ddos.policies[].country_thresholds` | Per-country PPS thresholds + auto CIDR blocking |
| IDS | `ids.sampling.high_risk_countries` | Country-based sampling mode |
| IDS | `ids.rules[].country_thresholds` | Per-country threshold overrides |
| IPS | `ips.country_thresholds` | Per-country blacklist thresholds + /24 subnet injection |
| L7 | `l7.rules[].src_country_codes` | Source country matching |
| L7 | `l7.rules[].dst_country_codes` | Destination country matching |
| Threat Intel | `threatintel.country_confidence_boost` | IOC confidence boost by country |
| DNS | `dns.reputation.high_risk_countries` | High-risk country reputation factor |
| Rate Limit | `ratelimit.country_tiers` | Per-country rate limit tiers (kernel LPM) |

See each domain's configuration reference for details.
