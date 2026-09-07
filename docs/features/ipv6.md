# IPv6 Support

> **Edition: OSS** | **Enforcement: All eBPF programs**

## Overview

eBPFsentinel provides full dual-stack IPv4/IPv6 support across all eBPF programs and domain engines. IPv6 is not a bolt-on feature — it is integrated into the core packet processing path.

## eBPF Programs

Every IP-path eBPF program parses both IPv4 and IPv6 headers natively, including **IPv6 extension header chains**. (`xdp-vip-announcer` handles ARP only, and `xdp-pass` is a passthrough helper.) The parser walks the chain to locate the upper-layer protocol header (TCP/UDP/ICMPv6), so a rule still matches when extension headers are present.

Six header types are walked: Hop-by-Hop (0), Routing (43), Fragment (44), AH (51), Destination Options (60) and Mobility (135). **ESP (50) is terminal**: it is not consumed, and it is returned as the upper-layer protocol, because everything past an ESP header is encrypted and there is no L4 header to find. A rule matching on port therefore never matches an ESP packet; match ESP on protocol instead.

The walk is bounded to **six iterations**, which the eBPF verifier requires. A chain of more than six extension headers is not walked to its end: the seventh header's own type is returned as the upper-layer protocol, with the offset pointing at that header rather than at TCP or UDP.

- **Firewall** — separate LPM trie maps for IPv4 and IPv6 (`FW_LPM_SRC_V4`, `FW_LPM_DST_V4`, `FW_LPM_SRC_V6`, `FW_LPM_DST_V6`)
- **Conntrack** — `ConnKeyV6` / `ConnValueV6` with 128-bit NAT addresses, shared LRU map between programs
- **NAT Ingress/Egress** — `NatRuleEntryV6` with per-word mask matching, L4 pseudo-header checksum updates (no `bpf_l3_csum_replace` needed for IPv6), NPTv6 (RFC 6296) stateless prefix translation
- **Scrub** — hop limit normalization (IPv6 equivalent of TTL), MSS clamping (reused from IPv4 path)
- **Threat Intel** — separate V6 maps for IOC lookups
- **Rate Limiting** — IPv6 addresses are XOR-folded to `u32` for per-CPU hash map keys
- **IDS** — port-only keys (IP version agnostic)
- **DNS** — captures queries over both IPv4 and IPv6

## PacketEvent Structure

The `PacketEvent` (96 bytes) carries IPv6 addresses natively:

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
    - id: ipv6-blocklist
      name: "IPv6 Blocklist"
      url: "https://feeds.example.com/ipv6-blocklist.txt"
      format: plaintext
      default_action: block
```

## Code Architecture

| Layer | Implementation |
|-------|---------------|
| `domain` | `IpNetwork::V6 { addr: [u8; 16], prefix_len }` in `crates/domain/src/firewall/entity.rs`; every engine handles IPv6 addresses via the `[u32; 4]` representation |
| `ebpf-common` | `PacketEvent` in `crates/ebpf-common/src/event.rs`, 96 bytes with both address fields sized for IPv6 |
| `ebpf-programs` | Dual-stack parsing, V6 LPM maps, `ConnKeyV6`/`ConnValueV6`, `NatRuleEntryV6` |
| `infrastructure` | Config validation for IPv6 CIDRs |
