# Firewall Configuration

The `firewall` section configures L3/L4 packet filtering rules enforced at XDP speed, with stateful connection tracking, IP/port aliases, packet normalization, and policy routing.

## Reference

```yaml
firewall:
  enabled: true                # Enable/disable firewall (default: true)
  mode: block                  # block or alert (default: block)
  default_policy: pass         # pass or drop. Default: pass
  anti_lockout:
    enabled: true
    interfaces: ["eth0"]
    ports: [22, 8080, 50051]
  scrub:
    enabled: true
    max_mss: 1440
    min_ttl: 64
    clear_df: true
    random_ip_id: true
  rules:
    - id: "rule-id"            # Unique rule identifier
      priority: 10             # Lower number = higher precedence
      action: allow            # allow, deny, or log
      protocol: tcp            # tcp, udp, icmp, or any
      src_ip: "10.0.0.0/8"    # Source CIDR (optional — omit to match any)
      dst_ip: "192.168.1.0/24" # Destination CIDR (optional)
      src_port: "1024-65535"   # Source port or range (optional)
      dst_port: "80-443"       # Destination port or range (optional)
      vlan_id: 100             # 802.1Q VLAN ID (optional — omit to match any)
      scope: global            # global, interface:<name>, namespace:<name>
      flags: "S/SA"            # TCP flags match/mask notation (optional)
      icmp_type: 8             # ICMP type number or name (optional)
      icmp_code: 0             # ICMP code number (optional)
      negate_source: false     # Invert source IP match (optional)
      negate_destination: false # Invert destination IP match (optional)
      src_mac: "aa:bb:cc:dd:ee:ff"  # Source MAC address (optional)
      dst_mac: "00:11:22:33:44:55"  # Destination MAC address (optional)
      dscp_match: 46           # Match DSCP value 0-63 (optional)
      dscp_mark: 46            # Set DSCP value on matched packets (optional)
      ct_states: [established, related]  # Conntrack state filter (optional)
      src_alias: trusted-networks  # Named IP alias for source (optional)
      dst_alias: servers       # Named IP alias for destination (optional)
      dst_port_alias: web-ports  # Named port alias for destination (optional)
      schedule: business_hours # Time-based schedule name (optional)
      max_states: 1000         # Per-rule connection state limit (optional)
      route_to:                # Policy routing action (optional)
        gateway: "203.0.113.1"
        interface: "eth1"
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable/disable the firewall |
| `mode` | `string` | `block` | `block` (deny→drop) or `alert` (deny→log only) |
| `default_policy` | `string` | `pass` | Action when no rule matches: `pass` or `drop` |
| `rules` | `[Rule]` | `[]` | Firewall rules list |
| `anti_lockout` | `AntiLockout` | see below | Anti-lockout safety mechanism |
| `scrub` | `Scrub` | see below | Packet normalization settings |

### Rule

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier |
| `priority` | `integer` | Yes | Evaluation order (lowest = first) |
| `action` | `string` | Yes | `allow`/`pass`, `deny`/`drop`/`block`, or `log` |
| `protocol` | `string` | No | `tcp`, `udp`, `icmp`, or `any` |
| `src_ip` | `string` | No | Source CIDR (`10.0.0.0/8`, `2001:db8::/32`) |
| `dst_ip` | `string` | No | Destination CIDR |
| `src_port` | `string` | No | Source port or range (`80`, `1024-65535`) |
| `dst_port` | `string` | No | Destination port or range |
| `vlan_id` | `integer` | No | 802.1Q VLAN ID (0 = any) |
| `scope` | `string` | No | `global`, `interface:<name>`, or `namespace:<name>` |
| `flags` | `string` | No | TCP flags in `match/mask` notation (`S/SA`, `A/A`, `F/F`, `R/R`) |
| `icmp_type` | `integer` or `string` | No | ICMP type number or name (`echo-request`, `8`) |
| `icmp_code` | `integer` | No | ICMP code number |
| `negate_source` | `bool` | No | Invert source IP match (match if NOT in CIDR) |
| `negate_destination` | `bool` | No | Invert destination IP match |
| `src_mac` | `string` | No | Source MAC address (`aa:bb:cc:dd:ee:ff`) |
| `dst_mac` | `string` | No | Destination MAC address |
| `dscp_match` | `integer` | No | Match DSCP value (0-63, omit = any) |
| `dscp_mark` | `integer` | No | Set DSCP value on matched packets (0-63) |
| `ct_states` | `[string]` | No | Conntrack state filter: `new`, `established`, `related`, `invalid` |
| `src_alias` | `string` | No | Named IP alias for source (resolved to IP set) |
| `dst_alias` | `string` | No | Named IP alias for destination |
| `dst_port_alias` | `string` | No | Named port alias for destination |
| `schedule` | `string` | No | Time-based schedule name |
| `max_states` | `integer` | No | Per-rule concurrent connection state limit |
| `route_to` | `object` | No | Force packet to a specific egress gateway |
| `reply_to` | `object` | No | Store ingress interface for stateful return routing |
| `dup_to` | `object` | No | Mirror packet to another interface |

### Anti-Lockout

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable anti-lockout protection |
| `interfaces` | `[string]` | `[]` | Management interfaces (e.g., `["eth0"]`) |
| `ports` | `[integer]` | `[]` | Management ports (e.g., `[22, 8080, 50051]`) |

Anti-lockout rules are injected at priority 0 (highest precedence) and marked as `system: true`. They cannot be deleted via the API.

### Scrub (Packet Normalization)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable packet normalization |
| `min_ttl` | `integer` | `0` | Raise TTL to this minimum value (0 = no change) |
| `max_mss` | `integer` | `0` | Clamp TCP MSS on SYN packets (0 = no clamp) |
| `clear_df` | `bool` | `false` | Clear the Don't Fragment flag |
| `random_ip_id` | `bool` | `false` | Randomize IP identification field |

Scrub runs as a TC program (`tc-scrub`) after XDP processing.

## Limits

- Maximum **4096 rules** per address family (IPv4/IPv6)
- CIDR-only rules use LPM trie maps (O(log n) lookup)
- Rules with port/protocol/VLAN/flags/ICMP/MAC/DSCP are evaluated in priority order (linear scan)
- Maximum 65536 per-source state counters
- TCP flags matching requires `protocol: tcp`
- ICMP type/code matching requires `protocol: icmp`

## Examples

### Drop-by-default with stateful rules

```yaml
firewall:
  default_policy: drop
  anti_lockout:
    enabled: true
    interfaces: ["eth0"]
    ports: [22, 8080]
  rules:
    - id: allow-established
      priority: 1
      action: allow
      ct_states: [established, related]
    - id: allow-web
      priority: 10
      action: allow
      protocol: tcp
      dst_ip: "10.0.1.0/24"
      dst_port: "80-443"
      flags: "S/SA"
    - id: allow-ssh-mgmt
      priority: 20
      action: allow
      protocol: tcp
      src_ip: "192.168.0.0/16"
      dst_port: 22
    - id: allow-dns
      priority: 30
      action: allow
      protocol: udp
      dst_port: 53
    - id: allow-ping
      priority: 40
      action: allow
      protocol: icmp
      icmp_type: 8
      icmp_code: 0
    - id: log-all
      priority: 1000
      action: log
```

### IPv6 with NDP

```yaml
firewall:
  default_policy: drop
  rules:
    - id: allow-ipv6-web
      priority: 10
      action: allow
      protocol: tcp
      src_ip: "2001:db8::/32"
      dst_port: "80-443"
    - id: allow-ndp-solicitation
      priority: 20
      action: allow
      protocol: icmp
      icmp_type: 135
    - id: allow-ndp-advertisement
      priority: 21
      action: allow
      protocol: icmp
      icmp_type: 136
```

### MAC address filtering

```yaml
firewall:
  rules:
    - id: block-rogue-device
      priority: 5
      action: deny
      src_mac: "aa:bb:cc:dd:ee:ff"
    - id: allow-trusted-server
      priority: 10
      action: allow
      dst_mac: "00:11:22:33:44:55"
      protocol: tcp
      dst_port: "80-443"
```

### IP negation (block RFC1918 on WAN)

```yaml
firewall:
  rules:
    - id: block-private-on-wan
      priority: 5
      action: deny
      src_ip: "10.0.0.0/8"
      negate_source: true
      scope: "interface:eth0"
```

### DSCP / QoS marking

```yaml
firewall:
  rules:
    - id: voip-priority
      priority: 10
      action: allow
      protocol: udp
      dst_port: "5060-5061"
      dscp_match: 46
      dscp_mark: 46
```

### VLAN-based isolation

```yaml
firewall:
  default_policy: pass
  rules:
    - id: allow-mgmt-vlan
      priority: 5
      action: allow
      vlan_id: 100
      protocol: tcp
      dst_port: 22
    - id: isolate-guest
      priority: 10
      action: deny
      vlan_id: 200
      dst_ip: "10.0.0.0/8"
```

### Aliases

```yaml
aliases:
  - id: trusted-networks
    type: ip
    entries: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
  - id: web-ports
    type: port
    entries: ["80", "443", "8080"]

firewall:
  rules:
    - id: allow-trusted-web
      priority: 10
      action: allow
      src_alias: trusted-networks
      dst_port_alias: web-ports
```

### Scheduled rules

```yaml
schedules:
  business_hours:
    entries:
      - days: [mon, tue, wed, thu, fri]
        time: "08:00-18:00"

firewall:
  rules:
    - id: guest-wifi
      priority: 60
      action: allow
      schedule: business_hours
      max_states: 1000
```

### Policy routing (multi-WAN)

```yaml
routing:
  enabled: true
  gateways:
    - id: 1
      name: wan1
      interface: eth1
      gateway_ip: "203.0.113.1"
      priority: 10
      health_check:
        target: "8.8.8.8"
        protocol: icmp
    - id: 2
      name: wan2
      interface: eth2
      gateway_ip: "198.51.100.1"
      priority: 20

firewall:
  rules:
    - id: wan2-outbound
      priority: 10
      action: allow
      src_ip: "10.0.2.0/24"
      route_to:
        gateway: "203.0.113.1"
        interface: "eth1"
```

### Packet normalization

```yaml
firewall:
  scrub:
    enabled: true
    max_mss: 1440
    min_ttl: 64
    clear_df: true
    random_ip_id: true
```
