# Aliases Configuration

The `aliases` section defines named collections of IPs, ports, MAC addresses, and other network identifiers that can be referenced by name in firewall rules, NAT, L7, and other domains. Aliases are defined at the top level of the configuration file.

## Reference

```yaml
aliases:
  rfc1918:
    type: ip_set
    values: ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]
    exclude: ["10.99.0.0/16"]
    description: "RFC 1918 private networks"
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | string | required | Alias type (see types below) |
| `values` | list | `[]` | Values for `ip_set`, `port_set`, and `mac_set` types |
| `aliases` | list | `[]` | Child alias names for `nested` type |
| `url` | string | `null` | URL for `url_table` and `url_table_json` types |
| `refresh_interval` | u64 | varies | Refresh interval in seconds for `url_table`, `url_table_json`, and `dynamic_dns` (default 3600 for URL types, 300 for DNS) |
| `country_codes` | list | `[]` | ISO 3166-1 alpha-2 codes for `geoip` type |
| `hostnames` | list | `[]` | Hostnames for `dynamic_dns` type |
| `interfaces` | list | `[]` | Interface names for `interface_group` type |
| `exclude` | list | `[]` | CIDRs to exclude (for `ip_set` and `nested` types) |
| `json_path` | string | `null` | JSONPointer path for `url_table_json` type |
| `asn_numbers` | list | `[]` | ASN numbers for `bgp_asn` type |
| `description` | string | `null` | Human-readable description |

Maximum 1000 aliases.

## Alias Types

### `ip_set` -- IP/CIDR Collection

A static set of IP addresses and CIDR ranges.

```yaml
rfc1918:
  type: ip_set
  values: ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]
  exclude: ["10.99.0.0/16"]
  description: "RFC 1918 minus the test lab"
```

### `port_set` -- Port Collection

A static set of ports and port ranges.

```yaml
http_ports:
  type: port_set
  values: ["80-443", 8080, 8443]
```

### `nested` -- Composite Alias

Combines multiple existing aliases into one, with optional exclusions.

```yaml
internal:
  type: nested
  aliases: [rfc1918, vpn_clients]
  exclude: ["10.99.0.0/16"]
```

### `url_table` -- External IP List

Fetches a plain-text list of IPs/CIDRs from a URL and refreshes periodically.

```yaml
tor_exits:
  type: url_table
  url: "https://check.torproject.org/torbulkexitlist"
  refresh_interval: 3600
```

### `url_table_json` -- External JSON Source

Fetches IPs from a JSON endpoint using a JSONPointer path.

```yaml
cloud_ranges:
  type: url_table_json
  url: "https://ip-ranges.amazonaws.com/ip-ranges.json"
  json_path: "/prefixes/*/ip_prefix"
  refresh_interval: 86400
```

### `geoip` -- Country-Based

Matches IPs by country using MaxMind GeoIP data. Country codes must be 2-letter uppercase ISO 3166-1 alpha-2.

```yaml
blocked_countries:
  type: geoip
  country_codes: ["CN", "RU", "KP"]
```

### `dynamic_dns` -- DNS-Resolved Hosts

Resolves hostnames to IPs and refreshes periodically.

```yaml
saas_providers:
  type: dynamic_dns
  hostnames: ["api.example.com", "cdn.example.com"]
  refresh_interval: 300
```

### `interface_group` -- Interface Set

Groups network interfaces by name.

```yaml
lan_interfaces:
  type: interface_group
  interfaces: [eth0, eth1]
```

### `mac_set` -- MAC Address Collection

A static set of MAC addresses.

```yaml
trusted_devices:
  type: mac_set
  values: ["aa:bb:cc:dd:ee:ff", "00:11:22:33:44:55"]
```

### `bgp_asn` -- Autonomous System Numbers

Matches IPs belonging to specific BGP autonomous systems.

```yaml
cloud_providers:
  type: bgp_asn
  asn_numbers: [16509, 14618, 8075]
  description: "AWS and Azure ASNs"
```

### `external` -- External Provider

Placeholder for externally managed alias data. No additional fields required.

```yaml
siem_watchlist:
  type: external
```

## Example

```yaml
aliases:
  rfc1918:
    type: ip_set
    values: ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"]
    description: "RFC 1918 private networks"

  http_ports:
    type: port_set
    values: [80, 443, 8080, "8443-8445"]

  blocked_countries:
    type: geoip
    country_codes: ["CN", "RU", "KP", "IR"]

  tor_exits:
    type: url_table
    url: "https://check.torproject.org/torbulkexitlist"
    refresh_interval: 3600

  all_internal:
    type: nested
    aliases: [rfc1918]
    exclude: ["10.99.0.0/16"]

  trusted_macs:
    type: mac_set
    values: ["aa:bb:cc:dd:ee:ff"]
    description: "Approved hardware"
```
