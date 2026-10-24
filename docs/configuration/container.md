# Container Awareness Configuration

Container awareness enriches alerts and events with workload identity (pod name, namespace, container ID, labels). Three independent components can be enabled separately. See [Container Awareness](../features/container-awareness.md) for the feature overview.

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
  kubernetes:
    enabled: false
    node_name: ""
    label_filter: []
    network_policy:
      mode: off
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

> Requires bind mount: `-v /var/run/docker.sock:/var/run/docker.sock:ro`

The mount is the Docker API, which is root on the host; `:ro` stops writes to
the socket file and not requests through it. The agent issues GETs only and
runs as 65534, so the socket's group ownership is what decides. Leaving it out
and setting `docker.enabled: false` keeps the container id on every alert, from
the resolver, and loses the name, the image and the labels. Either way the
agent states the choice once at startup, including when the enricher is on and
nothing answers at `docker.socket`.

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
