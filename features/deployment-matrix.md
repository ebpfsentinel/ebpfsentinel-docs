# Feature Deployment Matrix

> **Edition: OSS** | **Status: Shipped**

## Overview

Not all eBPFsentinel features work equally in every deployment mode. eBPF programs hook into kernel interfaces (XDP, TC) and process namespaces (uprobe), which imposes constraints depending on how the agent is deployed.

This page documents which features are fully supported, partially supported, or unsupported in each deployment mode.

## Deployment Modes

| Mode | Description | Network Namespace | Process Namespace |
|------|-------------|-------------------|-------------------|
| **Bare metal / VM** | Agent binary runs directly on the host | Host | Host |
| **Container** | `docker run --privileged --network host` | Host (shared) | Container (isolated) |
| **Kubernetes DaemonSet** | One privileged pod per node with `hostNetwork: true` | Host (shared) | Pod (isolated unless `hostPID: true`) |
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
| **DLP** | :white_check_mark: | :warning: | :warning: | :warning: |
| **Multi-WAN Routing** | :white_check_mark: | :white_check_mark: | :white_check_mark:\* | :x: |
| **Alert Pipeline** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **Prometheus Metrics** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **REST API / gRPC** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **CLI** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |

:white_check_mark: = fully supported | :warning: = partially supported (see details below) | :x: = not supported | \* = see CNI compatibility note

## Detailed Explanations

### XDP/TC Programs (Firewall, NAT, Conntrack, Rate Limiting, DDoS, Load Balancer, Scrub)

These programs attach to **host network interfaces** (e.g., `eth0`). They require access to the host network namespace to see all traffic entering and leaving the machine. **Multi-NIC is fully supported**: configure `agent.interfaces: [eth0, eth1, ...]` and every eBPF program attaches to each listed interface. Bond masters (`bond0`), team devices, and VLAN trunk parents are all valid targets — see the [agent configuration guide](../configuration/agent.md#multi-nic-and-bond-interfaces) for details.

- **Bare metal / Container / DaemonSet**: the agent sees the host's physical interfaces and can filter all traffic at wire speed across all listed NICs.
- **Sidecar**: the agent only sees the pod's virtual interface (`eth0` inside the pod network namespace). It cannot protect the host or other pods. XDP attaches to veth in generic (SKB) mode since kernel 4.19 and native mode since 5.9, but the scope is limited to the pod's own traffic.

**Requirements**: `--privileged` or `CAP_BPF` + `CAP_NET_ADMIN`, `--network host` (container), `hostNetwork: true` (Kubernetes).

### IDS/IPS, Threat Intelligence, DNS Intelligence, L7 Firewall

These TC classifier programs also attach to host interfaces but generate **events** rather than enforcing inline (except IPS blacklisting). In sidecar mode, they only see traffic entering and leaving the pod.

- **Sidecar limitation**: detects attacks targeting the pod but misses east-west traffic between other pods and host-level attacks. IPS blacklisting only affects the pod's own interface.

### DLP (Data Loss Prevention)

DLP uses **uprobes** that attach to `SSL_write` and `SSL_read` in `libssl.so.3` (OpenSSL). Unlike network hooks, uprobes target **processes**, not interfaces.

| Mode | Behavior |
|------|----------|
| **Bare metal** | Attaches to all host processes using `libssl.so.3`. Full visibility. |
| **Container** (no `--pid=host`) | Only attaches to processes inside the container. Cannot inspect TLS traffic from host processes or other containers. |
| **K8s DaemonSet** (no `hostPID`) | Only attaches to processes inside the pod. Cannot inspect TLS traffic from node processes or other pods. |
| **K8s DaemonSet** (`hostPID: true`) | Attaches to all node processes. Full visibility. |
| **Sidecar** | Only attaches to processes in the same pod. Can inspect the application's TLS traffic if it uses `libssl.so.3` in the same shared PID namespace. |

**Key constraint**: if the application manages TLS internally (e.g., Go's `crypto/tls`, Java's JSSE, or a sidecar proxy like Envoy with BoringSSL), the uprobe on `libssl.so.3` will not intercept that traffic. DLP only works when the target process links against OpenSSL's `libssl.so.3`.

To enable full DLP coverage in Kubernetes, add `hostPID: true` to the DaemonSet pod spec:

```yaml
spec:
  hostPID: true
  hostNetwork: true
  containers:
    - name: agent
      securityContext:
        privileged: true
```

### Multi-WAN Routing

Multi-WAN routing manages gateway selection with health checks (ICMP/TCP probes). It requires access to the **host routing table** to apply policy routing decisions.

- **Bare metal / Container** (`--network host`, `CAP_NET_ADMIN`): full support. The container shares the host network namespace and has direct access to `ip route` / `ip rule`.
- **K8s DaemonSet** (`hostNetwork: true`, `privileged: true`): **full support** — the pod shares the host network namespace, same as Docker host mode. Gateway health checks and policy routing (`ip rule add`) work correctly.

  > **CNI compatibility note**: eBPFsentinel adds policy routes (`ip rule`) to the host routing table. Most CNIs are unaffected because they use separate routing tables or eBPF-based routing:
  > - **Flannel, Calico (iptables mode), kube-router**: compatible — these use standard routing tables that don't conflict with policy routing rules.
  > - **Cilium (eBPF routing mode)**: compatible — Cilium uses eBPF for pod routing and doesn't rely on `ip rule`.
  > - **Calico (BGP mode)**: test before production — Calico BGP injects routes into the default table. Policy routing rules take precedence (`ip rule` is evaluated before the main table), so conflicts are unlikely but environment-specific.
  >
  > If in doubt, run `ip rule list` and `ip route show table all` on a node to check for overlapping rules before enabling multi-WAN.

- **Sidecar**: not supported — the pod has an isolated network namespace and cannot modify the host routing table.

### Userspace-Only Features (Alert Pipeline, Metrics, API, CLI)

These features have no kernel dependency. They work in all deployment modes as long as the agent process is running and the relevant eBPF programs are loaded (metrics read eBPF map counters).

## Recommendations

| Deployment Goal | Recommended Mode |
|----------------|-----------------|
| Full host/VM protection (all features) | Bare metal binary |
| Containerized with full coverage | Container with `--privileged --network host` |
| Kubernetes cluster-wide protection | DaemonSet with `hostNetwork: true`, `hostPID: true` |
| Per-pod application DLP only | Sidecar (limited to pod scope) |

For production Kubernetes deployments, use the **DaemonSet** pattern with `hostPID: true` for full feature coverage including DLP. See the [Kubernetes deployment guide](../operations/deployment/kubernetes.md) for the complete manifest.
