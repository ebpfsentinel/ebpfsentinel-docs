# eBPF KFuncs

KFuncs (kernel functions) expose kernel functionality to eBPF programs that is not reachable through the stable BPF helper ABI. eBPFsentinel calls kfuncs through the `ebpf-helpers` crate, which ships manual `extern "C"` declarations + safe Rust wrappers for every kfunc the eBPF programs use. Since aya 0.13 has no native kfunc infrastructure (upstream issue `aya-rs/aya#432`), each binding is hand-written and validated against the kernel BTF signature at load time.

## Status

eBPFsentinel uses kfuncs from kernel **5.18 → 6.9**. The agent enforces a **6.9 minimum kernel** at startup (`MIN_KERNEL_MAJOR=6`, `MIN_KERNEL_MINOR=9`), so every kfunc listed below is guaranteed-available at runtime — there are no fallback paths.

The single source of truth for the bindings is `crates/ebpf-helpers/src/kfuncs.rs`. Every safe wrapper enforces the verifier's `KF_ACQUIRE` / `KF_RELEASE` pairing and any `KF_RCU` requirements through one of three patterns:

- **Closure-scoped** (`with_*` helpers) — the kernel reference lives for the duration of the closure body and is released on every control-flow path on the way out.
- **`Drop`-based** (`CtBuilder`, `CtEntry`) — the wrapper owns the kernel reference and releases it in `Drop` if the caller never transitions through `insert()`.
- **Internal RCU lock** (`task_under_cgroup`) — the wrapper opens its own `bpf_rcu_read_lock` region so callers never have to manage RCU manually.

Host-side stubs maintain `HOST_CT_LIVE` / `HOST_CT_INIT_LIVE` counters so unit tests assert acquire/release balance even when running outside a real BPF context.

## KFunc Reference

### Conntrack lookup (kernel 5.18)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_ct_lookup` | 5.18+ | `KF_ACQUIRE \| KF_RET_NULL` | Look up an existing conntrack entry from a TC classifier |
| `bpf_xdp_ct_lookup` | 5.18+ | `KF_ACQUIRE \| KF_RET_NULL` | Look up an existing conntrack entry from XDP context |
| `bpf_ct_release` | 5.18+ | `KF_RELEASE` | Release any `nf_conn*` / `nf_conn___init*` reference |

Safe wrappers: `with_skb_ct_lookup`, `with_xdp_ct_lookup`. The closure body owns the live `nf_conn` reference; release is automatic on every exit path.

### Conntrack write-side delegation (kernel 6.0 / 6.1)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_ct_alloc` | 6.0+ | `KF_ACQUIRE \| KF_RET_NULL` | Allocate a new conntrack entry from a TC classifier |
| `bpf_xdp_ct_alloc` | 6.0+ | `KF_ACQUIRE \| KF_RET_NULL` | Allocate a new conntrack entry from XDP |
| `bpf_ct_insert_entry` | 6.0+ | `KF_ACQUIRE \| KF_RELEASE` | Commit an allocated `nf_conn___init` and return a live `nf_conn*` |
| `bpf_ct_set_timeout` | 6.0+ | — | Set the initial timeout on an allocated entry |
| `bpf_ct_change_timeout` | 6.0+ | — | Update the timeout on an inserted entry |
| `bpf_ct_set_status` | 6.0+ | — | Set the initial status bitmask on an allocated entry |
| `bpf_ct_change_status` | 6.0+ | — | Update the status bitmask on an inserted entry |
| `bpf_ct_set_nat_info` | 6.1+ | — | Configure SNAT/DNAT rewrite info on an allocated entry |

Safe wrappers: `CtBuilder` (allocate → configure → insert) and `CtEntry` (live entry mutators). `CtBuilder::Drop` releases an un-inserted `nf_conn___init` automatically. `IPS_DYING` is exposed via `CtEntry::mark_dying()` plus the `kill_flow_via_skb_ct` / `kill_flow_via_xdp_ct` one-shot helpers used by the IDS verdict pipeline to terminate a flow in netfilter from inside the BPF program.

### IPsec interface steering (kernel 6.2)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_get_xfrm_info` | 6.2+ | — | Read the `xfrm` interface metadata attached to a TC skb |
| `bpf_skb_set_xfrm_info` | 6.2+ | — | Push a TC skb through a specific `xfrmi` virtual device |

Safe wrappers: `skb_get_xfrm_info`, `skb_set_xfrm_info`. Used by the IPsec-aware NAT path to route encapsulated traffic through the matching kernel `xfrm` policy without smuggling intent through DSCP bits.

### XDP metadata (kernel 6.3 / 6.8)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_xdp_metadata_rx_hash` | 6.3+ | — | Read the NIC-computed RSS hash and `xdp_rss_hash_type` bitmask |
| `bpf_xdp_metadata_rx_timestamp` | 6.3+ | — | Read the hardware RX timestamp (nanoseconds since boot) |
| `bpf_xdp_metadata_rx_vlan_tag` | 6.8+ | — | Read the hardware-stripped VLAN tag |
| `bpf_xdp_get_xfrm_state` | 6.8+ | `KF_ACQUIRE \| KF_RET_NULL` | Look up the `xfrm_state` matching an XDP packet |
| `bpf_xdp_xfrm_state_release` | 6.8+ | `KF_RELEASE` | Release an `xfrm_state*` acquired above |

Safe wrappers: `xdp_rx_hash`, `xdp_rx_timestamp`, `xdp_rx_vlan_tag`, `with_xdp_xfrm_state`. The RSS hash wrapper exposes a `xdp_rss_hash_type` constant module so callers can switch on `L3_IPV4 | L4 | L4_TCP` etc. without literal hex.

### Dynptr packet parsing (kernel 6.4 / 6.5)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_dynptr_from_skb` | 6.4+ | — | Initialise a dynptr over a TC skb |
| `bpf_dynptr_from_xdp` | 6.4+ | — | Initialise a dynptr over an XDP frame |
| `bpf_dynptr_slice` | 6.4+ | — | Read-only zero-copy slice view of packet bytes |
| `bpf_dynptr_slice_rdwr` | 6.4+ | — | Read-write slice view of packet bytes |
| `bpf_dynptr_adjust` | 6.5+ | — | Narrow a dynptr to a `[start, end)` byte window |
| `bpf_dynptr_size` | 6.5+ | — | Report the logical size of a dynptr in bytes |
| `bpf_dynptr_is_null` | 6.5+ | — | Detect an uninitialised / invalidated dynptr |
| `bpf_dynptr_clone` | 6.5+ | — | Clone a dynptr so two cursors can advance independently |

Safe wrappers: `SkbDynptr`, `XdpDynptr` with typed `read::<T>(offset)`, `slice`, `slice_rdwr`, `adjust`, `size`, `is_null`, `clone_dynptr` methods. Replaces the manual `ptr_at` + bounds-check pattern with verifier-friendly accessors that work transparently on linear, paged, or `XDP_FRAGS` buffers.

### FOU/GUE overlay encapsulation (kernel 6.4)

| KFunc | Kernel | Acquire/Release | Purpose |
|-------|--------|-----------------|---------|
| `bpf_skb_get_fou_encap` | 6.4+ | — | Read FOU/GUE encap parameters attached to a TC skb |
| `bpf_skb_set_fou_encap` | 6.4+ | — | Install FOU or GUE encap parameters on a TC egress skb |

Safe wrappers: `skb_get_fou_encap`, `skb_set_fou_encap`. Lets the kernel build cloud-overlay tunnels without leaving the BPF datapath; the wrapper takes a `FouEncapType { Fou, Gue }` enum to keep the encap discriminant type-safe.

### Arena maps (kernel 6.9) — evaluated, not used

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
