# Firewall

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: xdp-firewall**

## Overview

The eBPFsentinel firewall provides L3/L4 packet filtering at XDP speed — the earliest possible hook point in the Linux network stack, before the kernel allocates an SKB. Packets are matched against rules using a multi-phase lookup combining LPM trie CIDR matching (O(log n)) with priority-based linear evaluation, stateful connection tracking, IP/port aliases, and policy routing.

## How It Works

### Rule Scope

Firewall rules can be scoped to control where they apply:

| Scope | Description |
|-------|-------------|
| **Global** | Rule applies to all interfaces and namespaces (default) |
| **Interface(`name`)** | Rule applies only to traffic on the named interface |
| **Namespace(`name`)** | Rule applies only within the named network namespace |

### Firewall Mode

The firewall operates in one of two modes:

- **block** (default) — `deny` rules drop packets (`XDP_DROP`)
- **alert** — `deny` rules log the packet but pass it through (`XDP_PASS` + RingBuf event)

Alert mode is useful for testing rules in production before enforcing them.

### Multi-Phase Pipeline

The XDP firewall processes packets through five phases:

1. **Phase 0 — Conntrack fast-path**: Overload check (IP set 255), then connection tracking lookup. Established connections are fast-tracked without rule evaluation.
2. **Phase 1 — LPM Trie** (O(log n)): CIDR-only rules (source/destination subnet) in four tries: `FW_LPM_SRC_V4`, `FW_LPM_DST_V4`, `FW_LPM_SRC_V6`, `FW_LPM_DST_V6`.
3. **Phase 2 — Linear scan**: Rules with port ranges, protocol, VLAN, TCP flags, ICMP, MAC, DSCP, aliases, or negation filters are evaluated in priority order (lowest number = highest precedence). First matching rule wins.
4. **Phase 3 — Connection limits**: Per-source and per-rule state limits are checked for new connections. Overloaded sources are added to the blacklist.
5. **Phase 4 — Routing actions**: Policy routing (route-to, reply-to, dup-to) is applied to matched packets.

### Rule Matching

Each rule field is optional — omitted fields act as wildcards:

| Field | Wildcard | Match Logic |
|-------|----------|-------------|
| `src_ip` | Omit to match any | CIDR subnet match (`10.0.0.0/8`) |
| `dst_ip` | Omit to match any | CIDR subnet match (`192.168.1.0/24`) |
| `src_port` | Omit to match any | Port range match (`1024-65535`) |
| `dst_port` | Omit to match any | Port range match (`80-443`) or single |
| `protocol` | `any` to match all | Exact match (`tcp`, `udp`, `icmp`) |
| `vlan_id` | Omit to match any | Exact 802.1Q VLAN ID match |
| `flags` | Omit to match any | TCP flags (`S/SA`, `A/A`, `F/F`) |
| `icmp_type` | Omit to match any | ICMP type number or name |
| `icmp_code` | Omit to match any | ICMP code number |
| `src_mac` | Omit to match any | Exact source MAC address |
| `dst_mac` | Omit to match any | Exact destination MAC address |
| `dscp_match` | Omit to match any | DSCP value (0-63) |
| `ct_states` | Omit to match any | Conntrack states (`new`, `established`, `related`, `invalid`) |
| `src_alias` | Omit to match any | Named IP alias (resolved to IP set) |
| `dst_alias` | Omit to match any | Named IP alias |
| `negate_source` | `false` | Invert source IP match (match if NOT in CIDR) |
| `negate_destination` | `false` | Invert destination IP match |

**Default policy** (`pass` or `drop`) applies when no rule matches. Maximum 4096 rules per address family.

### XDP Actions

- **allow** — `XDP_PASS` the packet into the kernel network stack
- **deny** — `XDP_DROP` the packet (never reaches the kernel)
- **log** — `XDP_PASS` + emit event to RingBuf for userspace logging

### Stateful Inspection (Connection Tracking)

When conntrack is enabled, the firewall maintains a connection state table:

- **TCP**: Full state machine (SYN_SENT → SYN_RECV → ESTABLISHED → FIN_WAIT → TIME_WAIT)
- **UDP**: Bidirectional detection (NEW → ESTABLISHED after reply seen)
- **ICMP**: Simple request/reply state

Rules can match on conntrack state using `ct_states`:

```yaml
- id: allow-established
  priority: 1
  action: allow
  ct_states: [established, related]
```

### Connection Limits & Overload Protection

Per-source connection limits prevent brute-force and state exhaustion attacks:

- `max_src_states`: Maximum concurrent connections per source IP
- `max_src_conn_rate`: Maximum new connections per source within a time window
- Per-rule `max_states`: Limit concurrent states matching a specific rule

When a source exceeds limits, its IP is automatically added to the overload blacklist (IP set 255) and all further packets are dropped at the fast-path.

### TCP Flags Matching

Rules can match on specific TCP flag combinations, using the `flags` field with `match/mask` notation:

| Notation | Meaning |
|----------|---------|
| `S/SA` | SYN set, ACK unset (new connections) |
| `A/A` | ACK set |
| `F/F` | FIN set |
| `R/R` | RST set |

### ICMP Type/Code Matching

Rules can match ICMP type and code to allow specific ICMP messages while blocking others:

```yaml
- id: allow-ping
  action: allow
  protocol: icmp
  icmp_type: 8         # echo-request
  icmp_code: 0
```

This is essential for IPv6 NDP to function correctly.

### IP Negation

Source and destination IP matching can be inverted with `negate_source` and `negate_destination`. This enables rules like "allow all except RFC1918 on WAN":

```yaml
- id: block-private-on-wan
  action: deny
  src_ip: "10.0.0.0/8"
  negate_source: true    # Match everything EXCEPT 10.0.0.0/8
  scope: "interface:eth0"
```

### MAC Address Filtering (L2)

Source and destination MAC addresses can be matched for L2 access control:

```yaml
- id: block-rogue-device
  action: deny
  src_mac: "aa:bb:cc:dd:ee:ff"
```

### DSCP / QoS

Rules can match on DSCP values and mark packets for downstream QoS queuing:

```yaml
- id: voip-priority
  action: allow
  protocol: udp
  dst_port: "5060-5061"
  dscp_match: 46         # Match EF traffic
  dscp_mark: 46          # Mark as EF (Expedited Forwarding)
```

### IP/Port Aliases

Named aliases allow rules to reference dynamic IP/port groups:

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
      action: allow
      src_alias: trusted-networks
      dst_port_alias: web-ports
```

Aliases are resolved at load time into eBPF IP set / port set maps.

### Rule Scheduling

Rules can be activated/deactivated based on time schedules:

```yaml
schedules:
  business_hours:
    entries:
      - days: [mon, tue, wed, thu, fri]
        time: "08:00-18:00"

firewall:
  rules:
    - id: guest-wifi
      action: allow
      schedule: business_hours
```

The scheduler evaluates every 60 seconds and reloads eBPF rules on state transitions.

### Anti-Lockout Protection

The firewall automatically injects anti-lockout rules at priority 0 (highest precedence) to prevent administrators from being locked out of the management interface:

```yaml
firewall:
  anti_lockout:
    enabled: true
    interfaces: ["eth0"]
    ports: [22, 8080, 50051]
```

Anti-lockout rules are marked as `system: true` and cannot be deleted via the API.

### Packet Normalization (Scrub)

A dedicated TC program normalizes packets after XDP processing:

- **TTL normalization**: Raise TTL to a minimum value (IPv4)
- **Hop limit normalization**: Raise hop limit to a minimum value (IPv6, no checksum update needed)
- **MSS clamping**: Clamp TCP MSS option on SYN packets (IPv4/IPv6)
- **DF bit clearing**: Clear the Don't Fragment flag (IPv4 only)
- **IP ID randomization**: Randomize the IP identification field (IPv4 only)

```yaml
firewall:
  scrub:
    enabled: true
    min_ttl: 64
    min_hop_limit: 64
    max_mss: 1440
    clear_df: true
    random_ip_id: true
```

### Policy Routing

Rules can include routing actions for multi-WAN and traffic engineering:

| Action | Description |
|--------|-------------|
| `route_to` | Force packet to a specific egress interface |
| `reply_to` | Store ingress interface for stateful return routing |
| `dup_to` | Mirror packet to another interface for inspection |

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
```

Gateways are health-checked periodically. When a gateway goes down, traffic fails over to the next healthy gateway.

### Tail-Call Chaining

When the firewall passes a packet, it optionally **tail-calls** into `xdp-ratelimit` via `PROG_ARRAY`. This means only one XDP program needs to be attached per interface.

### XDP Metadata

The firewall writes metadata (`bpf_xdp_adjust_meta`) containing the matched rule ID and flags. Downstream TC programs read this without re-parsing packet headers.

### Advanced XDP Features

- **Packet mirroring** via `DEVMAP` + `bpf_redirect` to monitoring interfaces
- **CPU steering** via `CPUMAP` for NUMA-aware packet distribution
- **FIB routing enrichment** via `bpf_fib_lookup` for next-hop and routing anomaly detection
- **MTU validation** via `bpf_check_mtu` before redirect operations
- **Checksum offload** via `bpf_csum_diff` / `bpf_l3_csum_replace` / `bpf_l4_csum_replace`

## Configuration

```yaml
firewall:
  enabled: true
  mode: block
  default_policy: drop
  anti_lockout:
    enabled: true
    interfaces: ["eth0"]
    ports: [22, 8080, 50051]
  scrub:
    enabled: true
    max_mss: 1440
    min_ttl: 64
    min_hop_limit: 64
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
      scope: "interface:eth0"
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
    - id: block-rogue
      priority: 50
      action: deny
      src_mac: "aa:bb:cc:dd:ee:ff"
    - id: guest-wifi
      priority: 60
      action: allow
      schedule: business_hours
      max_states: 1000
    - id: log-all
      priority: 1000
      action: log
```

The REST API accepts `"pass"`/`"allow"` and `"deny"`/`"drop"`/`"block"` as synonyms for the action field.

See [Configuration: Firewall](../configuration/firewall.md) for the full reference.

## CLI Usage

```bash
# List all rules
ebpfsentinel-agent firewall list

# Add a rule
ebpfsentinel-agent firewall add --json '{
  "id": "block-telnet",
  "priority": 5,
  "action": "deny",
  "protocol": "tcp",
  "dst_port": 23
}'

# Delete a rule
ebpfsentinel-agent firewall delete block-telnet

# Show schedule status
ebpfsentinel-agent firewall rules --show-schedule

# Show conntrack status
ebpfsentinel-agent conntrack status
ebpfsentinel-agent conntrack connections
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/firewall/rules` | List all firewall rules |
| POST | `/api/v1/firewall/rules` | Create a firewall rule |
| DELETE | `/api/v1/firewall/rules/{id}` | Delete a firewall rule (403 for system rules) |
| GET | `/api/v1/conntrack/status` | Conntrack status (enabled, connection count) |
| GET | `/api/v1/conntrack/connections` | List active connections |
| POST | `/api/v1/conntrack/flush` | Flush connection table |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-common` | `crates/ebpf-common/src/firewall.rs` | Shared rule entry structs (56B V4, 104B V6) |
| `ebpf-common` | `crates/ebpf-common/src/conntrack.rs` | Conntrack shared types |
| `ebpf-common` | `crates/ebpf-common/src/scrub.rs` | Scrub configuration struct |
| `ebpf-programs` | `crates/ebpf-programs/xdp-firewall/` | XDP kernel program |
| `ebpf-programs` | `crates/ebpf-programs/tc-conntrack/` | TC connection tracking |
| `ebpf-programs` | `crates/ebpf-programs/tc-scrub/` | TC packet normalization |
| `domain` | `crates/domain/src/firewall/` | Firewall engine (entity, engine, error) |
| `domain` | `crates/domain/src/routing/` | Gateway and routing entities |
| `ports` | `crates/ports/src/primary/firewall.rs` | Port trait |
| `application` | `crates/application/src/firewall_service_impl.rs` | App service (anti-lockout, mode, eBPF sync) |
| `application` | `crates/application/src/schedule_service_impl.rs` | Rule scheduling service |
| `application` | `crates/application/src/conntrack_service_impl.rs` | Conntrack management |
| `application` | `crates/application/src/routing_service_impl.rs` | Gateway monitoring & failover |
| `adapters` | `crates/adapters/src/http/firewall_handler.rs` | HTTP handler |
| `adapters` | `crates/adapters/src/http/conntrack_handler.rs` | Conntrack HTTP handler |

## Metrics

- `ebpfsentinel_packets_total{interface, verdict}` — packets processed with verdict (pass/drop/log)
- `ebpfsentinel_rules_loaded{domain="firewall"}` — number of loaded firewall rules
- `ebpfsentinel_processing_duration_seconds{domain="firewall"}` — rule evaluation latency
- `ebpfsentinel_conntrack_connections` — active connections in conntrack table
- `ebpfsentinel_conntrack_new_total` — new connections tracked
- `ebpfsentinel_scrub_mss_clamped_total` — MSS options clamped
- `ebpfsentinel_scrub_ttl_fixed_total` — TTL values normalized
