# eBPF Development

## Overview

eBPF programs are written in `#![no_std]` Rust using the [Aya](https://aya-rs.dev/) framework. Each program is a separate crate under `crates/ebpf-programs/`.

## Program Structure

```
crates/ebpf-programs/<program>/
├── Cargo.toml    # Dependencies: aya-ebpf, ebpf-common, network-types
└── src/
    └── main.rs   # #![no_std] #![no_main] entry point
```

### Entry Point Pattern

```rust
#![no_std]
#![no_main]

use aya_ebpf::{bindings::xdp_action, macros::xdp, programs::XdpContext};
use ebpf_common::PacketEvent;

#[xdp]
pub fn my_program(ctx: XdpContext) -> u32 {
    match try_my_program(ctx) {
        Ok(ret) => ret,
        Err(_) => xdp_action::XDP_PASS,
    }
}

fn try_my_program(ctx: XdpContext) -> Result<u32, ()> {
    // Packet parsing with bounds checks
    let eth = ptr_at::<EthHdr>(&ctx, 0)?;
    // ...
    Ok(xdp_action::XDP_PASS)
}
```

### Bounds Checking

All pointer access must be bounds-checked to pass the eBPF verifier:

```rust
#[inline(always)]
fn ptr_at<T>(ctx: &XdpContext, offset: usize) -> Result<*const T, ()> {
    let start = ctx.data();
    let end = ctx.data_end();
    let len = core::mem::size_of::<T>();
    if start + offset + len > end {
        return Err(());
    }
    Ok((start + offset) as *const T)
}
```

## Shared Types

Define shared types in `crates/ebpf-common/` with `#[repr(C)]`:

```rust
#[repr(C)]
pub struct PacketEvent {
    pub timestamp_ns: u64,
    pub src_addr: [u32; 4],
    pub dst_addr: [u32; 4],
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: u8,
    pub event_type: u8,
    pub action: u8,
    pub flags: u8,
    pub rule_id: u32,
    pub vlan_id: u16,
    pub cpu_id: u16,
    pub socket_cookie: u64,
}
// Total: 64 bytes, aligned to 8 bytes
```

## Building

```bash
cargo xtask ebpf-build    # All 14 programs
```

The `xtask` crate builds all 14 programs with the nightly toolchain targeting `bpfel-unknown-none`.

## Map Types Used

| Map Type | Used By | Purpose |
|----------|---------|---------|
| `LPM_TRIE` | xdp-firewall | O(log n) CIDR matching |
| `PERCPU_HASH` | xdp-ratelimit | Lock-free per-IP counters |
| `PROG_ARRAY` | xdp-firewall, xdp-ratelimit | Tail-call chain (firewall -> ratelimit -> reject) |
| `BLOOM_FILTER` | tc-threatintel | Fast IOC pre-check |
| `DEVMAP` | xdp-firewall | Packet mirroring |
| `CPUMAP` | xdp-firewall | CPU steering |
| `RING_BUF` | All programs | Event emission to userspace |
| `PER_CPU_ARRAY` | All programs | Per-CPU metrics counters |

## Debugging

```bash
# List loaded programs
sudo bpftool prog list

# Inspect a program
sudo bpftool prog show id <ID>

# Dump map contents
sudo bpftool map dump id <ID>

# View program instructions
sudo bpftool prog dump xlated id <ID>
```

## Shared Helpers (ebpf-helpers)

The `ebpf-helpers` crate provides shared utilities for all eBPF programs:

| Module | Contents |
|--------|----------|
| `asm` | `copy_mac_asm!` (6-byte MAC), `copy_16b_asm!` (16-byte IPv6 addr) — inline asm to prevent LLVM memcpy outlining |
| `checksum` | `compute_ipv4_csum`, `compute_tcp_csum_v4/v6`, `compute_icmp_csum`, `compute_icmpv6_csum` — fixed-iteration checksums |
| `event` | `emit_packet_event!` — shared PacketEvent emission with backpressure (TC and XDP variants) |
| `metrics` | `increment_metric!`, `add_metric!` |
| `net` | Header structs, constants, `ones_complement_add`, `prefix_to_mask` (NPTv6) |
| `ringbuf` | `ringbuf_has_backpressure!` |
| `xdp` | `ptr_at`, `ptr_at_mut`, `skip_ipv6_ext_headers` |
| `tc` | `ptr_at`, `skip_ipv6_ext_headers` (TcContext variant) |

## Common Pitfalls

- **Verifier rejection** — ensure all memory accesses are bounds-checked
- **Stack overflow** — eBPF stack is 512 bytes; use maps for large data
- **Loop limits** — use `bpf_loop` (5.17+) for variable-count iterations
- **Helper availability** — check kernel version for helper functions
- **LLVM memcpy outlining** — use `copy_mac_asm!` / `copy_16b_asm!` for `[u8; 6]` / `[u8; 16]` copies from packet pointers
- **Combined stack overflow** — split packet-writing functions into tail-called programs
- **Division panic at address 0** — guard all map-derived divisors with `!= 0` check
