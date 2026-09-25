# Compatibility

## Platform

**Linux only.** Requires kernel **6.9+** with BTF support.

Not supported: macOS, Windows, FreeBSD (no Linux eBPF subsystem).

The 6.9 floor is set by the BPF token: **`BPF_TOKEN_CREATE` +
`BPF_F_TOKEN_FD`** (kernel 6.9) is how the agent loads its programs
without holding `CAP_BPF` or `CAP_SYS_ADMIN` itself. The newest kfuncs the
programs call arrived earlier (6.8), so they do not move the floor.

## Distributions

What matters is the running kernel, not the release: any distribution booting
6.9 or later with BTF (`/sys/kernel/btf/vmlinux`) works.

| Distribution | Supported | Notes |
|-------------|-----------|-------|
| Debian 13 | Yes | Ships 6.12 |
| Debian 12 | No | Ships 6.1 - use a backports kernel 6.9+ or upgrade |
| Ubuntu 24.04.2+ | Yes | With the HWE kernel (`linux-generic-hwe-24.04`, 6.11 or later) |
| Ubuntu 24.04 (GA kernel) | No | Ships 6.8 - move to the HWE kernel |
| RHEL 10 / Rocky 10 | Yes | Ships 6.12 |
| RHEL 9.x / Rocky 9.x | No | Ships 5.14 - requires ELRepo `kernel-ml` 6.9+ |
| Alpine 3.21+ | Yes | `linux-lts` is 6.12 |
| Alpine 3.20 and earlier | No | `linux-lts` 6.6 is below the floor |
| Fedora 41+ | Yes | Kernel updates keep released Fedora on current stable |
| Arch Linux | Yes | Rolling |
| NixOS | Yes, with `linuxPackages_latest` | The default LTS kernel may be below 6.9 |
| Talos Linux 1.9+ | Yes | Ships 6.12 |

## Architectures

| Architecture | Status |
|-------------|--------|
| x86_64 | Primary; every integration lane runs here |
| aarch64 (ARM64) | Binaries and images built natively by the release pipeline; not exercised by the integration lanes |

## Containers

The agent is split in two containers, both on the host network:

| Container | User | Privileges |
|-----------|------|------------|
| Warden | root | `SYS_ADMIN`, `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`, `BPF`, `PERFMON`; AppArmor and seccomp unconfined |
| Agent | `65534` | `cap_drop: ALL`; AppArmor unconfined; seccomp either unconfined or the tailored profile `dist/seccomp/ebpfsentinel-agent.json` |

Neither runs `--privileged`. The warden delegates a bpffs to the agent, which
unshares a user namespace and loads its own programs through a BPF token; the
warden then brokers the few operations a token does not cover (conntrack
teardown, pcap sockets, gratuitous ARP, DLP uprobe links). The host needs
unprivileged user namespaces enabled. See the
[BPF token guide](deployment/bpf-token.md) and [Docker](deployment/docker.md).

## Orchestrators

| Orchestrator | Deployment |
|-------------|-----------|
| Kubernetes 1.29+ | DaemonSet with `hostNetwork: true`; the warden runs as a native sidecar (init container with `restartPolicy: Always`), the agent as uid 65534 with every capability dropped. The chart refuses an older cluster: native sidecars are behind an alpha feature gate, off by default, on 1.28. See [Kubernetes](deployment/kubernetes.md) |
| Docker Compose | `docker-compose.yml` at the repository root: warden and agent services, `network_mode: host` |

## Kernel Feature Matrix

All features require kernel **6.9+**. Here is when each eBPF feature the agent relies on became available:

| Feature / Helper | Kernel | Used By |
|-----------------|--------|---------|
| `BPF_TOKEN_CREATE` + `BPF_F_TOKEN_FD` | 6.9+ | Loading every program without `CAP_BPF` in the agent |
| `BPF_MAP_TYPE_ARENA` + `bpf_arena_alloc_pages` | 6.9+ | Not used - evaluated for zero-copy delivery, unusable on the `bpfel` target (verifier rejects the untyped arena pointer; alloc kfunc is sleepable-only) |
| `bpf_xdp_metadata_rx_vlan_tag` kfunc | 6.8+ | Hardware-offloaded 802.1Q VLAN tag read in XDP |
| `bpf_xdp_get_xfrm_state` kfunc | 6.8+ | IPsec state lookup for XDP firewall rules |
| `bpf_skb_get/set_xfrm_info` kfuncs | 6.2+ | XFRM interface metadata in TC |
| `bpf_skb_get/set_fou_encap` kfuncs | 6.4+ | FOU/GUE encapsulation metadata in TC |
| `bpf_xdp_metadata_rx_hash` / `rx_timestamp` kfuncs | 6.3+ | NIC hash and hardware timestamp in XDP |
| `bpf_skb_ct_*` / `bpf_xdp_ct_*` / `bpf_ct_*` kfuncs | 5.18+ (insert 6.0+, `bpf_ct_set_nat_info` 6.1+) | Kernel conntrack lookup and flow kill; NAT entries committed from `tc-nat-ingress` / `tc-nat-egress` |
| `bpf_dynptr_*` kfuncs | 6.4+ | Full packet length in the IDS and the XDP firewall |
| `bpf_tcp_raw_gen_syncookie_ipv4/_ipv6` | 6.0+ | Forging the SYN-ACK cookie in `xdp-ratelimit-syncookie` |
| `bpf_tcp_raw_check_syncookie_ipv4/_ipv6` | 6.0+ | Validating the returning ACK in `xdp-ratelimit` |
| `bpf_loop` | 5.17+ | XDP firewall rule iteration, NAT rule scanning |
| BPF Bloom filter | 5.16+ | TC threat intel IOC pre-check |
| `bpf_check_mtu` | 5.12+ | MTU validation in XDP rate limiting and firewall |
| BPF ring buffer | 5.8+ | Event emission from the eight programs that report events |
| `bpf_ringbuf_query` | 5.8+ | Backpressure and batched reader wakeups, in every event-emitting program |
| `bpf_ktime_get_boot_ns` | 5.8+ | Suspend-aware timestamps |
| CO-RE / BTF | 5.8+ | Compile Once, Run Everywhere |
| `bpf_fib_lookup` | 4.18+ | FIB routing enrichment in the XDP firewall |
| `DEVMAP` | 4.14+ | Load balancer redirect to a backend interface |
| `bpf_get_socket_cookie` | 4.12+ | Flow tracking |
| `LPM_TRIE` | 4.11+ | CIDR matching |
| `PERCPU_HASH` | 4.6+ | Lock-free counters |
| `PROG_ARRAY` + tail call | 4.2+ | Program chaining |
| `bpf_get_prandom_u32` | 4.1+ | QoS loss emulation, scrub IP ID randomisation; IDS random sampling |
| `bpf_csum_diff` | 4.6+ | Checksums in scrub |

SYN cookies are computed by the kernel's raw syncookie helpers and the
SYN-ACK is written by `xdp-ratelimit-syncookie` and sent back with `XDP_TX`;
the socket-bound `bpf_tcp_gen_syncookie` is not used.

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
