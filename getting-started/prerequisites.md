# Prerequisites

## System Requirements

### Linux Kernel

eBPFsentinel requires **Linux kernel 5.17+** with BTF (BPF Type Format) support.

Verify your system:

```bash
# Kernel version — must be >= 5.17
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
| Debian 12+ | Yes | BTF enabled since Debian 11 |
| Ubuntu 22.04+ | Yes | HWE kernels also supported |
| RHEL 9+ | Yes | BTF since RHEL 8.2 |
| Rocky Linux 9+ | Yes | 1:1 RHEL binary-compatible |
| Alpine 3.18+ | Yes | `linux-lts` package (verify `linux-virt`) |
| Fedora 37+ | Yes | BTF since Fedora 31 |
| Arch Linux | Yes | BTF since `linux 5.7.1.arch1-1` |
| NixOS | Yes | BTF in `common-config.nix` (>= 5.11) |
| Talos Linux | Yes | Full BPF/BTF in kernel config |

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
