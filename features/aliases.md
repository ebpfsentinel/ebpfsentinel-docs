# IP/Port Aliases

Aliases are named, reusable sets of addresses, ports, or other identifiers that can be referenced in firewall rules, NAT rules, and other domains. Instead of duplicating CIDR lists across rules, define an alias once and reference it by name.

## Alias Types

eBPFsentinel supports 11 alias types:

| Type | Description | Example |
|------|-------------|---------|
| `ip_set` | Static list of IP addresses or CIDRs with optional exclusions | RFC1918 ranges minus a specific subnet |
| `port_set` | List of ports or port ranges | Common web ports (80, 443, 8080-8089) |
| `nested` | References other aliases recursively | Combine `rfc1918` + `vpn-ranges` into `internal` |
| `url_table` | Text file fetched via URL (one IP/CIDR per line) | Remote blocklists, cloud provider IP ranges |
| `url_table_json` | JSON document fetched via URL with JSONPointer extraction | API responses with nested IP lists |
| `geoip` | IPs matching country codes via MaxMind GeoLite2 | All IPs from `CN`, `RU` |
| `dynamic_dns` | Hostnames resolved periodically | `my-server.dyndns.org` |
| `interface_group` | IPs assigned to named network interfaces | All IPs on `eth0`, `eth1` |
| `mac_set` | MAC addresses for L2 filtering | Known device MAC addresses |
| `bgp_asn` | IPs belonging to BGP AS numbers via MaxMind ASN database | AS15169 (Google), AS13335 (Cloudflare) |
| `external` | Empty placeholder — content pushed via REST API | Integration with external CMDB or IPAM |

## Configuration

Aliases are defined under `firewall.aliases` in the configuration file:

```yaml
firewall:
  aliases:
    rfc1918:
      alias_type: ip_set
      values:
        - "10.0.0.0/8"
        - "172.16.0.0/12"
        - "192.168.0.0/16"
      description: "RFC 1918 private ranges"

    web_ports:
      alias_type: port_set
      values: [80, 443, 8080, "8443-8449"]

    internal:
      alias_type: nested
      aliases: [rfc1918, vpn_ranges]
      exclude:
        - "10.99.0.0/16"

    cloud_ranges:
      alias_type: url_table
      url: "https://ip-ranges.amazonaws.com/ip-ranges.json"
      json_path: "/prefixes/*/ip_prefix"
      refresh_interval: 3600

    blocked_countries:
      alias_type: geoip
      country_codes: [CN, RU, KP]

    dns_servers:
      alias_type: dynamic_dns
      hostnames: ["ns1.example.com", "ns2.example.com"]
      refresh_interval: 300

    dmz_interfaces:
      alias_type: interface_group
      interfaces: [eth3, eth4]

    known_devices:
      alias_type: mac_set
      values:
        - "aa:bb:cc:dd:ee:f0"
        - "aa:bb:cc:dd:ee:f1"

    google_asn:
      alias_type: bgp_asn
      asn_numbers: [15169, 36040]

    external_blocklist:
      alias_type: external
      description: "Pushed via API by CMDB"
```

## Using Aliases in Rules

Reference aliases by name in firewall and NAT rules:

```yaml
firewall:
  rules:
    - id: allow-internal-web
      action: allow
      src_alias: internal
      dst_port_alias: web_ports

    - id: block-countries
      action: deny
      src_alias: blocked_countries

nat:
  dnat_rules:
    - id: forward-to-dmz
      nat_type: dnat
      match_src_alias: external_blocklist
      translated_addr: "10.0.3.10"
```

## Recursive Resolution

Nested aliases are resolved recursively with cycle detection. If alias A references B which references A, validation fails with a circular reference error.

Exclusions are applied after resolution — an `ip_set` with `exclude` removes matching CIDRs from the resolved set.

## External Aliases

The `external` type starts empty. Push content via the REST API:

```bash
curl -X PUT http://localhost:8080/api/v1/aliases/external_blocklist/content \
  -H "Content-Type: application/json" \
  -d '{"ips": ["192.168.0.0/16", "10.0.0.0/8"]}'
```

This enables integration with external systems (CMDB, IPAM, orchestrators) that manage IP lists independently.

## Limits

- Maximum 1000 aliases per configuration
- Alias IDs must be alphanumeric with dashes and underscores only

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/aliases/status` | Total alias count |
| PUT | `/api/v1/aliases/{id}/content` | Set content for an external alias |

See [REST API Reference](../api-reference/rest-api.md) for details.
