# Compatibility

## Platform

**Linux only.** Requires kernel **6.9+** with BTF support.

Not supported: macOS, Windows, FreeBSD (no Linux eBPF subsystem).

The 6.9 floor is driven by three hard kernel dependencies:

- **`BPF_TOKEN_CREATE` + `BPF_F_TOKEN_FD`** (kernel 6.9) — required
  for delegating eBPF load capabilities to unprivileged containers
  without `CAP_BPF`
- **`BPF_MAP_TYPE_ARENA`** (kernel 6.9) — required for zero-copy
  mmap'd map sharing between kernel programs and userspace readers
- **`bpf_task_get_cgroup1`**, **`bpf_xdp_metadata_rx_vlan_tag`**,
  **`bpf_xdp_get_xfrm_state`**, **`bpf_iter_css_task`** kfuncs
  (kernel 6.7–6.8) — required for in-kernel container id enrichment,
  VLAN hardware offload metadata reads, IPsec state lookups, and
  cgroup descendant iteration

## Distributions

| Distribution | Supported | Notes |
|-------------|-----------|-------|
| Debian 13 | Yes | Ships 6.12 kernel natively |
| Debian 12 | No | Ships 6.1 (below 6.9 floor) — use backports kernel or upgrade |
| Ubuntu 24.04.2+ | Yes | Use HWE stack (`linux-generic-hwe-24.04` → 6.11) |
| Ubuntu 24.04 (GA) | No | Ships 6.8 — upgrade to HWE or install 6.9 mainline |
| RHEL 10 / Rocky 10 | Yes | Ships 6.12 kernel |
| RHEL 9.x / Rocky 9.x | No | Stock 5.14 far below floor — requires ELRepo `kernel-ml` 6.9+ |
| Alpine 3.20+ | Yes | `linux-lts` package (6.6+) — upgrade to edge for 6.9+ |
| Fedora 40+ | Yes | Ships 6.8 (F40) / 6.10 (F41) / 6.12 (F42) |
| Arch Linux | Yes | Rolling, always 6.9+ |
| NixOS 24.11+ | Yes | Ships 6.11 kernel |
| Talos Linux 1.8+ | Yes | Ships 6.9 kernel |

## Architectures

| Architecture | Status |
|-------------|--------|
| x86_64 | Primary, fully tested |
| aarch64 (ARM64) | Cross-tested |

## Containers

| Runtime | Requirements |
|---------|-------------|
| Docker | `--privileged --network host` |
| Podman | `--privileged --network host` |

## Orchestrators

| Orchestrator | Deployment |
|-------------|-----------|
| Kubernetes | DaemonSet with `privileged: true`, `hostNetwork: true` |
| Nomad | Privileged Docker task |

## Kernel Feature Matrix

All features require kernel **6.9+**. Here is when each eBPF feature the agent relies on became available:

| Feature / Helper | Kernel | Used By |
|-----------------|--------|---------|
| `BPF_TOKEN_CREATE` + `BPF_F_TOKEN_FD` | 6.9+ | Container-aware least-privilege delegation (enterprise) |
| `BPF_MAP_TYPE_ARENA` + `bpf_arena_alloc_pages` | 6.9+ | Zero-copy mmap'd map sharing (roadmap — aya-rs upstream support pending) |
| `bpf_task_get_cgroup1` kfunc | 6.8+ | Kernel-side cgroup1 inode enrichment for Docker containers |
| `bpf_xdp_metadata_rx_vlan_tag` kfunc | 6.8+ | Hardware-offloaded 802.1Q VLAN tag read in XDP |
| `bpf_xdp_get_xfrm_state` kfunc | 6.8+ | IPsec state lookup for XDP firewall rules |
| `bpf_iter_css_task_*` / `bpf_iter_css_*` kfuncs | 6.7+ | Cgroup task enumeration for per-container audit |
| `bpf_loop` | 5.17+ | XDP firewall rule iteration, NAT rule scanning |
| `bpf_strncmp` | 5.17+ | L7 protocol detection |
| BPF Bloom filter | 5.16+ | TC threat intel IOC pre-check |
| `bpf_timer` | 5.15+ | Rate limit bucket expiry |
| `bpf_for_each_map_elem` | 5.13+ | Kernel-side map iteration |
| `bpf_check_mtu` | 5.12+ | MTU validation |
| `bpf_tcp_gen_syncookie` | 5.3+ | Deprecated — replaced by custom FNV-1a SYN cookie forging via `XDP_TX` |
| BPF ring buffer | 5.8+ | All programs — event emission |
| `bpf_ringbuf_query` | 5.8+ | Adaptive backpressure |
| `bpf_ktime_get_boot_ns` | 5.8+ | Suspend-aware timestamps |
| CO-RE / BTF | 5.8+ | Compile Once, Run Everywhere |
| `bpf_sk_lookup_tcp/udp` | 4.20+ | Socket lookup |
| `bpf_fib_lookup` | 4.18+ | FIB routing enrichment |
| `CPUMAP` | 4.15+ | CPU steering |
| `bpf_xdp_adjust_meta` | 4.15+ | XDP→TC metadata |
| `DEVMAP` | 4.14+ | Packet mirroring |
| `bpf_get_socket_cookie` | 4.12+ | Flow tracking |
| `LPM_TRIE` | 4.11+ | CIDR matching |
| `PERCPU_HASH` | 4.6+ | Lock-free counters |
| `bpf_skb_vlan_push/pop` | 4.3+ | VLAN rewriting |
| `PROG_ARRAY` + tail call | 4.2+ | Program chaining |
| `bpf_get_prandom_u32` | 4.1+ | Sampling |
| `bpf_csum_diff` | 4.1+ | Checksums |

## Kernel Verification

```bash
# Check kernel version
uname -r

# Check BTF support
ls /sys/kernel/btf/vmlinux

# Check BPF filesystem
mount | grep bpf

# Check available BPF helpers
sudo bpftool feature probe
```
