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
    pub src_addr: [u32; 4],
    pub dst_addr: [u32; 4],
    pub src_port: u16,
    pub dst_port: u16,
    pub protocol: u8,
    pub flags: u8,
    pub vlan_id: u16,
    pub cpu_id: u32,
    pub timestamp: u64,
}
```

## Building

```bash
cargo xtask ebpf-build    # All programs
```

The `xtask` crate builds each program with the nightly toolchain targeting `bpfel-unknown-none`.

## Map Types Used

| Map Type | Used By | Purpose |
|----------|---------|---------|
| `LPM_TRIE` | xdp-firewall | O(log n) CIDR matching |
| `PERCPU_HASH` | xdp-ratelimit | Lock-free per-IP counters |
| `PROG_ARRAY` | xdp-firewall | Tail-call to rate limiter |
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

## Common Pitfalls

- **Verifier rejection** — ensure all memory accesses are bounds-checked
- **Stack overflow** — eBPF stack is 512 bytes; use maps for large data
- **Loop limits** — use `bpf_loop` (5.17+) for variable-count iterations
- **Helper availability** — check kernel version for helper functions
