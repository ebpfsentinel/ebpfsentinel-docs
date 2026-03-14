# Interface Groups

> **Edition: OSS** | **Status: Shipped** | **Scope: Cross-domain (6 eBPF programs)**

## Overview

Interface groups allow rules to be scoped to specific network interfaces or groups of interfaces. This enables per-zone policies (e.g., different firewall rules for LAN vs WAN, stricter rate limiting on public-facing interfaces, separate NAT policies per network segment) without duplicating rules or maintaining per-interface configuration files.

Rules without an `interfaces` field are **floating rules** — they apply to all interfaces, preserving full backward compatibility.

## How It Works

### Configuration

Define named interface groups at the top level, then reference them in the `interfaces` field on individual rules:

```yaml
interface_groups:
  lan:
    interfaces: [eth0, eth1]
  wan:
    interfaces: [eth2]
  dmz:
    interfaces: [eth3]

firewall:
  rules:
    - id: block-external-ssh
      action: deny
      protocol: tcp
      dst_port: 22
      interfaces: [wan]           # Only on WAN interfaces

    - id: allow-internal-all
      action: allow
      interfaces: ["!wan"]        # All interfaces EXCEPT WAN (inversion)

    - id: allow-dns
      action: allow
      protocol: udp
      dst_port: 53                # No interfaces = floating (all interfaces)

nat:
  rules:
    - id: masquerade-wan
      nat_type: masquerade
      interfaces: [wan]           # SNAT only on WAN egress

ratelimit:
  rules:
    - id: wan-ratelimit
      rate: 5000
      burst: 10000
      algorithm: token_bucket
      interfaces: [wan]           # Stricter rate limits on WAN

qos:
  classifiers:
    - id: 1
      queue_id: 1
      priority: 10
      protocol: 6
      dst_port: 443
      interfaces: [wan]           # Shape HTTPS only on WAN egress

ids:
  rules:
    - id: dmz-strict
      pattern: ".*"
      interfaces: [dmz]           # Full inspection on DMZ
```

### Inversion

Prefix a group name with `!` to invert the match. The rule applies to all interfaces *except* those in the specified group:

```yaml
interfaces: ["!wan"]    # Matches LAN, DMZ, and any other non-WAN interface
```

### Floating Rules

Rules without an `interfaces` field (or with an empty list) are floating — they apply to all interfaces regardless of group membership. This is the default behavior and ensures backward compatibility with configurations that predate interface groups.

## Supported Domains

Interface groups are enforced in 6 eBPF programs:

| Domain | eBPF Program | Rule Field |
|--------|-------------|------------|
| Firewall | `xdp-firewall` | `group_mask` on `FirewallRuleEntry` |
| Rate Limiting / DDoS | `xdp-ratelimit` | `group_mask` on rate limit rules |
| NAT (ingress) | `tc-nat-ingress` | `group_mask` on `NatRuleEntry` |
| NAT (egress) | `tc-nat-egress` | `group_mask` on `NatRuleEntry` |
| IDS | `tc-ids` | `group_mask` on IDS rules |
| QoS | `tc-qos` | `group_mask` on pipe/classifier entries |

Programs without interface group support (tc-conntrack, tc-scrub, tc-threatintel, tc-dns, xdp-loadbalancer, uprobe-dlp) process all traffic unconditionally.

## eBPF Implementation

Each of the 6 programs has an `INTERFACE_GROUPS` HashMap map:

- **Key:** `u32` (ifindex of the network interface)
- **Value:** `u32` (bitmask of group memberships)
- **Max entries:** 64

Userspace writes the mapping at configuration load and reload. Each rule struct carries a `group_mask: u32` field.

### Matching Logic (per rule)

```
if group_mask == 0:
    # Floating rule — always matches
    evaluate rule

else:
    iface_mask = INTERFACE_GROUPS.lookup(ifindex)
    if iface_mask is None:
        skip rule  # interface not in any group

    invert = group_mask & (1 << 31)
    mask   = group_mask & 0x7FFFFFFF

    if invert:
        if (iface_mask & mask) == 0:
            evaluate rule   # interface NOT in specified groups
    else:
        if (iface_mask & mask) != 0:
            evaluate rule   # interface IS in specified groups
```

This adds one HashMap lookup and one AND + compare per rule — negligible overhead at wire speed.

## Limits

- **Up to 31 groups** (bits 0-30 of the u32 bitmask). Bit 31 is reserved for the inversion flag.
- **Up to 64 interfaces** can have group membership (HashMap max_entries).
- An interface can belong to **multiple groups** simultaneously (multiple bits set).
- A rule can target **multiple groups** simultaneously (multiple group names in the `interfaces` list).

## Metrics

Interface group configuration is included in the standard config reload metrics. No additional per-group metrics are emitted — rule match counters already reflect per-rule hit rates regardless of interface scoping.
