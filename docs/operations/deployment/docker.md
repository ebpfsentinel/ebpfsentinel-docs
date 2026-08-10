# Docker Deployment

> Kernel 6.9+ only. eBPF loads **exclusively** through a BPF token, and there is
> **no capability-based fallback**. A deployment is always two containers: the
> privileged **warden** broker and the rootless **agent**. The agent drops every
> capability, self-unshares a user namespace, has the warden delegate a bpffs
> over a shared socket, and loads its own eBPF through a token against it.
> Without the warden the agent still starts, but it reaches API-only mode and
> attaches nothing. DLP across neighbouring containers additionally needs
> `pid: host`. See the [BPF token guide](bpf-token.md) and the
> [deployment compatibility matrix](../../features/deployment-matrix.md).

## Images

| Image | Contents |
|-------|----------|
| `ghcr.io/ebpfsentinel/ebpfsentinel` | the agent and the compiled eBPF programs |
| `ghcr.io/ebpfsentinel/ebpfsentinel-warden` | the warden broker, static binary on distroless |

Both are multi-arch (`linux/amd64`, `linux/arm64`) and cosign-signed. To build
them from a checkout instead:

```bash
docker build -f Dockerfile.agent  -t ebpfsentinel .
docker build -f Dockerfile.warden -t ebpfsentinel-warden .
```

## What the split does at startup

1. The **warden** starts first, holding `CAP_SYS_ADMIN` / `CAP_NET_ADMIN` /
   `CAP_NET_RAW` (plus `CAP_BPF`, `CAP_PERFMON` and `CAP_SYS_PTRACE` for the DLP
   uprobe) in the initial namespaces, and serves the typed `warden-proto` RPC on
   an `AF_UNIX` socket in a shared volume. It loads no eBPF and holds no maps.
2. The **agent** starts as uid 65534 with `cap_drop: ALL`, connects to that
   socket (`EBPFSENTINEL_WARDEN_SOCK`) and unshares a user namespace.
3. It `fsopen("bpf")`s and passes the fd to the warden over `SCM_RIGHTS`; the
   warden stamps `delegate_*=any` + `FSCONFIG_CMD_CREATE` on it and hands it
   back. Only that one step needs `CAP_SYS_ADMIN` in the initial user namespace.
4. The agent mounts the delegated bpffs, calls `BPF_TOKEN_CREATE` (`EOPNOTSUPP`
   outside a user namespace, which is why the split exists) and loads and
   attaches every program through the token, holding no host capability.

Confirm the token was created, rather than an API-only fallback:

```bash
docker exec ebpfsentinel sh -c 'curl -s localhost:9090/metrics | grep bpf_token_used'
# expect: ebpfsentinel_bpf_token_used 1
```

## Docker Compose

`docker-compose.yml` in the repository root wires both services and the shared
socket volume. Three host-level prerequisites first:

```bash
# 1. The agent runs as uid 65534 and rejects a world-readable config.
sudo chown 65534:65534 config/ebpfsentinel.yaml
sudo chmod 640 config/ebpfsentinel.yaml

# 2. On Ubuntu 24.04+ (any host with kernel.apparmor_restrict_unprivileged_userns=1),
#    a non-root process cannot create a user namespace. Allow it host-wide:
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
#    or scope it to the binary with dist/apparmor.d/ebpfsentinel-agent.

# 3. SYN-cookie DDoS protection, if enabled, reads a host sysctl.
sudo sysctl -w net.ipv4.tcp_syncookies=2
```

```bash
docker compose up -d
docker compose logs -f
docker compose kill -s HUP ebpfsentinel   # reload config
docker compose down
```

The shape of the two services:

```yaml
services:
  warden:
    image: ghcr.io/ebpfsentinel/ebpfsentinel-warden
    command: ["serve", "/run/ebpfsentinel/warden.sock", "--uid", "65534"]
    network_mode: host           # conntrack, routes, ARP in the init netns
    pid: host                    # reach a neighbour's /proc/<pid>/root for DLP
    cap_drop: [ALL]
    cap_add: [SYS_ADMIN, NET_ADMIN, NET_RAW, SYS_PTRACE, BPF, PERFMON]
    security_opt:
      - apparmor=unconfined      # delegation does fsconfig/move_mount
      - seccomp=unconfined       # mount/bpf/netlink syscalls
    volumes:
      - warden-sock:/run/ebpfsentinel
      - /proc:/host/proc:ro

  agent:
    image: ghcr.io/ebpfsentinel/ebpfsentinel
    depends_on: [warden]
    environment:
      EBPFSENTINEL_WARDEN_SOCK: /run/ebpfsentinel/warden.sock
      EBPFSENTINEL_HOST_PROC: /host/proc
    network_mode: host           # XDP/TC attach to host interfaces
    pid: host                    # node-wide TLS DLP
    user: "65534:65534"
    cap_drop: [ALL]              # the warden holds every host capability
    security_opt:
      - seccomp=./dist/seccomp/ebpfsentinel-agent.json
      - apparmor=unconfined
    volumes:
      - ./config/ebpfsentinel.yaml:/etc/ebpfsentinel/config.yaml
      - /sys/fs/cgroup:/sys/fs/cgroup:ro
      - /proc:/host/proc:ro
      - warden-sock:/run/ebpfsentinel:ro
      - type: tmpfs              # a container's /sys is read-only
        target: /sys/fs/bpf
        tmpfs:
          mode: 0o1777

volumes:
  warden-sock:
```

Two of those lines are easy to get wrong:

- **`seccomp=./dist/seccomp/ebpfsentinel-agent.json`** is the Docker default
  profile plus an unconditional allow for the `unshare` / `mount` family / `bpf`
  syscalls. The agent issues them while holding no `CAP_SYS_ADMIN`, and the
  default profile gates exactly those on that capability. This is strictly
  tighter than `seccomp=unconfined`; the path resolves from the compose working
  directory, so run `docker compose` from the repository root.
- **The `tmpfs` at `/sys/fs/bpf`** is mandatory. A container's `/sys` is
  read-only, so without a writable mountpoint the agent cannot mount the
  delegated bpffs and falls back to API-only mode.

`pid: host` lets the agent and the warden see every process on the node, which
is the irreducible cost of node-wide DLP. Drop it from both services to scope
DLP to the agent's own container.

## Without Compose

The same two containers by hand, sharing a named volume:

```bash
docker volume create warden-sock

docker run -d --name ebpfsentinel-warden \
  --network host --pid host \
  --cap-drop ALL \
  --cap-add SYS_ADMIN --cap-add NET_ADMIN --cap-add NET_RAW \
  --cap-add SYS_PTRACE --cap-add BPF --cap-add PERFMON \
  --security-opt apparmor=unconfined --security-opt seccomp=unconfined \
  -v warden-sock:/run/ebpfsentinel \
  -v /proc:/host/proc:ro \
  ghcr.io/ebpfsentinel/ebpfsentinel-warden

docker run -d --name ebpfsentinel \
  --network host --pid host \
  --user 65534:65534 --cap-drop ALL \
  --security-opt seccomp=./dist/seccomp/ebpfsentinel-agent.json \
  --security-opt apparmor=unconfined \
  -e EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock \
  -e EBPFSENTINEL_HOST_PROC=/host/proc \
  -v ./config/ebpfsentinel.yaml:/etc/ebpfsentinel/config.yaml \
  -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
  -v /proc:/host/proc:ro \
  -v warden-sock:/run/ebpfsentinel:ro \
  --tmpfs /sys/fs/bpf:mode=1777 \
  ghcr.io/ebpfsentinel/ebpfsentinel
```

> **conntrack flow-kill, Multi-WAN and VIP gratuitous-ARP** are not lost in this
> model: the agent cannot perform them from its user namespace, so it brokers
> them to the warden, which lives in the initial network namespace. Adding
> `--cap-add NET_ADMIN` to the *agent* would not help either way, because
> netlink re-checks the capability against the sending namespace. See the
> [capability matrix](bpf-token.md#capability-matrix).

## Container Awareness Configuration

The container resolver maps a packet's cgroup id, recovered on the TC egress
hook, to the owning container by walking the host cgroup hierarchy. The
container's own `/sys/fs/cgroup` is a namespaced subtree that lacks the host
inodes, which is why the read-only host mount above is required.

```yaml
container:
  resolver:
    enabled: true
    proc_path: /host/proc          # matches EBPFSENTINEL_HOST_PROC
    cgroup_root: /sys/fs/cgroup    # the read-only host mount
  docker:
    enabled: true                  # optional Docker enricher
    socket: /var/run/docker.sock
    cache_size: 1024
    cache_ttl_seconds: 300
    timeout_ms: 2000
```

The Docker enricher is off by default. Enabling it also needs the daemon socket
mounted read-only into the agent container
(`-v /var/run/docker.sock:/var/run/docker.sock:ro`); the agent then calls
`/containers/{id}/json` to attach container name, image and labels to every
alert. See [container awareness](../../features/container-awareness.md) for the
full reference.

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

| Requirement | Container | Reason |
|-------------|-----------|--------|
| `CAP_SYS_ADMIN` | warden | bpffs delegation (`fsconfig` + `FSCONFIG_CMD_CREATE`) and module BTF fds |
| `CAP_NET_ADMIN` | warden | conntrack teardown and route programming over netlink |
| `CAP_NET_RAW` | warden | `AF_PACKET` pcap sockets and gratuitous ARP |
| `CAP_SYS_PTRACE`, `CAP_BPF`, `CAP_PERFMON` | warden | read a neighbour container's `/proc/<pid>/root` and create the DLP uprobe link |
| `apparmor=unconfined`, `seccomp=unconfined` | warden | the default profiles block the `mount` family and netlink |
| no capability at all | agent | the whole point of the split; the token authorises every eBPF syscall |
| tailored seccomp profile | agent | the default profile gates `unshare`/`mount`/`bpf` on a capability the agent does not hold |
| unprivileged user namespaces enabled on the host | agent | `BPF_TOKEN_CREATE` is only valid inside a user namespace |
| `--network host` | both | XDP/TC attach to host interfaces; the warden programs the init netns |
| `--pid host` | both | uprobe DLP against processes in neighbouring containers |
| shared socket volume | both | the `warden-proto` control channel |

## Volumes

| Host Path | Container Path | Container | Purpose |
|-----------|---------------|-----------|---------|
| `warden-sock` (named volume) | `/run/ebpfsentinel` | warden (rw), agent (ro) | warden control socket |
| `./config/ebpfsentinel.yaml` | `/etc/ebpfsentinel/config.yaml` | agent | configuration, hot-reloaded on write |
| `tmpfs` | `/sys/fs/bpf` | agent | mountpoint for the delegated bpffs |
| `/proc` | `/host/proc` (ro) | both | container resolver and DLP library discovery |
| `/sys/fs/cgroup` | `/sys/fs/cgroup` (ro) | agent | cgroup-id to container attribution |
| `/var/run/docker.sock` | `/var/run/docker.sock` (ro) | agent | Docker enricher, optional |

## Health Check

The image ships its own health check, so no `curl` is needed in the container:

```bash
docker exec ebpfsentinel ebpfsentinel-agent health
```

`Dockerfile.agent` already declares it:

```yaml
healthcheck:
  test: ["CMD", "ebpfsentinel-agent", "health"]
  interval: 10s
  timeout: 5s
  retries: 3
  start_period: 10s
```

A container reporting healthy has answered on its API, which is not the same as
having attached: check `ebpfsentinel_bpf_token_used` as well if the agent came
up before the warden.
