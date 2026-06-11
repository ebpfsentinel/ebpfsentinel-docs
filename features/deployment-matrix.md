# Feature Deployment Matrix

> **Edition: OSS** | **Status: Shipped**

## Overview

Not all eBPFsentinel features work equally in every deployment mode. eBPF programs hook into kernel interfaces (XDP, TC) and process namespaces (uprobe), which imposes constraints depending on how the agent is deployed.

This page documents which features are fully supported, partially supported, or unsupported in each deployment mode.

## Deployment Modes

| Mode | Description | Network Namespace | Process Namespace |
|------|-------------|-------------------|-------------------|
| **Bare metal / VM** | Agent binary runs directly on the host | Host | Host |
| **Container** | `docker run --network host`, rootless via a BPF token (no `CAP_BPF` / `--privileged`); a privileged init service mounts the delegated bpffs | Host (shared) | Container (isolated) |
| **Kubernetes DaemonSet** | One DaemonSet pod per node with `hostNetwork: true`, a BPF-token init container, and a `CAP_NET_RAW` agent container | Host (shared) | Pod (isolated unless `hostPID: true`) |
| **Sidecar** | Agent runs alongside an application in the same pod | Pod (isolated) | Pod (isolated) |

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

**Requirements**: kernel 6.9+ with a BPF token (the only loading path; a privileged helper mounts the delegated bpffs, the agent process then needs no `CAP_BPF` — only feature-scoped `CAP_NET_RAW` for pcap capture and `CAP_NET_ADMIN` for conntrack flow-kill / Multi-WAN); `--network host` (container), `hostNetwork: true` (Kubernetes).

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
  initContainers:
    - name: bpf-token-setup      # mounts the delegated bpffs (privileged)
      securityContext:
        privileged: true
  containers:
    - name: agent
      securityContext:
        capabilities:
          drop: [ALL]
          add:
            - NET_RAW            # pcap capture only; eBPF loads via the BPF token
```

> **Note:** `hostPID: true` is required for full DLP visibility. With the
> BPF token (default) the agent container needs only `CAP_NET_RAW`.

### Multi-WAN Routing

Multi-WAN routing manages gateway selection with health checks (ICMP/TCP probes). It requires access to the **host routing table** to apply policy routing decisions.

- **Bare metal / Container** (`--network host`, `CAP_NET_ADMIN`): full support. The container shares the host network namespace and has direct access to `ip route` / `ip rule`.
- **K8s DaemonSet** (`hostNetwork: true`): **full support** — the pod shares the host network namespace, same as Docker host mode. Gateway health checks and policy routing (`ip rule add`) work correctly. The BPF token covers only eBPF syscalls, so this feature additionally needs `CAP_NET_ADMIN` on the agent container (it manipulates the host routing table via netlink) — add it to the token deployment's `capabilities.add` when Multi-WAN is enabled.

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
is no capability-based loading path. A privileged helper (systemd
`ExecStartPre` / K8s init container) mounts a delegated bpffs; the agent
process then creates a `BPF_TOKEN_CREATE` fd and loads every program
through it, so it runs with **no `CAP_BPF` / `CAP_SYS_ADMIN`** — only
feature-scoped `CAP_NET_RAW` (`libpcap` capture, `POST /api/v1/captures/manual`)
and `CAP_NET_ADMIN` (conntrack flow-kill, Multi-WAN). This is what the systemd unit
(`dist/ebpfsentinel.service`) and the Helm chart ship.

### Capability fallback

If the bpffs cannot be delegated, set
`agent.bpf_token.fallback_allow_capabilities: true` and grant the scoped
capability set instead (drop `ALL`, then add):

| Capability | Used for |
|------------|----------|
| `CAP_BPF` | Loading eBPF programs and creating BPF maps |
| `CAP_NET_ADMIN` | XDP / TC attach (also covers Multi-WAN `ip rule` updates) |
| `CAP_SYS_ADMIN` | perf/uprobe events and eBPF ops not split into `CAP_BPF`/`CAP_PERFMON` across the full program set |
| `CAP_NET_RAW` | `libpcap` packet capture |

`CAP_SYS_ADMIN` is broad, which is the reason the token path is the
default. See the
[Kubernetes deployment guide](../operations/deployment/kubernetes.md#kernel-version-matrix)
for the kernel-version matrix.

## Recommendations

| Deployment Goal | Recommended Mode |
|----------------|-----------------|
| Full host/VM protection (all features) | Bare metal binary |
| Containerized with full coverage | Container with a BPF token (`CAP_NET_RAW`) + `--network host --pid host` |
| Kubernetes cluster-wide protection | DaemonSet with `hostNetwork: true`, `hostPID: true`, BPF-token init container |
| Per-pod application DLP only | Sidecar (limited to pod scope) |

For production Kubernetes deployments, use the **DaemonSet** pattern with `hostPID: true` for full feature coverage including DLP, and enable the Kubernetes metadata enricher for workload-aware alerts. See the [Kubernetes deployment guide](../operations/deployment/kubernetes.md) for the complete manifest.
