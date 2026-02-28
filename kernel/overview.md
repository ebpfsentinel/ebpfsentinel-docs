# Kernel Overview

eBPFsentinel runs 10 eBPF programs in the Linux kernel to inspect, filter, and forward network packets at wire speed — before they ever reach the userspace TCP/IP stack. This section documents the kernel-side architecture in detail.

## Why eBPF?

Traditional network security agents operate entirely in userspace, copying every packet across the kernel/user boundary. eBPF programs execute *inside* the kernel, attached to strategic hook points, and can drop, redirect, or annotate packets with zero context-switch overhead.

eBPFsentinel hooks into three kernel subsystems:

| Subsystem | Hook Point | Latency | Programs |
|-----------|-----------|---------|----------|
| [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | Driver receive path (before SKB allocation) | ~100 ns | `xdp-firewall`, `xdp-ratelimit` |
| [TC](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) | Traffic Control classifier (after SKB) | ~1 µs | `tc-conntrack`, `tc-nat-*`, `tc-scrub`, `tc-ids`, `tc-threatintel`, `tc-dns` |
| [Uprobe](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_KPROBE/) | Userspace function entry (SSL_write/read) | ~5 µs | `uprobe-dlp` |

## Program Inventory

| # | Program | Hook | Purpose | Key Kernel Features |
|---|---------|------|---------|---------------------|
| 1 | `xdp-firewall` | XDP | Stateful L3/L4 packet filtering | LPM trie, PROG_ARRAY tail-call, DEVMAP, CPUMAP, conntrack fast-path |
| 2 | `xdp-ratelimit` | XDP | DDoS protection & rate limiting | PerCPU hash, [`bpf_timer`](https://docs.ebpf.io/linux/helper-function/bpf_timer_init/), [`bpf_tcp_gen_syncookie`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_gen_syncookie/) |
| 3 | `tc-conntrack` | TC ingress | TCP/UDP/ICMP state machine (IPv4/IPv6) | LRU hash, bidirectional key normalization, `ConnValueV6` |
| 4 | `tc-nat-ingress` | TC ingress | DNAT (port forwarding, 1:1 NAT, IPv4/IPv6) | [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/), checksum helpers, `NatRuleEntryV6` |
| 5 | `tc-nat-egress` | TC egress | SNAT / masquerade (IPv4/IPv6) | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/), [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) |
| 6 | `tc-ids` | TC ingress | Intrusion detection, L7 sampling | [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/), [`bpf_strncmp`](https://docs.ebpf.io/linux/helper-function/bpf_strncmp/) |
| 7 | `tc-threatintel` | TC ingress | IOC matching, VLAN quarantine | Bloom filter map, [`bpf_skb_vlan_push`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_push/) |
| 8 | `tc-dns` | TC ingress | Passive DNS capture | UDP:53 identification, RingBuf emission |
| 9 | `uprobe-dlp` | uprobe | SSL/TLS content inspection | Attaches to `SSL_write`/`SSL_read` |
| 10 | `tc-scrub` | TC ingress | Packet normalization (TTL/hop limit, MSS, DF, IP ID, IPv4/IPv6) | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/), [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) |

## Ingress / Egress Pipeline

```
INGRESS:
  NIC → XDP (xdp-firewall)
          ├── XDP_DROP → [end]
          └── tail_call (PROG_ARRAY) → XDP (xdp-ratelimit)
                ├── XDP_DROP → [end]
                └── XDP_PASS + metadata (bpf_xdp_adjust_meta)
                        │
                        ▼
                    Kernel Stack (SKB allocation)
                        │
                        ▼
                    TC ingress (tc-conntrack)  → state update
                    TC ingress (tc-scrub)      → packet normalization
                    TC ingress (tc-nat-ingress) → DNAT rewrite
                    TC ingress (tc-ids)         → sampling + L7 detect
                    TC ingress (tc-threatintel) → Bloom filter + VLAN quarantine
                    TC ingress (tc-dns)         → DNS capture
                        │
                        ▼
                    Userspace (via RingBuf events)

EGRESS:
  Application → TC egress (tc-nat-egress: SNAT/masquerade) → wire
```

## Compilation

All programs are written in `#![no_std]` Rust using the [Aya](https://aya-rs.dev/) framework, compiled for `bpfel-unknown-none` (little-endian BPF) with the nightly toolchain:

```bash
cargo xtask ebpf-build    # Builds all 10 programs
```

Shared `#[repr(C)]` types live in `crates/ebpf-common/` and are consumed by both kernel programs and the userspace agent.

## Kernel Requirements

- **Linux 5.17+** with `CONFIG_DEBUG_INFO_BTF=y`
- **CO-RE / BTF** for portable compilation ([`/sys/kernel/btf/vmlinux`](https://docs.ebpf.io/linux/concepts/btf/) must exist)
- **`CAP_BPF`** + **`CAP_NET_ADMIN`** capabilities (or root)

See [Kernel Compatibility](requirements.md) for the full feature-to-kernel-version matrix.
