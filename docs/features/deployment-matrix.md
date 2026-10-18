# Feature Deployment Matrix

> **Edition: OSS**

## Overview

Not all eBPFsentinel features work equally in every deployment mode. eBPF programs hook into kernel interfaces (XDP, TC) and process namespaces (uprobe), which imposes constraints depending on how the agent is deployed.

This page documents which features are fully supported, partially supported, or unsupported in each deployment mode.

## Deployment Modes

| Mode | Description | Network Namespace | Process Namespace |
|------|-------------|-------------------|-------------------|
| **Bare metal / VM** | Agent binary runs directly on the host | Host | Host |
| **Container** | Two containers with `network_mode: host`: the `warden` broker holds the host capabilities, the agent runs as uid 65534 with `cap_drop: [ALL]` (see `docker-compose.yml`) | Host (shared) | Container. The shipped compose file sets no `pid: host`; both containers read the node's processes through the read-only `/proc:/host/proc:ro` mount (`EBPFSENTINEL_HOST_PROC`) |
| **Kubernetes DaemonSet** | One pod per node with `hostNetwork: true`; the warden is a native sidecar (init container with `restartPolicy: Always`) holding the capabilities, the agent container runs as uid 65534 with every capability dropped | Host (shared) | Pod. `daemonset.hostPID` defaults to `false`; the node's processes are read through the same `/host/proc` mount |
| **Sidecar** | Agent runs alongside an application in the same pod | Pod (isolated) | Pod (isolated) |

In both the Container and DaemonSet modes the agent holds **no host
capability**. It unshares its own user namespace, has the warden delegate a
bpffs into it, creates a BPF token there and loads every program through it.
What a user namespace cannot do against the host (conntrack teardown, route
programming, gratuitous ARP, packet capture, cross-container uprobe links) is
brokered to the warden over a Unix socket. See the
[BPF token guide](../operations/deployment/bpf-token.md#the-warden-broker).

## Compatibility Matrix

Every row is a claim about one code path, and the path is named beside it so a
reader can check the claim rather than believe it (see
[How this matrix is maintained](#how-this-matrix-is-maintained)). Paths are
relative to the agent repository unless they start with `../`.

| Feature | Bare Metal / VM | Container | K8s DaemonSet | Sidecar | Proven by |
|---------|:-:|:-:|:-:|:-:|---|
| **Stateful Firewall** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | `crates/ebpf-programs/xdp-firewall` |
| **NAT** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | `crates/ebpf-programs/tc-nat-ingress`, `tc-nat-egress` |
| **Conntrack** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | `crates/ebpf-programs/tc-conntrack` |
| **Rate Limiting** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | `crates/ebpf-programs/xdp-ratelimit` |
| **DDoS Mitigation** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | `crates/ebpf-programs/xdp-ratelimit-syncookie` |
| **L4 Load Balancer** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | `crates/ebpf-programs/xdp-loadbalancer` |
| **Packet Scrubbing** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :x: | `crates/ebpf-programs/tc-scrub` |
| **IDS/IPS** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: | `crates/ebpf-programs/tc-ids` |
| **Threat Intelligence** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: | `crates/ebpf-programs/tc-threatintel` |
| **DNS Intelligence** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: | `crates/ebpf-programs/tc-dns` |
| **L7 Firewall** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :warning: | `crates/ebpf-programs/tc-ids` (`L7_PORTS`) |
| **DLP** | :white_check_mark: | :white_check_mark:\*\* | :white_check_mark:\*\* | :warning: | `crates/ebpf-programs/uprobe-dlp`, `crates/adapters/src/ebpf/dlp_attach.rs` |
| **Container Resolver** (OSS) | :white_check_mark: | :white_check_mark:\*\* | :white_check_mark:\*\* | :warning: | `crates/adapters/src/container/proc_resolver.rs`, `cgroupfs_resolver.rs` |
| **Docker Enricher** (OSS) | :warning: | :white_check_mark: | :warning: | :x: | `crates/adapters/src/container/docker_events.rs`, `docker_enricher.rs` |
| **Kubernetes Enricher** (OSS) | :x: | :x: | :white_check_mark: | :warning: | `crates/adapters/src/container/k8s_enricher.rs` |
| **Extended TLS DLP** (Enterprise) | :white_check_mark: | :white_check_mark:\*\* | :white_check_mark:\*\* | :warning: | `../ebpfsentinel-enterprise/crates/enterprise-adapters/src/proc_tls_scanner.rs` |
| **Multi-WAN Routing** | :white_check_mark: | :white_check_mark: | :white_check_mark:\* | :x: | `crates/application/src/routing_service_impl.rs`, brokered by `crates/warden/src/net_ops.rs` |
| **Alert Pipeline** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | `crates/application/src/alert_pipeline.rs` |
| **Prometheus Metrics** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | `crates/adapters/src/metrics.rs` |
| **REST API / gRPC** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | `crates/agent/src/http/router.rs`, `crates/adapters/src/grpc/` |
| **CLI** | :white_check_mark: | :white_check_mark: | :white_check_mark: | :white_check_mark: | `crates/agent/src/cli.rs` |

:white_check_mark: = fully supported | :warning: = partially supported (see details below) | :x: = not supported | \* = see CNI compatibility note | \*\* = needs the node's `/proc` mounted read-only at `/host/proc` (`EBPFSENTINEL_HOST_PROC`), which the shipped Compose file and the Helm chart both do. **Not** `pid: host` or `hostPID: true`: the uprobe is created against a path and an offset with pid 0, and the resolver reads a path.

Three rows are qualified rather than ticked, and the qualification is the
point:

- **Docker Enricher, bare metal** - the enricher is not Kubernetes-only and not
  container-only: it reads `/var/run/docker.sock`, so an agent installed as a
  systemd unit on a host running Docker enriches that host's containers. It is
  a warning rather than a tick because the socket is not there on a host that
  runs no Docker.
- **Docker Enricher, DaemonSet** - the Helm chart mounts no Docker socket, and
  a node running containerd or CRI-O has none to mount. The resolver still
  names the container id; name, image and labels are what is missing.
- **Container Resolver** - it reads `/proc/<pid>/cgroup` and the cgroup
  hierarchy, so a containerised agent needs both the `/host/proc` mount and
  `/sys/fs/cgroup` read-only, which is what the Compose file and the chart
  mount.

### What the node itself reports

The three container rows above are the ones a customer can check against the
running agent rather than against this page. `GET /api/v1/agent/status` carries
a `container_coverage` object, and `ebpfsentinel-agent status` prints it as one
line:

```json
{
  "container_coverage": {
    "proc_root": "/host/proc",
    "host_proc": true,
    "resolver": true,
    "docker": "on",
    "kubernetes": "off_not_in_cluster"
  }
}
```

| Field | Matrix row it answers |
|-------|----------------------|
| `proc_root`, `host_proc` | The `\*\*` footnote: the node's procfs is mounted, so DLP and the resolver see every process rather than the agent's own |
| `resolver` | **Container Resolver** |
| `docker` | **Docker Enricher** - `on`, `off_no_socket`, `off_by_configuration` |
| `kubernetes` | **Kubernetes Enricher** - `on`, `off_not_in_cluster`, `off_unavailable`, `off_by_configuration`, `off_not_built` |

`starting` means the agent has not finished building its enrichers yet. A
verdict that disagrees with the row above is a bug in this page, not in the
node.

## Detailed Explanations

### XDP/TC Programs (Firewall, NAT, Conntrack, Rate Limiting, DDoS, Load Balancer, Scrub)

These programs attach to **host network interfaces** (e.g., `eth0`). They require access to the host network namespace to see all traffic entering and leaving the machine. **Multi-NIC is fully supported**: configure `agent.interfaces: [eth0, eth1, ...]` and every eBPF program attaches to each listed interface. Bond masters (`bond0`), team devices, and VLAN trunk parents are all valid targets - see the [agent configuration guide](../configuration/agent.md#multi-nic-and-bond-interfaces) for details.

- **Bare metal / Container / DaemonSet**: the agent sees the host's physical interfaces and can filter all traffic at wire speed across all listed NICs.
- **Sidecar**: the agent only sees the pod's virtual interface (`eth0` inside the pod network namespace). It cannot protect the host or other pods, and its scope is limited to the pod's own traffic.

**Requirements**: kernel 6.9+ with a BPF token (the only loading path; the agent creates it in its own user namespace on a bpffs the warden delegates, and holds no host capability); `network_mode: host` (container), `hostNetwork: true` (Kubernetes).

### Node traffic or container-to-container traffic

A DaemonSet or a host-network container protects the **node** by default: the
programs sit on the interfaces listed in `agent.interfaces`, so they see what
enters and leaves the machine. Traffic between two pods on the same node never
crosses those interfaces. What can be brought down to one container depends on
the hook:

| Hook | Programs | Per container | How |
|------|----------|:-:|-----|
| XDP | firewall, reject, rate limiting, DDoS, SYN cookies, load balancer, VIP announcer | :x: | Node NIC only. XDP runs before the kernel builds a packet buffer, which is only meaningful on a physical or bond interface. |
| TC | IDS/IPS, threat intelligence, DNS, conntrack, NAT, scrub, QoS | :white_check_mark: | Attached to the container's host-side interface (netkit or veth), see below |
| uprobe | DLP | :white_check_mark: | Attached to the TLS library mapped by each process, see [DLP](#dlp-data-loss-prevention) |

**netkit (Kubernetes, Cilium 1.16+ in netkit mode).** With
`agent.attach_mode: auto` (the default) or `netkit`, the agent watches for
netkit devices and attaches the TC chain to every pod automatically:

- the ingress chain (IDS, threat intelligence, DNS, conntrack, NAT ingress,
  scrub, QoS ingress) runs on traffic going **into** the pod, the egress chain
  (IDS when `ids.inspect_egress` or the container resolver is on, NAT egress,
  QoS) on traffic coming **out** of it, each in the same order as on a node NIC;
- pods already running when the agent starts are covered on the first poll,
  new pods within one poll cycle;
- the links are released when the pod is deleted, so pod churn does not leak
  program references;
- an interface also listed in `agent.interfaces` is left alone, so nothing is
  attached twice.

The watcher does not run with `attach_mode: tc`.

**veth (Docker, Calico, Flannel and every other veth-based CNI).** There is no
automatic discovery: list the host-side interfaces in `agent.interfaces` to put
the TC chain on them. For Docker, listing the bridge (`docker0`, or a
`br-<id>` user network) covers every container attached to it; a single
container's `veth<id>` covers that container only, and its name changes when the
container is recreated.

Container attribution is independent of the interface: the container resolver
maps each packet's cgroup id (read on the TC egress hook) to its container or
pod, so alerts carry the workload even when the chain sits on the node NIC.

### Namespace scope

A firewall rule's `scope` can be `global`, an interface, or
`{ namespace: <name> }`. The namespace is an **eBPFsentinel namespace**, not a
Linux network namespace and not a Kubernetes namespace: it is the ownership
label that role-based access checks against the `namespaces` claim of an
`operator` identity (see [Authentication](authentication.md)). It is not tied
to one interface, so one NIC can carry traffic governed by several namespaces,
each owned by a different team. What a namespace rule matches is set by its own
fields (addresses, ports, protocol, VLAN, `interfaces` groups), never by the
namespace name. What keeps an operator's rule on their own team's traffic is
the [`namespaces`](../configuration/namespaces.md) section: it binds each
namespace to CIDRs, and a rule an operator writes must match a source or
destination inside them.

### IDS/IPS, Threat Intelligence, DNS Intelligence, L7 Firewall

These TC classifier programs also attach to host interfaces but generate **events** rather than enforcing inline (except IPS blacklisting). In sidecar mode, they only see traffic entering and leaving the pod.

- **Sidecar limitation**: detects attacks targeting the pod but misses east-west traffic between other pods and host-level attacks. IPS blacklisting only affects the pod's own interface.

### DLP (Data Loss Prevention)

DLP uses **uprobes** that attach to `SSL_write` and `SSL_read` in any mapped
`libssl.so` or `libboringssl.so`, which covers dynamically-linked OpenSSL and
dynamically-linked BoringSSL. `libcrypto` is deliberately not a target: it
carries the primitives, not the `SSL_*` record functions. Unlike network
hooks, uprobes target **processes**, not interfaces.

| Mode | Behavior |
|------|----------|
| **Bare metal** | Attaches to all host processes mapping a matching SSL library. Full visibility. |
| **Container** (`/proc` mounted at `/host/proc`) | Attaches to every process on the node, in any container. Full visibility with container-level enrichment. This is what `docker-compose.yml` ships. |
| **Container** (no `/host/proc` mount) | Only attaches to processes inside the container: the scan has no other procfs to walk. |
| **K8s DaemonSet** (`/host/proc` mounted) | Attaches to every process on the node. Full visibility with pod-level enrichment (see below). This is what the Helm chart ships, with `daemonset.hostPID` left `false`. |
| **K8s DaemonSet** (no `/host/proc` mount) | Only attaches to processes inside the pod. |
| **Sidecar** | Only attaches to processes in the same pod. Can inspect the application's TLS traffic if it links a matching SSL library dynamically in the same shared PID namespace. |

**Container/pod enrichment**: DLP events carry `cgroup_id` (via `bpf_get_current_cgroup_id` in the uprobe), which the container resolver maps to the owning container or pod. Combined with the Docker enricher or Kubernetes metadata enricher, every DLP alert includes container/pod name, namespace, and labels - enabling per-workload DLP policy enforcement.

**Key constraint (OSS)**: the uprobe needs a shared object to attach to, so a
runtime that manages TLS internally is not intercepted - Go's `crypto/tls`,
Java's JSSE, and a proxy like Envoy that links BoringSSL statically rather
than mapping `libboringssl.so`.

**Enterprise extends this coverage** via additional uprobe targets - Go `crypto/tls`, Java JSSE, BoringSSL (statically linked), kTLS (kernel TLS), GnuTLS, wolfSSL, mbedTLS, s2n-tls and NSS - so applications that don't link OpenSSL are still seen. Go `crypto/tls`, GnuTLS, wolfSSL, mbedTLS, s2n-tls and statically linked BoringSSL are probed and their plaintext scanned, and kTLS is read kernel-side rather than through an image; Java JSSE and NSS are discovered and reported only. See [Enterprise DLP: Extended TLS Library Coverage](enterprise/dlp.md#extended-tls-library-coverage).

**Across containers**, the agent finds each process's library through the
host `/proc` mounted at `/host/proc` (`EBPFSENTINEL_HOST_PROC`), and the warden
creates the uprobe link against `/host/proc/<pid>/root/<lib>` (it holds
`SYS_PTRACE`, `BPF` and `PERFMON` for that). New processes are picked up as they
start, and each event's `cgroup_id` names the container it came from.

**Recommended K8s deployment** for full DLP coverage, as the Helm chart renders
it (trimmed). There is no `hostPID` here: `daemonset.hostPID` defaults to
`false` and the host-procfs mount is what carries the coverage.

```yaml
spec:
  hostNetwork: true
  initContainers:
    - name: warden                 # native sidecar: starts first, lives with the pod
      restartPolicy: Always
      args: ["serve", "/run/ebpfsentinel/warden.sock", "--uid", "65534"]
      securityContext:
        runAsUser: 0
        capabilities:
          drop: [ALL]
          add: [SYS_ADMIN, NET_ADMIN, NET_RAW, SYS_PTRACE, BPF, PERFMON]
      volumeMounts:
        - { name: warden-sock, mountPath: /run/ebpfsentinel }
        - { name: host-proc, mountPath: /host/proc, readOnly: true }
  containers:
    - name: agent
      args: ["--config", "/etc/ebpfsentinel/config.yaml"]
      env:
        - { name: EBPFSENTINEL_WARDEN_SOCK, value: /run/ebpfsentinel/warden.sock }
        - { name: EBPFSENTINEL_HOST_PROC, value: /host/proc }
      securityContext:
        runAsUser: 65534
        allowPrivilegeEscalation: true   # the agent unshares its own user namespace
        capabilities:
          drop: [ALL]
      volumeMounts:
        - { name: warden-sock, mountPath: /run/ebpfsentinel, readOnly: true }
        - { name: host-proc, mountPath: /host/proc, readOnly: true }
        - { name: cgroup, mountPath: /sys/fs/cgroup, readOnly: true }
```

> **Note:** the read-only `/host/proc` mount on **both** containers is what
> gives full DLP visibility; the host pid namespace is not needed and
> `daemonset.hostPID` stays `false`. Both containers run with `Unconfined`
> AppArmor and seccomp profiles, which the user-namespace unshare and the
> bpffs delegation need.

### Multi-WAN Routing

Multi-WAN routing manages gateway selection with health checks (ICMP/TCP probes). It requires access to the **host routing table** to apply policy routing decisions.

- **Bare metal / Container** (`network_mode: host`): full support. The route changes go through the warden, which holds `CAP_NET_ADMIN` in the host network namespace.
- **K8s DaemonSet** (`hostNetwork: true`): the agent runs in its own user namespace, which is never privileged over the host network namespace, so it cannot program routes itself. The route changes are sent to the warden, which holds `CAP_NET_ADMIN` in the host network namespace and applies them over netlink (same path as `conntrack -D` flow teardown; see the [BPF token capability matrix](../operations/deployment/bpf-token.md#capability-matrix)).

  > **CNI compatibility note**: eBPFsentinel adds policy routes (`ip rule`) to the host routing table. Most CNIs are unaffected because they use separate routing tables or eBPF-based routing:
  > - **Flannel, Calico (iptables mode), kube-router**: compatible - these use standard routing tables that don't conflict with policy routing rules.
  > - **Cilium (eBPF routing mode)**: compatible - Cilium uses eBPF for pod routing and doesn't rely on `ip rule`.
  > - **Calico (BGP mode)**: test before production - Calico BGP injects routes into the default table. Policy routing rules take precedence (`ip rule` is evaluated before the main table), so conflicts are unlikely but environment-specific.
  >
  > If in doubt, run `ip rule list` and `ip route show table all` on a node to check for overlapping rules before enabling multi-WAN.

- **Sidecar**: not supported - the pod has an isolated network namespace and cannot modify the host routing table.

### Userspace-Only Features (Alert Pipeline, Metrics, API, CLI)

These features have no kernel dependency. They work in all deployment modes as long as the agent process is running and the relevant eBPF programs are loaded (metrics read eBPF map counters).

### Container Awareness (Resolver, Docker, Kubernetes)

Container awareness enriches every alert with the workload that
generated it. It is composed of three OSS building blocks that attach
independently after the packet pipeline.

| Block | Requires | Notes |
|-------|----------|-------|
| **Container Resolver** | read access to host `/proc` (bind-mount `/proc:/host/proc:ro` when containerised) | Works anywhere a process is reachable via `/proc/{pid}/cgroup`; sidecar mode sees only pods in the shared PID namespace |
| **Docker Enricher** | `/var/run/docker.sock:/var/run/docker.sock:ro` bind-mount, mounted and enabled by the shipped `docker-compose.yml` | With the socket, the `/events` stream names a container created after the agent started, and the inspect is the fallback. Without it, the enricher says so once at startup and every alert keeps the resolver's container id while losing name, image and labels |
| **Kubernetes Enricher** | in-cluster service account with `pods` `get/list/watch` | Auto-disables when `KUBERNETES_SERVICE_HOST` is absent; not useful on bare metal |

See the full reference at [Container Awareness](container-awareness.md).

## Loading mode: BPF token (default)

The agent requires **kernel 6.9+** and loads eBPF **exclusively** through
[**BPF token delegation**](../operations/deployment/bpf-token.md) - there
is no capability-based loading path. The agent unshares its own user
namespace, the warden (which holds `CAP_SYS_ADMIN`) mounts a bpffs with the
`delegate_*` options for it, and the agent creates a `BPF_TOKEN_CREATE` fd
there and loads every program through it. The long-running agent holds **no
host capabilities** at all. This is what the systemd units, the Compose file
and the Helm chart ship.

Because the agent runs in its own user namespace, host-netns operations are
brokered to the warden in the init network namespace: `conntrack -D` teardown,
Multi-WAN route application, gratuitous ARP on VIP takeover, and pcap capture
(the warden opens the `AF_PACKET` sockets and passes the fds). The in-kernel
equivalents (conntrack-timeout flow-kill, `xdp-vip-announcer`) cover the eBPF side.
See the [capability matrix](../operations/deployment/bpf-token.md#capability-matrix).

### When the token cannot be created

There is **no capability-based fallback**. If the bpffs cannot be delegated
(the node disallows unprivileged user namespaces, AppArmor restricts them, or
the runtime / PSA level blocks the warden's `CAP_SYS_ADMIN`), the agent starts in **API-only mode**
with no eBPF attached (`ebpfsentinel_bpf_token_used` reads `0`). The fix is
cluster runtime config, not a capability set.

`CAP_SYS_ADMIN` is broad, which is why it sits in the warden, a small broker
with no API and no parser, rather than in the agent. See the
[Kubernetes deployment guide](../operations/deployment/kubernetes.md#kernel-version-matrix)
for the kernel-version matrix.

## Recommendations

| Deployment Goal | Recommended Mode |
|----------------|-----------------|
| Full host/VM protection (all features) | Bare metal binary |
| Containerized with full coverage | Container, warden + agent from `docker-compose.yml` (`network_mode: host`, `/proc:/host/proc:ro` on both, no `pid: host`) |
| Kubernetes cluster-wide protection | DaemonSet with `hostNetwork: true` and the `/host/proc` mount, warden sidecar (Helm chart defaults) |
| Pod-to-pod inspection on the same node | DaemonSet with `attach_mode: auto` on a netkit CNI, or the veth interfaces listed in `agent.interfaces` |
| Per-pod application DLP only | Sidecar (limited to pod scope) |

For production Kubernetes deployments, use the **DaemonSet** pattern as the
chart renders it - `hostNetwork: true`, the warden sidecar, the `/host/proc`
mount and `hostPID` left `false` - for full feature coverage including DLP, and
enable the Kubernetes metadata enricher for workload-aware alerts. See the
[Kubernetes deployment guide](../operations/deployment/kubernetes.md) for the
complete manifest.

## How this matrix is maintained

A row here is a claim about a code path, not a summary of a deployment guide.
The **Proven by** column names that path, and the rule for changing anything on
this page is the same in both directions:

1. **A cell changes when its code path changes.** Deleting or moving the path
   named in a row means re-reading the row in the same change: somebody working
   in `crates/` can grep this file for the path they are about to move and find
   the sentence that is about to become false.
2. **A cell is a tick, a qualification or a cross - never a hope.** A tick says
   the path runs in that mode today. A `:warning:` says it runs with a stated
   condition, and the condition is written under the table rather than left in
   a footnote marker. A `:x:` says the path cannot run there at all. A
   capability that is planned does not get a row.
3. **A footnote names the mechanism, not the flag somebody used to need.** The
   `\*\*` footnote says what has to be mounted, which is what the code reads;
   it stopped naming `pid: host` when the uprobe stopped needing a pid.
4. **Where the node can answer, the node wins.** The container rows are
   reported by `GET /api/v1/agent/status`
   ([above](#what-the-node-itself-reports)), so a disagreement between this page
   and a running agent is resolved against the agent and fixed here.

The deployment guides ([Docker](../operations/deployment/docker.md),
[Kubernetes](../operations/deployment/kubernetes.md)) and the website's install
page describe the same shipped files; a change to the Compose file or the chart
is expected to move all three.
