# Docker Deployment

> Kernel 6.9+ only. eBPF loads **exclusively** through a BPF token, and there is
> **no capability-based fallback**. The image entrypoint is the privileged
> launcher (`ebpfsentinel-token-launch`); it sets up the delegated bpffs and
> creates the token **inside a child user namespace**, then execs the agent
> there — so the long-running agent runs unprivileged even though the container
> is granted `CAP_SYS_ADMIN` for the bootstrap. There is no separate init
> service. DLP requires `--pid=host` for full process visibility. See the
> [BPF token guide](bpf-token.md) and the
> [deployment compatibility matrix](../../features/deployment-matrix.md).

## Build

```bash
docker build -t ebpfsentinel .
```

## The BPF token creation phase

There is no separate setup step or init service — token creation happens
**in-process**, in the launcher, every time the container starts. The image
entrypoint is `ebpfsentinel-token-launch`, and the sequence is:

1. The launcher starts as container root (with `CAP_SYS_ADMIN`). It inherits an
   fd for every loaded kernel module's BTF object so module kfuncs resolve
   without `CAP_SYS_ADMIN` in the agent.
2. A child process unshares a **user namespace** and `fsopen("bpf")`; the
   privileged launcher applies `delegate_*=any` + `FSCONFIG_CMD_CREATE`, then the
   child `fsmount`s + `move_mount`s the delegated bpffs at
   `/sys/fs/bpf/ebpfsentinel`. (`BPF_TOKEN_CREATE` is `EOPNOTSUPP` outside a user
   namespace, which is why the launcher exists.)
3. The launcher pre-opens the `AF_PACKET` capture socket pool (so pcap works
   without `CAP_NET_RAW` in the agent) and execs the agent **inside that user
   namespace**.
4. The agent finds the delegated bpffs, calls `BPF_TOKEN_CREATE`, and
   loads/attaches every eBPF program through the token — holding no host
   capabilities.

Confirm the token was created (not an API-only fallback):

```bash
docker exec ebpfsentinel sh -c 'curl -s localhost:9090/metrics | grep bpf_token_used'
# expect: ebpfsentinel_bpf_token_used 1
```

## Run (rootless agent, privileged launcher)

The container needs `CAP_SYS_ADMIN` (bpffs delegation + module BTF fds) and the
ability to create a user namespace; the launcher drops into the userns before
exec'ing the agent, so the long-running agent is unprivileged. Mount `/proc`,
`/sys/fs/cgroup`, and the Docker socket read-only so the container resolver and
Docker enricher can attach workload metadata to every alert:

```bash
docker run --network host --pid host \
  --cap-add SYS_ADMIN \
  --cap-add NET_RAW \
  --security-opt apparmor=unconfined \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  -v /proc:/host/proc:ro \
  -v /sys/fs/cgroup:/host/sys/fs/cgroup:ro \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  ebpfsentinel
```

`CAP_SYS_ADMIN` is consumed by the **launcher** for bpffs delegation; the agent
it execs holds no host capabilities (the token authorizes every eBPF syscall).
`CAP_NET_RAW` lets the launcher open the `AF_PACKET` capture sockets it hands to
the agent (the cap is checked only at `socket()` time, so the userns agent reads
them without any capability of its own); drop it if you never capture.
`--pid host` is only needed for uprobe DLP against host processes.
`apparmor=unconfined` is required because the default Docker AppArmor profile
blocks the `mount`/`move_mount` syscalls the launcher uses for bpffs delegation.
The `-v /sys/fs/bpf:/sys/fs/bpf` mount is **mandatory**: a container's `/sys` is
read-only, so without a writable `/sys/fs/bpf` the launcher cannot create the
delegated bpffs mountpoint and the agent falls back to API-only mode. The host
bpffs is writable; bind it in (or use `--tmpfs /sys/fs/bpf` if the host has no
bpffs mounted).

> **conntrack flow-kill, Multi-WAN and VIP gratuitous-ARP** stay unavailable to
> the userns agent and `--cap-add NET_ADMIN` does **not** restore them (netlink
> re-checks the cap against the userns sender). The in-kernel equivalents
> (eBPF `IPS_DYING` flow-kill, `xdp-vip-announcer`) keep working. See the
> [BPF token guide](bpf-token.md#capability-matrix).

## Split-broker Compose (rootless agent)

To keep the agent container off `CAP_SYS_ADMIN` (non-root + `cap-drop: ALL`), run
the privileged bpffs delegation in a separate `broker` service:
`dist/docker-compose.broker.yml`. See the
[BPF token guide](bpf-token.md#split-broker-deployment-rootless-agent).

## Docker Compose

The default `docker-compose.yml` wires this automatically. There is a single
service: the image entrypoint (`ebpfsentinel-token-launch`) creates the token in
its child user namespace and execs the unprivileged agent — no separate setup
service:

```yaml
services:
  agent:
    image: ebpfsentinel
    # entrypoint is ebpfsentinel-token-launch (baked into the image); it sets up
    # the delegated bpffs + token in a child userns, then execs the agent there.
    network_mode: host
    pid: host
    cap_add:
      - SYS_ADMIN                 # launcher: bpffs delegation + module BTF fds
      - NET_RAW                   # launcher: pre-open AF_PACKET capture sockets
    security_opt:
      - apparmor=unconfined       # allow mount/move_mount for bpffs delegation
    volumes:
      - ./config:/etc/ebpfsentinel
      - /sys/fs/bpf:/sys/fs/bpf
      - /proc:/host/proc:ro
      - /sys/fs/cgroup:/host/sys/fs/cgroup:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

Set `EBPFSENTINEL_PCAP_POOL` (default 2) in the service `environment` to size
the capture-socket pool if you run many concurrent captures.

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
| `CAP_SYS_ADMIN` (launcher only) | bpffs delegation + module BTF fds + user-namespace creation during bootstrap; the agent it execs holds no host caps |
| `CAP_NET_RAW` (launcher only, optional) | pre-open the `AF_PACKET` pcap capture sockets passed to the agent |
| `apparmor=unconfined` | the default Docker profile blocks `mount`/`move_mount` used for bpffs delegation |
| unprivileged user namespaces enabled on the host | `BPF_TOKEN_CREATE` is only valid inside a user namespace |
| `--network host` | XDP/TC programs attach to host interfaces |
| `--pid host` | Uprobe DLP visibility across host processes |
| `/sys/fs/bpf` mount | BPF filesystem for map persistence |
| `/proc` mount (read-only) | Container resolver reads `cgroup` per pid |
| `/sys/fs/cgroup` mount (read-only) | Cgroup introspection |
| `/var/run/docker.sock` mount (read-only, optional) | Docker enricher metadata lookups |

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
