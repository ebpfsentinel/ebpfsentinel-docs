# Docker Deployment

> Kernel 6.9+ only. eBPF loads **exclusively** through a BPF token — the agent
> container runs rootless with **no `CAP_BPF` and no `--privileged`**. A
> one-shot privileged init service mounts the delegated bpffs. DLP requires
> `--pid=host` for full process visibility. See the
> [BPF token guide](bpf-token.md) and the
> [deployment compatibility matrix](../../features/deployment-matrix.md).

## Build

```bash
docker build -t ebpfsentinel .
```

## Run (rootless, token-only)

eBPF is loaded only through a BPF token, so a privileged step must mount the
delegated bpffs first; the agent itself then runs with `CAP_BPF` dropped. Mount
`/proc`, `/sys/fs/cgroup`, and the Docker socket read-only so the container
resolver and Docker enricher can attach workload metadata to every alert:

```bash
# Privileged, one-time: mount the delegated bpffs (the only CAP_SYS_ADMIN step).
sudo ./dist/ebpfsentinel-token-setup.sh /sys/fs/bpf/ebpfsentinel

docker run --network host --pid host \
  --cap-drop ALL \
  --cap-add NET_RAW \
  --cap-add NET_ADMIN \
  --cap-add CAP_SYS_PTRACE \
  --security-opt no-new-privileges:true \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  -v /proc:/host/proc:ro \
  -v /sys/fs/cgroup:/host/sys/fs/cgroup:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ebpfsentinel
```

The agent holds **no `CAP_BPF`** — the token authorizes every eBPF syscall.
`CAP_NET_RAW` is needed only for pcap capture, `CAP_NET_ADMIN` only for conntrack
flow-kill + Multi-WAN, and `CAP_SYS_PTRACE` only for host-process uprobe DLP;
drop any you do not use. `--pid host` is only needed for uprobe DLP against host
processes.

## Docker Compose

The default `docker-compose.yml` wires this automatically: a privileged,
run-once `bpf-token-setup` service mounts the delegated bpffs, then the agent
service runs rootless with `cap_drop: [ALL]` and only feature-scoped caps:

```yaml
services:
  bpf-token-setup:                # privileged, run-once — mounts the bpffs
    image: ebpfsentinel
    entrypoint:
      - /usr/local/bin/ebpfsentinel-token-setup.sh
      - /sys/fs/bpf/ebpfsentinel
    privileged: true
    network_mode: host
    volumes:
      - /sys/fs/bpf:/sys/fs/bpf:rshared
    restart: "no"

  agent:
    image: ebpfsentinel
    network_mode: host
    pid: host
    depends_on:
      bpf-token-setup:
        condition: service_completed_successfully
    cap_drop:
      - ALL
    cap_add:
      - NET_RAW                   # pcap capture
      - NET_ADMIN                 # conntrack flow-kill + Multi-WAN
    security_opt:
      - no-new-privileges:true
    volumes:
      - ./config:/etc/ebpfsentinel
      - /sys/fs/bpf:/sys/fs/bpf
      - /proc:/host/proc:ro
      - /sys/fs/cgroup:/host/sys/fs/cgroup:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

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
