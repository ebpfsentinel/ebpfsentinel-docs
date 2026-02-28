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
| **Packet Scrubbing** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: |
| **IDS/IPS** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **Threat Intelligence** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **DNS Intelligence** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **L7 Firewall** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: |
| **DLP** | :white_check_mark: | :warning: | :warning: | :warning: |
| **Multi-WAN Routing** | :white_check_mark: | :white_check_mark: | :warning: | :x: |
| **Alert Pipeline** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **Prometheus Metrics** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **REST API / gRPC** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |
| **CLI** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: |

:white_check_mark: = fully supported | :warning: = partially supported (see details below) | :x: = not supported

## Detailed Explanations

### XDP/TC Programs (Firewall, NAT, Conntrack, Rate Limiting, DDoS, Scrub)

These programs attach to **host network interfaces** (e.g., `eth0`). They require access to the host network namespace to see all traffic entering and leaving the machine.

- **Bare metal / Container / DaemonSet**: the agent sees the host's physical interfaces and can filter all traffic at wire speed.
- **Sidecar**: the agent only sees the pod's virtual interface (`eth0` inside the pod network namespace). It cannot protect the host or other pods. XDP attachment may also fail on virtual interfaces (veth) depending on the kernel version and CNI driver.

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

- **Bare metal / Container** (`CAP_NET_ADMIN`): full support.
- **K8s DaemonSet**: gateway health checks work, but applying routing policies to the node's routing table requires `CAP_NET_ADMIN` and may conflict with the CNI plugin.
- **Sidecar**: cannot modify the host routing table from an isolated pod network namespace.

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
