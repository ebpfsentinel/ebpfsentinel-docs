# Prerequisites

## System Requirements

### Linux Kernel

eBPFsentinel requires **Linux kernel 6.1+** with BTF (BPF Type Format) support.

Verify your system:

```bash
# Kernel version — must be >= 6.1
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
| Debian 12+ | Yes | Ships 6.1 kernel |
| Ubuntu 24.04+ | Yes | Ships 6.8 kernel |
| Ubuntu 22.04 (HWE) | Yes | HWE 6.5+ kernel required |
| RHEL 9.4+ | Yes | Stock 5.14 insufficient; `kernel-ml` 6.1+ or RHEL 10 |
| Rocky Linux 9.4+ | Yes | Same as RHEL (ELRepo `kernel-ml`) |
| Alpine 3.18+ | Yes | `linux-lts` package (6.1+) |
| Fedora 37+ | Yes | Ships 6.0+ kernel |
| Arch Linux | Yes | Rolling, always 6.1+ |
| NixOS | Yes | Requires 6.1+ kernel |
| Talos Linux | Yes | Ships 6.x kernel |

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
