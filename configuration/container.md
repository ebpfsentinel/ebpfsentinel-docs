# Container Awareness Configuration

Container awareness enriches alerts and events with workload identity (pod name, namespace, container ID, labels). Three independent components can be enabled separately. See [Container Awareness](../features/container-awareness.md) for the feature overview.

## Configuration

```yaml
container:
  resolver:
    enabled: true
    cache_size: 4096
    proc_path: /proc
  docker:
    enabled: false
    socket: /var/run/docker.sock
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
  kubernetes:
    enabled: false
    label_filter: []
```

## Container Resolver

Resolves `cgroup_id` from eBPF events to container identity via `/proc/{pid}/cgroup` scanning. Always available, no external dependencies.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `resolver.enabled` | bool | `true` | Enable cgroup-based container resolution |
| `resolver.cache_size` | usize | `4096` | Max cached cgroup → container mappings |
| `resolver.proc_path` | string | `/proc` | Path to procfs (use `/host/proc` when containerized with bind mount) |

## Docker Enricher

Queries the Docker daemon for container metadata (name, image, labels). Requires socket access.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `docker.enabled` | bool | `false` | Enable Docker metadata enrichment |
| `docker.socket` | string | `/var/run/docker.sock` | Docker daemon socket path |
| `docker.cache_size` | usize | `1024` | Max cached container metadata entries |
| `docker.cache_ttl_seconds` | u64 | `300` | Cache TTL in seconds |
| `docker.timeout_ms` | u64 | `2000` | Docker API request timeout |

> Requires bind mount: `-v /var/run/docker.sock:/var/run/docker.sock:ro`

## Kubernetes Enricher

Watches the Kubernetes API for pod metadata (name, namespace, labels, annotations). Auto-disables when `KUBERNETES_SERVICE_HOST` is absent.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `kubernetes.enabled` | bool | `false` | Enable Kubernetes pod metadata enrichment |
| `kubernetes.node_name` | string | auto-detect | Node name filter (defaults to `NODE_NAME` env var or hostname) |
| `kubernetes.label_filter` | `[string]` | `[]` | Only enrich pods with these label keys (empty = all pods) |

> Requires a ServiceAccount with `get`, `list`, `watch` on the `pods` resource. See [Kubernetes deployment](../operations/deployment/kubernetes.md).
