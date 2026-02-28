# Kernel Compatibility

## Minimum Requirements

| Requirement | Value |
|-------------|-------|
| Linux kernel | **5.17+** |
| BTF | `CONFIG_DEBUG_INFO_BTF=y` (`/sys/kernel/btf/vmlinux` must exist) |
| Capabilities | `CAP_BPF` + `CAP_NET_ADMIN` (or root) |

Verify on your system:

```bash
uname -r                       # Must be >= 5.17
ls /sys/kernel/btf/vmlinux     # Must exist
```

## Feature-to-Kernel-Version Matrix

Every eBPF feature used by eBPFsentinel, the minimum kernel version, and which program relies on it.

### Helper Functions

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) | 4.1+ | xdp-firewall | Checksum difference computation |
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | IP header checksum update |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-* | TCP/UDP checksum update |
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-*, tc-conntrack | Packet byte rewriting |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.1+ | tc-ids, tc-scrub | Kernel-side random sampling, IP ID randomization |
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
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.7+ | xdp-ratelimit, tc-conntrack | Suspend-aware timestamps |
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | All programs | Ring buffer event emission |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | All programs | Ring buffer event submission |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | tc-ids, tc-threatintel | Adaptive backpressure |
| [`bpf_tcp_gen_syncookie`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_gen_syncookie/) | 5.10+ | xdp-ratelimit | SYN flood mitigation |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall | MTU validation before redirect |
| [`bpf_for_each_map_elem`](https://docs.ebpf.io/linux/helper-function/bpf_for_each_map_elem/) | 5.13+ | xdp-ratelimit | Kernel-side map iteration |
| [`bpf_timer_init`](https://docs.ebpf.io/linux/helper-function/bpf_timer_init/) | 5.15+ | xdp-ratelimit | Timer-based bucket expiration |
| [`bpf_strncmp`](https://docs.ebpf.io/linux/helper-function/bpf_strncmp/) | 5.17+ | tc-ids | L7 protocol signature detection |
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall | Large rule set iteration |

### Map Types

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| [`BPF_MAP_TYPE_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/) | 3.19+ | xdp-firewall, tc-ids, tc-threatintel | General key/value storage |
| [`BPF_MAP_TYPE_PROG_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PROG_ARRAY/) | 4.2+ | xdp-firewall | Tail-call chaining |
| [`BPF_MAP_TYPE_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_HASH/) | 4.6+ | xdp-ratelimit | Lock-free per-IP counters |
| [`BPF_MAP_TYPE_PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/) | 4.6+ | All programs | Per-CPU metrics counters |
| [`BPF_MAP_TYPE_LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) | 4.10+ | tc-conntrack | Conntrack with auto-eviction |
| [`BPF_MAP_TYPE_LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/) | 4.11+ | xdp-firewall | O(log n) CIDR matching |
| [`BPF_MAP_TYPE_DEVMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_DEVMAP/) | 4.14+ | xdp-firewall | Packet mirroring |
| [`BPF_MAP_TYPE_CPUMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_CPUMAP/) | 4.15+ | xdp-firewall | NUMA-aware CPU steering |
| [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/) | 5.8+ | All programs | Kernel→userspace events |
| [`BPF_MAP_TYPE_BLOOM_FILTER`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/) | 5.16+ | tc-threatintel | IOC pre-filtering |

### Other Kernel Features

| Feature | Min Kernel | Description |
|---------|-----------|-------------|
| CO-RE / BTF | 5.8+ | Compile Once, Run Everywhere — portable eBPF binaries |
| `CONFIG_DEBUG_INFO_BTF` | 5.2+ | Type information embedded in vmlinux |

## Distribution Compatibility

| Distribution | Kernel | BTF | Status |
|-------------|--------|-----|--------|
| Debian 12+ | 6.1+ | Yes | Verified |
| Ubuntu 22.04+ | 5.15+ (HWE: 6.x) | Yes | Verified |
| RHEL 9+ | 5.14+ | Yes | Verified |
| Rocky Linux 9+ | 5.14+ | Yes | Verified |
| Alpine 3.18+ | 6.1+ (lts) | Yes | Verified |
| Fedora 37+ | 6.0+ | Yes | Verified |
| Arch Linux | Rolling | Yes | Verified |
| NixOS | Varies | Yes | Since 5.11 |
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
