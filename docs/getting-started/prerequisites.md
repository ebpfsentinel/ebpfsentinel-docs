# Prerequisites

## System Requirements

### Linux Kernel

eBPFsentinel requires **Linux kernel 6.18+** with BTF (BPF Type Format) support.

The 6.18 floor is the long-term kernel of 2025 and the first release that verifies the signature of a BPF program (Ubuntu 26.04, Ubuntu 24.04's HWE line, Talos 1.12, GKE Container-Optimized OS 133 and EKS Amazon Linux 2023 run it or later). Everything else the agent needs from the kernel is older than it:

- **BPF token delegation** (`BPF_TOKEN_CREATE`, `BPF_F_TOKEN_FD`, 6.9) - container-aware least-privilege mode
- `bpf_send_signal_task` (6.13), which signals a task at once
- Kfuncs `bpf_task_get_cgroup1` (6.8), `bpf_xdp_metadata_rx_vlan_tag` (6.8), `bpf_xdp_get_xfrm_state` (6.8), `bpf_iter_css_task` (6.7)

What the floor buys is that the file kfuncs of 6.12 exist, not that they load: they need a sleepable context behind the BPF LSM, so the agent probes them at startup and falls back to userspace where they are refused.

Verify your system:

```bash
# Kernel version - must be >= 6.18
uname -r

# BTF support - this file must exist
ls /sys/kernel/btf/vmlinux

# BPF filesystem - must be mounted
mount | grep bpf
```

BTF is enabled by default on most modern distributions. If `/sys/kernel/btf/vmlinux` does not exist, your kernel was built without `CONFIG_DEBUG_INFO_BTF=y` - you'll need to install a BTF-enabled kernel or rebuild.

### Kernel Modules

Five programs call kfuncs that a kernel module registers rather than the kernel itself: the firewall, conntrack and IDS programs need `nf_conntrack`, the NAT egress program needs `fou`, and the two NAT programs need `xfrm_interface`. A module's kfuncs exist only while it is loaded, and a minimal host loads none of these on its own: a stock Ubuntu 26.04 cloud image with no firewall rules has none of them. The agent checks before loading and refuses with the module and the program, for example:

```text
`tc_nat_egress` calls `bpf_skb_set_fou_encap` and `bpf_skb_set_xfrm_info`, registered by kernel modules `fou` and `xfrm_interface`, which are not loaded on this host (absent from /sys/kernel/btf): load them with `modprobe fou xfrm_interface` or list them in /etc/modules-load.d, then restart the agent
```

`fou6` registers no kfunc but carries IPv6 FOU encapsulation, so it is loaded alongside. Load them now and at every boot:

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
the host. The agent runs as its own unprivileged user, `ebpfsentinel`, never as
root, so the host must allow an unprivileged user one user namespace; the
[BPF token guide](../operations/deployment/bpf-token.md#unprivileged-user-namespaces-per-distribution)
lists the setting per distribution.

```bash
sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel
```

The package and the release tarball install both as systemd units (`ebpfsentinel-warden` and
`ebpfsentinel`). Without `EBPFSENTINEL_WARDEN_SOCK` the agent cannot create a
token and starts in API-only mode with no eBPF loaded. On Ubuntu 24.04 and later,
`kernel.apparmor_restrict_unprivileged_userns=1` blocks the namespace unless the
shipped AppArmor profile, `/etc/apparmor.d/ebpfsentinel-agent`, is loaded; the
package and `install.sh` load it, and it grants the namespace to the agent alone
rather than lifting the restriction host-wide. See the
[BPF token guide](../operations/deployment/bpf-token.md).

### Supported Distributions

| Distribution | Supported | Notes |
|-------------|-----------|-------|
| Ubuntu 26.04 LTS | Yes | Ships 7.0 |
| Ubuntu 24.04 with the HWE kernel | Yes | `linux-generic-hwe-24.04` is 7.0 since 24.04.5 (6.17 in 24.04.4 was below the floor); any 24.04 host kept up to date gets it, whatever point release it was installed from |
| Ubuntu 24.04 on its GA kernel | No | Ships 6.8 - `apt install linux-generic-hwe-24.04` and reboot |
| Ubuntu 22.04 | No | The HWE kernel stops at 6.8 |
| Debian 13 with the backports kernel | Yes | `apt install -t trixie-backports linux-image-amd64` installs 6.18 or later |
| Debian 13 on its stock kernel | No | Ships 6.12 |
| Debian 12 | No | Ships 6.1, and its backports kernel stops at 6.12 |
| Fedora 43+ | Yes | Kernel updates keep released Fedora on current stable |
| openSUSE Tumbleweed | Yes | Rolling |
| SLES 16 / openSUSE Leap 16 | No | Ships 6.12 for the release's life |
| RHEL / Rocky / AlmaLinux 10 | No | Ships 6.12 for the release's life; only ELRepo's mainline `kernel-ml` reaches 6.18 |
| RHEL / Rocky / AlmaLinux 9 | No | Ships 5.14; only ELRepo's mainline `kernel-ml` reaches 6.18 |
| Alpine 3.23+ | Yes | `linux-lts` is 6.18 |
| Alpine 3.22 and earlier | No | `linux-lts` 6.12 or older is below the floor |
| Arch Linux | Yes | Rolling |
| NixOS 26.05+ | Yes | The default kernel is 6.18 |
| NixOS 25.11 | With `linuxPackages_6_18` | `boot.kernelPackages = pkgs.linuxPackages_6_18` |
| Talos Linux 1.12+ | Yes | Ships 6.18; Talos 1.11 and earlier ship 6.12 or older |
| Flatcar Container Linux | Where the release runs 6.18 | Releases of 2026 ship 6.18, earlier ones 6.12: read `uname -r` on the image |

### Managed Node Images

A managed cluster decides the node kernel, so the question is which node image
the provider runs and what the operator can turn to reach 6.18. The agent
refuses to start below the floor and says which kernel it found, so a node that
is out says so at startup rather than loading half its programs.

| Provider and node image | Supported | Kernel | The operator's lever |
|-------------------------|-----------|--------|----------------------|
| GKE, Container-Optimized OS milestone 133 and later | Yes | 6.18 | The cluster version: COS has no package manager, so the node image follows the GKE version and nothing else |
| GKE, Container-Optimized OS milestones 125 to 129 | No | 6.12 | Upgrade the cluster to a version whose default COS image is milestone 133 or later |
| GKE, Container-Optimized OS milestone 121 and earlier | No | 6.6 or older | Upgrade the cluster to a version whose default COS image is milestone 133 or later |
| GKE, Ubuntu node images | Where the image's kernel is 6.18 or later | Per image | The node image version, chosen per node pool; read `uname -r` on one node before rolling out |
| EKS, Amazon Linux 2023 on the 6.18 kernel | Yes | 6.18 | The AMI: AL2023's default kernel since 2026-08-17; a node group on an older AMI moves by updating its release version |
| EKS, Amazon Linux 2023 on the 6.1 or 6.12 kernel | No | 6.1 or 6.12 | Update the node group to an AMI on the 6.18 kernel, or build a custom AMI from `awslabs/amazon-eks-ami` on that stream |
| EKS, Bottlerocket `aws-k8s-1.36` and later, outside FIPS | Yes | 6.18 | The variant, which follows the Kubernetes version |
| EKS, Bottlerocket FIPS variants and `aws-k8s-1.35` and earlier | No | 6.12 or older | Move the node group to a non-FIPS 1.36 or later variant |
| AKS, Ubuntu 26.04 node images | Yes | 7.0 | The node pool's OS SKU: in preview from Kubernetes 1.36, and what the `Ubuntu` SKU defaults to from 1.38 |
| AKS, Ubuntu 24.04 node images | No | 6.8 | Move the node pool to Ubuntu 26.04 |
| AKS, Azure Linux 3.0 and Ubuntu 22.04 node images | No | 6.6 and 5.15 | Move the node pool to Ubuntu 26.04; Azure Linux 4.0 runs 6.18 and qualifies once AKS offers it |
| Scaleway Kapsule | Not measured | Not published | Read `uname -r` on one node before rolling out |

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
