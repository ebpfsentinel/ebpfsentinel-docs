# Kernel Compatibility

## Minimum Requirements

| Requirement | Value |
|-------------|-------|
| Linux kernel | **6.6+** |
| BTF | `CONFIG_DEBUG_INFO_BTF=y` (`/sys/kernel/btf/vmlinux` must exist) |
| Capabilities | `CAP_BPF` + `CAP_NET_ADMIN` (or root) |

Verify on your system:

```bash
uname -r                       # Must be >= 6.6
ls /sys/kernel/btf/vmlinux     # Must exist
```

## Feature-to-Kernel-Version Matrix

Every eBPF feature used by eBPFsentinel, the minimum kernel version, and which program relies on it.

### Helper Functions

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) | 4.6+ | xdp-firewall | Checksum difference computation |
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | IP header checksum update |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-* | TCP/UDP checksum update |
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-*, tc-conntrack | Packet byte rewriting |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.17+ | tc-ids, tc-scrub, tc-qos | Kernel-side random sampling, IP ID randomization, QoS loss emulation |
| [`bpf_get_smp_processor_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_smp_processor_id/) | 4.1+ | All programs | CPU ID for NUMA analysis |
| [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/) | 4.2+ | xdp-firewall | XDP firewall → rate limiter chaining |
| [`bpf_skb_vlan_push`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_push/) | 4.3+ | tc-threatintel | VLAN quarantine tagging |
| [`bpf_skb_vlan_pop`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_pop/) | 4.3+ | tc-threatintel | VLAN tag removal |
| [`bpf_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_redirect/) | 4.4+ | xdp-firewall | Packet redirect (DEVMAP/CPUMAP) |
| [`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/) | 4.12+ | tc-conntrack | Per-connection flow tracking |
| [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) | 4.14+ | xdp-firewall | Redirect via DEVMAP/CPUMAP |
| [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) | 4.15+ | xdp-firewall | XDP→TC metadata passing |
| [`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/) | 4.18+ | xdp-firewall | FIB routing enrichment |
| [`bpf_sk_lookup_tcp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_tcp/) | 4.20+ | tc-conntrack | Socket lookup for process attribution |
| [`bpf_sk_lookup_udp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_udp/) | 4.20+ | tc-conntrack | UDP socket lookup |
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.8+ | xdp-ratelimit, tc-conntrack, tc-qos | Suspend-aware timestamps |
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | All programs | Ring buffer event emission |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | All programs | Ring buffer event submission |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | tc-ids, tc-threatintel | Adaptive backpressure |
| [`bpf_tcp_gen_syncookie`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_gen_syncookie/) | 5.4+ | ~~xdp-ratelimit~~ | Deprecated — replaced by custom FNV-1a SYN cookie forging via `XDP_TX` |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer | MTU validation — drops oversized packets before pass/forward |
| [`bpf_for_each_map_elem`](https://docs.ebpf.io/linux/helper-function/bpf_for_each_map_elem/) | 5.13+ | xdp-ratelimit | Kernel-side map iteration |
| [`bpf_timer_init`](https://docs.ebpf.io/linux/helper-function/bpf_timer_init/) | 5.15+ | xdp-ratelimit | Timer-based bucket expiration |
| [`bpf_strncmp`](https://docs.ebpf.io/linux/helper-function/bpf_strncmp/) | 5.17+ | tc-ids | L7 protocol signature detection |
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall, tc-nat-ingress, tc-nat-egress | Rule set iteration |
| [`bpf_dynptr_from_mem`](https://docs.ebpf.io/linux/helper-function/bpf_dynptr_from_mem/) | 5.19+ | tc-ids, uprobe-dlp (all programs) | Variable-size RingBuf event emission |
| [`bpf_user_ringbuf_drain`](https://docs.ebpf.io/linux/helper-function/bpf_user_ringbuf_drain/) | 6.1+ | xdp-firewall (extensible to all programs) | Drain config commands from User RingBuf |

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
| [`BPF_MAP_TYPE_DEVMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_DEVMAP/) | 4.14+ | xdp-firewall | Packet mirroring |
| [`BPF_MAP_TYPE_CPUMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_CPUMAP/) | 4.15+ | xdp-firewall | NUMA-aware CPU steering |
| [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/) | 5.8+ | All programs | Kernel→userspace events |
| [`BPF_MAP_TYPE_BLOOM_FILTER`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/) | 5.16+ | tc-threatintel | IOC pre-filtering |
| [`BPF_MAP_TYPE_USER_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_USER_RINGBUF/) | 6.1+ | xdp-firewall (extensible to all programs) | Userspace→kernel config push |

### Other Kernel Features

| Feature | Min Kernel | Description |
|---------|-----------|-------------|
| CO-RE / BTF | 5.8+ | Compile Once, Run Everywhere — portable eBPF binaries |
| `CONFIG_DEBUG_INFO_BTF` | 5.2+ | Type information embedded in vmlinux |
| BPF filesystem pinning | 5.8+ | `/sys/fs/bpf/` map sharing across programs |

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

### Conntrack: BPF Filesystem Map Pinning

**Programs:** `tc-conntrack`, `xdp-firewall`, `tc-nat-ingress`, `tc-nat-egress`

Pins `CT_TABLE_V4` (262K entries) and `CT_TABLE_V6` (65K entries) to `/sys/fs/bpf/` so they are shared across programs instead of duplicated. Saves ~49 MB of kernel memory. The `INTERFACE_GROUPS` map (6 programs) is also pinned.

### Variable-Size RingBuf Events (`bpf_dynptr`)

**Programs:** `tc-ids`, `uprobe-dlp` (all programs benefit)

Uses `bpf_dynptr` (kernel 5.19+) for variable-size `bpf_ringbuf_reserve`. Events carry only the actual payload bytes instead of a fixed 64-byte struct. Saves ~70% ring buffer space for L7 events, allowing ~4x more events before drops.

### User RingBuf: Atomic Config Push (kernel 6.1+)

**Programs:** `xdp-firewall` (pilot), extensible to all programs

Uses `BPF_MAP_TYPE_USER_RINGBUF` (kernel 6.1+) and `bpf_user_ringbuf_drain` for atomic batch config updates from userspace. Replaces per-entry `bpf_map_update_elem` syscalls with a single ring buffer drain, eliminating race conditions and reducing latency for bulk rule reloads.

## Distribution Compatibility

| Distribution | Kernel | BTF | Status |
|-------------|--------|-----|--------|
| Debian 12+ | 6.1+ | Yes | Verified |
| Ubuntu 24.04+ | 6.8+ | Yes | Verified |
| Ubuntu 22.04 (HWE) | 6.5+ (HWE) | Yes | Verified (HWE kernel required) |
| RHEL 9.4+ | 5.14+ (backports) | Yes | Verified (kernel-ml 6.1+ recommended) |
| Rocky Linux 9.4+ | 5.14+ (backports) | Yes | Verified (kernel-ml 6.1+ recommended) |
| Alpine 3.18+ | 6.1+ (lts) | Yes | Verified |
| Fedora 37+ | 6.0+ | Yes | Verified |
| Arch Linux | Rolling | Yes | Verified |
| NixOS | Varies | Yes | Requires 6.1+ kernel |
| Talos Linux | 6.x | Yes | Verified |

**Not supported:** macOS, Windows, FreeBSD (no Linux eBPF subsystem).

**Architectures:** x86_64 (primary), aarch64/ARM64 (cross-tested).

## Verifying Kernel Support

```bash
# Check kernel version
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
