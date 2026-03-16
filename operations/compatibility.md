# Compatibility

## Platform

**Linux only.** Requires kernel 6.1+ with BTF support.

Not supported: macOS, Windows, FreeBSD (no Linux eBPF subsystem).

## Distributions

| Distribution | Supported | Notes |
|-------------|-----------|-------|
| Debian 12+ | Yes | Ships 6.1 kernel |
| Ubuntu 24.04+ | Yes | Ships 6.8 kernel |
| Ubuntu 22.04 (HWE) | Yes | HWE 6.5+ kernel required (`linux-generic-hwe-22.04`) |
| RHEL 9.4+ | Yes | Stock 5.14 insufficient; install `kernel-ml` 6.1+ or use RHEL 10 |
| Rocky Linux 9.4+ | Yes | Same as RHEL (use ELRepo `kernel-ml`) |
| Alpine 3.18+ | Yes | `linux-lts` package (6.1+) |
| Fedora 37+ | Yes | Ships 6.0+ kernel |
| Arch Linux | Yes | Rolling, always 6.1+ |
| NixOS | Yes | Requires 6.1+ kernel in configuration |
| Talos Linux | Yes | Ships 6.x kernel |

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

All features require kernel 6.1+. Here is when each eBPF feature became available:

| Feature / Helper | Kernel | Used By |
|-----------------|--------|---------|
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
