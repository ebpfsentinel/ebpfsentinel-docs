# NAT Configuration

Network Address Translation rules for SNAT and DNAT. See [NAT](../features/nat.md) for the feature overview.

## Configuration

```yaml
nat:
  enabled: false
  snat_rules:
    - id: masq-lan
      nat_type: masquerade
      interface: eth0
      match_src: "192.168.1.0/24"
      match_protocol: tcp

  dnat_rules:
    - id: web-forward
      nat_type: port_forward
      ext_port: { start: 80, end: 80 }
      int_addr: "10.0.1.10"
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

Maximum 256 rules per direction.

### Rule Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | Unique rule identifier |
| `enabled` | bool | `true` | Enable/disable without deleting |
| `priority` | u32 | `100` | Lower values match first |
| `nat_type` | string | — | One of: `snat`, `dnat`, `masquerade`, `one_to_one`, `redirect`, `port_forward` |

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
| `int_addr` | string | Internal destination IP |
| `int_port` | object | Internal `{ start, end }` port range |

### Match Criteria

All match fields are optional. If omitted, the rule matches all traffic.

| Field | Type | Description |
|-------|------|-------------|
| `match_src` | string | Source CIDR |
| `match_dst` | string | Destination CIDR |
| `match_dst_port` | object | Destination `{ start, end }` port range |
| `match_protocol` | string | `tcp`, `udp`, or omit for both |
| `match_src_alias` | string | Reference an [alias](../features/aliases.md) for source matching |
| `match_dst_alias` | string | Reference an alias for destination matching |

## Examples

### Masquerade LAN to WAN

```yaml
nat:
  enabled: true
  snat_rules:
    - id: masq-all
      nat_type: masquerade
      interface: eth0
      match_src: "192.168.0.0/16"
```

### Port Forward with Alias

```yaml
nat:
  enabled: true
  dnat_rules:
    - id: forward-web
      nat_type: port_forward
      ext_port: { start: 443, end: 443 }
      int_addr: "10.0.1.10"
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
      nat_type: one_to_one
      external_addr: "203.0.113.10"
      internal_addr: "10.0.1.10"
```
