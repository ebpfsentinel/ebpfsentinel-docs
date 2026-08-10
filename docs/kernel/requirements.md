# Kernel Compatibility

## Minimum Requirements

| Requirement | Value |
|-------------|-------|
| Linux kernel | **6.9+** |
| BTF | `CONFIG_DEBUG_INFO_BTF=y` (`/sys/kernel/btf/vmlinux` must exist) |
| Privileges | Launcher needs `CAP_SYS_ADMIN` + unprivileged user namespaces enabled (creates the BPF token); the agent it execs runs unprivileged. No `CAP_BPF`/`setcap` path. |

The 6.9 floor is enforced at agent startup before any BPF program is loaded — there is no fallback path. The minimum is driven by the kfunc surface eBPFsentinel relies on (see [KFuncs](kfuncs.md)) plus BPF token delegation.

Verify on your system:

```bash
uname -r                       # Must be >= 6.9
ls /sys/kernel/btf/vmlinux     # Must exist
```

## Ask the running kernel

A version number is a proxy for capability, not capability itself: vendors backport helpers into older trees and distributions compile features out. At startup the agent therefore asks the kernel directly, per program type, about every helper its programs call, logs a one-line summary, and serves the detail:

```bash
curl -s http://127.0.0.1:8080/api/v1/ebpf/kernel-features
```

```json
{
  "probed": true,
  "load_mode": "bpf-token",
  "program_types": [{"program_type": "xdp", "supported": true}],
  "helpers": [{"program_type": "xdp", "helper": "bpf_fib_lookup", "supported": true}],
  "missing_required": []
}
```

Read it as follows.

- `missing_required` is the actionable field. Each entry names the program object, the program type and the helper. A program whose helper is missing is refused before it is loaded, with that same sentence as the error, instead of an opaque verifier rejection. `/readyz` stays `not_ready` while any entry remains, and repeats the list in `kernel_helpers_missing`.
- `probed: false` means the probe could not run, **not** that the kernel is missing anything. `helpers` and `missing_required` are then empty because nothing was measured, and `reason` says why. Nothing is refused on this basis and the agent starts normally.
- **`probed: false` is the expected answer on the standard deployment.** The probe issues a plain program load, which needs `CAP_BPF`; the agent loads through a BPF token and holds no capabilities, so it cannot probe. `load_mode` is printed alongside precisely so this asymmetry is visible rather than inferred. To get a full reading, run the agent once with `CAP_BPF` on a representative host.
- Helpers only. KFuncs, map types and program types have no equivalent probe; for those the matrix below and the BTF check remain the source of truth.

The probe does not move the floor, and cannot: the newest helper in the matrix below arrived in 6.0, well under 6.9. What sets the floor is the kfunc surface plus BPF token delegation, neither of which the probe covers. Measured on a 7.0 kernel with `CAP_BPF`, every helper/program-type pair the agent needs is supported and `missing_required` is empty.

## Feature-to-Kernel-Version Matrix

Every eBPF feature used by eBPFsentinel, the minimum kernel version, and which program relies on it.

### Helper Functions

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| [`bpf_map_lookup_elem`](https://docs.ebpf.io/linux/helper-function/bpf_map_lookup_elem/) | 3.19+ | All programs | Map read on every packet path |
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-scrub | IP header checksum update |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-scrub | TCP/UDP checksum update |
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-ingress, tc-nat-egress | Packet byte rewriting |
| [`bpf_skb_load_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_load_bytes/) | 4.5+ | tc-ids, tc-dns | Payload copy into the event record |
| [`bpf_get_smp_processor_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_smp_processor_id/) | 4.1+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer, tc-ids | Per-CPU counter indexing |
| [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/) | 4.2+ | xdp-firewall, xdp-ratelimit | Chaining to reject, VIP announce, rate limit and load balancer |
| [`bpf_clone_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_clone_redirect/) | 4.2+ | tc-ids | Mirror a matched packet to the capture interface |
| [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) | 4.6+ | tc-scrub | Checksum difference computation |
| [`bpf_get_current_pid_tgid`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_pid_tgid/) | 4.2+ | uprobe-dlp | Attribute a TLS write to its process |
| [`bpf_probe_read_user`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_user/) | 5.5+ | uprobe-dlp | Read the plaintext buffer from the traced process |
| [`bpf_probe_read_kernel`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_kernel/) | 5.5+ | xdp-firewall, tc-conntrack | Read `nf_conn` fields at BTF-resolved offsets |
| [`bpf_get_current_cgroup_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_cgroup_id/) | 4.18+ | tc-ids, tc-dns, uprobe-dlp | Container attribution for locally-originated events |
| [`bpf_skb_cgroup_id`](https://docs.ebpf.io/linux/helper-function/bpf_skb_cgroup_id/) | 4.18+ | tc-ids | Container attribution on the egress hook |
| [`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/) | 4.18+ | xdp-firewall | FIB routing enrichment |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.1+ | tc-ids, tc-qos, tc-scrub | Kernel-side sampling, loss emulation, IP ID randomization |
| [`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/) | 4.12+ | tc-ids | Per-connection flow identity |
| [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) | 4.14+ | xdp-firewall (CPUMAP), xdp-loadbalancer (DEVMAP) | CPU steering and wire-speed backend forwarding |
| [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) | 4.15+ | xdp-firewall | XDP to TC metadata passing |
| [`bpf_xdp_adjust_tail`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_tail/) | 4.15+ | xdp-firewall-reject, xdp-ratelimit-syncookie | Resize the forged reply |
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.8+ | Most programs | Suspend-aware timestamps |
| [`bpf_ktime_get_coarse_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_coarse_ns/) | 5.11+ | xdp-ratelimit | Cheap clock for token-bucket refill |
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | Every event-emitting program | Ring buffer record reservation |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | Every event-emitting program | Ring buffer record submission |
| [`bpf_ringbuf_discard`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_discard/) | 5.8+ | Every event-emitting program | Drop a reservation whose payload read failed |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | tc-dns | Adaptive backpressure |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer | MTU validation before pass or forward |
| [`bpf_skb_ecn_set_ce`](https://docs.ebpf.io/linux/helper-function/bpf_skb_ecn_set_ce/) | 5.1+ | tc-qos | ECN congestion marking instead of dropping |
| [`bpf_skb_set_tstamp`](https://docs.ebpf.io/linux/helper-function/bpf_skb_set_tstamp/) | 5.18+ | tc-qos | Earliest-departure-time pacing |
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall, tc-nat-ingress, tc-nat-egress, tc-scrub | Rule set iteration |
| [`bpf_tcp_raw_gen_syncookie_ipv4`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_raw_gen_syncookie_ipv4/) / `_ipv6` | 6.0+ | xdp-ratelimit-syncookie | Forge a SYN cookie without a socket |
| [`bpf_tcp_raw_check_syncookie_ipv4`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_raw_check_syncookie_ipv4/) / `_ipv6` | 6.0+ | xdp-ratelimit | Validate the returning ACK |

This table is generated from the same requirement table the agent probes with (`crates/adapters/src/ebpf/helper_probe.rs`), which a unit test keeps in step with the program sources: a helper call added without a matching entry fails the build rather than surfacing as a verifier rejection on an operator's kernel.

### Map Types

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| [`BPF_MAP_TYPE_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/) | 3.19+ | xdp-firewall, tc-ids | General key/value storage |
| [`BPF_MAP_TYPE_PROG_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PROG_ARRAY/) | 4.2+ | xdp-firewall | Tail-call chaining |
| [`BPF_MAP_TYPE_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_HASH/) | 4.6+ | xdp-ratelimit | Lock-free per-IP counters |
| [`BPF_MAP_TYPE_PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/) | 4.6+ | All programs | Per-CPU metrics counters |
| [`BPF_MAP_TYPE_LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) | 4.10+ | tc-conntrack, tc-threatintel | Conntrack + threat intel IOC maps with auto-eviction |
| [`BPF_MAP_TYPE_LRU_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_PERCPU_HASH/) | 4.10+ | tc-qos | Per-flow token bucket state with LRU eviction |
| [`BPF_MAP_TYPE_LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/) | 4.11+ | xdp-firewall | O(log n) CIDR matching |
| [`BPF_MAP_TYPE_DEVMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_DEVMAP/) | 4.14+ | xdp-loadbalancer | Wire-speed redirect to a backend interface |
| [`BPF_MAP_TYPE_CPUMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_CPUMAP/) | 4.15+ | xdp-firewall | NUMA-aware CPU steering |
| [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/) | 5.8+ | All programs | Kernel→userspace events |
| [`BPF_MAP_TYPE_BLOOM_FILTER`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/) | 5.16+ | tc-threatintel | IOC pre-filtering |

### KFuncs

KFuncs are bound manually through `crates/ebpf-helpers/src/kfuncs.rs`: aya still has no kfunc infrastructure as of 0.14. See [KFuncs](kfuncs.md) for full per-kfunc semantics and safe-wrapper coverage.

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| `bpf_skb_ct_lookup` / `bpf_xdp_ct_lookup` / `bpf_ct_release` | 5.18+ | tc-conntrack, tc-ids, tc-nat-* | Read kernel netfilter conntrack from BPF |
| `bpf_skb_ct_alloc` / `bpf_xdp_ct_alloc` / `bpf_ct_insert_entry` | 6.0+ | tc-conntrack, tc-nat-* | Write-side conntrack delegation |
| `bpf_ct_set_timeout` / `bpf_ct_change_timeout` | 6.0+ | tc-conntrack | Conntrack timeout management |
| `bpf_ct_set_status` / `bpf_ct_change_status` | 6.0+ | tc-conntrack, tc-ids | Conntrack status flag management (`IPS_CONFIRMED`, `IPS_DYING`) |
| `bpf_cgroup_ancestor` / `bpf_cgroup_acquire` | 6.0+ | tc-ids, tc-threatintel | Cgroup tree walk + refcount bump |
| `bpf_ct_set_nat_info` | 6.1+ | tc-nat-ingress, tc-nat-egress | In-kernel SNAT/DNAT rewrite delegation |
| `bpf_task_under_cgroup` | 6.1+ | tc-ids, tc-threatintel | Per-tenant membership test |
| `bpf_rcu_read_lock` / `bpf_rcu_read_unlock` | 6.2+ | tc-ids, tc-threatintel | RCU read-side critical sections for kernel field access |
| `bpf_rdonly_cast` / `bpf_cast_to_kern_ctx` | 6.2+ | tc-ids, tc-threatintel | Re-type opaque pointers as `PTR_TO_BTF_ID` |
| `bpf_skb_get_xfrm_info` / `bpf_skb_set_xfrm_info` | 6.2+ | tc-nat-* | IPsec interface steering via `xfrmi` devices |
| `bpf_xdp_metadata_rx_hash` | 6.3+ | xdp-ratelimit, xdp-loadbalancer | NIC-offloaded RSS hash reuse |
| `bpf_xdp_metadata_rx_timestamp` | 6.3+ | xdp-ratelimit, tc-ids | Hardware RX timestamps |
| `bpf_dynptr_from_skb` / `bpf_dynptr_from_xdp` | 6.4+ | tc-ids, tc-dns, uprobe-dlp | dynptr packet parsing |
| `bpf_dynptr_slice` / `bpf_dynptr_slice_rdwr` | 6.4+ | tc-ids, tc-dns | Zero-copy + read-write dynptr slices |
| `bpf_skb_get_fou_encap` / `bpf_skb_set_fou_encap` | 6.4+ | tc-nat-egress | FOU/GUE cloud-overlay encapsulation |
| `bpf_dynptr_adjust` / `_size` / `_is_null` / `_clone` | 6.5+ | tc-ids, tc-dns | dynptr accessors and window narrowing |
| `bpf_cgroup_release` | 6.5+ | tc-ids, tc-threatintel | Release any cgroup pointer |
| `bpf_cgroup_from_id` | 6.5+ | tc-ids, tc-threatintel | Resolve `cgroup_id` to a kernel cgroup pointer in-kernel |
| `bpf_iter_css_task_new` / `_next` / `_destroy` | 6.7+ | tc-ids | Iterate tasks attached to a cgroup |
| `bpf_iter_css_new` / `_next` / `_destroy` | 6.7+ | tc-ids | Iterate the cgroup tree |
| `bpf_task_get_cgroup1` | 6.8+ | tc-ids, tc-threatintel | Resolve cgroup1 hierarchy for a task |
| `bpf_xdp_metadata_rx_vlan_tag` | 6.8+ | xdp-firewall, xdp-ratelimit | Hardware VLAN tag extraction |
| `bpf_xdp_get_xfrm_state` / `bpf_xdp_xfrm_state_release` | 6.8+ | xdp-firewall | XDP-side `xfrm_state` lookup |

### Other Kernel Features

| Feature | Min Kernel | Description |
|---------|-----------|-------------|
| CO-RE / BTF | 5.8+ | Compile Once, Run Everywhere — portable eBPF binaries |
| `CONFIG_DEBUG_INFO_BTF` | 5.2+ | Type information embedded in vmlinux |
| BPF filesystem pinning | 5.8+ | `/sys/fs/bpf/` map sharing across programs |
| BPF token delegation | 6.9+ | Sandboxed BPF object loading from unprivileged user namespaces |
| Netkit device + `BPF_NETKIT_PRIMARY` attach | 6.7+ | Native TC-program attach to netkit interfaces via `BPF_LINK_CREATE` (Cilium 1.16+ pod networking); standard interfaces fall back to TC clsact |

## Kernel 6.1+ Optimizations

The 6.1 minimum kernel requirement unlocks several performance optimizations. Below is a per-program breakdown.

### Firewall & NAT: Multi-Level HashMap Rule Lookup

**Programs:** `xdp-firewall`, `tc-nat-ingress`, `tc-nat-egress`

Replaces linear O(n) rule scans with multi-level HashMap lookups:

| Level | Map | Complexity | Match Type |
|-------|-----|-----------|------------|
| 1 | `FW_HASH_5TUPLE` (HashMap) | O(1) | Exact 5-tuple |
| 2 | `FW_LPM_*` (LPM Trie) | O(log n) | CIDR-only |
| 3 | `FW_HASH_PORT` (HashMap) | O(1) | Protocol + port |
| 4 | `FW_RULES_ARRAY` + `bpf_loop` | O(n) | Complex rules (fallback) |

NAT follows the same pattern (`NAT_HASH_EXACT`, `NAT_HASH_CIDR`, `NAT_RULES_ARRAY`). Achieves <500ns latency at 10K rules (vs ~2µs at 4K rules with linear scan).

### Rate Limiter: Consolidated Bucket Map

**Program:** `xdp-ratelimit`

Consolidates 4 separate per-algorithm maps into a single `RL_BUCKETS` (`LruPerCpuHashMap`, 262K entries) using a discriminated union (`RateLimitBucketUnion`, 64 bytes). Reduces kernel memory by ~75%.

### Load Balancer: Two-Level HashMap

**Program:** `xdp-loadbalancer`

Replaces embedded `backend_ids: [u32; 16]` with two-level lookup:

- `LB_SERVICES` (HashMap, 4096 entries) → `LbServiceConfigV2` (8 bytes: algorithm + count + start_id)
- `LB_BACKENDS` (HashMap, 65536 entries) → `LbBackendEntry`

Scales from 64 services × 16 backends to 4096 services × 256 backends.

### Conntrack: Kernel Netfilter Kfuncs

**Programs:** `tc-conntrack`, `xdp-firewall`

Connection tracking uses kernel netfilter directly via `bpf_skb_ct_lookup` / `bpf_xdp_ct_lookup` kfuncs (kernel 5.18+). No BPF-side shadow tables — kernel manages all CT state. `nf_conn` field offsets are resolved at startup from vmlinux BTF and pushed to the `CT_NF_CONN_OFFSETS` Array map. The `INTERFACE_GROUPS` map (6 programs) is pinned to `/sys/fs/bpf/`.

### Variable-Size RingBuf Events (`bpf_dynptr`)

**Programs:** `tc-ids`, `uprobe-dlp` (all programs benefit)

Uses `bpf_dynptr` (kernel 5.19+) for variable-size `bpf_ringbuf_reserve`. Events carry only the actual payload bytes instead of a fixed 64-byte struct. Saves ~70% ring buffer space for L7 events, allowing ~4x more events before drops.

## Distribution Compatibility

The 6.9 minimum kernel narrows the supported distribution surface. Older LTS distributions need a backport / HWE / kernel-ml channel to ship a recent enough kernel.

| Distribution | Stock Kernel | 6.9+ Path | Status |
|-------------|--------------|-----------|--------|
| Debian 13 (Trixie) | 6.12 | stock | Verified |
| Debian 12 (Bookworm) | 6.1 | backports kernel required | Not supported on stock kernel |
| Ubuntu 24.10+ | 6.11+ | stock | Verified |
| Ubuntu 24.04 LTS | 6.8 | HWE 6.11+ required | Verified with HWE only |
| Ubuntu 22.04 LTS | 5.15 | HWE 6.8 still below floor | Not supported |
| Fedora 40+ | 6.8+ | kernel update to 6.9+ | Verified |
| Arch Linux | Rolling (≥6.9) | stock | Verified |
| Alpine 3.20+ | 6.6 | edge / kernel-lts upgrade | Verified with edge kernel |
| RHEL / Rocky 9.x | 5.14 (backports) | `kernel-ml` (ELRepo) 6.9+ | Verified with kernel-ml |
| NixOS unstable | Varies | `boot.kernelPackages = pkgs.linuxPackages_latest` | Verified |
| Talos Linux 1.8+ | 6.10+ | stock | Verified |

**Not supported:** macOS, Windows, FreeBSD (no Linux eBPF subsystem).

**Architectures:** x86_64 (primary), aarch64/ARM64 (cross-tested).

## Verifying Kernel Support

```bash
# Check kernel version (must be >= 6.9)
uname -r

# Check BTF support
ls /sys/kernel/btf/vmlinux

# Check available eBPF helpers (requires bpftool)
sudo bpftool feature probe kernel

# Check specific map type support
sudo bpftool feature probe kernel | grep -i bloom
sudo bpftool feature probe kernel | grep -i lpm

# Check loaded eBPF programs
sudo bpftool prog list

# Check loaded eBPF maps
sudo bpftool map list
```
