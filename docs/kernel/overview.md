# Kernel Overview

eBPFsentinel ships 16 eBPF programs that run in the Linux kernel to inspect, filter, and forward network packets at wire speed - before they ever reach the userspace TCP/IP stack. Fifteen make up the production datapath; the sixteenth, `xdp-pass`, is a test-only veth helper never attached in production. This section documents the kernel-side architecture in detail.

## Why eBPF?

Traditional network security agents operate entirely in userspace, copying every packet across the kernel/user boundary. eBPF programs execute *inside* the kernel, attached to strategic hook points, and can drop, redirect, or annotate packets with zero context-switch overhead.

eBPFsentinel hooks into three kernel subsystems:

| Subsystem | Hook Point | Programs |
|-----------|-----------|----------|
| [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | Driver receive path (before SKB allocation) | `xdp-firewall`, `xdp-ratelimit`, `xdp-loadbalancer`, and the tail-call targets `xdp-firewall-reject`, `xdp-ratelimit-syncookie`, `xdp-vip-announcer` |
| [TC](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) | Traffic Control classifier (after SKB), attached through TCX | `tc-conntrack`, `tc-nat-ingress`, `tc-nat-egress`, `tc-scrub`, `tc-ids`, `tc-threatintel`, `tc-dns`, `tc-qos` |
| [Uprobe](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_KPROBE/) | Userspace function entry (`SSL_write`/`SSL_read`) | `uprobe-dlp` |

Measured on live traffic, the whole stack costs about 1 µs of kernel time per received packet: the XDP chain 630-712 ns, each TC program between 23 and 292 ns. See [Performance Tuning](../operations/performance-tuning.md) for the figures and how they were taken.

## Program Inventory

| # | Program | Hook | Purpose | Key Kernel Features |
|---|---------|------|---------|---------------------|
| 1 | `xdp-firewall` | XDP | Stateful L3/L4 packet filtering | LPM trie, PROG_ARRAY tail-call, conntrack fast-path |
| 2 | `xdp-ratelimit` | XDP | DDoS protection & rate limiting | PerCPU hash token buckets, `bpf_ktime_get_coarse_ns`, kernel raw SYN cookie check, tail calls to `xdp-ratelimit-syncookie` and `xdp-loadbalancer` |
| 3 | `tc-conntrack` | TC ingress | TCP/UDP/ICMP state machine (IPv4/IPv6) | LRU hash, bidirectional key normalization, packet+byte counters, unified V4/V6 state machine |
| 4 | `tc-nat-ingress` | TC ingress | DNAT (port forwarding, 1:1 NAT, IPv4/IPv6) | [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/), [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) rule scan, checksum helpers, `NatRuleEntryV6` |
| 5 | `tc-nat-egress` | TC egress | SNAT / masquerade (IPv4/IPv6) | [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) rule scan, [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/), [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) |
| 6 | `tc-ids` | TC ingress (egress optional) | Intrusion detection, sampling | [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/), [`bpf_dynptr_size`](https://docs.ebpf.io/linux/kfuncs/bpf_dynptr_size/) |
| 7 | `tc-threatintel` | TC ingress | IOC matching (alert or drop) | Bloom filter map, LRU hash map (IOC confirmation), VLAN and QinQ tag parsing |
| 8 | `tc-dns` | TC ingress | Passive DNS capture | UDP:53 identification, RingBuf emission |
| 9 | `uprobe-dlp` | uprobe | SSL/TLS content inspection | Attaches to `SSL_write`/`SSL_read` |
| 10 | `tc-scrub` | TC ingress | Packet normalization (TTL/hop limit, MSS, DF, IP ID, IPv4/IPv6) | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/), [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) |
| 11 | `xdp-loadbalancer` | XDP | L4 load balancing (TCP/UDP/TLS passthrough) | Destination IP/port rewrite, MAC swap, checksum fixup, per-service round-robin, health-aware backend selection |
| 12 | `tc-qos` | TC egress, plus `tc_qos_ingress` on ingress | QoS / traffic shaping | Token bucket bandwidth limiting, WF2Q+ queuing, 4-level classifier, delay/loss emulation |
| 13 | `xdp-firewall-reject` | XDP (tail call) | Forges TCP RST / ICMP unreachable for REJECT rules | `XDP_TX`, per-source reply rate limit, `PKT_CTX` shared with `xdp-firewall` |
| 14 | `xdp-ratelimit-syncookie` | XDP (tail call) | Answers a SYN flood with a SYN-ACK cookie | Kernel raw SYN cookie generation, `XDP_TX` |
| 15 | `xdp-vip-announcer` | XDP (tail call) | Answers ARP for load-balancer virtual IPs while this node is the elected speaker | `XDP_TX`, fixed 28-byte ARP rewrite |
| 16 | `xdp-pass` | XDP | Test-only: returns `XDP_PASS`, used on the peer side of a veth in tests | none |

## Ingress / Egress Pipeline

```
INGRESS:
  NIC → XDP (xdp-firewall)
          ├── XDP_DROP / XDP_PASS → [end of XDP]
          └── tail_call (XDP_PROG_ARRAY)
                ├── slot 0 → xdp-ratelimit
                │             ├── XDP_DROP / XDP_PASS
                │             └── tail_call (RL_PROG_ARRAY)
                │                   ├── slot 0 → xdp-ratelimit-syncookie (SYN-ACK via XDP_TX)
                │                   └── slot 1 → xdp-loadbalancer
                ├── slot 1 → xdp-firewall-reject (RST / ICMP via XDP_TX)
                ├── slot 2 → xdp-loadbalancer (DEVMAP redirect or XDP_TX)
                └── slot 3 → xdp-vip-announcer (ARP reply via XDP_TX)
                        │
                        ▼
                    Kernel Stack (SKB allocation)
                        │
                        ▼
                    TC ingress (tc-ids)           → sampling + L7 detect
                    TC ingress (tc-threatintel)   → Bloom filter + IOC confirmation
                    TC ingress (tc-dns)           → DNS capture
                    TC ingress (tc-conntrack)     → state update
                    TC ingress (tc-nat-ingress)   → DNAT rewrite
                    TC ingress (tc-scrub)         → packet normalization
                    TC ingress (tc_qos_ingress)   → ingress shaping
                        │
                        ▼
                    Userspace (via RingBuf events)

EGRESS:
  Application → TC egress (tc-ids, only with inspect_egress or the cgroup resolver)
                    → TC egress (tc-nat-egress: SNAT/masquerade)
                    → TC egress (tc-qos: traffic shaping) → wire
```

When the firewall is disabled, `xdp-ratelimit` attaches on its own, and `xdp-loadbalancer` attaches on its own when no other XDP program is active. The order above is the startup order: each TC program is attached through TCX at the tail of the chain, so a program enabled later at runtime runs after the ones already attached. The first TC program to parse a packet leaves its offsets in `skb->cb`, and the following programs of the same chain reuse them instead of parsing again; NAT invalidates that record after a rewrite. No metadata is passed from XDP to TC.

## XDP Attachment Modes

XDP programs can be attached in three modes, controlled by [`agent.xdp_mode`](../configuration/agent.md#xdp-attachment-mode):

| Mode | Where it runs | `sk_buff` allocated? | Performance | Kernel requirement |
|------|--------------|---------------------|-------------|-------------------|
| **Native** (`drv`) | Inside the NIC driver's receive path | No | Fastest - zero-copy packet access | Driver must implement `ndo_bpf` |
| **Generic** (`skb`) | After the kernel allocates an `sk_buff` | Yes | Slower - same as TC hook | Any interface (universal) |
| **Offloaded** (`hw`) | On the NIC hardware itself | No | Line-rate, zero CPU | SmartNIC required (Netronome NFP) |

In **auto** mode (default), the kernel tries native first, then falls back to generic. If native is explicitly requested but unsupported, eBPFsentinel falls back to auto and logs a warning.

> **Performance impact**: native XDP on `virtio_net` (common in VMs) processes packets before any kernel allocation. Generic XDP loses this advantage - packets are already wrapped in `sk_buff` when the program runs. Measured with iperf3 between two VMs, generic XDP lost about 23% of the throughput that native XDP kept.

## Dynamic Program Lifecycle

Enabling or disabling a feature in the configuration loads or detaches the matching program without restarting the agent: `tc-ids`, `tc-threatintel`, `tc-dns`, `tc-conntrack`, the NAT pair, `tc-scrub`, `uprobe-dlp`, and the three XDP programs `xdp-firewall`, `xdp-ratelimit` and `xdp-loadbalancer` with their tail-call targets. `tc-qos` is loaded at startup when QoS is enabled; later changes switch its maps, so turning QoS on for an agent started without it takes a restart. Shared maps are pinned under `/sys/fs/bpf/ebpfsentinel/` (the DLP program under `/sys/fs/bpf/ebpfsentinel-dlp/`), so kernel state such as connection tracking tables and rate limit counters survives a program being detached and attached again; ring buffers and XDP redirect maps are private to each program and are not pinned. The XDP tail-call slots are rewritten whenever an XDP program is added or removed. The pin directories are removed when the agent shuts down. See [Hot Reload](../operations/hot-reload.md) for details.

## Cross-Cutting: Interface Groups

Six eBPF programs (`xdp-firewall`, `xdp-ratelimit`, `tc-nat-ingress`, `tc-nat-egress`, `tc-ids`, `tc-qos`) share an `INTERFACE_GROUPS` HashMap map that maps ifindex to a u32 bitmask. Each rule struct in these programs carries a `group_mask` field. When `group_mask == 0`, the rule is a **floating rule** and applies everywhere. Otherwise, the program performs a single AND + compare against the current interface's group bitmask to decide whether the rule applies. Bit 31 acts as an inversion flag. Up to 31 groups are supported. See [Interface Groups](../features/interface-groups.md).

## Compilation

All programs are written in `#![no_std]` Rust using the [Aya](https://aya-rs.dev/) framework, compiled for `bpfel-unknown-none` (little-endian BPF) with the nightly toolchain:

```bash
cargo xtask ebpf-build    # Builds all 16 programs
```

Shared `#[repr(C)]` types live in `crates/ebpf-common/` and are consumed by both kernel programs and the userspace agent.

## Kernel Requirements

- **Linux 6.9+** with `CONFIG_DEBUG_INFO_BTF=y`
- **CO-RE / BTF** for portable compilation ([`/sys/kernel/btf/vmlinux`](https://docs.ebpf.io/linux/concepts/btf/) must exist)
- **A BPF token** for loading (kernel 6.9+); the agent holds no `CAP_BPF`. `CAP_NET_ADMIN` is still needed for the host-network operations the warden brokers

The 6.9 minimum is set by BPF token delegation and the kfunc surface; `bpf_dynptr` and BPF filesystem map pinning arrived well below it. See [Kernel Compatibility](requirements.md) for the full feature matrix and per-program optimization details.
