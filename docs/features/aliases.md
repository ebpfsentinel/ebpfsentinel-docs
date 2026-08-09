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
| `interface_group` | Addresses currently assigned to named interfaces | The agent's own addresses on `eth0`, `eth1` |
| `mac_set` | MAC addresses for L2 filtering | Known device MAC addresses |
| `bgp_asn` | IPs belonging to BGP AS numbers via MaxMind ASN database | AS15169 (Google), AS13335 (Cloudflare) |
| `external` | Empty placeholder — content pushed via REST API | Integration with external CMDB or IPAM |

## Configuration

Aliases are defined under `firewall.aliases` in the configuration file:

```yaml
firewall:
  aliases:
    rfc1918:
      type: ip_set
      values:
        - "10.0.0.0/8"
        - "172.16.0.0/12"
        - "192.168.0.0/16"
      description: "RFC 1918 private ranges"

    web_ports:
      type: port_set
      values: [80, 443, 8080, "8443-8449"]

    internal:
      type: nested
      aliases: [rfc1918, vpn_ranges]
      exclude:
        - "10.99.0.0/16"

    cloud_ranges:
      type: url_table
      url: "https://ip-ranges.amazonaws.com/ip-ranges.json"
      json_path: "/prefixes/*/ip_prefix"
      refresh_interval: 3600

    blocked_countries:
      type: geoip
      country_codes: [CN, RU, KP]

    dns_servers:
      type: dynamic_dns
      hostnames: ["ns1.example.com", "ns2.example.com"]
      refresh_interval: 300

    dmz_interfaces:
      type: interface_group
      interfaces: [eth3, eth4]

    known_devices:
      type: mac_set
      values:
        - "aa:bb:cc:dd:ee:f0"
        - "aa:bb:cc:dd:ee:f1"

    google_asn:
      type: bgp_asn
      asn_numbers: [15169, 36040]

    external_blocklist:
      type: external
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

    - id: block-scanners
      action: deny
      src_alias: external_blocklist

nat:
  dnat_rules:
    - id: forward-to-dmz
      type: dnat
      match_src_alias: external_blocklist
      translated_addr: "10.0.3.10"
```

## How a Rule Reference Reaches the Kernel

The kernel matches addresses, ports and MAC addresses, never names. Each alias
type therefore binds to one of three kernel mechanisms, and the type decides
which one:

| Alias types | Binding | Consequence for rules |
|-------------|---------|-----------------------|
| `ip_set`, `nested`, `port_set`, `mac_set` | Rule expansion | The rule is installed once per member, so a rule naming a 5-network alias occupies 5 rule slots |
| `url_table`, `url_table_json`, `dynamic_dns`, `interface_group`, `external` | Kernel IPv4 IP set | The rule is installed once and matches against the set, which the agent refills on every refresh without touching the rule |
| `geoip`, `bgp_asn` | LPM trie drop entries | Traffic from the listed countries or AS numbers is dropped on ingress as soon as the alias resolves; naming one of them in a firewall rule does not install that rule |

Expansion covers criteria the IP set cannot express: CIDRs, IPv6, port ranges
and MAC addresses. When a rule names aliases on several sides, the installed
rules are the cross product of what each side resolves to, and combinations
that mix IPv4 with IPv6 are skipped. Expansion is capped at 256 installed rules
per authored rule; a larger alias belongs to one of the set-backed types, whose
members the kernel matches without expansion.

The IPv4 IP set holds exact host addresses, up to 65536 across all sets. Members
that are not `/32` (a CIDR from a URL table, an IPv6 address from a DNS
resolution) stay out of the set and are reported in the agent log, so a rule is
never silently narrowed to a network address.

Two more rules apply everywhere:

- A rule that sets both a literal criterion and an alias on the same side keeps
  the literal; the ignored alias is reported in the log.
- An alias that resolves to nothing drops its rule instead of installing it with
  the criterion left out, which would widen the rule rather than restrict it.

Bindings are rebuilt at startup, on configuration reload, on alias reload, and
on every periodic refresh of the dynamic types, so a new URL table entry or a
new DHCP address reaches the kernel without a rule change.

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
