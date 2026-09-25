# eBPF KFuncs

KFuncs (kernel functions) expose kernel functionality to eBPF programs that is not reachable through the stable BPF helper ABI. eBPFsentinel declares every kfunc the programs call as a manual `extern "C"` item in the `ebpf-helpers` crate, with safe Rust wrappers around them.

## Loading

aya 0.14 cannot relocate a kfunc call, so the agent loads programs that call kfuncs with its own loader (`crates/adapters/src/ebpf/kfunc_loader.rs` and `kfunc.rs`):

1. Every kfunc call site in the ELF is rewritten to a `BPF_PSEUDO_KFUNC_CALL`.
2. Each kfunc name is resolved to its BTF id by walking the raw BTF of vmlinux and of the loaded kernel modules (module BTF is split BTF layered on vmlinux, which `aya-obj` does not parse).
3. The program is loaded with a raw `BPF_PROG_LOAD` carrying an `fd_array` of module BTF fds, and attached with raw `BPF_LINK_CREATE` (`kfunc_attach.rs`).

Opening a module's BTF fd needs `CAP_SYS_ADMIN`, which a BPF token does not grant, so in the split deployment the warden opens them and hands them to the agent through `EBPF_MODULE_BTF_FDS`. A kfunc found in neither vmlinux nor any loaded module fails the load with `kfunc ... not found in vmlinux or any loaded module BTF`: the conntrack kfuncs need `nf_conntrack`, the FOU kfuncs `fou`/`fou6`, the XFRM interface kfuncs `xfrm_interface`.

## Status

The kfuncs span kernel **5.18 to 6.8**. The agent refuses to start below **6.9** (`MIN_KERNEL_MAJOR=6`, `MIN_KERNEL_MINOR=9` in `crates/adapters/src/ebpf/kernel_probe.rs`), so every kfunc below exists on a supported kernel.

The single source of truth for the bindings is `crates/ebpf-helpers/src/kfuncs.rs`. The safe wrappers keep the verifier's `KF_ACQUIRE` / `KF_RELEASE` pairing through two patterns:

- **Closure-scoped** (`with_*` helpers) - the kernel reference lives for the duration of the closure body and is released on every path on the way out.
- **`Drop`-based** (`CtBuilder`, `CtEntry`) - the wrapper owns the kernel reference and releases it in `Drop` if the caller never transitions through `insert()`.

Host-side stubs keep live-reference counters (`host_ct_live_count`, `host_ct_init_live_count`) so unit tests assert acquire/release balance outside a real BPF context.

## KFunc Reference

### Conntrack lookup (kernel 5.18)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_ct_lookup` | 5.18+ | `KF_ACQUIRE \| KF_RET_NULL` | Look up an existing conntrack entry from a TC classifier |
| `bpf_xdp_ct_lookup` | 5.18+ | `KF_ACQUIRE \| KF_RET_NULL` | Look up an existing conntrack entry from XDP context |
| `bpf_ct_release` | 5.18+ | `KF_RELEASE` | Release any `nf_conn*` / `nf_conn___init*` reference |

Safe wrappers: `with_skb_ct_lookup` (tc-conntrack), `with_xdp_ct_lookup` (xdp-firewall). The closure body owns the live `nf_conn` reference; release is automatic on every exit path.

### Conntrack write-side delegation (kernel 6.0 / 6.1)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_ct_alloc` | 6.0+ | `KF_ACQUIRE \| KF_RET_NULL` | Allocate a new conntrack entry from a TC classifier |
| `bpf_xdp_ct_alloc` | 6.0+ | `KF_ACQUIRE \| KF_RET_NULL` | Allocate a new conntrack entry from XDP; declared, not called by any program |
| `bpf_ct_insert_entry` | 6.0+ | `KF_ACQUIRE \| KF_RELEASE` | Commit an allocated `nf_conn___init` and return a live `nf_conn*` |
| `bpf_ct_set_timeout` | 6.0+ | - | Set the initial timeout on an allocated entry; declared, not called by any program |
| `bpf_ct_change_timeout` | 6.0+ | - | Update the timeout on an inserted entry |
| `bpf_ct_set_status` | 6.0+ | - | Set the initial status bitmask on an allocated entry; declared, not called by any program |
| `bpf_ct_change_status` | 6.0+ | - | Update the status bitmask on an inserted entry; declared, not called by any program |
| `bpf_ct_set_nat_info` | 6.1+ | - | Configure SNAT/DNAT rewrite info on an allocated entry |

Safe wrappers: `CtBuilder` (allocate, configure, insert; used by tc-nat-ingress and tc-nat-egress) and `CtEntry` (`change_timeout` on a live entry). `CtBuilder::Drop` releases an un-inserted `nf_conn___init` automatically.

`kill_flow_via_skb_ct` (tc-ids) and `kill_flow_via_xdp_ct` (xdp-firewall) terminate a flow from inside the program: lookup, collapse the entry's timeout to one millisecond so the conntrack garbage collector reaps it, release. `IPS_DYING` cannot be used for this: it is in the kernel's unchangeable status mask and a BPF program asking for it is refused.

### IPsec interface steering (kernel 6.2)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_get_xfrm_info` | 6.2+ | - | Read the `xfrm` interface metadata attached to a TC skb |
| `bpf_skb_set_xfrm_info` | 6.2+ | - | Push a TC skb through a specific `xfrmi` virtual device |

Safe wrappers: `skb_get_xfrm_info` (tc-nat-ingress), `skb_set_xfrm_info` (tc-nat-egress). Used by the IPsec-aware NAT path to route encapsulated traffic through the matching kernel `xfrm` interface.

### XDP metadata (kernel 6.3 / 6.8)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_xdp_metadata_rx_hash` | 6.3+ | - | Read the NIC-computed RSS hash and `xdp_rss_hash_type` bitmask |
| `bpf_xdp_metadata_rx_timestamp` | 6.3+ | - | Read the hardware RX timestamp (nanoseconds since boot) |
| `bpf_xdp_metadata_rx_vlan_tag` | 6.8+ | - | Read the hardware-stripped VLAN tag |
| `bpf_xdp_get_xfrm_state` | 6.8+ | `KF_ACQUIRE \| KF_RET_NULL` | Look up the `xfrm_state` matching an XDP packet |
| `bpf_xdp_xfrm_state_release` | 6.8+ | `KF_RELEASE` | Release an `xfrm_state*` acquired above |

Safe wrappers: `xdp_rx_hash` and `xdp_rx_timestamp` (xdp-firewall, xdp-ratelimit, xdp-loadbalancer), `xdp_rx_vlan_tag` and `with_xdp_xfrm_state` (xdp-firewall). A driver that does not implement a metadata kfunc answers `EOPNOTSUPP` and the wrapper returns `None`. The `xdp_rss_hash_type` constant module lets callers switch on `L3_IPV4 | L4 | L4_TCP` etc. without literal hex.

### Dynptr packet size (kernel 6.4 / 6.5)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_dynptr_from_skb` | 6.4+ | - | Initialise a dynptr over a TC skb |
| `bpf_dynptr_from_xdp` | 6.4+ | - | Initialise a dynptr over an XDP frame |
| `bpf_dynptr_size` | 6.5+ | - | Report the logical size of a dynptr in bytes |
| `bpf_dynptr_slice` | 6.4+ | - | Declared, not called by any program |
| `bpf_dynptr_adjust` | 6.5+ | - | Declared, not called by any program |

Safe wrappers: `skb_packet_size` (tc-ids) and `xdp_frame_size` (xdp-firewall) return the full packet size, fragments and multi-buffer frames included, without linearising the packet. The dynptr is a kernel-managed stack object that must stay in the slot the kfunc wrote it to, so each wrapper creates and consumes it in one frame and only the size escapes; returning the dynptr in a struct would move it and the verifier rejects that with `invalid read from stack`.

### FOU/GUE overlay encapsulation (kernel 6.4)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_get_fou_encap` | 6.4+ | - | Read FOU/GUE encap parameters attached to a TC skb |
| `bpf_skb_set_fou_encap` | 6.4+ | - | Install FOU or GUE encap parameters on a TC egress skb |

Safe wrappers: `skb_get_fou_encap` (tc-ids), `skb_set_fou_encap` (tc-nat-egress). Lets the kernel build cloud-overlay tunnels without leaving the BPF datapath; the wrapper takes a `FouEncapType { Fou, Gue }` enum to keep the encap discriminant type-safe.

### Arena maps (kernel 6.9) - evaluated, not used

The `bpf_arena_alloc_pages` / `bpf_arena_free_pages` kfuncs and
`BPF_MAP_TYPE_ARENA` exist on kernel 6.9+, but eBPFsentinel does **not**
use them. Every program delivers events through `RingBuf` exclusively.

An arena map would give BPF and userspace a shared mmap'd region for
zero-copy event delivery, but the approach is not viable on the Rust
`bpfel` target:

- `bpf_arena_alloc_pages` returns an **untyped scalar** on `bpfel` (no
  `addr_space_cast`), so the verifier rejects any write through the
  returned pointer.
- The alloc kfunc is **sleepable-only**; XDP and TC programs are not
  sleepable, so it is unavailable in the datapath hooks.

`RingBuf` is therefore the sole event transport. See
[Program Limits](limits.md) for per-program ring buffer sizes.

## Verification

Run the helpers test suite to verify all kfunc wrappers compile and that the host stubs balance acquire/release:

```bash
cd crates/ebpf-helpers
cargo fmt
cargo test --lib
```

At runtime the agent verifies the kernel version meets the 6.9 floor before loading any BPF program. See [Kernel Compatibility](requirements.md) for distribution support.
