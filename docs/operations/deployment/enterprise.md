# Enterprise Deployment (rootless split)

The enterprise agent ships in the same **rootless split** posture as the OSS
agent: a fully unprivileged agent (uid 65534, every capability dropped) paired
with a privileged **enterprise-warden** broker. The warden is the OSS warden plus
one addition - it serves the enterprise **proc-TLS scan** (extended-TLS discovery
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
  gate - an in-container/in-pod Unconfined profile does **not** lift it. Either:
  - set `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0`
    (persist via `/etc/sysctl.d/`), or
  - load a per-binary AppArmor profile granting `userns` (the bundled
    `dist/apparmor.d/ebpfsentinel-enterprise-agent`).
- A signed **license**. Without one the agent runs in OSS mode (every enterprise
  feature inert). Provide it at `/etc/ebpfsentinel/license.key`, via
  `EBPFSENTINEL_LICENSE`, or `enterprise.license_path` in the config.

## What the agent checks before it starts

The version floor is a proxy for capability, not capability itself: helpers get
backported into older trees and distributions compile features out. Before the
version gate runs, the enterprise agent asks the running kernel which helpers it
will accept for each program type, and the result decides the boot:

| Outcome | What it means | What the agent does |
|---------|---------------|---------------------|
| Verified | Every helper every object needs is accepted | Starts normally |
| Unverified | The probe itself could not run, so nothing was measured | Starts normally, logs a WARN carrying `helper_support="unverified"` and the reason. Nothing is refused on this basis |
| Degraded | Some objects need a helper the kernel rejects | Starts, skips those objects, and names each one |
| Refused | No object can load | Exits with code `2`, naming the missing helper rather than only the kernel version |

Refusal is reserved for the total case on purpose. A kernel that starves every
object is not one this agent can protect anything on, but a kernel that starves
one object still runs the rest, and refusing there would trade a partial
datapath for none.

The unverified case is the normal one on a rootless deployment: the probe issues
real `BPF_PROG_LOAD` calls, which need `CAP_BPF`, and the BPF-token path
deliberately holds no capabilities. It means "not measured", never "missing".

The detail is served on the enterprise API, reading the cached result without
issuing further kernel calls:

```bash
curl -s http://127.0.0.1:8444/api/v1/ebpf/kernel-features
```

Three signals a log aggregator can key on distinguish an unverified boot: the
WARN level, the `helper_support="unverified"` field, and the phrase stating that
helper support was not verified.

## Bare metal (systemd)

The release tarball carries the agent, the `ebpfsentinel-license` CLI and the
two licence signing public keys, and nothing else: no warden, no eBPF objects,
no units. A bare-metal install is therefore built from the enterprise checkout,
with the OSS repository beside it:

```bash
# eBPF objects, from the OSS repository
(cd ../ebpfsentinel && cargo xtask ebpf-build)
cargo build --release --bin ebpfsentinel-enterprise-agent --bin enterprise-warden --bin ebpfsentinel-license

# Stage what install.sh expects next to it
cp target/release/{ebpfsentinel-enterprise-agent,enterprise-warden,ebpfsentinel-license} dist/
mkdir -p dist/ebpf && cp ../ebpfsentinel/target/bpfel-unknown-none/release/* dist/ebpf/
cp config/ebpfsentinel.yaml dist/

sudo ./dist/install.sh
sudo install -m 0640 my-license.key /etc/ebpfsentinel/license.key
sudo systemctl enable --now ebpfsentinel-enterprise-warden ebpfsentinel-enterprise
journalctl -u ebpfsentinel-enterprise -u ebpfsentinel-enterprise-warden -f
```

`install.sh` reads everything from its own directory. It checks the kernel
version and BTF, then:

- installs `ebpfsentinel-enterprise-agent`, `enterprise-warden` and
  `ebpfsentinel-license` into `/usr/local/bin/`;
- copies the eBPF objects into `/usr/local/lib/ebpfsentinel/`;
- installs the config to `/etc/ebpfsentinel/config.yaml` with mode `0640`, and
  leaves an existing one untouched;
- creates `/var/lib/ebpfsentinel/`, `captures/` and `data/` under it;
- installs both units and runs `systemctl daemon-reload`;
- on hosts where `kernel.apparmor_restrict_unprivileged_userns=1`, loads the
  per-binary AppArmor profile, or installs the sysctl drop-in when
  `apparmor_parser` is absent.

It enables and starts nothing.

What the units do:

- **`ebpfsentinel-enterprise-warden.service`** runs
  `enterprise-warden serve /run/ebpfsentinel/warden.sock --uid 0`, with
  `RuntimeDirectory=ebpfsentinel` creating the socket directory.
- **`ebpfsentinel-enterprise.service`** sets `EBPFSENTINEL_WARDEN_SOCK` and
  `EBPFSENTINEL_LICENSE=/etc/ebpfsentinel/license.key`, waits up to ten seconds
  for the warden socket, then runs
  `ebpfsentinel-enterprise-agent --config /etc/ebpfsentinel/config.yaml` from
  `/var/lib/ebpfsentinel`, where the relative `data/*.redb` paths resolve. It
  `Wants` rather than `Requires` the warden, so a warden restart does not stop
  the agent.

On bare metal the two share the host PID namespace, so the warden reads `/proc`
directly and no `/host/proc` mount is needed. The enterprise API listens on
`127.0.0.1:8444` unless `--bind-address` says otherwise.

The enterprise agent builds its datapath once at boot: it has no config file
watcher, no SIGHUP handling and no reload route, so the unit carries no
`ExecReload` and a config edit takes `systemctl restart ebpfsentinel-enterprise`.

## Docker Compose

`docker-compose.yml` defines the two services sharing a socket volume:

```bash
# Place a signed license next to the compose file (the file MUST exist - Docker
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
The license is mounted at `/etc/ebpfsentinel/license.key`, the path the shipped
config names in `enterprise.license_path`.

The agent's state lives on the `ebpfsentinel-state` volume at
`/var/lib/ebpfsentinel`, the image's working directory and owned by 65534: the
redb stores under `data/`, GeoIP databases and the telemetry installation
identifier. Captures go to the `ebpfsentinel-captures` volume under it. A config
edit takes `docker compose restart agent`.

## Kubernetes (Helm)

The `charts/ebpfsentinel-enterprise` chart deploys one agent per node as a
DaemonSet with the warden as a **native sidecar** (init container with
`restartPolicy: Always`, Kubernetes 1.29+). The release publishes the OSS and
dashboard charts only, so this one is installed from a checkout of
`ebpfsentinel-enterprise`:

```bash
git clone https://github.com/ebpfsentinel/ebpfsentinel-enterprise.git && cd ebpfsentinel-enterprise
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
(`SYS_ADMIN, NET_ADMIN, NET_RAW, SYS_PTRACE, BPF, PERFMON`); the agent stays
`cap-drop: ALL`. Both containers mount host `/proc` read-only at `/host/proc`,
and the agent also mounts host `/sys/fs/cgroup` read-only for cgroup attribution.
The config is a ConfigMap whose checksum is a pod annotation, so a values change
rolls the DaemonSet. The chart mounts no state volume: the redb stores, GeoIP
databases and captures live in the container filesystem and go with the pod. The
chart exposes the enterprise API (8444) and the HA peer gRPC port (9443), and
nothing else: this binary opens one HTTP listener, so the REST surface,
`/metrics` and the `/healthz` and `/readyz` probes are all served on 8444 and
the OSS agent's own 8080, 50051 and 9090 are never started. The enterprise API
terminates no TLS of its own, so put a proxy in front of it if it leaves the
node. The HA port carries no authentication and no TLS either, so it must reach
the HA peers and nothing else - see
the [gRPC API reference](../../api-reference/grpc-api.md).

> On Ubuntu 24.04+ nodes, set `kernel.apparmor_restrict_unprivileged_userns=0`
> per node (a privileged init DaemonSet, a node-bootstrap MachineConfig, or
> `/etc/sysctl.d/`) - the in-pod Unconfined profiles do not lift that host gate.
