# Docker Deployment

> Runs with granular capabilities on kernel 5.8+ — `--privileged` is only
> needed as a fallback for older kernels. DLP requires `--pid=host` for
> full process visibility. See the
> [deployment compatibility matrix](../../features/deployment-matrix.md)
> for details.

## Build

```bash
docker build -t ebpfsentinel .
```

## Run (least-privilege)

eBPF needs elevated capabilities and `--network host`. On kernels 5.8+
(with `CAP_BPF`), use fine-grained capabilities instead of
`--privileged`, and mount `/proc`, `/sys/fs/cgroup`, and the Docker
socket read-only so the container resolver and Docker enricher can
attach workload metadata to every alert:

```bash
docker run --network host --pid host \
  --cap-drop ALL \
  --cap-add CAP_BPF \
  --cap-add CAP_NET_ADMIN \
  --cap-add CAP_SYS_PTRACE \
  --cap-add CAP_PERFMON \
  --cap-add CAP_SYS_RESOURCE \
  --cap-add CAP_NET_RAW \
  --security-opt no-new-privileges:true \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  -v /proc:/host/proc:ro \
  -v /sys/fs/cgroup:/host/sys/fs/cgroup:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ebpfsentinel
```

`--pid host` is only needed if you want uprobe DLP to attach to host
processes. Drop it when only container workloads need protection.

### Privileged fallback (kernel <5.8)

On older kernels without `CAP_BPF`, fall back to `--privileged`:

```bash
docker run --privileged --network host --pid host \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  -v /proc:/host/proc:ro \
  -v /sys/fs/cgroup:/host/sys/fs/cgroup:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ebpfsentinel
```

## Docker Compose

The default `docker-compose.yml` uses fine-grained capabilities:

```yaml
services:
  ebpfsentinel:
    image: ebpfsentinel
    network_mode: host
    pid: host
    cap_drop:
      - ALL
    cap_add:
      - CAP_BPF
      - CAP_NET_ADMIN
      - CAP_SYS_PTRACE
      - CAP_PERFMON
      - CAP_SYS_RESOURCE
      - CAP_NET_RAW
    security_opt:
      - no-new-privileges:true
    volumes:
      - ./config:/etc/ebpfsentinel
      - /sys/fs/bpf:/sys/fs/bpf
      - /proc:/host/proc:ro
      - /sys/fs/cgroup:/host/sys/fs/cgroup:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

If your kernel does not support `CAP_BPF` (pre-5.8), replace `cap_drop`
+ `cap_add` with `privileged: true`.

When the Docker enricher is enabled (`container.docker.enabled=true` in
your agent config), the daemon socket mount lets the agent call
`/containers/{id}/json` to enrich every alert with container name,
image, and labels.

```bash
# Edit config/ebpfsentinel.yaml
docker compose up -d

# View logs
docker compose logs -f

# Reload config (SIGHUP)
docker compose kill -s HUP ebpfsentinel

# Stop
docker compose down
```

## Container Awareness Configuration

Add the `container` block to `config/ebpfsentinel.yaml`:

```yaml
container:
  resolver:
    enabled: true
    proc_path: /host/proc       # matches the bind-mount above
  docker:
    enabled: true               # enables the Docker enricher
    socket: /var/run/docker.sock
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
```

See [container awareness](../../features/container-awareness.md) for
the full reference.

## Bind Address and Host Networking

With `network_mode: host`, the container shares the host network stack.
The `bind_address` setting in your configuration controls which address
the agent actually listens on:

```yaml
agent:
  bind_address: "127.0.0.1"    # Localhost-only, even in host networking
  # bind_address: "0.0.0.0"    # All interfaces (use with caution)
```

Setting `bind_address` to `127.0.0.1` restricts the API/gRPC endpoints
to the loopback interface, meaning they are not reachable from other
hosts even though the container uses host networking.

## Requirements

| Requirement | Reason |
|-------------|--------|
| `CAP_BPF`, `CAP_NET_ADMIN`, `CAP_PERFMON`, `CAP_SYS_PTRACE`, `CAP_SYS_RESOURCE`, `CAP_NET_RAW` | eBPF program loading, uprobe attach, network hooks (kernel 5.8+) |
| `--privileged` (fallback) | Required on kernels without `CAP_BPF` (<5.8) |
| `--network host` | XDP/TC programs attach to host interfaces |
| `--pid host` | Uprobe DLP visibility across host processes |
| `/sys/fs/bpf` mount | BPF filesystem for map persistence |
| `/proc` mount (read-only) | Container resolver reads `cgroup` per pid |
| `/sys/fs/cgroup` mount (read-only) | Cgroup introspection |
| `/var/run/docker.sock` mount (read-only, optional) | Docker enricher metadata lookups |
| `no-new-privileges:true` | Prevents privilege escalation inside the container |

## Volumes

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./config/` | `/etc/ebpfsentinel/` | Configuration |
| `/sys/fs/bpf` | `/sys/fs/bpf` | BPF filesystem |
| `/proc` | `/host/proc` (ro) | Container resolver |
| `/sys/fs/cgroup` | `/host/sys/fs/cgroup` (ro) | Cgroup introspection |
| `/var/run/docker.sock` | `/var/run/docker.sock` (ro) | Docker enricher (optional) |

## Health Check

```bash
docker exec ebpfsentinel curl -sf http://localhost:8080/healthz
```

Or in `docker-compose.yml`:

```yaml
healthcheck:
  test: ["CMD", "curl", "-sf", "http://localhost:8080/healthz"]
  interval: 10s
  timeout: 5s
  retries: 3
```
