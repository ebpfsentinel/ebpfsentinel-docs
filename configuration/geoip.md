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
  refresh_interval_hours: 24                   # Auto-refresh interval (0 = disabled)
  database_dir: "/var/lib/ebpfsentinel/geoip"  # Storage directory for downloaded databases
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable GeoIP enrichment |
| `source` | `GeoIpSource` | Required | Database provisioning mode |
| `refresh_interval_hours` | `integer` | `24` | Hours between auto-refresh downloads (0 = disabled) |
| `database_dir` | `string` | `/var/lib/ebpfsentinel/geoip` | Directory for storing downloaded databases |

### GeoIpSource — Mode: `maxmind_account`

Auto-download databases from the MaxMind API using account credentials.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `string` | Yes | Must be `maxmind_account` |
| `account_id` | `string` | Yes | MaxMind account ID |
| `license_key` | `string` | Yes | MaxMind license key |
| `edition_ids` | `[string]` | No | Database editions to download (default: `["GeoLite2-City", "GeoLite2-ASN"]`) |

### GeoIpSource — Mode: `url`

Download databases from arbitrary URLs. Supports raw `.mmdb` files and `.tar.gz` archives (auto-extracted).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `string` | Yes | Must be `url` |
| `city_url` | `string` | Yes | URL for the City database |
| `asn_url` | `string` | No | URL for the ASN database |

### GeoIpSource — Mode: `file`

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
- `file` mode: `city_path` must not be empty
- `license_key` is masked in sanitized config output (`****`)

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
  refresh_interval_hours: 0
```

### City database only (no ASN)

```yaml
geoip:
  enabled: true
  source:
    mode: file
    city_path: "/opt/geoip/GeoLite2-City.mmdb"
  refresh_interval_hours: 0
```

Alerts will include country/city information but no ASN data.
