# Container Awareness

> **Edition: OSS (core) + Enterprise (extended TLS)** | **Status: Shipped**

## Overview

Container awareness enriches every network event with the container and
pod that generated it. eBPFsentinel reads `cgroup_id` from the kernel
during packet processing, resolves it to a `ContainerInfo`
(container id + runtime), and then asks a pluggable **metadata enricher**
to attach runtime-specific metadata (Docker image, Kubernetes labels,
service account, namespace, …).

When alerts are generated, the enriched context is embedded in the alert
payload, the SIEM export, the audit trail, and the gRPC/REST API
responses. SOC analysts no longer need to correlate IP addresses back to
workloads manually — the workload identity travels with every event.

Container awareness is composed of four independent building blocks:

| Block | Edition | Purpose |
|-------|---------|---------|
| Container Resolver | OSS | cgroup → `ContainerInfo` (runtime + container id) |
| Docker Enricher | OSS | Docker Engine API (image, labels, status) |
| Kubernetes Enricher | OSS | kube-rs pod watcher (pod, namespace, SA, owner) |
| Extended TLS Hooking | Enterprise | Discovers Go `crypto/tls`, Java JSSE, statically linked BoringSSL, kTLS, GnuTLS — background `/proc` scanner, 6 Prometheus metrics, `/api/v1/enterprise/tls-probes/*` admin API; kernel uprobe attachment blocked on upstream aya support |

Each block is opt-in: a bare-metal agent can stay lean, a Docker host
turns on the Docker enricher, a Kubernetes DaemonSet turns on the K8s
enricher (and automatically skips Docker).

## Environment Detection

The agent auto-detects its environment at startup:

| Signal | Environment |
|--------|-------------|
| `KUBERNETES_SERVICE_HOST` env var set | Kubernetes |
| `/var/run/docker.sock` mount + enricher enabled | Docker host |
| Otherwise | Bare metal / VM |

`container.kubernetes.enabled` and `container.docker.enabled` are
independent toggles. When both are enabled the Kubernetes enricher runs
first and the Docker enricher acts as a fallback for containers not
managed by the K8s API (e.g. kubelet sandbox containers).

## Container Resolver

The resolver walks `/proc/{pid}/cgroup`, detects the container runtime
from the cgroup path, and extracts the canonical container id.

### Supported runtimes

| Runtime | Cgroup signature |
|---------|------------------|
| Docker | `docker-<id>`, `/docker/<id>` |
| containerd | `cri-containerd-<id>` |
| CRI-O | `crio-<id>` |
| Podman | `libpod-<id>` |

Both cgroup v1 and v2 are supported. Unknown paths resolve to
`ContainerInfo::Host` (host process, no container context).

### Cache

Resolution results are stored in an LRU cache keyed by `pid` →
`ContainerInfo`. Default capacity is 4 096 entries; the working set of
active processes is bounded by the number of processes the agent
observes packets for, so this is usually more than enough.

| Metric | Meaning |
|--------|---------|
| `ebpfsentinel_container_cache_hit_total` | Resolved via cache |
| `ebpfsentinel_container_cache_miss_total` | Resolved via `/proc` |
| `ebpfsentinel_container_resolver_error_total` | `/proc` read failed |

### Configuration

```yaml
container:
  resolver:
    enabled: true          # default: true
    cache_size: 4096
    proc_path: /proc        # set to /host/proc in containers
```

## Docker Enricher

The Docker enricher connects to the Docker Engine API over a Unix
socket and calls `GET /v1.43/containers/{id}/json` for every container
id the resolver produces. Results are cached in an LRU with TTL to
avoid hammering the daemon.

### Metadata fields

| Field | Description |
|-------|-------------|
| `name` | Container name (leading `/` stripped) |
| `image` | Image tag (e.g. `nginx:1.25`) |
| `labels` | Key/value pairs from `Config.Labels` |
| `created_at` | ISO-8601 creation timestamp |
| `status` | Runtime status (`running`, `exited`, …) |

### Graceful degradation

If the socket is unreachable (non-Docker host), the enricher logs a
single warning at startup and returns `None` from every lookup. A
periodic re-check (default 60 s) re-enables it if Docker later comes
online.

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

## Kubernetes Enricher

The Kubernetes enricher runs a `kube-rs` reflector on the `Pod`
resource, scoped to the **current node** via the
`spec.nodeName` field selector, and maintains an in-memory reverse
index from `containerID` to the owning pod. Lookups are served entirely
from memory — no API call per alert.

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

1. `EBPFSENTINEL_NODE_NAME` env var (recommended — set from `fieldRef`)
2. `HOSTNAME` env var
3. `/proc/sys/kernel/hostname`

### RBAC

The agent needs `get`, `list`, `watch` on `pods` cluster-wide. Use a
`ClusterRole` + `ClusterRoleBinding`:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ebpfsentinel-pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
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

| Metric | Meaning |
|--------|---------|
| `ebpfsentinel_k8s_enricher_pods_cached` | Current pod cache size |
| `ebpfsentinel_k8s_enricher_lookups_total` | Total lookups served |
| `ebpfsentinel_k8s_enricher_misses_total` | Lookups that missed the cache |
| `ebpfsentinel_k8s_enricher_api_errors_total` | Watcher backoff events |

### Configuration

```yaml
container:
  kubernetes:
    enabled: true          # default: false
    node_name: ""          # empty = auto-detect
    label_filter: []       # optional pod label selector
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
before the Docker enricher.

Example alert fragment (JSON):

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

## Configuration Reference

The full `container:` block:

```yaml
container:
  resolver:
    enabled: true
    cache_size: 4096
    proc_path: /proc            # /host/proc inside a container
  docker:
    enabled: false
    socket: /var/run/docker.sock
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
  kubernetes:
    enabled: false
    node_name: ""               # auto-detect
    label_filter: []
```

## Deployment Requirements

| Requirement | Resolver | Docker | Kubernetes |
|-------------|:--------:|:------:|:----------:|
| `CAP_BPF` + `CAP_NET_ADMIN` (existing) | ✅ | ✅ | ✅ |
| `CAP_SYS_PTRACE` (for `/proc` introspection) | ✅ | ✅ | ✅ |
| `/proc` mount (read-only) | ✅ | ✅ | ✅ |
| Docker socket mount | — | ✅ | — |
| In-cluster service account | — | — | ✅ |
| ClusterRole on `pods` get/list/watch | — | — | ✅ |
| Kernel version | any | any | any |

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
                          └── SIEM / gRPC stream / audit / REST API
```

## Related

- [Extended TLS Library Hooking (Enterprise)](enterprise/dlp.md#extended-tls-library-coverage)
- [Deployment Matrix](deployment-matrix.md)
- [Kubernetes Deployment](../operations/deployment/kubernetes.md)
- [Docker Deployment](../operations/deployment/docker.md)
