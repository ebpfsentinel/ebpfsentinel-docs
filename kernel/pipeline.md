# Packet Pipeline

The full kernel-side packet processing pipeline, from NIC to userspace.

## Ingress Pipeline

```mermaid
flowchart TD
    NIC["NIC (driver)"]

    subgraph XDP["XDP Programs (earliest hook)"]
        FW["xdp-firewall\n1. Conntrack fast-path\n2. LPM trie lookup\n3. Linear rule scan\n4. Connection limits\n5. Routing actions"]
        FW -->|XDP_DROP| DROP1(("DROP\n(end)"))
        FW -->|"PROG_ARRAY slot 1"| REJECT["xdp-firewall-reject\nTCP RST forge\nICMP Unreach forge"]
        REJECT -->|XDP_TX| REJECT_OUT(("TX\n(reject & return)"))
        FW -->|"PROG_ARRAY slot 0"| RL["xdp-ratelimit\nPer-IP rate check\nICMP limit\nUDP amp detection"]
        RL -->|XDP_DROP| DROP2(("DROP\n(end)"))
        RL -->|"RL_PROG slot 0"| SYNCOOKIE["xdp-ratelimit-syncookie\nSYN+ACK forge (FNV-1a)"]
        SYNCOOKIE -->|XDP_TX| COOKIE_OUT(("TX\n(cookie & return)"))
        RL -->|"RL_PROG slot 1\n(also FW slot 2 fallback)"| LB["xdp-loadbalancer\nService lookup\nBackend select\nDNAT rewrite"]
        LB -->|"XDP_PASS + metadata\n(bpf_xdp_adjust_meta)"| XDP_PASS(("PASS"))
        RL -->|XDP_PASS| XDP_PASS
    end

    STACK["Kernel Network Stack\n(SKB allocation)"]

    subgraph TC["TC Programs (classifier hook)"]
        CONNTRACK["tc-conntrack\nTCP/UDP/ICMP state\nBidirectional tracking"]
        SCRUB["tc-scrub\nTTL / MSS / DF / IP ID"]
        NAT_IN["tc-nat-ingress\nDNAT rewrite\nChecksum update"]
        IDS["tc-ids\nSampling\nL7 signature detection"]
        THREATINTEL["tc-threatintel\nBloom filter pre-check\nVLAN quarantine"]
        DNS["tc-dns\nUDP:53 capture"]

        CONNTRACK --> SCRUB --> NAT_IN --> IDS --> THREATINTEL --> DNS
    end

    RINGBUF["RingBuf events"]
    APP["Application / Userspace"]

    NIC --> FW
    XDP_PASS --> STACK
    STACK --> CONNTRACK
    DNS --> RINGBUF --> APP
```

## Egress Pipeline

```mermaid
flowchart TD
    APP["Application"]
    APP --> NAT_EG

    subgraph TC_EG["TC Programs (egress hook)"]
        NAT_EG["tc-nat-egress\nSNAT / masquerade\nPort allocation\nChecksum update"]
        QOS["tc-qos\n4-level classifier\nToken bucket shaping\nLoss / delay emulation"]
        NAT_EG --> QOS
    end

    WIRE["NIC --> wire"]
    QOS --> WIRE
```

## XDP→TC Metadata Flow

The XDP firewall uses [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) to pass context to downstream TC programs:

```mermaid
flowchart LR
    subgraph BEFORE["Before bpf_xdp_adjust_meta"]
        direction LR
        B_DATA["data\n(packet bytes)"]
        B_END["data_end"]
        B_DATA --- B_END
    end

    subgraph AFTER["After bpf_xdp_adjust_meta(ctx, -sizeof metadata)"]
        direction LR
        A_META["data_meta\n(metadata)"]
        A_DATA["data\n(packet bytes)"]
        A_END["data_end"]
        A_META --- A_DATA --- A_END
    end

    subgraph STRUCT["Metadata struct (8 bytes)"]
        direction LR
        RULE["rule_id\n(u32)"]
        FLAGS["flags\n(u16)"]
        STATUS["status\n(u16)"]
    end

    BEFORE --> AFTER --> STRUCT
```

TC programs access `ctx->data_meta` directly without re-parsing Ethernet/IP/TCP headers, saving ~50ns per packet.

## RingBuf Event Flow

All kernel programs emit events to userspace via the same [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/):

```mermaid
flowchart LR
    subgraph KERNEL["Kernel producers"]
        FW["xdp-firewall"]
        RL["xdp-ratelimit"]
        IDS["tc-ids"]
        TI["tc-threatintel"]
        DNS["tc-dns"]
        DLP["uprobe-dlp"]
    end

    RING["RingBuf (shared)\nPacketEvent (64 bytes)\nMPSC: multi-producer,\nsingle-consumer"]

    subgraph USER["Userspace"]
        DISP["EventDispatcher"]
        DISP --> IDS_E["IDS engine"]
        DISP --> FW_E["Firewall engine"]
        DISP --> DLP_E["DLP engine"]
        DISP --> TI_E["ThreatIntel engine"]
        DISP --> DNS_E["DNS engine"]
        DISP --> OTHER["..."]
    end

    FW --> RING
    RL --> RING
    IDS --> RING
    TI --> RING
    DNS --> RING
    DLP --> RING
    RING --> DISP
```

### PacketEvent Structure (64 bytes)

The standard event type emitted by all programs:

```
Offset  Field            Type             Notes
──────  ───────────────  ───────────────  ──────────────────────────
 0      timestamp_ns     u64 (8 B)        bpf_ktime_get_boot_ns()
 8      src_addr         [u32; 4] (16 B)  IPv4: [addr, 0, 0, 0]
                                          IPv6: [a, b, c, d]
24      dst_addr         [u32; 4] (16 B)
40      src_port         u16 (2 B)
42      dst_port         u16 (2 B)
44      protocol         u8  (1 B)        6=TCP, 17=UDP, 1=ICMP
45      event_type       u8  (1 B)        0=FW, 1=IDS, 7=DNS, ...
46      action           u8  (1 B)        pass / drop / log
47      flags            u8  (1 B)        FLAG_IPV6, FLAG_VLAN
48      rule_id          u32 (4 B)        matched rule ID (0 = none)
52      vlan_id          u16 (2 B)        802.1Q VLAN ID (0 = none)
54      cpu_id           u16 (2 B)        bpf_get_smp_processor_id()
56      socket_cookie    u64 (8 B)        bpf_get_socket_cookie()
──────
Total: 64 bytes, #[repr(C)], aligned to 8 bytes
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
