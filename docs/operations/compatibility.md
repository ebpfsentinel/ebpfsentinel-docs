# Compatibility

## Platform

**Linux only.** Requires kernel **6.12+** with BTF support.

Not supported: macOS, Windows, FreeBSD (no Linux eBPF subsystem).

The 6.12 floor is the kernel the managed node images converge on (GKE Container-Optimized OS, EKS Amazon Linux 2023, Ubuntu's HWE line). Everything the agent needs is older:
**`BPF_TOKEN_CREATE` + `BPF_F_TOKEN_FD`** (kernel 6.9) is how the agent loads
its programs without holding `CAP_BPF` or `CAP_SYS_ADMIN` itself, and the
kfuncs the programs call arrived by 6.8. The 6.12 file kfuncs exist on every
supported kernel but load only in a sleepable context behind the BPF LSM, so
they are probed rather than assumed.

## Distributions

What matters is the running kernel, not the release: any distribution booting
6.12 or later with BTF (`/sys/kernel/btf/vmlinux`) works.

| Distribution | Supported | Notes |
|-------------|-----------|-------|
| Debian 13+ | Yes | Ships 6.12 |
| Debian 12 | Yes, with the backports kernel | Ships 6.1; `apt install -t bookworm-backports linux-image-amd64` installs 6.12 |
| Ubuntu 26.04 LTS | Yes | Ships 7.0 |
| Ubuntu 24.04 with the HWE kernel | Yes | `linux-generic-hwe-24.04` is 7.0 since 24.04.5 (6.17 in 24.04.4, 6.14 in 24.04.3); any 24.04 host kept up to date gets it, whatever point release it was installed from |
| Ubuntu 24.04 on its GA kernel | No | Ships 6.8 - `apt install linux-generic-hwe-24.04` and reboot |
| Ubuntu 22.04 | No | The HWE kernel stops at 6.8 |
| RHEL 10 / Rocky Linux 10 | Yes | Ships 6.12 |
| RHEL 9.x / Rocky 9.x | No | Ships 5.14 - requires ELRepo `kernel-ml` 6.12+ |
| Alpine 3.21+ | Yes | `linux-lts` is 6.12 |
| Alpine 3.20 and earlier | No | `linux-lts` 6.6 is below the floor |
| Fedora 41+ | Yes | Kernel updates keep released Fedora on current stable |
| Arch Linux | Yes | Rolling |
| NixOS 25.05+ | Yes | The default kernel is 6.12 or later |
| NixOS 24.11 and earlier | With `linuxPackages_latest` | The default kernel is 6.6 |
| Talos Linux 1.9+ | Yes | Ships 6.12; Talos 1.8 ships 6.6 |

## Managed Node Images

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
| AKS, Ubuntu 26.04 node images | Yes | 7.0 | The node pool's OS SKU: in preview from Kubernetes 1.36, and what the `Ubuntu` SKU defaults to from 1.38 |
| AKS, Ubuntu 24.04 node images | Where the image's kernel is 6.12 or later | Per image | Canonical moved the 24.04 `linux-azure` kernel to 7.0, but the node image decides what a node boots: read `uname -r` on one node before rolling out, or move the pool to Ubuntu 26.04 |
| AKS, Azure Linux 3.0 and Ubuntu 22.04 node images | No | 6.6 and 5.15 | Move the node pool to Ubuntu 26.04 |

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
| Agent | `65534` | `cap_drop: ALL`; AppArmor unconfined; seccomp either unconfined or the tailored profile `ebpfsentinel-agent.json`, a release asset |

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
| Docker Compose | `compose.yaml`, a release asset beside the seccomp profile it names: warden and agent services, `network_mode: host`. See [Docker](deployment/docker.md#docker-compose) |

## Kernel Feature Matrix

All features require kernel **6.12+**, the agent's floor. Here is when each eBPF feature the agent relies on became available:

| Feature / Helper | Kernel | Used By |
|-----------------|--------|---------|
| `BPF_TOKEN_CREATE` + `BPF_F_TOKEN_FD` | 6.9+ | Loading every program without `CAP_BPF` in the agent |
| `BPF_MAP_TYPE_ARENA` + `bpf_arena_alloc_pages` | 6.9+ | Not used - evaluated for zero-copy delivery, unusable on the `bpfel` target (verifier rejects the untyped arena pointer; alloc kfunc is sleepable-only) |
| `bpf_xdp_metadata_rx_vlan_tag` kfunc | 6.8+ | Hardware-offloaded 802.1Q VLAN tag read in XDP |
| `bpf_xdp_get_xfrm_state` kfunc | 6.8+ | IPsec state lookup for XDP firewall rules |
| `bpf_skb_get/set_xfrm_info` kfuncs | 6.2+ | XFRM interface metadata in TC |
| `bpf_skb_get/set_fou_encap` kfuncs | 6.4+ | FOU/GUE encapsulation metadata in TC |
| `bpf_xdp_metadata_rx_hash` / `rx_timestamp` kfuncs | 6.3+ | NIC hash and hardware timestamp in XDP |
| `bpf_skb_ct_*` / `bpf_xdp_ct_*` / `bpf_ct_*` kfuncs | 5.18+ (`bpf_ct_change_timeout` 6.0+) | Kernel conntrack lookup and flow kill |
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

### Probed rather than read from the version

Four kfuncs read what a task executes and what a file carries:
`bpf_get_task_exe_file` and `bpf_put_file` take and release a task's
executable, `bpf_path_d_path` renders a path, and `bpf_get_dentry_xattr` reads
an extended attribute. The agent never assumes them from the kernel version,
because a vendor backports one and a configuration leaves another out. It asks
three questions at startup and reports each answer separately:

| Question | How it is answered |
|----------|--------------------|
| Does the kernel declare the kfunc? | Its name is a function in the kernel's own BTF |
| Does a sleepable LSM program load? | A two-instruction sleepable LSM program is loaded and closed, through the same BPF token the agent's own LSM programs use |
| Can it attach? | `bpf` is among the active security modules, the same `lsm=` condition as every LSM program |

A kfunc is usable only where all three answer yes. The kernel offers these four
to sleepable LSM programs alone, so a host that declares them and boots without
`bpf` in `lsm=` has them and can use none of them, and says so. Where the probe
itself is refused for lack of privilege, the answer is "not probed" with the
reason, never "unsupported". The answer is the `file_kfuncs` block of
[`GET /api/v1/ebpf/kernel-features`](../api-reference/rest-api.md) and the
last section of `ebpfsentinel-agent ebpf kernel-features`.

Three more facts are asked the same way although no shipped program uses them
yet, each named after the one thing it would be used for, so that the day one
is wired, whether a host offers it is already a reading rather than a kernel
version to interpret:

| Fact | Kfuncs | Would be used for | How it is confirmed |
|------|--------|-------------------|---------------------|
| `kprobe_session` | `bpf_session_is_return`, `bpf_session_cookie` | One program on a function's entry and return for the kernel TLS record path, instead of a kprobe, a kretprobe and a map correlating them | A kprobe program with the session attach type calling both kfuncs is loaded and closed |
| `copy_from_user_str` | `bpf_copy_from_user_str` | The real argument vector of a process, read at exec | A sleepable LSM program calling it is loaded and closed |
| `tcp_reqsk_assign` | `bpf_sk_assign_tcp_reqsk` | A validated SYN cookie handed to the stack as a request socket, so the stack does not revalidate a cookie it did not issue | Read from the kernel's BTF only: a call needs a listening socket looked up first, which a probe cannot honestly fake |

A load that succeeds confirms the fact; a kfunc the BTF does not declare, or a
load the verifier refuses, is a definite no with the verifier's first line as
the reason. The third is reported as declared and never as confirmed. Where
the load is refused for lack of privilege, the answer is "not probed". The
answer is the `kfunc_features` block of the same endpoint.

SYN cookies are computed by the kernel's raw syncookie helpers and the
SYN-ACK is written by `xdp-ratelimit-syncookie` and sent back with `XDP_TX`;
the socket-bound `bpf_tcp_gen_syncookie` is not used.

## Above the Floor

<!-- BEGIN GENERATED ABOVE THE FLOOR -->

Everything below is above the 6.12 floor: each entry is active only where its condition holds on the host, and its fallback runs everywhere else. The agent decides each one from a probe or an attach, never from the kernel version, and reports it in the `capabilities` block of `GET /api/v1/ebpf/kernel-features` and in `ebpfsentinel-agent ebpf kernel-features`, with the reason and the way to switch it on where it is off.

| Capability | What it unlocks | Condition | Where it is absent |
|------------|-----------------|-----------|--------------------|
| `bpf_lsm` | Programs attached at security module hooks, which is where the kernel decides a call before it happens | The BPF LSM active at boot, with bpf listed in the lsm= kernel parameter | Each capability resting on it runs its own fallback, listed beside it |
| `file_kfuncs` | A task's executable, a rendered path and a file's extended attribute read in the kernel | The BPF LSM active at boot, with bpf listed in the lsm= kernel parameter | Executables are identified by the device and inode read in userspace, and paths and attributes are read off the filesystem |
| `kprobe_session` | One program on a function's entry and return for the kernel TLS record path, instead of a kprobe, a kretprobe and a map correlating them | A kernel built with it | Nothing changes: no shipped program rests on it yet |
| `copy_from_user_str` | The real argument vector of a process, read at exec | The BPF LSM active at boot, with bpf listed in the lsm= kernel parameter | Nothing changes: no shipped program rests on it yet |
| `tcp_reqsk_assign` | A validated SYN cookie handed to the stack as a request socket, so the stack does not revalidate a cookie it did not issue | A kernel built with it | Nothing changes: no shipped program rests on it yet |
| `attribution` | The workload that opened a socket, named on every flow | Turned on in the configuration and attached on the node | Flows carry no workload name and everything else is unchanged |
| `process_tracing` | The process behind a flow or an alert, with its command line and lineage | Turned on in the configuration and attached on the node | Flows and alerts carry no process and everything else is unchanged |
| `workload_firewall` | Rules on what a named workload may connect to, send to or bind, decided in the syscall | Turned on in the configuration and attached on the node | No workload rule is enforced, and a configuration that needs one refuses to start rather than running unenforced |
| `quarantine` | A workload cut off from the network in the kernel for a bounded time | Turned on in the configuration and attached on the node | A quarantine is refused with the reason and the alert still fires |
| `process_signal` | A process stopped by a signal sent from the kernel | Turned on in the configuration and attached on the node | A signal is refused with the reason and the alert still fires |
| `immediate_signal` | A signal that reaches its target at once, even a process making no syscall | A kernel offering it, from Linux 6.13 or through a vendor backport | The signal waits for the target's next syscall, and a target making none within the window is reported as a survivor |
| `network_executables` | The list of executables allowed to reach the network, decided before the socket exists | The BPF LSM active at boot, with bpf listed in the lsm= kernel parameter | An observing list is skipped with the reason and an enforcing list refuses to start the agent |
| `write_refusal` | A write-open refused past a count, before a byte is written | The BPF LSM active at boot, with bpf listed in the lsm= kernel parameter | A fanotify permission group refuses on at most 4,096 marked inodes, and where that cannot run the mass encryption detection and its stop remain |
| `self_protection` | The agent's own maps and links refused to every other task | The BPF LSM active at boot, with bpf listed in the lsm= kernel parameter | The agent's objects are guarded only by the privilege it takes to reach them, and the node reports itself unprotected |

<!-- END GENERATED ABOVE THE FLOOR -->

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
