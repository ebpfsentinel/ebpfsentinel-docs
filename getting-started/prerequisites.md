# Prerequisites

## System Requirements

### Linux Kernel

eBPFsentinel requires **Linux kernel 6.9+** with BTF (BPF Type Format) support.

The 6.9 floor is driven by:

- **BPF token delegation** (`BPF_TOKEN_CREATE`, `BPF_F_TOKEN_FD`) — container-aware least-privilege mode
- **`BPF_MAP_TYPE_ARENA`** — mmap'd zero-copy maps
- Kfuncs `bpf_task_get_cgroup1` (6.8), `bpf_xdp_metadata_rx_vlan_tag` (6.8), `bpf_xdp_get_xfrm_state` (6.8), `bpf_iter_css_task` (6.7)

Verify your system:

```bash
# Kernel version — must be >= 6.9
uname -r

# BTF support — this file must exist
ls /sys/kernel/btf/vmlinux

# BPF filesystem — must be mounted
mount | grep bpf
```

BTF is enabled by default on most modern distributions. If `/sys/kernel/btf/vmlinux` does not exist, your kernel was built without `CONFIG_DEBUG_INFO_BTF=y` — you'll need to install a BTF-enabled kernel or rebuild.

### Capabilities

The agent requires `CAP_BPF` + `CAP_NET_ADMIN` capabilities, or root access:

```bash
# Run as root
sudo ./ebpfsentinel-agent --config config/ebpfsentinel.yaml

# Or with capabilities
sudo setcap cap_bpf,cap_net_admin+ep ./ebpfsentinel-agent
./ebpfsentinel-agent --config config/ebpfsentinel.yaml
```

### Supported Distributions

| Distribution | Supported | Notes |
|-------------|-----------|-------|
| Debian 13+ | Yes | Ships 6.12 kernel natively |
| Debian 12 | No | Ships 6.1 — install mainline 6.9+ or upgrade to Debian 13 |
| Ubuntu 24.04.2+ (HWE) | Yes | `linux-generic-hwe-24.04` → 6.11 |
| Ubuntu 24.04 (GA) | No | Ships 6.8 — below floor, use HWE or 6.9 mainline |
| RHEL 10 / Rocky Linux 10 | Yes | Ships 6.12 |
| RHEL 9.x / Rocky 9.x | No | Requires ELRepo `kernel-ml` 6.9+ |
| Alpine Edge | Yes | `linux-edge` tracks mainline 6.9+ |
| Fedora 40+ | Yes | Fedora 41 ships 6.10, Fedora 42 ships 6.12 |
| Arch Linux | Yes | Rolling, always 6.9+ |
| NixOS 24.11+ | Yes | Ships 6.11 |
| Talos Linux 1.8+ | Yes | Ships 6.9 |

**Architectures:** x86_64 (primary), aarch64/ARM64 (cross-tested)

**Not supported:** macOS, Windows, FreeBSD (no Linux eBPF subsystem)

## Build Requirements

Only needed if building from source. Pre-built binaries and Docker images don't need these.

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Rust stable | 1.93+ | Userspace crates |
| Rust nightly | latest | eBPF kernel programs (`bpfel-unknown-none` target) |
| `bpftool` | any | eBPF program inspection |
| `iproute2` | any | Network interface management |
| `protoc` | 3.x+ | gRPC proto compilation |

### Install Rust Toolchains

```bash
# Stable (userspace)
rustup toolchain install stable
rustup component add rustfmt clippy rust-src

# Nightly (eBPF programs)
rustup toolchain install nightly --component rust-src
```

## Runtime Dependencies

- `iproute2` — for interface management
- `bpftool` — for eBPF program inspection and debugging (optional but recommended)

## Test Requirements

Additional dependencies for running tests:

| Tool | Purpose |
|------|---------|
| `jq` | Integration test JSON parsing |
| [BATS](https://github.com/bats-core/bats-core) 1.10+ | Integration test framework |
| [grpcurl](https://github.com/fullstorydev/grpcurl) | gRPC integration tests |
