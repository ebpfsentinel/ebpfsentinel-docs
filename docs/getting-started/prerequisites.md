# Prerequisites

## System Requirements

### Linux Kernel

eBPFsentinel requires **Linux kernel 6.12+** with BTF (BPF Type Format) support.

The 6.12 floor is the kernel the managed node images converge on (GKE Container-Optimized OS, EKS Amazon Linux 2023, Ubuntu's HWE line). Everything the agent needs from the kernel is older than it:

- **BPF token delegation** (`BPF_TOKEN_CREATE`, `BPF_F_TOKEN_FD`, 6.9) - container-aware least-privilege mode
- Kfuncs `bpf_task_get_cgroup1` (6.8), `bpf_xdp_metadata_rx_vlan_tag` (6.8), `bpf_xdp_get_xfrm_state` (6.8), `bpf_iter_css_task` (6.7)

What the floor buys is that the 6.12 file kfuncs exist, not that they load: they need a sleepable context behind the BPF LSM, so the agent probes them at startup and falls back to userspace where they are refused.

Verify your system:

```bash
# Kernel version - must be >= 6.12
uname -r

# BTF support - this file must exist
ls /sys/kernel/btf/vmlinux

# BPF filesystem - must be mounted
mount | grep bpf
```

BTF is enabled by default on most modern distributions. If `/sys/kernel/btf/vmlinux` does not exist, your kernel was built without `CONFIG_DEBUG_INFO_BTF=y` - you'll need to install a BTF-enabled kernel or rebuild.

### Kernel Modules

Five programs call kfuncs that a kernel module registers rather than the kernel itself: the firewall, conntrack and IDS programs need `nf_conntrack`, the IDS and NAT egress programs need `fou`, and the two NAT programs need `xfrm_interface`. A module's kfuncs exist only while it is loaded, and a minimal host loads none of these on its own: a stock Ubuntu 26.04 cloud image with no firewall rules has none of them. The agent checks before loading and refuses with the module and the program, for example:

```text
`tc_ids` calls `bpf_skb_ct_lookup` and `bpf_skb_get_fou_encap`, registered by kernel modules `nf_conntrack` and `fou`, which are not loaded on this host (absent from /sys/kernel/btf): load them with `modprobe nf_conntrack fou` or list them in /etc/modules-load.d, then restart the agent
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
| Debian 12 | No | Ships 6.1 - use a backports kernel 6.12+ or upgrade to Debian 13 |
| Ubuntu 24.04.3+ (HWE) | Yes | `linux-generic-hwe-24.04` → 6.14 or later |
| Ubuntu 24.04.2 (HWE) | No | Its HWE kernel is 6.11 - update to the current HWE kernel |
| Ubuntu 24.04 (GA) | No | Ships 6.8 - move to the HWE kernel |
| Ubuntu 22.04 | No | The HWE kernel stops at 6.8 |
| RHEL 10 / Rocky Linux 10 | Yes | Ships 6.12 |
| RHEL 9.x / Rocky 9.x | No | Ships 5.14 - requires ELRepo `kernel-ml` 6.12+ |
| Alpine 3.21+ | Yes | `linux-lts` is 6.12 |
| Alpine 3.20 and earlier | No | `linux-lts` 6.6 is below the floor |
| Fedora 41+ | Yes | Kernel updates keep released Fedora on current stable |
| Arch Linux | Yes | Rolling |
| NixOS | Yes, with `linuxPackages_latest` | The default LTS kernel may be below 6.12 |
| Talos Linux 1.9+ | Yes | Ships 6.12; Talos 1.8 ships 6.6 |

### Managed Node Images

A managed cluster decides the node kernel, so the question is which node image
the provider runs and what the operator can turn to reach 6.12. The agent
refuses to start below the floor and says which kernel it found, so a node that
is out says so at startup rather than loading half its programs.

| Provider and node image | Supported | Kernel | The operator's lever |
|-------------------------|-----------|--------|----------------------|
| GKE, Container-Optimized OS milestone 125 and later | Yes | 6.12 | The cluster version: COS has no package manager, so the node image follows the GKE version and nothing else |
| GKE, Container-Optimized OS milestones 121, 117 and 113 | No | 6.6, 6.6 and 6.1 | Upgrade the cluster to a version whose default COS image is milestone 125 or later |
| GKE, Ubuntu node images | Where the image's kernel is 6.12 or later | Per image | The node image version, chosen per node pool; read `uname -r` on one node before rolling out |
| EKS, Amazon Linux 2023, Kubernetes 1.33 and later | Yes | 6.12 | The Kubernetes version of the node group; AL2023's parallel kernel streams and a custom AMI built from `awslabs/amazon-eks-ami` are both supported ways to choose a newer kernel |
| EKS, Amazon Linux 2023, Kubernetes 1.31 and 1.32 | No | 6.1 | Upgrade the node group, or build a custom AMI on a newer AL2023 kernel stream |
| EKS, Bottlerocket `aws-k8s-1.33` and later variants | Yes | 6.12 | The variant, which follows the Kubernetes version |
| EKS, Bottlerocket `aws-k8s-1.32` and earlier variants | No | 6.1 | Move the node group to a 1.33 or later variant |
| AKS, every current node image | No | Azure Linux 3.0 is 6.6, Ubuntu 22.04 is 5.15, Ubuntu 24.04 is 6.8 | None today: a standard node pool accepts no node image of your own, so the agent does not run on AKS |

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
