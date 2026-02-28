# Packet Pipeline

The full kernel-side packet processing pipeline, from NIC to userspace.

## Ingress Pipeline

```
                    ┌─────────────────────────────┐
                    │          NIC (driver)        │
                    └──────────────┬──────────────┘
                                   │
                    ╔══════════════╧══════════════╗
                    ║     XDP Hook (earliest)      ║
                    ╠═════════════════════════════╣
                    ║                              ║
                    ║  ┌────────────────────────┐  ║
                    ║  │    xdp-firewall         │  ║
                    ║  │                          │  ║
                    ║  │  1. Conntrack fast-path  │  ║
                    ║  │  2. LPM trie lookup      │  ║
                    ║  │  3. Linear rule scan     │  ║
                    ║  │  4. Connection limits     │  ║
                    ║  │  5. Routing actions       │  ║
                    ║  └──────┬────────┬─────────┘  ║
                    ║         │        │             ║
                    ║    XDP_DROP   tail_call        ║
                    ║    [end]      (PROG_ARRAY)     ║
                    ║              │                  ║
                    ║  ┌───────────▼──────────────┐  ║
                    ║  │    xdp-ratelimit          │  ║
                    ║  │                            │  ║
                    ║  │  • Per-IP rate check       │  ║
                    ║  │  • SYN cookie protection   │  ║
                    ║  │  • ICMP rate limiting      │  ║
                    ║  │  • UDP amp detection       │  ║
                    ║  └──────┬────────┬───────────┘  ║
                    ║         │        │               ║
                    ║    XDP_DROP   XDP_PASS            ║
                    ║    [end]      + metadata          ║
                    ║              (bpf_xdp_adjust_meta)║
                    ╚══════════════╤════════════════════╝
                                   │
                    ┌──────────────▼──────────────┐
                    │    Kernel Network Stack      │
                    │    (SKB allocation)          │
                    └──────────────┬──────────────┘
                                   │
                    ╔══════════════╧══════════════╗
                    ║    TC Hook (classifier)      ║
                    ╠═════════════════════════════╣
                    ║                              ║
                    ║  tc-conntrack                 ║
                    ║    → TCP/UDP/ICMP state       ║
                    ║    → Bidirectional tracking   ║
                    ║         │                     ║
                    ║  tc-scrub                     ║
                    ║    → TTL / MSS / DF / IP ID   ║
                    ║         │                     ║
                    ║  tc-nat-ingress               ║
                    ║    → DNAT rewrite             ║
                    ║    → Checksum update          ║
                    ║         │                     ║
                    ║  tc-ids                       ║
                    ║    → Sampling                 ║
                    ║    → L7 signature detection   ║
                    ║         │                     ║
                    ║  tc-threatintel               ║
                    ║    → Bloom filter pre-check   ║
                    ║    → VLAN quarantine          ║
                    ║         │                     ║
                    ║  tc-dns                       ║
                    ║    → UDP:53 capture           ║
                    ║                              ║
                    ╚══════════════╤══════════════╝
                                   │
                         RingBuf events ──→ Userspace
                                   │
                    ┌──────────────▼──────────────┐
                    │       Application            │
                    └─────────────────────────────┘
```

## Egress Pipeline

```
                    ┌─────────────────────────────┐
                    │       Application            │
                    └──────────────┬──────────────┘
                                   │
                    ╔══════════════╧══════════════╗
                    ║   TC Hook (egress)           ║
                    ╠═════════════════════════════╣
                    ║                              ║
                    ║  tc-nat-egress               ║
                    ║    → SNAT / masquerade       ║
                    ║    → Port allocation         ║
                    ║    → Checksum update         ║
                    ║                              ║
                    ╚══════════════╤══════════════╝
                                   │
                    ┌──────────────▼──────────────┐
                    │          NIC → wire          │
                    └─────────────────────────────┘
```

## XDP→TC Metadata Flow

The XDP firewall uses [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) to pass context to downstream TC programs:

```
XDP data area (before adjust_meta):
  ┌──────────────────────────────────┐
  │ data                        data_end │
  │ [packet bytes .................]     │
  └──────────────────────────────────┘

After bpf_xdp_adjust_meta(ctx, -sizeof(metadata)):
  ┌────────────────────────────────────────┐
  │ data_meta    data              data_end │
  │ [metadata]   [packet bytes ........]    │
  └────────────────────────────────────────┘

Metadata struct:
  ┌──────────┬──────────┬────────┐
  │ rule_id  │ flags    │ status │
  │ (u32)    │ (u16)    │ (u16)  │
  └──────────┴──────────┴────────┘
```

TC programs access `ctx->data_meta` directly without re-parsing Ethernet/IP/TCP headers, saving ~50ns per packet.

## RingBuf Event Flow

All kernel programs emit events to userspace via the same [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/):

```
Kernel programs                          Userspace
┌─────────────┐
│ xdp-firewall│──┐
├─────────────┤  │   ┌────────────────┐    ┌───────────────────┐
│xdp-ratelimit│──┼──→│   RingBuf      │───→│  EventDispatcher  │
├─────────────┤  │   │  (shared)      │    │                   │
│   tc-ids    │──┤   │                │    │  ├─→ IDS engine   │
├─────────────┤  │   │  PacketEvent   │    │  ├─→ Firewall eng │
│tc-threatintel──┤   │  (56 bytes)    │    │  ├─→ DLP engine   │
├─────────────┤  │   │                │    │  ├─→ ThreatIntel  │
│   tc-dns    │──┤   │  MPSC: multi-  │    │  ├─→ DNS engine   │
├─────────────┤  │   │  producer,     │    │  └─→ ...          │
│  uprobe-dlp │──┘   │  single-       │    └───────────────────┘
└─────────────┘      │  consumer      │
                     └────────────────┘
```

### PacketEvent Structure (56 bytes)

The standard event type emitted by all programs:

```
┌───────────────┬──────────────────┐
│ src_addr      │ [u32; 4] (16 B)  │  IPv4: [addr, 0, 0, 0]
│               │                  │  IPv6: [a, b, c, d]
├───────────────┼──────────────────┤
│ dst_addr      │ [u32; 4] (16 B)  │
├───────────────┼──────────────────┤
│ src_port      │ u16 (2 B)        │
├───────────────┼──────────────────┤
│ dst_port      │ u16 (2 B)        │
├───────────────┼──────────────────┤
│ protocol      │ u8  (1 B)        │  6=TCP, 17=UDP, 1=ICMP
├───────────────┼──────────────────┤
│ flags         │ u8  (1 B)        │  FLAG_IPV6, FLAG_VLAN
├───────────────┼──────────────────┤
│ vlan_id       │ u16 (2 B)        │  802.1Q VLAN ID (0 = none)
├───────────────┼──────────────────┤
│ cpu_id        │ u32 (4 B)        │  bpf_get_smp_processor_id()
├───────────────┼──────────────────┤
│ timestamp     │ u64 (8 B)        │  bpf_ktime_get_boot_ns()
└───────────────┴──────────────────┘
Total: 56 bytes, #[repr(C)]
```

### Backpressure

IDS and threat intel programs check ring buffer fill level before emitting:

```
avail = bpf_ringbuf_query(&EVENTS, BPF_RB_AVAIL_DATA)
if avail > capacity * 75 / 100:
    metrics[EVENTS_DROPPED] += 1
    return TC_ACT_OK          // skip event, pass packet
```

This prevents kernel-side event buildup when the userspace consumer is slow, avoiding memory pressure and latency spikes.

## Map Sharing (BPF Filesystem Pinning)

Several maps are shared across programs via BPF filesystem pinning (`/sys/fs/bpf/`):

| Map | Writer | Reader | Purpose |
|-----|--------|--------|---------|
| Conntrack table | tc-conntrack | xdp-firewall | Fast-path lookup for ESTABLISHED connections |
| Per-source counters | tc-conntrack | xdp-firewall | Connection limit enforcement |
| Firewall LPM tries | Userspace | xdp-firewall | Rule updates without program reload |
| Rate limit configs | Userspace | xdp-ratelimit | Policy changes |
| Threat intel Bloom | Userspace | tc-threatintel | Feed refresh |
| IPS blacklist | Userspace | xdp-firewall | Auto-block from IPS engine |
