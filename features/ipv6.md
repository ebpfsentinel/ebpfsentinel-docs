# IPv6 Support

> **Edition: OSS** | **Status: Shipped** | **Enforcement: All eBPF programs**

## Overview

eBPFsentinel provides full dual-stack IPv4/IPv6 support across all eBPF programs and domain engines. IPv6 is not a bolt-on feature — it is integrated into the core packet processing path.

## eBPF Programs

All 10 eBPF programs parse both IPv4 and IPv6 headers natively:

- **Firewall** — separate LPM trie maps for IPv4 and IPv6 (`FW_LPM_SRC_V4`, `FW_LPM_DST_V4`, `FW_LPM_SRC_V6`, `FW_LPM_DST_V6`)
- **Conntrack** — `ConnKeyV6` / `ConnValueV6` with 128-bit NAT addresses, shared LRU map between programs
- **NAT Ingress/Egress** — `NatRuleEntryV6` with per-word mask matching, L4 pseudo-header checksum updates (no `bpf_l3_csum_replace` needed for IPv6)
- **Scrub** — hop limit normalization (IPv6 equivalent of TTL), MSS clamping (reused from IPv4 path)
- **Threat Intel** — separate V6 maps for IOC lookups
- **Rate Limiting** — IPv6 addresses are XOR-folded to `u32` for per-CPU hash map keys
- **IDS** — port-only keys (IP version agnostic)
- **DNS** — captures queries over both IPv4 and IPv6

## PacketEvent Structure

The `PacketEvent` (56 bytes) carries IPv6 addresses natively:

- `src_addr: [u32; 4]` — source address (IPv4 uses index 0 only)
- `dst_addr: [u32; 4]` — destination address
- `flags` — `FLAG_IPV6` set for IPv6 packets
- Domain engines check the flag to interpret the address fields correctly

## Configuration

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

## Code Architecture

| Layer | Implementation |
|-------|---------------|
| `ebpf-common` | `IpNetwork::V6 { addr: [u8; 16], prefix_len }`, `IpCidr` type alias |
| `ebpf-programs` | Dual-stack parsing, V6 LPM maps, `ConnKeyV6`/`ConnValueV6`, `NatRuleEntryV6` |
| `domain` | All engines handle IPv6 addresses via `[u32; 4]` representation |
| `infrastructure` | Config validation for IPv6 CIDRs |
