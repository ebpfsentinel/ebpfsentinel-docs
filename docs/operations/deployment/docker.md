# Docker Deployment

> Kernel 6.9+ only. eBPF loads **exclusively** through a BPF token, and there is
> **no capability-based fallback**. A deployment is always two containers: the
> privileged **warden** broker and the rootless **agent**. The agent drops every
> capability, self-unshares a user namespace, has the warden delegate a bpffs
> over a shared socket, and loads its own eBPF through a token against it.
> Without the warden the agent still starts, but it reaches API-only mode and
> attaches nothing. DLP across neighbouring containers additionally needs a
> read-only `/proc` bind mount at `/host/proc`, and no longer `pid: host`. See
> the [BPF token guide](bpf-token.md) and the
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
docker exec ebpfsentinel ebpfsentinel-agent metrics | grep bpf_token_used
# expect: ebpfsentinel_bpf_token_used 1
```

The agent image is distroless and carries no shell and no `curl`, so the check
goes through the agent's own CLI. Run inside the container it needs no
credential: it reads the key the agent drew for itself out of
`/var/lib/ebpfsentinel/auth/api-key`. With host networking a `curl -s
localhost:9090/metrics` from the host reaches the same endpoint, and the
counters are not authenticated unless `auth.metrics_auth_required` says so.

From the host, anything under `/api/v1` carries the key:

```bash
export EBPFSENTINEL_TOKEN=$(docker exec ebpfsentinel cat /var/lib/ebpfsentinel/auth/api-key)
curl -s -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" localhost:8080/api/v1/ebpf/status
```

The state volume is what keeps that key across a `docker compose up`
again; a container started without it draws a new one. Naming your own under
`auth.api_keys` in the config file replaces it.

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
      - ebpfsentinel-state:/var/lib/ebpfsentinel
      - ebpfsentinel-captures:/var/lib/ebpfsentinel/captures
      - type: tmpfs              # a container's /sys is read-only
        target: /sys/fs/bpf
        tmpfs:
          mode: 0o1777

volumes:
  warden-sock:
  ebpfsentinel-state:
  ebpfsentinel-captures:
```

The agent image's working directory is `/var/lib/ebpfsentinel`, owned by uid
65534, so the relative `data/*.redb` paths of the default config (audit, alerts,
rule change history) land in `/var/lib/ebpfsentinel/data/`, beside the GeoIP
databases and the telemetry installation identifier. A named volume there keeps
all of it across a container recreate: without it the stores live in the
container's writable layer. The telemetry identifier survives either way: the
compose file also mounts the host's `/etc/machine-id` read-only and the
identifier is derived from it, so the host keeps one name. On a host without
that file, drop the mount, and the identifier is random and lives in the
volume.

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

**The read-only `/proc:/host/proc` bind mount** is what makes DLP node-wide,
and `pid: host` is not needed for it: both services read the node's processes
through that mount (`EBPFSENTINEL_HOST_PROC`), and the uprobe link is created
against a path and a file offset with `pid = 0`, so it fires for every process
mapping the library whatever pid namespace it runs in. The mount lets the
containers read the node's command lines, which is the cost; drop it from both
services to scope DLP to the agent's own container, or keep it and narrow what
is inspected with `dlp.scope`.

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
  -v ebpfsentinel-state:/var/lib/ebpfsentinel \
  -v ebpfsentinel-captures:/var/lib/ebpfsentinel/captures \
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

The Docker enricher is off in the agent's own defaults and on in the
`docker-compose.yml` and `config/ebpfsentinel.yaml` this repository ships,
because the compose file is the Docker deployment and an alert carrying a
64-hex id there is an alert nobody reads. It needs the daemon socket mounted
read-only into the agent container
(`-v /var/run/docker.sock:/var/run/docker.sock:ro`).

With the socket, the agent opens `/events` and keeps the connection, so a
container created, started, stopped or removed while the agent runs is in the
metadata cache before its first packet is enriched; `/containers/{id}/json` is
the fallback for an id first seen before the stream was up. The stream
reconnects with a capped backoff and its backlog is bounded, so a daemon
restart costs enrichment for as long as it is down and nothing else.

What the mount costs, stated where it is made: the Docker API is root on the
host, and `:ro` prevents writes to the socket file rather than requests through
it. Every call the agent makes is a GET, the agent process is the one in this
deployment that is not root (65534), and the socket's group ownership is what
actually decides what that uid may do. The exposure is therefore what a
compromise of the agent would reach, not an extra privilege granted to the
host.

To run without it: remove the mount and set `container.docker.enabled: false`.
Alerts keep the container id, which the cgroup resolver produces from the
mounted host cgroup hierarchy and no socket, and lose the name, the image and
the labels. The agent says so once at startup, naming what is lost, rather than
enriching nothing in silence - and it says the same when the enricher is
enabled and no socket is at that path. See
[container awareness](../../features/container-awareness.md) for the full
reference.

### Containers coming and going

Each container's host-side `veth<id>` gets the TC chain the moment Docker
creates it, with no restart and nothing listed in `agent.interfaces`: the agent
hears the link on rtnetlink, waits 100 ms to fold a burst, attaches, and logs
`hot-plug: workload link attached` with the container id. A container stopped
releases its attachments; one recreated gets a new `veth<id>` name and is
attached under it. A `docker compose up` starting many containers costs one
attach each, and a burst large enough to overrun the socket makes the agent
re-read the link table rather than miss one, as it also does every 60 seconds.
Containers on a macvlan or ipvlan network are attached the same way. What
passes before the attach completes is measured by
`ebpfsentinel_link_attach_gap_seconds` and
`ebpfsentinel_link_attach_unguarded_packets_total`, described under
[workload link hot-plug](../../configuration/agent.md#workload-link-hot-plug).

### Published ports

Publishing a port (`-p 8080:80`, or `ports:` in a compose file) makes Docker
write a DNAT rule in the `nat` table's `PREROUTING` chain. The packet is
rewritten towards the container and routed through `FORWARD`, so a `DROP` in
the host's `INPUT` chain never sees it: the rule most operators write first
does nothing for a published port.

The XDP firewall runs on the receiving interface before netfilter, so the
packet it decides still carries the host's address and the published port. A
rule written against those refuses the packet before Docker translates it:

```yaml
firewall:
  enabled: true
  mode: block
  rules:
    - id: no-admin-from-outside
      priority: 10
      action: deny
      protocol: tcp
      dst_port: 8080    # the published port, not the container's 80
```

Name the published port, not the container's own: the translation has not
happened yet when the rule is decided. The interface the rule applies on is
the one the traffic arrives on, listed in `agent.interfaces`. The integration
suite proves it on every pull request: it shows the `INPUT` rule walked past,
then starts the agent with the deny rule and records nothing from the client in
a capture on the Docker bridge.

### Policy on the container's labels

The person who knows what a container may reach is usually the person who
wrote its compose file, so a container can carry its own egress policy in its
labels. Turn the reading on next to the enricher:

```yaml
container:
  docker:
    enabled: true
    label_policy: true
```

Four labels make up the vocabulary, and any other label under
`io.ebpfsentinel.` is refused as a typo rather than ignored:

| Label | Values | Default |
|-------|--------|---------|
| `io.ebpfsentinel.policy.mode` | `observe` or `enforce` | `observe` |
| `io.ebpfsentinel.policy.egress.deny` | destinations refused | none |
| `io.ebpfsentinel.policy.egress.allow` | destinations let through | none |
| `io.ebpfsentinel.policy.egress.default` | `allow` or `deny`, for a destination neither list names | `allow` |

A destination is `<protocol>[/<port>[-<port>]][@<address>[/<prefix>]]`, the
protocol being `tcp`, `udp` or `any`, and a list separates destinations with
commas. The deny list is examined first, then the allow list, then the
default. A web container that may answer on 443 and resolve names through one
resolver, and nothing else:

```yaml
services:
  web:
    image: nginx:1.27
    labels:
      io.ebpfsentinel.policy.mode: enforce
      io.ebpfsentinel.policy.egress.allow: "tcp/443, udp/53@10.0.0.2"
      io.ebpfsentinel.policy.egress.default: deny
```

A worker that may reach anything except mail and the management network,
counted rather than refused while it is being tried out:

```yaml
  worker:
    image: example/worker:2
    labels:
      io.ebpfsentinel.policy.egress.deny: "tcp/25, any@192.168.100.0/24"
```

The labels become ordinary workload rules whose selector is the container's
id, decided in the same cgroup hooks and listed by `firewall workload` beside
the rules from the configuration file, which always come first. They are read
when the agent starts and followed through the Docker event stream: a
container that is recreated with new labels is policed by the new ones
without a reload, and its rules go when it is removed. A container that stops
keeps its rules until it is removed, so a restart never comes back unpoliced
for a moment.

A label that cannot be read is never skipped over: a policy with one entry
left out is not the policy that was written. A container with any refused
label gets no label rule at all, the problem is logged, and
`ebpfsentinel-agent firewall labels` (or `GET /api/v1/firewall/workload/labels`)
names the container, the label and the reason. One container may name at
most 16 destinations across both lists, and the node as a whole carries at
most 64 workload rules; a container that would go past that is refused whole
rather than half-applied, and reported the same way.

The option loads the workload firewall's cgroup hooks even with no workload
rule in the file, and the agent refuses to start with it on when the kernel
refuses those hooks, since a label saying `enforce` on a container started
later would otherwise enforce nothing.

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
| no `--pid host` | both | the uprobe link carries a path and an offset rather than a pid, so neighbouring containers are reached through the read-only `/host/proc` mount |
| shared socket volume | both | the `warden-proto` control channel |

## Volumes

| Host Path | Container Path | Container | Purpose |
|-----------|---------------|-----------|---------|
| `warden-sock` (named volume) | `/run/ebpfsentinel` | warden (rw), agent (ro) | warden control socket |
| `./config/ebpfsentinel.yaml` | `/etc/ebpfsentinel/config.yaml` | agent | configuration, hot-reloaded on write |
| `ebpfsentinel-state` (named volume) | `/var/lib/ebpfsentinel` | agent | redb stores under `data/`, GeoIP databases, telemetry installation identifier |
| `ebpfsentinel-captures` (named volume) | `/var/lib/ebpfsentinel/captures` | agent | packet capture files (`{id}.pcap`) |
| `tmpfs` | `/sys/fs/bpf` | agent | mountpoint for the delegated bpffs |
| `/proc` | `/host/proc` (ro) | both | container resolver and DLP library discovery |
| `/sys/fs/cgroup` | `/sys/fs/cgroup` (ro) | agent | cgroup-id to container attribution |
| `/var/run/docker.sock` | `/var/run/docker.sock` (ro) | agent | Docker enricher: the `/events` stream and the inspect fallback. Removable, and the section above says what that costs |

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
up before the warden. It is also not the same as having a working datapath: a
wedged ring-buffer reader leaves the API answering, and what reports that is
`datapath_stalled_secs` on `/readyz`.

## Stopping a container

Both services carry `stop_grace_period: 30s`, over Compose's 10s default,
because the agent's own stop can take up to 20s: the servers drain in 5s, a
running capture closes its file inside that, and a stop waiting on the warden
can hold a brokered call for 10s. At the default, docker would `SIGKILL` a stop
that was proceeding correctly, which is how a capture file ends up truncated and
a redb store ends up needing recovery on the next start. The warden carries the
same number because the agent is stopped first and can be mid-call there.

Unlike the systemd units, there is no watchdog here: docker restarts a container
that exits, and nothing asks a running one whether it is still working. On
Docker the stall shows up on `/readyz` only, so point whatever watches the
deployment at that rather than at the process being up.
