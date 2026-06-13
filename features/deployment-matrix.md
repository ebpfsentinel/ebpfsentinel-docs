# Feature Deployment Matrix

> **Edition: OSS** | **Status: Shipped**

## Overview

Not all eBPFsentinel features work equally in every deployment mode. eBPF programs hook into kernel interfaces (XDP, TC) and process namespaces (uprobe), which imposes constraints depending on how the agent is deployed.

This page documents which features are fully supported, partially supported, or unsupported in each deployment mode.

## Deployment Modes

| Mode | Description | Network Namespace | Process Namespace |
|------|-------------|-------------------|-------------------|
| **Bare metal / VM** | Agent binary runs directly on the host | Host | Host |
| **Container** | `docker run --network host`; the image entrypoint is the launcher, which creates the BPF token in a child userns and execs the agent unprivileged (container granted `CAP_SYS_ADMIN` for the bootstrap only) | Host (shared) | Container (isolated) |
| **Kubernetes DaemonSet** | One DaemonSet pod per node with `hostNetwork: true`; the launcher-entrypoint agent container is granted `CAP_SYS_ADMIN` + `allowPrivilegeEscalation` for the token bootstrap (no init container) | Host (shared) | Pod (isolated unless `hostPID: true`) |
| **Sidecar** | Agent runs alongside an application in the same pod | Pod (isolated) | Pod (isolated) |

> **Split-broker variant (Container / DaemonSet):** the privileged bpffs
> delegation can run in a separate small `broker` container so the long-running
> agent container runs **non-root + `cap-drop: ALL` + no `CAP_SYS_ADMIN`**. Same
> feature support as the modes above; only the privilege placement changes. See
> the [BPF token guide](../operations/deployment/bpf-token.md#split-broker-deployment-rootless-agent).

## Compatibility Matrix

| Feature | Bare Metal / VM | Container | K8s DaemonSet | Sidecar |
|---------|:-:|:-:|:-:|:-:|
| **Stateful Firewall** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **NAT** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **Conntrack** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **Rate Limiting** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **DDoS Mitigation** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **L4 Load Balancer** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **Packet Scrubbing** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **IDS/IPS** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **Threat Intelligence** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **DNS Intelligence** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **L7 Firewall** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **DLP** | :white_check_mark: | :white_check_mark:\*\* | :white_check_mark:\*\* | :warning: |
| **Container Resolver** (OSS) | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **Docker Enricher** (OSS) | :x: | :white_check_mark: | :white_check_mark: | :x: |
| **Kubernetes Enricher** (OSS) | :x: | :x: | :white_check_mark: | :warning: |
| **Extended TLS DLP** (Enterprise) | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **Multi-WAN Routing** | :white_check_mark: | :white_check_mark: | :white_check_mark:\* | :x: |
| **Alert Pipeline** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **Prometheus Metrics** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **REST API / gRPC** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **CLI** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |

:white_check_mark: = fully supported | :warning: = partially supported (see details below) | :x: = not supported | \* = see CNI compatibility note | \*\* = requires host PID namespace (`--pid=host` or `hostPID: true`)

## Detailed Explanations

### XDP/TC Programs (Firewall, NAT, Conntrack, Rate Limiting, DDoS, Load Balancer, Scrub)

These programs attach to **host network interfaces** (e.g., `eth0`). They require access to the host network namespace to see all traffic entering and leaving the machine. **Multi-NIC is fully supported**: configure `agent.interfaces: [eth0, eth1, ...]` and every eBPF program attaches to each listed interface. Bond masters (`bond0`), team devices, and VLAN trunk parents are all valid targets — see the [agent configuration guide](../configuration/agent.md#multi-nic-and-bond-interfaces) for details.

- **Bare metal / Container / DaemonSet**: the agent sees the host's physical interfaces and can filter all traffic at wire speed across all listed NICs.
- **Sidecar**: the agent only sees the pod's virtual interface (`eth0` inside the pod network namespace). It cannot protect the host or other pods. XDP attaches to veth in generic (SKB) mode since kernel 4.19 and native mode since 5.9, but the scope is limited to the pod's own traffic.

**Requirements**: kernel 6.9+ with a BPF token (the only loading path; the launcher entrypoint sets up the delegated bpffs and creates the token in a child user namespace, then execs the agent unprivileged — the long-running agent holds no host capabilities); `--network host` (container), `hostNetwork: true` (Kubernetes).

### IDS/IPS, Threat Intelligence, DNS Intelligence, L7 Firewall

These TC classifier programs also attach to host interfaces but generate **events** rather than enforcing inline (except IPS blacklisting). In sidecar mode, they only see traffic entering and leaving the pod.

- **Sidecar limitation**: detects attacks targeting the pod but misses east-west traffic between other pods and host-level attacks. IPS blacklisting only affects the pod's own interface.

### DLP (Data Loss Prevention)

DLP uses **uprobes** that attach to `SSL_write` and `SSL_read` in `libssl.so.3` (OpenSSL). Unlike network hooks, uprobes target **processes**, not interfaces.

| Mode | Behavior |
|------|----------|
| **Bare metal** | Attaches to all host processes using `libssl.so.3`. Full visibility. |
| **Container** (`--pid=host`) | Attaches to all host processes. Full visibility with container-level enrichment. |
| **Container** (no `--pid=host`) | Only attaches to processes inside the container. Limited — use `--pid=host` for production. |
| **K8s DaemonSet** (`hostPID: true`) | Attaches to all node processes. Full visibility with pod-level enrichment (see below). |
| **K8s DaemonSet** (no `hostPID`) | Only attaches to processes inside the pod. Limited — use `hostPID: true` for production. |
| **Sidecar** | Only attaches to processes in the same pod. Can inspect the application's TLS traffic if it uses `libssl.so.3` in the same shared PID namespace. |

**Container/pod enrichment**: DLP events carry `cgroup_id` (via `bpf_get_current_cgroup_id` in the uprobe), which the container resolver maps to the owning container or pod. Combined with the Docker enricher or Kubernetes metadata enricher, every DLP alert includes container/pod name, namespace, and labels — enabling per-workload DLP policy enforcement.

**Key constraint (OSS)**: if the application manages TLS internally (e.g., Go's `crypto/tls`, Java's JSSE, or a sidecar proxy like Envoy with BoringSSL), the uprobe on `libssl.so.3` will not intercept that traffic. The OSS uprobe-dlp only hooks OpenSSL's `libssl.so.3`.

**Enterprise extends this coverage** via additional uprobe targets — Go `crypto/tls`, Java JSSE, BoringSSL (statically linked), kTLS (kernel TLS), and GnuTLS — so applications that don't link OpenSSL are still scanned. See [Enterprise DLP: Extended TLS Library Coverage](enterprise/dlp.md#extended-tls-library-coverage).

**Recommended K8s deployment** for full DLP coverage (BPF token, default):

```yaml
spec:
  hostPID: true
  hostNetwork: true
  # No init container — the image entrypoint (ebpfsentinel-token-launch) creates
  # the token in a child userns and execs the agent unprivileged.
  containers:
    - name: agent
      args: ["--config", "/etc/ebpfsentinel/config.yaml"]
      securityContext:
        allowPrivilegeEscalation: true
        capabilities:
          drop: [ALL]
          add:
            - SYS_ADMIN          # launcher bootstrap only; eBPF loads via the token
```

> **Note:** `hostPID: true` is required for full DLP visibility. The agent
> container grants `CAP_SYS_ADMIN` for the launcher bootstrap; the
> long-running agent is unprivileged.

### Multi-WAN Routing

Multi-WAN routing manages gateway selection with health checks (ICMP/TCP probes). It requires access to the **host routing table** to apply policy routing decisions.

- **Bare metal / Container** (`--network host`, `CAP_NET_ADMIN`): full support. The container shares the host network namespace and has direct access to `ip route` / `ip rule`.
- **K8s DaemonSet** (`hostNetwork: true`): the pod shares the host network namespace, but policy routing (`ip rule add` / `ip route`) goes through **netlink**, which re-checks `CAP_NET_ADMIN` against the *sending* task on every message. The launcher runs the agent in a child user namespace, and a descendant namespace is never privileged over the host netns it manipulates — so adding `CAP_NET_ADMIN` to `capabilities.add` does **not** make Multi-WAN route changes take effect (same limitation as `conntrack -D` flow teardown; see the [BPF token capability matrix](../operations/deployment/bpf-token.md#capability-matrix)). Gateway health checks (ICMP/TCP probes) still run; the route application is what is constrained.

  > **CNI compatibility note**: eBPFsentinel adds policy routes (`ip rule`) to the host routing table. Most CNIs are unaffected because they use separate routing tables or eBPF-based routing:
  > - **Flannel, Calico (iptables mode), kube-router**: compatible — these use standard routing tables that don't conflict with policy routing rules.
  > - **Cilium (eBPF routing mode)**: compatible — Cilium uses eBPF for pod routing and doesn't rely on `ip rule`.
  > - **Calico (BGP mode)**: test before production — Calico BGP injects routes into the default table. Policy routing rules take precedence (`ip rule` is evaluated before the main table), so conflicts are unlikely but environment-specific.
  >
  > If in doubt, run `ip rule list` and `ip route show table all` on a node to check for overlapping rules before enabling multi-WAN.

- **Sidecar**: not supported — the pod has an isolated network namespace and cannot modify the host routing table.

### Userspace-Only Features (Alert Pipeline, Metrics, API, CLI)

These features have no kernel dependency. They work in all deployment modes as long as the agent process is running and the relevant eBPF programs are loaded (metrics read eBPF map counters).

### Container Awareness (Resolver, Docker, Kubernetes)

Container awareness enriches every alert with the workload that
generated it. It is composed of three OSS building blocks that attach
independently after the packet pipeline.

| Block | Requires | Notes |
|-------|----------|-------|
| **Container Resolver** | read access to host `/proc` (bind-mount `/proc:/host/proc:ro` when containerised) | Works anywhere a process is reachable via `/proc/{pid}/cgroup`; sidecar mode sees only pods in the shared PID namespace |
| **Docker Enricher** | `/var/run/docker.sock:/var/run/docker.sock:ro` bind-mount | Non-Docker hosts disable the enricher at startup — zero runtime cost |
| **Kubernetes Enricher** | in-cluster service account with `pods` `get/list/watch` | Auto-disables when `KUBERNETES_SERVICE_HOST` is absent; not useful on bare metal |

See the full reference at [Container Awareness](container-awareness.md).

## Loading mode: BPF token (default)

The agent requires **kernel 6.9+** and loads eBPF **exclusively** through
[**BPF token delegation**](../operations/deployment/bpf-token.md) — there
is no capability-based loading path. The privileged launcher
(`ebpfsentinel-token-launch`, the systemd `ExecStart` and the container
image entrypoint) sets up a delegated bpffs **inside a child user
namespace**, then execs the agent there; the agent creates a
`BPF_TOKEN_CREATE` fd and loads every program through it. The launcher
consumes `CAP_SYS_ADMIN` for the bootstrap; the long-running agent holds
**no host capabilities** at all. This is what the systemd unit
(`dist/ebpfsentinel.service`) and the Helm chart ship.

Because the agent runs in a child user namespace, host-netns operations
that re-check capabilities per syscall are unavailable to it — `conntrack -D`
teardown, Multi-WAN route application, and VIP gratuitous ARP — and granting
the agent extra capabilities does not change that. pcap capture is the
exception: the launcher pre-opens the `AF_PACKET` sockets (cap checked only
at `socket()`) and passes the fds. The in-kernel equivalents (IPS_DYING
flow-kill, `xdp-vip-announcer`) cover the eBPF side. See the
[capability matrix](../operations/deployment/bpf-token.md#capability-matrix).

### When the token cannot be created

There is **no capability-based fallback**. If the launcher cannot delegate
the bpffs (the node disallows unprivileged user namespaces, or the runtime
/ PSA level blocks `CAP_SYS_ADMIN`), the agent starts in **API-only mode**
with no eBPF attached (`ebpfsentinel_bpf_token_used` reads `0`). The fix is
cluster runtime config, not a capability set.

`CAP_SYS_ADMIN` is broad, which is the reason the token path is the
default. See the
[Kubernetes deployment guide](../operations/deployment/kubernetes.md#kernel-version-matrix)
for the kernel-version matrix.

## Recommendations

| Deployment Goal | Recommended Mode |
|----------------|-----------------|
| Full host/VM protection (all features) | Bare metal binary |
| Containerized with full coverage | Container, launcher entrypoint (`CAP_SYS_ADMIN` bootstrap) + `--network host --pid host` |
| Kubernetes cluster-wide protection | DaemonSet with `hostNetwork: true`, `hostPID: true`, launcher entrypoint (`CAP_SYS_ADMIN`, no init container) |
| Per-pod application DLP only | Sidecar (limited to pod scope) |

For production Kubernetes deployments, use the **DaemonSet** pattern with `hostPID: true` for full feature coverage including DLP, and enable the Kubernetes metadata enricher for workload-aware alerts. See the [Kubernetes deployment guide](../operations/deployment/kubernetes.md) for the complete manifest.
