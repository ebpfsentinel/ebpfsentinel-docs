# Prerequisites

## System Requirements

### Linux Kernel

eBPFsentinel requires **Linux kernel 6.9+** with BTF (BPF Type Format) support.

The 6.9 floor is driven by:

- **BPF token delegation** (`BPF_TOKEN_CREATE`, `BPF_F_TOKEN_FD`) - container-aware least-privilege mode
- Kfuncs `bpf_task_get_cgroup1` (6.8), `bpf_xdp_metadata_rx_vlan_tag` (6.8), `bpf_xdp_get_xfrm_state` (6.8), `bpf_iter_css_task` (6.7)

Verify your system:

```bash
# Kernel version - must be >= 6.9
uname -r

# BTF support - this file must exist
ls /sys/kernel/btf/vmlinux

# BPF filesystem - must be mounted
mount | grep bpf
```

BTF is enabled by default on most modern distributions. If `/sys/kernel/btf/vmlinux` does not exist, your kernel was built without `CONFIG_DEBUG_INFO_BTF=y` - you'll need to install a BTF-enabled kernel or rebuild.

### Kernel Modules

Four programs call kfuncs that a kernel module registers rather than the kernel itself: the firewall and conntrack programs need `nf_conntrack`, the IDS program needs `fou` and `fou6`, the NAT programs need `xfrm_interface`. A module's kfuncs exist only while it is loaded, and a minimal host loads none of these on its own: a stock Ubuntu 26.04 cloud image with no firewall rules has none of them, so the four programs fail with `kfunc ... not found in vmlinux or any loaded module BTF` and the agent never reports ready. Load them now and at every boot:

```bash
printf 'nf_conntrack\nfou\nfou6\nxfrm_interface\n' | sudo tee /etc/modules-load.d/ebpfsentinel.conf
for m in nf_conntrack fou fou6 xfrm_interface; do sudo modprobe "$m"; done
ls /sys/kernel/btf | grep -E 'nf_conntrack|fou|xfrm_interface'
```

### Capabilities

eBPF loads **exclusively** through a BPF token - there is no `CAP_BPF`/`setcap`
loading path. Two processes share the work: the **warden** broker runs as root,
and the **agent** unshares its own user namespace, has the warden delegate a
bpffs over a Unix socket, and creates the token there, holding no capability over
the host. The host must allow unprivileged user namespaces:

```bash
sudo warden serve /run/ebpfsentinel/warden.sock --uid 0 &
sudo EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock \
  ./ebpfsentinel-agent --config config/ebpfsentinel.yaml
```

The release tarball installs both as systemd units (`ebpfsentinel-warden` and
`ebpfsentinel`). Without `EBPFSENTINEL_WARDEN_SOCK` the agent cannot create a
token and starts in API-only mode with no eBPF loaded. On Ubuntu 24.04 and later,
`kernel.apparmor_restrict_unprivileged_userns=1` blocks the namespace unless the
shipped AppArmor profile is loaded. See the
[BPF token guide](../operations/deployment/bpf-token.md).

### Supported Distributions

| Distribution | Supported | Notes |
|-------------|-----------|-------|
| Debian 13+ | Yes | Ships 6.12 |
| Debian 12 | No | Ships 6.1 - use a backports kernel 6.9+ or upgrade to Debian 13 |
| Ubuntu 24.04.2+ (HWE) | Yes | `linux-generic-hwe-24.04` → 6.11 or later |
| Ubuntu 24.04 (GA) | No | Ships 6.8 - move to the HWE kernel |
| Ubuntu 22.04 | No | The HWE kernel stops at 6.8 |
| RHEL 10 / Rocky Linux 10 | Yes | Ships 6.12 |
| RHEL 9.x / Rocky 9.x | No | Ships 5.14 - requires ELRepo `kernel-ml` 6.9+ |
| Alpine 3.21+ | Yes | `linux-lts` is 6.12 |
| Alpine 3.20 and earlier | No | `linux-lts` 6.6 is below the floor |
| Fedora 41+ | Yes | Kernel updates keep released Fedora on current stable |
| Arch Linux | Yes | Rolling |
| NixOS | Yes, with `linuxPackages_latest` | The default LTS kernel may be below 6.9 |
| Talos Linux 1.9+ | Yes | Ships 6.12; Talos 1.8 ships 6.6 |

**Architectures:** x86_64 (primary), aarch64/ARM64 (cross-tested)

**Not supported:** macOS, Windows, FreeBSD (no Linux eBPF subsystem)

## Build Requirements

Only needed if building from source. Pre-built binaries and Docker images don't need these.

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Rust stable | 1.99+ | Userspace crates |
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

- `iproute2` - for interface management
- `bpftool` - for eBPF program inspection and debugging (optional but recommended)

## Test Requirements

Additional dependencies for running tests:

| Tool | Purpose |
|------|---------|
| `jq` | Integration test JSON parsing |
| [BATS](https://github.com/bats-core/bats-core) 1.10+ | Integration test framework |
| [grpcurl](https://github.com/fullstorydev/grpcurl) | gRPC integration tests |
