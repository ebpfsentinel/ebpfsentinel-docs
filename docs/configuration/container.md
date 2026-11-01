# Container Awareness Configuration

Container awareness enriches alerts and events with workload identity (pod name, namespace, container ID, labels). Six independent components can be enabled separately. See [Container Awareness](../features/container-awareness.md) for the feature overview.

## Configuration

```yaml
container:
  resolver:
    enabled: true
    cache_size: 4096
    proc_path: /proc
    cgroup_root: /sys/fs/cgroup
  docker:
    enabled: false
    socket: /var/run/docker.sock
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
    label_policy: false
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
    node_name: ""
    label_filter: []
    network_policy:
      mode: off
    cluster_ip:
      enabled: false
      workloads: []
```

## Container Resolver

Resolves `cgroup_id` from eBPF events to container identity. Process-context events (uprobe DLP) resolve via `/proc/{pid}/cgroup`; datapath events carry no pid, so they resolve by matching the `cgroup_id` against the cgroup v2 hierarchy under `cgroup_root`. Always available, no external dependencies.

Attributing locally-originated traffic (for example a container's outbound connections) requires the IDS classifier to observe the egress hook, where the kernel has bound the originating socket to the packet - enable [`ids.inspect_egress`](ids.md). On ingress the originating socket is not yet attached, so cgroup attribution is unavailable there.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `resolver.enabled` | bool | `true` | Enable cgroup-based container resolution |
| `resolver.cache_size` | usize | `4096` | Max cached cgroup → container mappings |
| `resolver.proc_path` | string | `/proc` | Path to procfs (use `/host/proc` when containerized with bind mount) |
| `resolver.cgroup_root` | string | `/sys/fs/cgroup` | cgroup v2 mount used for `cgroup_id` → path lookup (use the host mount when containerized) |

## Docker Enricher

Attaches container metadata (name, image, labels) to the identity the resolver
produced. Requires socket access.

Two paths feed one cache. The agent opens `GET /events` filtered to container
`create`, `start`, `die` and `destroy`, and writes the cache from what the
daemon sends, so a container that appears while the agent runs is named before
its first packet is enriched and one that is removed is forgotten rather than
waiting out `cache_ttl_seconds`. A cache miss still falls back to
`/containers/{id}/json`, which is what covers an id first seen before the
stream was connected, and it is also the only call that learns the creation
time. The stream reconnects with a capped backoff and carries a bounded
backlog: a daemon restart costs enrichment while it is down, never memory.

`cache_ttl_seconds` therefore bounds how long a stale inspect result is kept,
not how quickly a new container is learned.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `docker.enabled` | bool | `false` | Enable Docker metadata enrichment |
| `docker.socket` | string | `/var/run/docker.sock` | Docker daemon socket path |
| `docker.cache_size` | usize | `1024` | Max cached container metadata entries |
| `docker.cache_ttl_seconds` | u64 | `300` | Cache TTL in seconds |
| `docker.timeout_ms` | u64 | `2000` | Docker API request timeout |
| `docker.label_policy` | bool | `false` | Read each container's `io.ebpfsentinel.policy.*` labels and put them in force as workload rules; requires `docker.enabled` |

With `label_policy` on, the same stream also carries each container's policy
labels into the workload firewall: the running containers are listed every
time the stream connects, and each `create`, `start` and `destroy` updates the
container it names, so a relabelled or recreated container is policed without
a reload. The vocabulary and its compose examples are on the
[Docker deployment page](../operations/deployment/docker.md#policy-on-the-containers-labels).
The option loads the cgroup hooks on its own, and the agent refuses to start
with it on when those hooks cannot attach.

> Requires bind mount: `-v /var/run/docker.sock:/var/run/docker.sock:ro`

The mount is the Docker API, which is root on the host; `:ro` stops writes to
the socket file and not requests through it. The agent issues GETs only and
runs as 65534, so the socket's group ownership is what decides. Leaving it out
and setting `docker.enabled: false` keeps the container id on every alert, from
the resolver, and loses the name, the image and the labels. Either way the
agent states the choice once at startup, including when the enricher is on and
nothing answers at `docker.socket`.

## Podman Enricher

Attaches the same name, image and labels to a container Podman runs, over
Podman's Docker-compatible API: the event stream and the inspect fallback
behave as the Docker enricher's do. Rootful Podman answers on one socket;
each user running rootless containers is a runtime of their own, on
`<run_user_root>/<uid>/podman/podman.sock`, and the owner is read from the
container's `user@<uid>.service` cgroup. Each socket is reached the first
time one of its owner's containers is seen and asked again a minute later
while it does not answer, so nothing has to be listed in advance.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `podman.enabled` | bool | `false` | Enable Podman metadata enrichment |
| `podman.socket` | string | `/run/podman/podman.sock` | The rootful runtime's socket |
| `podman.rootless` | bool | `true` | Also name rootless containers, through each user's own socket |
| `podman.run_user_root` | string | `/run/user` | Directory holding each user's runtime directory; required when `rootless` is on |
| `podman.cache_size` | usize | `1024` | Max cached container metadata entries, shared by every runtime |
| `podman.cache_ttl_seconds` | u64 | `300` | Cache TTL in seconds |
| `podman.timeout_ms` | u64 | `2000` | Podman API request timeout |

The agent refuses to start with the enricher on and an empty `socket`, an
empty `run_user_root` while `rootless` is on, or a zero `cache_size` or
`timeout_ms`. With `rootless` off and no rootful socket it turns the
enricher off at startup with one warning.

A rootless socket is readable only by root or its owning user, and exists
only while that user's `podman.socket` unit listens. An agent that cannot
reach one logs it once, naming the user, the socket and the reason, and
`ebpfsentinel-agent status` lists it with that reason; its containers keep
their id and runtime from the resolver. The limits are spelled out on the
[feature page](../features/container-awareness.md#what-a-rootless-runtime-costs).

> Requires bind mounts when containerized: `-v /run/podman/podman.sock:/run/podman/podman.sock:ro`, and `-v /run/user:/run/user:ro` for rootless runtimes

## LXC Enricher

Names an LXC container: a Proxmox CT, an Incus or LXD instance, or one
started with the LXC tools themselves. An LXC container is a cgroup like any
other, so the resolver gives it runtime `lxc` and its name, read from the
cgroup path (`lxc.payload.<name>`, or `lxc/<name>` on Proxmox and on older
LXC), and every rule scoped by container name applies to it unchanged. The
enricher then adds what the host knows about it:

- **Proxmox**: a CT is named by its number. The enricher reads
  `<proxmox_dir>/<vmid>.conf` and takes the `hostname` as the container's
  name, the `ostype` as its image and each of its `tags` as a
  `proxmox.tag` label, beside `proxmox.vmid`. Snapshot sections are
  ignored, so the name is the current one.
- **Incus**: the enricher asks the daemon on `incus_socket` for the instance,
  in its project (`<project>_<name>` in the cgroup), and takes each `user.<key>`
  configuration key as a label named `<key>`, its image description as its image and its
  project as the `incus.project` label.
- **Neither**: the container keeps the name its cgroup gives it.

The enricher is on by default because it costs nothing on a host with no LXC
container: a path that does not exist is a source that is not there.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `lxc.enabled` | bool | `true` | Enable LXC metadata enrichment |
| `lxc.proxmox_dir` | string | `/etc/pve/lxc` | Directory holding the Proxmox CT configuration files; empty skips Proxmox |
| `lxc.incus_socket` | string | `/var/lib/incus/unix.socket` | The Incus daemon's socket; empty skips Incus |
| `lxc.cache_size` | usize | `1024` | Max cached container metadata entries |
| `lxc.cache_ttl_seconds` | u64 | `300` | Cache TTL in seconds |
| `lxc.timeout_ms` | u64 | `2000` | Incus API request timeout |

The agent refuses to start with a zero `cache_size` or `timeout_ms`.

> Requires bind mounts when containerized: `-v /etc/pve/lxc:/etc/pve/lxc:ro` on a Proxmox node, `-v /var/lib/incus/unix.socket:/var/lib/incus/unix.socket:ro` on an Incus host

The Incus socket, like the Docker one, is the daemon's API: the agent issues
GETs only, and the socket's ownership decides what it may do.

## Guest Naming

Names the virtual machine behind each tap or macvtap device the link
watcher finds on the host. A guest carries its own kernel, so nothing in the
host's process table or cgroup tree is the guest's: the device is the only
place the agent meets its traffic, and the name comes from the record the
hypervisor keeps for it.

- **Proxmox VE**: a guest's tap is `tap<vmid>i<n>`. The agent reads
  `<proxmox_dir>/<vmid>.conf` and takes its `name` and its `tags`; snapshot
  sections are ignored, so the name is the current one.
- **libvirt**: the agent reads the status file libvirt keeps for each running
  domain under `libvirt_dir` and finds the device among the domain's
  interfaces, taking the domain's name and UUID.
- **KubeVirt**: a KubeVirt guest's tap is inside its `virt-launcher` pod,
  so the device on the node is the pod's own link. A pod labelled
  `kubevirt.io: virt-launcher` makes that link a guest, named
  `<namespace>/<vm>` from its `vm.kubevirt.io/name` label (or
  `kubevirt.io/domain` when the instance belongs to no `VirtualMachine`),
  with the instance's UID from `kubevirt.io/created-by` as its identifier.
  This needs nothing here: the pods come from the
  [Kubernetes enricher](../features/container-awareness.md#kubernetes-enricher)
  and are read again every five seconds.
- **Neither**: the device is listed unnamed, with the reason, and never
  given a placeholder name.

The records are read each time the guest list is asked for, never cached,
because libvirt writes a domain's status file after it made the device.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `guests.proxmox_dir` | string | `/etc/pve/qemu-server` | Directory holding the Proxmox VM configuration files; empty skips Proxmox |
| `guests.libvirt_dir` | string | `/run/libvirt/qemu` | Directory holding libvirt's running-domain status files; empty skips libvirt |

> Requires bind mounts when containerized: `-v /etc/pve/qemu-server:/etc/pve/qemu-server:ro` on a Proxmox node, `-v /run/libvirt/qemu:/run/libvirt/qemu:ro` on a libvirt host

The list is read with
[`ebpfsentinel-agent ebpf guests`](../cli-reference/index.md#ebpf) or
[`GET /api/v1/ebpf/guests`](../api-reference/rest-api.md#get-apiv1ebpfguests).

## Kubernetes Enricher

Watches the Kubernetes API for pod metadata (name, namespace, labels, annotations). Auto-disables when `KUBERNETES_SERVICE_HOST` is absent.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kubernetes.enabled` | bool | `false` | Enable Kubernetes pod metadata enrichment |
| `kubernetes.node_name` | string | `""` | Node whose pods are watched. Empty resolves it from `EBPFSENTINEL_NODE_NAME`, then `HOSTNAME`, then `/proc/sys/kernel/hostname`; set it explicitly when none of those name the node the agent runs on |
| `kubernetes.label_filter` | `[string]` | `[]` | Label selector narrowing the pod watch. One `key=value` pair per entry, joined into a single selector; empty watches every pod on the node |

A malformed entry (no `=`, an empty key, or several pairs crammed into one
entry with commas) is refused at load rather than at watch time, where the
API server's rejection would surface only in the watcher's log.

> Requires a ServiceAccount with `get`, `list`, `watch` on the `pods` resource. See [Kubernetes deployment](../operations/deployment/kubernetes.md).

### NetworkPolicy

The agent can carry out the cluster's `NetworkPolicy` on the pods of its own
node, for clusters whose CNI enforces none. See
[Kubernetes NetworkPolicy](../features/network-policy.md) for what is decided
where and how the specification is read.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kubernetes.network_policy.mode` | `off`, `observe`, `enforce` | `off` | `observe` counts what the policies would refuse and lets it through; `enforce` refuses it, and stops the agent at startup when the hooks cannot attach or the cluster cannot be read |

Any mode other than `off` requires `kubernetes.enabled`, and is refused at load
otherwise. The ServiceAccount also needs `list` and `watch` on `namespaces`
and `services`, on `networkpolicies` in `networking.k8s.io` and on
`endpointslices` in `discovery.k8s.io`.

### Cluster address resolution

The agent can send the connections that chosen pods make to a Service cluster
address straight to one of its ready backends at `connect()`, every other pod
staying on kube-proxy. See
[Cluster address resolution](../features/cluster-ip.md) for what it resolves
and what it leaves to kube-proxy.

```yaml
container:
  kubernetes:
    enabled: true
    cluster_ip:
      enabled: true
      workloads:
        - pods:
            match_labels:
              app: checkout
          namespaces:
            match_expressions:
              - key: kubernetes.io/metadata.name
                operator: In
                values: [shop]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kubernetes.cluster_ip.enabled` | bool | `false` | Load the hooks and resolve the cluster addresses of the pods `workloads` names |
| `kubernetes.cluster_ip.workloads` | list | `[]` | The pods resolved here. A pod is taken when it matches any entry |
| `kubernetes.cluster_ip.workloads[].pods` | label selector | absent | `match_labels` and `match_expressions` on the pod's labels; absent matches every pod |
| `kubernetes.cluster_ip.workloads[].namespaces` | label selector | absent | The same on the labels of the pod's namespace; absent matches every namespace |

`enabled` requires `kubernetes.enabled` and at least one entry in `workloads`,
and each entry has to set `pods`, `namespaces` or both, so that turning it on
never takes every pod of the node by omission. These are refused at load, as is
a selector the API server would refuse. The setting is read when the agent
starts, so a change takes a restart. The ServiceAccount needs `list` and
`watch` on `namespaces`, `pods` and `services`, and on `endpointslices` in
`discovery.k8s.io`.
