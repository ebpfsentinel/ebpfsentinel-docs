# NAT Configuration

Network Address Translation rules for SNAT and DNAT. See [NAT](../features/nat.md) for the feature overview.

## Configuration

```yaml
nat:
  enabled: false
  snat_rules:
    - id: masq-lan
      type: masquerade
      interface: eth0
      match_src: "192.168.1.0/24"
      match_protocol: tcp

  dnat_rules:
    - id: web-forward
      type: port_forward
      ext_port: { start: 80, end: 80 }
      internal_addr: "10.0.1.10"
      int_port: { start: 8080, end: 8080 }
      match_protocol: tcp
```

## Reference

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable NAT |
| `snat_rules` | list | `[]` | Source NAT rules (applied on egress) |
| `dnat_rules` | list | `[]` | Destination NAT rules (applied on ingress) |
| `nptv6_rules` | list | `[]` | NPTv6 (RFC 6296) stateless IPv6 prefix translation rules |
| `hairpin` | object | — | Hairpin NAT (NAT reflection) settings |

Maximum 256 rules per direction (IPv4), 128 per direction (IPv6).

### Rule Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | Unique rule identifier |
| `enabled` | bool | `true` | Enable/disable without deleting |
| `priority` | u32 | `100` | Lower values match first |
| `type` | string | — | One of: `snat`, `dnat`, `masquerade`, `one_to_one`, `redirect`, `port_forward` |
| `interfaces` | list | `[]` | Restrict the rule to specific interfaces or interface groups. Empty = all interfaces |
| `tenant_id` | u32 | `0` | Tenant this rule belongs to. `0` is global and translates for every tenant. A non-zero value makes the kernel skip the rule for traffic it resolves to any other tenant, which is what lets two tenants keep overlapping private ranges behind separate translations. An agent without tenant attribution resolves every packet to `0`, so leave it unset there |

`tenant_id` applies to `snat_rules` and `dnat_rules`. NPTv6 translation is a
stateless prefix rewrite and is not tenant-scoped.

### NAT Type Parameters

#### `snat`

| Field | Type | Description |
|-------|------|-------------|
| `translated_addr` | string | IP address to rewrite source to |
| `port_range` | object | Optional `{ start, end }` port range |

#### `dnat`

| Field | Type | Description |
|-------|------|-------------|
| `translated_addr` | string | IP address to rewrite destination to |
| `translated_port` | u16 | Optional port to rewrite destination to |

#### `masquerade`

| Field | Type | Description |
|-------|------|-------------|
| `interface` | string | Outgoing interface whose IP will be used |
| `port_range` | object | Optional `{ start, end }` port range |

#### `one_to_one`

| Field | Type | Description |
|-------|------|-------------|
| `external_addr` | string | External (public) IP |
| `internal_addr` | string | Internal (private) IP |

#### `redirect`

| Field | Type | Description |
|-------|------|-------------|
| `translated_port` | u16 | Local port to redirect to |

#### `port_forward`

| Field | Type | Description |
|-------|------|-------------|
| `ext_port` | object | External `{ start, end }` port range |
| `internal_addr` | string | Internal destination IP |
| `int_port` | object | Internal `{ start, end }` port range |

### Match Criteria

All match fields are optional. If omitted, the rule matches all traffic.

| Field | Type | Description |
|-------|------|-------------|
| `match_src` | string | Source address or CIDR, e.g. `10.0.0.1` or `10.0.0.0/8` |
| `match_dst` | string | Destination address or CIDR |
| `match_dst_port` | object | Destination `{ start, end }` port range |
| `match_protocol` | string | `tcp`, `udp`, `icmp`, `icmpv6`, or `any` (the same as omitting it) |
| `match_src_alias` | string | Reference an [alias](../features/aliases.md) for source matching, see below |
| `match_dst_alias` | string | Reference an alias for destination matching |

`icmp` and `icmpv6` are the same setting written two ways: each rule is
matched by the ICMP of its own address family.

### Alias references

The data plane matches addresses, so an alias-named criterion is resolved
into CIDRs when the rules are loaded, and again on every configuration
reload. A rule naming an alias that holds several networks becomes one
installed rule per network, and a rule naming one on both sides becomes the
cross product of the two, minus the combinations that mix address families.
The rules keep the id they were written with.

Two cases are worth knowing:

- A rule that sets both `match_src` and `match_src_alias` keeps the literal
  CIDR and logs that the alias was ignored, the same on the destination side.
  The literal is the explicit intent, and the two are not intersected.
- A rule whose alias is unknown, or resolves to no network, is dropped rather
  than installed unrestricted, and the reason is logged. A rule that lost its
  source restriction would translate traffic it was never meant to touch.

An alias that fills in later (a URL table, a hostname set) is picked up at
the next configuration reload, not the moment the alias refreshes.

A rule is IPv4 or IPv6 as a whole. Its translated, external and internal
addresses and its match CIDRs must all belong to one family, since the rule
is installed in the IPv4 or the IPv6 map and an address of the other family
has no representation there. A rule that mixes them, a match that is neither
an address nor a CIDR, and a protocol outside the list above are all
rejected when the configuration is read: the data plane cannot report them,
it can only leave the criterion out, which widens the rule instead of
narrowing it.

### Hairpin NAT (NAT reflection)

Lets internal clients reach internal services via the external IP. The firewall
applies DNAT + SNAT so return traffic routes back through `tc-nat-ingress` instead
of being short-circuited (which would break the connection via asymmetric routing).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable hairpin NAT |
| `internal_subnet` | string | — | Internal client subnet (CIDR) eligible for reflection |
| `hairpin_snat_ip` | string | — | Source IP applied to hairpinned traffic |

```yaml
nat:
  enabled: true
  hairpin:
    enabled: true
    internal_subnet: "192.168.1.0/24"
    hairpin_snat_ip: "192.168.1.1"
```

### NPTv6 (RFC 6296)

Stateless, bidirectional IPv6-to-IPv6 prefix translation — no conntrack. Egress
rewrites the source prefix (internal → external); ingress rewrites the destination
prefix (external → internal), adjusting one IID word for checksum neutrality.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | Unique rule identifier |
| `enabled` | bool | `true` | Enable/disable without deleting |
| `internal_prefix` | string | — | Site-local IPv6 prefix (e.g. ULA `fd00:1::`) |
| `external_prefix` | string | — | Provider-assigned / globally-routable prefix |
| `prefix_len` | u8 | — | Prefix length in bits (1–64) |
| `interfaces` | list | `[]` | Restrict the rule to specific interfaces or groups |

```yaml
nat:
  enabled: true
  nptv6_rules:
    - id: nptv6-site1
      internal_prefix: "fd00:1::"
      external_prefix: "2001:db8:1::"
      prefix_len: 48
```

## Examples

### Masquerade LAN to WAN

```yaml
nat:
  enabled: true
  snat_rules:
    - id: masq-all
      type: masquerade
      interface: eth0
      match_src: "192.168.0.0/16"
```

### Port Forward with Alias

```yaml
nat:
  enabled: true
  dnat_rules:
    - id: forward-web
      type: port_forward
      ext_port: { start: 443, end: 443 }
      internal_addr: "10.0.1.10"
      int_port: { start: 8443, end: 8443 }
      match_src_alias: trusted_networks
      match_protocol: tcp
```

### Bidirectional 1:1 NAT

```yaml
nat:
  enabled: true
  snat_rules:
    - id: nat-server1
      type: one_to_one
      external_addr: "203.0.113.10"
      internal_addr: "10.0.1.10"
```
