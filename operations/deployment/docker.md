# Docker Deployment

## Build

```bash
docker build -t ebpfsentinel .
```

## Run

eBPF requires `--privileged` and `--network host`:

```bash
docker run --privileged --network host \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  ebpfsentinel
```

## Docker Compose

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

## Requirements

| Requirement | Reason |
|-------------|--------|
| `--privileged` | eBPF program loading requires elevated privileges |
| `--network host` | XDP/TC programs attach to host interfaces |
| `/sys/fs/bpf` mount | BPF filesystem for map persistence |

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
