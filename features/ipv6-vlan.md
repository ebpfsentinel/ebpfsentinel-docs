# IPv6 & VLAN Support

> **Edition: OSS** | **Status: Shipped** | **Enforcement: All eBPF programs**

## Overview

eBPFsentinel provides full dual-stack IPv4/IPv6 support and 802.1Q VLAN filtering across all eBPF programs and domain engines. IPv6 and VLAN are not bolt-on features — they are integrated into the core packet processing path.

## IPv6 Support

### eBPF Programs

All eBPF programs parse both IPv4 and IPv6 headers natively:

- **Firewall** — separate LPM trie maps for IPv4 and IPv6 (`FW_LPM_SRC_V4`, `FW_LPM_DST_V4`, `FW_LPM_SRC_V6`, `FW_LPM_DST_V6`)
- **Threat Intel** — separate V6 maps for IOC lookups
- **Rate Limiting** — IPv6 addresses are XOR-folded to `u32` for per-CPU hash map keys
- **IDS** — port-only keys (IP version agnostic)
- **DNS** — captures queries over both IPv4 and IPv6

### PacketEvent Structure

The `PacketEvent` (56 bytes) carries IPv6 addresses natively:

- `src_addr: [u32; 4]` — source address (IPv4 uses index 0 only)
- `dst_addr: [u32; 4]` — destination address
- `flags` — `FLAG_IPV6` set for IPv6 packets
- Domain engines check the flag to interpret the address fields correctly

### Configuration

IPv6 CIDRs work in all rule fields that accept IP addresses:

```yaml
firewall:
  rules:
    - id: allow-ipv6-web
      priority: 10
      action: allow
      protocol: tcp
      src_ip: "2001:db8::/32"
      dst_port: "80-443"
    - id: block-ipv6-range
      priority: 20
      action: deny
      dst_ip: "fd00::/8"

threatintel:
  feeds:
    - name: ipv6-blocklist
      url: "https://feeds.example.com/ipv6-blocklist.txt"
      format: plaintext
      action: block
```

## VLAN 802.1Q Support

### Firewall VLAN Filtering

Firewall rules can match on VLAN ID (0 = any VLAN, >0 = exact match):

```yaml
firewall:
  rules:
    - id: allow-management-vlan
      priority: 5
      action: allow
      vlan_id: 100
      protocol: tcp
      dst_port: 22
    - id: isolate-guest-vlan
      priority: 10
      action: deny
      vlan_id: 200
      dst_ip: "10.0.0.0/8"
```

### VLAN Quarantine

Threat intelligence can tag matching traffic with a quarantine VLAN using `bpf_skb_vlan_push`:

```yaml
threatintel:
  quarantine_vlan: 999
  feeds:
    - name: malware-ips
      url: "https://feeds.example.com/malware.txt"
      format: plaintext
      action: quarantine    # Tags with VLAN 999 instead of dropping
```

### eBPF Implementation

- Inline `VlanHdr` struct for 802.1Q header parsing
- `bpf_skb_vlan_push` / `bpf_skb_vlan_pop` for VLAN rewriting in TC programs
- `FLAG_VLAN` in `PacketEvent.flags` signals VLAN-tagged packets to userspace
- `PacketEvent.vlan_id` carries the original VLAN ID

## Code Architecture

IPv6 and VLAN support is not isolated to a single crate — it's woven through:

| Layer | Implementation |
|-------|---------------|
| `ebpf-common` | `IpNetwork::V6 { addr: [u8; 16], prefix_len }`, `IpCidr` type alias |
| `ebpf-programs` | Dual-stack parsing, VLAN header parsing, V6 LPM maps |
| `domain` | All engines handle IPv6 addresses and VLAN context |
| `infrastructure` | Config validation for IPv6 CIDRs and VLAN IDs |
