# Container Awareness

> **Edition: OSS (core) + Enterprise (extended TLS)**

## Overview

Container awareness enriches every network event with the container and
pod that generated it. eBPFsentinel reads `cgroup_id` from the kernel
during packet processing, resolves it to a `ContainerInfo`
(container id + runtime), and then asks a pluggable **metadata enricher**
to attach runtime-specific metadata (Docker image, Kubernetes labels,
service account, namespace, …).

When alerts are generated the enriched context rides the alert, so it is
on the webhook payload, on the REST and gRPC readings, and on every
Enterprise SIEM exporter that ships the alert whole (Splunk HEC, the S3
NDJSON archive). The exporters that map into a fixed schema - ECS,
QRadar LEEF, CEF over syslog - carry no container field, and **the audit
trail carries none either**: an audit entry is a decision with its
five-tuple and its rule, and has no field a workload identity could
travel in. SOC analysts no longer need to correlate IP addresses back to
workloads manually on the paths that do carry it - the workload identity
travels with the alert.

Container awareness is composed of seven independent building blocks:

| Block | Edition | Purpose |
|-------|---------|---------|
| Container Resolver | OSS | cgroup → `ContainerInfo` (runtime + container id) |
| Docker Enricher | OSS | Docker Engine API (image, labels, status) |
| Podman Enricher | OSS | Podman's Docker-compatible API, rootful and one runtime per rootless user (image, labels, status) |
| LXC Enricher | OSS | Proxmox CT configuration files and the Incus API (name, image, labels) |
| Guest Naming | OSS | Proxmox VM configuration files and libvirt domain status files, for each tap or macvtap device (name, id, tags) |
| Kubernetes Enricher | OSS | kube-rs pod watcher (pod, namespace, SA, owner) |
| Extended TLS Hooking | Enterprise | Discovers Go `crypto/tls`, Java JSSE, statically linked OpenSSL and BoringSSL, kTLS, GnuTLS, wolfSSL, mbedTLS, s2n-tls and NSS - background `/proc` scanner, 6 Prometheus metrics, `/api/v1/enterprise/tls-probes/*` admin API. GnuTLS, wolfSSL, mbedTLS, s2n-tls, static OpenSSL or BoringSSL and Go `crypto/tls` are attached at the resolved offsets, and kTLS on the kernel's own send and receive symbols; Java JSSE and NSS are discovered and reported without being probed. Each workload carries a published verdict - read, or not read with the reason |

Each block is opt-in: a bare-metal agent can stay lean, a Docker host
turns on the Docker enricher, a Podman host the Podman one, a Proxmox or
Incus host keeps the LXC one it starts with, a Kubernetes DaemonSet turns on the K8s
enricher (and automatically skips Docker).

## Environment Detection

The agent auto-detects its environment at startup:

| Signal | Environment |
|--------|-------------|
| `KUBERNETES_SERVICE_HOST` env var set | Kubernetes |
| `/var/run/docker.sock` mount + enricher enabled | Docker host |
| `container.podman.enabled` | Podman host, rootful and rootless |
| Otherwise | Bare metal / VM |

`container.kubernetes.enabled` and `container.docker.enabled` are
independent toggles. When both are enabled the Kubernetes enricher runs
first and the Docker enricher acts as a fallback for containers not
managed by the K8s API (e.g. kubelet sandbox containers).

## Container Resolver

The resolver walks `/proc/{pid}/cgroup`, detects the container runtime
from the cgroup path, and extracts the canonical container id.

### Supported runtimes

This table is the list of runtimes the agent supports, and the one
place it is written. The resolver gives every container its id and
runtime from the cgroup path alone; the name, image and labels come
from whichever enricher reaches that runtime.

| Runtime | Cgroup signature | Id and runtime | Name, image, labels |
|---------|------------------|:--------------:|---------------------|
| Docker | `docker-<id>`, `/docker/<id>` | ✅ | Docker enricher |
| containerd under Kubernetes | `cri-containerd-<id>` | ✅ | Kubernetes enricher (pod, namespace, labels) |
| CRI-O under Kubernetes | `crio-<id>` | ✅ | Kubernetes enricher (pod, namespace, labels) |
| Podman, rootful | `libpod-<id>` | ✅ | Podman enricher |
| Podman, rootless | `libpod-<id>` under `user@<uid>.service` | ✅ | Podman enricher, while that user's `podman.socket` is reachable - see [what a rootless runtime costs](#what-a-rootless-runtime-costs) |
| containerd or CRI-O outside Kubernetes | as above | ✅ | none: the id and the runtime only |
| LXC, Incus, LXD | `lxc.payload.<name>` | ✅ | LXC enricher, from the Incus API; the name is the cgroup's |
| Proxmox CT, older LXC | `lxc/<vmid>`, `lxc/<name>` | ✅ | LXC enricher, from the CT's configuration file |

The id of an LXC container is its name, since LXC numbers nothing else,
and an Incus instance outside the default project is `<project>_<name>`.
The monitor process LXC keeps beside each container lives in
`lxc.monitor.<name>` and stays a host process. A runtime started inside a
system container, Docker in a Proxmox CT for example, names the inner
container: the innermost runtime is the one that owns the task.

Both cgroup v1 and v2 are supported. Unknown paths resolve to
`ContainerInfo::Host` (host process, no container context).

### Cache

Resolution results are stored in an LRU cache keyed by `pid` →
`ContainerInfo`. Default capacity is 4 096 entries; the working set of
active processes is bounded by the number of processes the agent
observes packets for, so this is usually more than enough.

| Metric | Meaning |
|--------|---------|
| `ebpfsentinel_container_resolver_cache_hits_total` | Resolved via cache |
| `ebpfsentinel_container_resolver_cache_misses_total` | Resolved via `/proc` |
| `ebpfsentinel_container_resolver_errors_total` | `/proc` read failed |
| `ebpfsentinel_link_attach_gap_seconds` | Time a new workload link went without the TC chain, by link kind |
| `ebpfsentinel_link_attach_unguarded_packets_total` | Packets a new workload link carried before the TC chain was on it, by link kind |

### Configuration

```yaml
container:
  resolver:
    enabled: true          # default: true
    cache_size: 4096       # default: 4096
    proc_path: /proc        # default: /proc, set to /host/proc in containers
    cgroup_root: /sys/fs/cgroup  # default: /sys/fs/cgroup
```

## Docker Enricher

The Docker enricher connects to the Docker Engine API over a Unix socket and
keeps one LRU cache, written from two places.

`GET /v1.43/events`, filtered to container `create`, `start`, `die` and
`destroy`, stays open for the life of the agent. Every event carries the
container's id, name, image and labels, so the cache is written as the daemon
acts: a container that appears after the agent started is named on its first
alert, and one that is destroyed is dropped from the cache instead of being
served stale until the TTL runs out. The connection reconnects with a capped
backoff and the applier reads from a bounded queue, so a daemon restart or a
burst of churn costs events, never unbounded memory.

`GET /v1.43/containers/{id}/json` is what a cache miss falls back to - an id
first seen before the stream was connected, or one the stream never mentioned -
and it is the only call that learns `created_at`, so an entry written by the
stream is completed by exactly one inspect the first time it is looked up.

### Metadata fields

| Field | Description |
|-------|-------------|
| `name` | Container name (leading `/` stripped) |
| `image` | Image tag (e.g. `nginx:1.25`) |
| `labels` | Key/value pairs from `Config.Labels` |
| `created_at` | ISO-8601 creation timestamp |
| `status` | Runtime status (`running`, `exited`, …) |

### Graceful degradation

If the socket is unreachable (non-Docker host), the enricher logs a single
warning at startup, naming what alerts lose - the name, the image and the
labels, with the container id still arriving from the resolver - and returns
`None` from every lookup. A periodic re-check (default 60 s) re-enables it if
Docker later comes online. The same line is logged, as information rather than
a warning, when `container.docker.enabled` is false: an operator reading the
first page of the log is told which of the two decisions is in force.

### Configuration

```yaml
container:
  docker:
    enabled: true                         # default: false
    socket: /var/run/docker.sock
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
```

### Volume mount

When running eBPFsentinel itself inside Docker, mount the daemon socket
read-only into the container:

```bash
docker run ... -v /var/run/docker.sock:/var/run/docker.sock:ro ...
```

The shipped `docker-compose.yml` makes that mount and enables the enricher.
The mount hands the agent the Docker API, which is root on the host: `:ro`
stops writes to the socket file, not requests through it. The agent issues
GETs only and runs as uid 65534, so the socket's group ownership decides what
it may do. Removing the two lines and setting `container.docker.enabled: false`
runs without it, at the cost named under graceful degradation.

## Podman Enricher

Podman serves the Docker Engine API on its own socket, so the Podman
enricher speaks the same wire as the Docker one - the same event stream
keeps the cache current and the same inspect fills a miss - and the
alert carries the same `name`, `image` and `labels`. What differs is
how many runtimes a node has. Rootful Podman is one daemonless runtime
answering on `/run/podman/podman.sock`; every user running rootless
containers is a runtime of their own, answering on
`/run/user/<uid>/podman/podman.sock` and only while that user's
`podman.socket` unit is enabled.

The enricher reads the owner from the container's cgroup path: a
rootless container lives under `user@<uid>.service`, a rootful one does
not. Each owner's socket is reached the first time one of their
containers is seen, its event stream is followed from then on, and a
socket that is not there yet is asked again a minute later, so a user
who logs in after the agent started is named from their next alert on.

### What a rootless runtime costs

A rootless socket is owned by its user and is mode `0600` inside a
`0700` directory, so the agent reaches it only when it can read that
path, and the runtime only answers while the user's `podman.socket` is
listening. An agent started beside a warden runs as root inside a user
namespace of its own, which cannot enter another user's directory
whatever its capabilities, so when its own connect is refused it asks
the warden instead: the warden connects to
`/run/user/<uid>/podman/podman.sock` on the host, checks that the
socket and the process listening on it both belong to that uid, and
hands the open connection over. The agent names a user and never a
path, root's runtime is never connected this way, and a warden running
in a container needs the host's `/run/user` mounted for it. Neither condition is the agent's to fix, so neither is
hidden: the first time a runtime cannot be reached the agent logs one
warning naming the user, the socket and the reason, and
`ebpfsentinel-agent status` lists every Podman runtime it has gone to
with the same reason:

```text
  Containers /proc (host procfs), ids yes, docker off by configuration, podman on, lxc on, kubernetes off, not in a cluster
             podman root: named (/run/podman/podman.sock)
             podman uid 1000: unnamed, no socket (podman.socket not enabled, or not mounted) (/run/user/1000/podman/podman.sock)
```

| Reach | Meaning | What to do |
|-------|---------|------------|
| `reachable` | The runtime answers; its containers are named | - |
| `no_socket` | No socket at that path | `systemctl --user enable --now podman.socket` as that user, and mount `/run/user` when the agent runs in a container |
| `refused` | The socket exists and refused the agent, and no warden connected for it | Run the agent beside a warden, as root, or as the owning user |
| `unavailable` | The socket accepted nothing in time | Check the user's `podman.socket` unit |
| `rootless_off` | `container.podman.rootless` is false | Set it to true to name rootless containers |

A container the enricher cannot name still carries its id, its runtime
`podman` and its cgroup path from the resolver, so a rule scoped by
cgroup or by container id keeps working; only a selector by name or
image matches nothing for it.

### Configuration

```yaml
container:
  podman:
    enabled: true                         # default: false
    socket: /run/podman/podman.sock       # the rootful runtime
    rootless: true                        # default: true
    run_user_root: /run/user              # where each user's runtime directory lives
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
```

With `rootless: false` and no rootful socket there is nothing to name,
so the agent turns the enricher off at startup with one warning, the
way the Docker enricher does when its socket is missing. When the
agent runs in a container, mount the sockets read-only:

```bash
podman run ... -v /run/podman/podman.sock:/run/podman/podman.sock:ro \
               -v /run/user:/run/user:ro ...
```

## LXC Enricher

Proxmox VE, Incus and LXD all run system containers on LXC, and an LXC
container is a cgroup, so it is a container like the others: the resolver
names it from its cgroup path, a workload rule naming it by name applies,
and an alert from it carries runtime `lxc`. The enricher fills in what the
host knows beyond the name:

| Host | Source | `name` | `image` | Labels |
|------|--------|--------|---------|--------|
| Proxmox VE | `/etc/pve/lxc/<vmid>.conf` | `hostname` | `ostype` | `proxmox.vmid`, one `proxmox.tag` per tag |
| Incus | `GET /1.0/instances/<name>` on the daemon socket | instance name | image description | each `user.<key>` as `<key>`, `incus.project` |
| Plain LXC | the cgroup path | container name | - | - |

A Proxmox CT is named by its number in the cgroup and by its hostname in
the enricher, so a rule may use either: `container: "4101"` and
`container: ct-web` name the same CT.

```yaml
container:
  lxc:
    enabled: true                              # default: true
    proxmox_dir: /etc/pve/lxc                  # empty skips Proxmox
    incus_socket: /var/lib/incus/unix.socket   # empty skips Incus
```

```yaml
firewall:
  rules:
    - id: ct-web-no-smtp
      action: deny
      protocol: tcp
      dst_port: 25
      workload:
        container: ct-web
        mode: enforce
```

## Hypervisor Guests

A virtual machine's traffic crosses the host on its tap or macvtap device,
so the link watcher attaches the agent's chain there as it does on a
container's veth, and names the guest from the record its hypervisor keeps:

| Hypervisor | Device | Source | `name` | `id` | `tags` |
|------------|--------|--------|--------|------|--------|
| Proxmox VE | `tap<vmid>i<n>` | `/etc/pve/qemu-server/<vmid>.conf` | `name` | VMID | `tags` |
| libvirt (KVM, QEMU) | any tap or macvtap a domain lists | `/run/libvirt/qemu/<domain>.xml` | domain name | UUID | - |
| KubeVirt | the `virt-launcher` pod's link on the node | the pod's labels, from the Kubernetes enricher | `<namespace>/<vm>` | instance UID | - |

A KubeVirt guest runs inside a pod, so the cluster names it through that pod
and the hypervisor view through the virtual machine. Both reach the one
device: a rule selecting the launcher pod with `pods:` or `namespaces:` and a
rule naming the guest with `guest: prod/db` are both decided on the pod's
link, under the guest's key. Unlike a Proxmox or libvirt tap, whose owner is
the emulator and lends the guest none of its rules, the launcher pod is the
guest's own name in the cluster.

The device, not a cgroup, is a guest's key: the guest runs its own kernel,
so no process of it is in the host's process table. A device no record
names is listed unnamed with a reason code (`no_source`, `no_record`,
`record_without_name` or `record_unreadable`) and never given a placeholder
name. A `tun` device, which carries IP packets for a VPN rather than a
guest's frames, is not a guest.

An IDS rule names a guest with `workload: { guest: web-01 }`, by the name or
the identifier its hypervisor gives it, and is decided on the guest's device
(see [IDS workload scope](../configuration/ids.md#guests)). The protection is
the network only, and the guest list says so for each guest: the guest runs
its own kernel, so its processes, sockets and TLS sessions are inside it, and
process attribution and data loss prevention need an agent inside the guest.

```bash
ebpfsentinel-agent ebpf guests
```

```text
Guests on this host: 2 named, 1 unnamed

INTERFACE  KIND  ATTACHED  GUEST               ID                                    SOURCE   TAGS          PROTECTED
tap101i0   tap   yes       web-01              101                                   proxmox  prod,eu-west  network
vnet3      tap   yes       db                  6f1c1a8e-0a7b-4d3c-9b8e-2f9d1e7c4a55  libvirt  -             network
vnet9      tap   yes       unnamed: no_record  -                                     -        -             network
  vnet9: no libvirt domain and no Proxmox virtual machine names this device; it may belong to a hypervisor the agent does not read
  Protection: network only: the guest runs its own kernel, so its processes, sockets and TLS sessions are inside it and the host sees only the packets on its device; process attribution and data loss prevention need an agent inside the guest
```

```yaml
container:
  guests:
    proxmox_dir: /etc/pve/qemu-server   # empty skips Proxmox
    libvirt_dir: /run/libvirt/qemu      # empty skips libvirt
```

## Kubernetes Enricher

The Kubernetes enricher runs a `kube-rs` reflector on the `Pod`
resource, scoped to the **current node** via the
`spec.nodeName` field selector, and maintains an in-memory reverse
index from `containerID` to the owning pod. Lookups are served entirely
from memory - no API call per alert.

### Metadata fields

| Field | Description |
|-------|-------------|
| `pod_name` | Pod name (`my-app-7b8f9`) |
| `namespace` | Pod namespace |
| `container_name` | Container name inside the pod |
| `labels` | Pod labels |
| `annotations` | Pod annotations |
| `service_account` | Pod service account |
| `owner_kind` / `owner_name` | First owner reference (e.g. `ReplicaSet` + name) |
| `node_name` | Scheduled node |

Init containers, sidecar containers, and ephemeral debug containers are
all indexed. Pod updates that rotate container ids (e.g. crashloop
restarts) are handled transparently.

### Environment detection

At startup the enricher checks `KUBERNETES_SERVICE_HOST`; when the
variable is missing the enricher disables itself with an info log and
zero runtime cost. When running inside a cluster it uses
`kube::Client::try_default()` to pick up the in-cluster service account
credentials.

### Node name resolution

Looked up in this order:

1. `EBPFSENTINEL_NODE_NAME` env var (recommended - set from `fieldRef`)
2. `HOSTNAME` env var
3. `/proc/sys/kernel/hostname`

### RBAC

The agent needs `get`, `list`, `watch` on `pods` and `list`, `watch` on
`namespaces`, cluster-wide: a workload firewall rule naming namespaces is
matched against their labels. Use a `ClusterRole` + `ClusterRoleBinding`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ebpfsentinel-pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ebpfsentinel-pod-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ebpfsentinel-pod-reader
subjects:
  - kind: ServiceAccount
    name: ebpfsentinel
    namespace: ebpfsentinel
```

### Namespace hook

The OSS enricher exposes a `NamespaceHook` trait that is called on every
resolved namespace. The OSS agent registers no hook, so the call is a
no-op. **Enterprise multi-tenancy** plugs the tenant engine in as a
namespace hook to map Kubernetes namespaces to tenant ids without
touching OSS code.

```rust
pub trait NamespaceHook: Send + Sync {
    fn on_namespace_resolved(&self, namespace: &str) -> Option<String>;
}
```

### Metrics

The Kubernetes enricher keeps its own counters - pods cached, lookups served,
cache misses and watcher backoff events - as in-process atomics. **None of them
is registered with the Prometheus registry**, so none is scrapable: they are
readable only through the enricher's own accessors. The container resolver
counters above are the scrapable ones.

### Configuration

```yaml
container:
  kubernetes:
    enabled: true          # default: false
    node_name: ""          # empty = auto-detect
    label_filter: []       # optional pod label selector, one key=value per entry
```

### Cargo feature

The Kubernetes enricher pulls `kube-rs` and `k8s-openapi` transitively.
To keep the base binary lean it lives behind the `kubernetes` Cargo
feature on the `adapters` crate, which is **enabled by default** in the
agent binary. Disable it with `--no-default-features` when building for
environments that will never touch a Kubernetes API.

## Event Enrichment Fields

Every alert that flows through the pipeline carries two optional
fields:

| Field | Source |
|-------|--------|
| `container` | `ContainerInfo` from the resolver (runtime + id) |
| `container_metadata` | `ContainerMetadata::Docker` or `Kubernetes` from an enricher |

`container_metadata` is populated by the first registered
`MetadataEnricher` that returns `Some(..)`. Enrichers are consulted in
registration order, so the startup code inserts the Kubernetes enricher
before the Docker enricher. **Exactly one of them ever answers for a
given alert**: the pipeline keeps the first metadata it gets, so a
Kubernetes-enriched alert carries no Docker fields and a
Docker-enriched one carries no pod.

### Webhook payload

The webhook serialises the domain `Alert` as it stands, so both fields
appear in full, each tagged by its own `kind`:

```json
{
  "id": "1742000000000-ids-rule-42",
  "component": "ids",
  "severity": "Critical",
  "message": "SSH brute force detected",
  "container": {
    "kind": "container",
    "container_id": "abcdef1234567890",
    "runtime": "containerd",
    "cgroup_path": "/kubepods/burstable/pod.../cri-containerd-abc.scope",
    "pid": 12345
  },
  "container_metadata": {
    "kind": "kubernetes",
    "pod_name": "my-app-7b8f9",
    "namespace": "production",
    "container_name": "app",
    "labels": [["app", "my-app"]],
    "service_account": "my-app",
    "owner_kind": "ReplicaSet",
    "owner_name": "my-app-7b8f9",
    "node_name": "node-01"
  }
}
```

### REST and gRPC readings

`GET /api/v1/alerts` and the gRPC alert stream carry **one flattened
object** instead of the two: `container`, holding the resolver's
identity with whichever enricher fields were filled. There is no
`container_metadata` on either, and the labels, annotations, service
account, owner reference, node name, image status and creation
timestamp are not projected onto them at all - those live on the
webhook payload and on the exporters that ship the alert whole.

| Field | Filled by | Meaning |
|-------|-----------|---------|
| `kind` | always | Always the string `container`: a host-namespace process carries no `container` object at all, so the field never says `host` |
| `runtime` | resolver | `docker`, `containerd`, `crio`, `podman`, `lxc` or `unknown` |
| `id` | resolver | Canonical container id |
| `cgroup_path` | resolver | The cgroup path the resolver matched |
| `namespace` | Kubernetes enricher | Pod namespace |
| `pod` | Kubernetes enricher | Pod name |
| `container_name` | Kubernetes enricher | Container name inside the pod |
| `name` | Docker, Podman or LXC enricher | Container name, leading `/` stripped |
| `image` | Docker, Podman or LXC enricher | Image tag, for example `nginx:1.25`; the OS type of a Proxmox CT |

On REST an unfilled field is absent rather than empty; on gRPC, where
every field is a `string`, it is the empty string. The `pid` the
resolver carries is deliberately not projected onto either: it is the
process that happened to be observed, not a property of the container.

```json
{
  "container": {
    "kind": "container",
    "runtime": "docker",
    "id": "c0ffee2b91a44d7e8f30ba52cd917e64",
    "cgroup_path": "/docker/c0ffee2b91a44d7e8f30ba52cd917e64",
    "name": "legacy-batch",
    "image": "registry.internal/legacy-batch:1.9.3"
  }
}
```

## Configuration Reference

The full `container:` block:

```yaml
container:
  resolver:
    enabled: true
    cache_size: 4096
    proc_path: /proc            # /host/proc inside a container
    cgroup_root: /sys/fs/cgroup # cgroup v2 hierarchy root, walked to map a cgroup id to a container
  docker:
    enabled: false
    socket: /var/run/docker.sock
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
  podman:
    enabled: false
    socket: /run/podman/podman.sock
    rootless: true
    run_user_root: /run/user
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
  lxc:
    enabled: true
    proxmox_dir: /etc/pve/lxc
    incus_socket: /var/lib/incus/unix.socket
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
  guests:
    proxmox_dir: /etc/pve/qemu-server
    libvirt_dir: /run/libvirt/qemu
  kubernetes:
    enabled: false
    node_name: ""               # auto-detect
    label_filter: []            # e.g. ["app=web", "tier=frontend"]
```

## Deployment Requirements

| Requirement | Resolver | Docker | Podman | LXC | Kubernetes |
|-------------|:--------:|:------:|:------:|:---:|:----------:|
| `CAP_BPF` + `CAP_NET_ADMIN` (existing) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `CAP_SYS_PTRACE` (for `/proc` introspection) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `/proc` mount (read-only) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Docker socket mount | - | ✅ | - | - | - |
| Podman socket mount, and `/run/user` for rootless | - | - | ✅ | - | - |
| `/etc/pve/lxc` on Proxmox, the Incus socket on Incus | - | - | - | ✅ | - |
| In-cluster service account | - | - | - | - | ✅ |
| ClusterRole on `pods` get/list/watch and `namespaces` list/watch | - | - | - | - | ✅ |
| Kernel version | any | any | any | any | any |

See [least-privilege deployment](../operations/deployment/kubernetes.md)
for the complete Helm / manifest template.

## Architecture

```
eBPF (cgroup_id in PacketEvent)
  └── userspace pipeline
        └── ContainerResolver
              └── /proc/{pid}/cgroup → ContainerInfo (cached)
                    └── AlertPipeline
                          ├── MetadataEnricher::Kubernetes (first hit wins)
                          │     └── PodCache (kube-rs watcher reverse index)
                          └── MetadataEnricher::Docker
                                └── DockerClient (Unix socket HTTP)
                                      └── LRU + TTL cache
                    └── Alert { container, container_metadata }
                          ├── webhook + whole-alert SIEM exporters (both fields)
                          └── REST + gRPC (one flattened container object)
```

## Related

- [Extended TLS Library Hooking (Enterprise)](enterprise/dlp.md#extended-tls-library-coverage)
- [TC attach mode & netkit hot-plug](../configuration/agent.md#tc-attachment-mode) - how TC programs attach to Cilium netkit pod interfaces
- [Deployment Matrix](deployment-matrix.md)
- [What a node agent sees](../architecture/node-agent-visibility.md) - which traffic of a pod a node agent does not see, and why
- [Kubernetes Deployment](../operations/deployment/kubernetes.md)
- [Docker Deployment](../operations/deployment/docker.md)
