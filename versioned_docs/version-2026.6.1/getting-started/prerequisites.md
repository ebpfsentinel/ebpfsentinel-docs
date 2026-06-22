# Prerequisites

## System Requirements

### Linux Kernel

eBPFsentinel requires **Linux kernel 6.9+** with BTF (BPF Type Format) support.

The 6.9 floor is driven by:

- **BPF token delegation** (`BPF_TOKEN_CREATE`, `BPF_F_TOKEN_FD`) — container-aware least-privilege mode
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

eBPF loads **exclusively** through a BPF token — there is no `CAP_BPF`/`setcap`
loading path. The agent is started via the privileged launcher
(`ebpfsentinel-token-launch`), which creates the token in a child user namespace
and execs the agent unprivileged. The launcher needs `CAP_SYS_ADMIN` (i.e. root,
or `CAP_SYS_ADMIN` granted) **and** the host must allow unprivileged user
namespaces:

```bash
sudo ebpfsentinel-token-launch \
  --bpffs /sys/fs/bpf/ebpfsentinel \
  ./ebpfsentinel-agent --config config/ebpfsentinel.yaml
```

Running the agent binary directly would fail `BPF_TOKEN_CREATE` (`EOPNOTSUPP`
outside a user namespace) and fall back to API-only mode. See the
[BPF token guide](../operations/deployment/bpf-token.md).

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
