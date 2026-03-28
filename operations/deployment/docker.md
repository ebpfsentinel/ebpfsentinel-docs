# Docker Deployment

> Most features are fully supported with `--privileged --network host`. DLP requires `--pid=host` for full process visibility. See the [deployment compatibility matrix](../../features/deployment-matrix.md) for details.

## Build

```bash
docker build -t ebpfsentinel .
```

## Run

eBPF requires elevated capabilities and `--network host`. On kernels 5.8+ (with `CAP_BPF` support), use fine-grained capabilities instead of `--privileged`:

```bash
docker run --network host \
  --cap-add CAP_BPF --cap-add CAP_NET_ADMIN \
  --cap-add CAP_SYS_ADMIN --cap-add CAP_NET_RAW \
  --security-opt no-new-privileges:true \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  ebpfsentinel
```

On older kernels (< 5.8), fall back to `--privileged`:

```bash
docker run --privileged --network host \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  ebpfsentinel
```

## Docker Compose

The default `docker-compose.yml` uses fine-grained capabilities:

```yaml
services:
  ebpfsentinel:
    image: ebpfsentinel
    network_mode: host
    cap_add:
      - CAP_BPF
      - CAP_NET_ADMIN
      - CAP_SYS_ADMIN
      - CAP_NET_RAW
    security_opt:
      - no-new-privileges:true
    volumes:
      - ./config:/etc/ebpfsentinel
      - /sys/fs/bpf:/sys/fs/bpf
```

If your kernel does not support `CAP_BPF` (pre-5.8), replace `cap_add` with `privileged: true`.

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

## Bind Address and Host Networking

With `network_mode: host`, the container shares the host network stack. The `bind_address` setting in your configuration controls which address the agent actually listens on:

```yaml
agent:
  bind_address: "127.0.0.1"    # Localhost-only, even in host networking
  # bind_address: "0.0.0.0"    # All interfaces (use with caution)
```

Setting `bind_address` to `127.0.0.1` restricts the API/gRPC endpoints to the loopback interface, meaning they are not reachable from other hosts even though the container uses host networking.

## Requirements

| Requirement | Reason |
|-------------|--------|
| `CAP_BPF`, `CAP_NET_ADMIN`, `CAP_SYS_ADMIN`, `CAP_NET_RAW` | eBPF program loading and network attachment (kernel 5.8+) |
| `--privileged` (fallback) | Required on older kernels without `CAP_BPF` support |
| `--network host` | XDP/TC programs attach to host interfaces |
| `/sys/fs/bpf` mount | BPF filesystem for map persistence |
| `no-new-privileges:true` | Prevents privilege escalation inside the container |

## Volumes

| Host Path | Container Path | Purpose |
|-----------|---------------|---------|
| `./config/` | `/etc/ebpfsentinel/` | Configuration |
| `/sys/fs/bpf` | `/sys/fs/bpf` | BPF filesystem |

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
