# Enterprise Deployment (rootless split)

The enterprise agent ships in the same **rootless split** posture as the OSS
agent: a fully unprivileged agent (uid 65534, every capability dropped) paired
with a privileged **enterprise-warden** broker. The warden is the OSS warden plus
one addition — it serves the enterprise **proc-TLS scan** (extended-TLS discovery
of Go / Java / static BoringSSL / kTLS / GnuTLS usage) over the same socket. A
single privileged daemon therefore backs the whole rootless enterprise agent.

| Half | Runs as | Holds | Role |
|------|---------|-------|------|
| `enterprise-warden` | root | `CAP_SYS_ADMIN`, `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`, `BPF`, `PERFMON` | bpffs delegation, conntrack, routes, ARP, pcap pool, DLP uprobe, extended-TLS `/proc` scan |
| `enterprise-agent` | uid 65534, `cap-drop: ALL` | nothing | self-unshares a user namespace, loads its own eBPF through a BPF token; brokers privileged ops to the warden |

The agent reaches the warden over an `AF_UNIX` socket given by
`EBPFSENTINEL_WARDEN_SOCK`. When that variable is unset the agent falls back to
reading `/proc` directly (bare-metal root). The extended-TLS scan is brokered
whenever the socket is set, so the rootless agent never needs `CAP_SYS_PTRACE`.

## Prerequisites

- Linux kernel **6.9+** with BTF (`/sys/kernel/btf/vmlinux`).
- Unprivileged user namespaces enabled. On kernels that gate them behind AppArmor
  (`kernel.apparmor_restrict_unprivileged_userns=1`, the Ubuntu 24.04+ default)
  the agent (uid 65534) cannot self-unshare a userns. This is a **host-level**
  gate — an in-container/in-pod Unconfined profile does **not** lift it. Either:
  - set `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
    (persist via `/etc/sysctl.d/`), or
  - load a per-binary AppArmor profile granting `userns` (the bundled
    `dist/apparmor.d/ebpfsentinel-enterprise-agent`).
- A signed **license**. Without one the agent runs in OSS mode (every enterprise
  feature inert). Provide it at `/etc/ebpfsentinel/license.key`, via
  `EBPFSENTINEL_LICENSE`, or `enterprise.license_path` in the config.

## Bare metal (systemd)

The `dist/` directory ships two units and an installer:

```bash
# From a directory holding the built binaries (ebpfsentinel-enterprise-agent,
# enterprise-warden, ebpfsentinel-license), the dist/ files and ebpfsentinel.yaml:
sudo ./dist/install.sh
sudo cp my-license.key /etc/ebpfsentinel/license.key
sudo systemctl enable --now ebpfsentinel-enterprise-warden ebpfsentinel-enterprise
journalctl -u ebpfsentinel-enterprise -u ebpfsentinel-enterprise-warden -f
```

The agent unit `Wants` (not `Requires`) the warden and waits for its socket before
starting; a warden restart does not tear the agent down. On bare metal the two
share the host PID namespace, so the warden reads `/proc` directly — no
`/host/proc` mount is needed.

## Docker Compose

`docker-compose.yml` defines the two services sharing a socket volume:

```bash
# Place a signed license next to the compose file (the file MUST exist — Docker
# creates a directory in its place if absent), then bring the stack up:
cp my-license.key ./license.key
sudo chown 65534:65534 ./config/ebpfsentinel.yaml && sudo chmod 640 ./config/ebpfsentinel.yaml
docker compose up -d
docker compose logs -f
```

The `warden` service holds the host capabilities and bind-mounts host `/proc`
read-only at `/host/proc` (`EBPFSENTINEL_HOST_PROC`) for the cross-container
proc-TLS scan; both services run `network_mode: host` and `pid: host`. The agent
runs as `65534:65534`, `cap-drop: ALL`, with the tailored
`dist/seccomp/ebpfsentinel-agent.json` profile (the Docker default plus an
allow-list for the `unshare`/`mount`/`bpf` syscalls the rootless bootstrap needs).

## Kubernetes (Helm)

The `charts/ebpfsentinel-enterprise` chart deploys one agent per node as a
DaemonSet with the warden as a **native sidecar** (init container with
`restartPolicy: Always`, Kubernetes 1.28+):

```bash
helm install ent charts/ebpfsentinel-enterprise \
  --namespace ebpfsentinel --create-namespace \
  --set image.repository=ghcr.io/ebpfsentinel/ebpfsentinel-enterprise \
  --set wardenImage.repository=ghcr.io/ebpfsentinel/ebpfsentinel-enterprise-warden \
  --set 'agent.interfaces={eth0}' \
  --set-file license.key=./my-license.key
```

Provide the license either inline (`--set-file license.key=…`, which creates a
Secret) or by referencing an existing one (`--set license.secretName=…` whose
`license.key` data entry holds the signed license). It is mounted read-only at
`/etc/ebpfsentinel-license/license.key` (the chart's `enterprise.license_path`).

Key values:

| Value | Default | Purpose |
|-------|---------|---------|
| `agent.interfaces` | `[eth0]` | Host NICs to attach eBPF to (REQUIRED) |
| `license.secretName` / `license.key` | `""` | Enterprise license (OSS mode if unset) |
| `extendedTls.enabled` | `true` | Warden-brokered extended-TLS `/proc` scan |
| `daemonset.hostPID` | `true` | Node-wide DLP visibility (set `false` to scope to the pod) |
| `daemonset.bpfToken.bpffsEmptyDir` | `false` | Use an in-pod tmpfs bpffs on nested runtimes (kind, minikube) |

The warden holds the host capabilities
(`SYS_ADMIN, NET_ADMIN, NET_RAW, SYS_PTRACE, BPF, PERFMON`) and mounts host
`/proc` and `/sys/fs/cgroup` read-only; the agent stays `cap-drop: ALL`. The
chart exposes the OSS API (8080), gRPC (50051), metrics (9090), the enterprise
HTTPS API (8444) and the HA peer gRPC port (9443).

> On Ubuntu 24.04+ nodes, set `kernel.apparmor_restrict_unprivileged_userns=0`
> per node (a privileged init DaemonSet, a node-bootstrap MachineConfig, or
> `/etc/sysctl.d/`) — the in-pod Unconfined profiles do not lift that host gate.
