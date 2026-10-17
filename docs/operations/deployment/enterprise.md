# Enterprise Deployment (rootless split)

The enterprise agent ships in the same **rootless split** posture as the OSS
agent: a fully unprivileged agent (uid 65534, every capability dropped) paired
with a privileged **enterprise-warden** broker. The warden is the OSS warden plus
one addition - it serves the enterprise **proc-TLS scan** (extended-TLS discovery
of the TLS libraries the OSS agent cannot reach) over the same socket. A
single privileged daemon therefore backs the whole rootless enterprise agent.

| Half | Runs as | Holds | Role |
|------|---------|-------|------|
| `enterprise-warden` | root | `CAP_SYS_ADMIN`, `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`, `BPF`, `PERFMON` | bpffs delegation, conntrack, routes, ARP, pcap pool, DLP uprobe, extended-TLS `/proc` scan |
| `enterprise-agent` | uid 65534, `cap-drop: ALL` | nothing | self-unshares a user namespace, loads its own eBPF through a BPF token; brokers privileged ops to the warden |

The agent reaches the warden over an `AF_UNIX` socket given by
`EBPFSENTINEL_WARDEN_SOCK`. When that variable is unset the agent falls back to
reading `/proc` directly (bare-metal root). The extended-TLS scan is brokered
whenever the socket is set, so the rootless agent never needs `CAP_SYS_PTRACE`.

Where the licence key and the join secret used below come from, and how to
confirm afterwards that every node is reporting, is walked in
[From purchase to reporting agents](../../getting-started/from-purchase-to-reporting-agents.md).

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

The release tarball carries everything `install.sh` reads: the agent,
`enterprise-warden`, the `ebpfsentinel-license` CLI, the eBPF objects under
`ebpf/`, the default config, both units, the AppArmor profile and the sysctl
drop-in, plus the two licence signing public keys and the licence agreements the
software is used under: `EULA.md` for an organisation running it on its own
infrastructure, `EULA-MSSP.md` for a provider reselling it to the customers it
manages, each with its French version (`EULA.fr.md`, `EULA-MSSP.fr.md`), which
prevails for a licensee established in France. The container image carries the
same four files under `/usr/share/doc/ebpfsentinel-enterprise/`. Each release on the
[releases page](https://github.com/ebpfsentinel/ebpfsentinel-release/releases) carries one per architecture, with its signature:

```bash
curl -fsSLO https://github.com/ebpfsentinel/ebpfsentinel-release/releases/download/v<release>/ebpfsentinel-enterprise-<version>-linux-<arch>.tar.gz
tar xzf ebpfsentinel-enterprise-<version>-linux-<arch>.tar.gz
cd ebpfsentinel-enterprise-<version>-linux-<arch>
sudo ./install.sh
sudo install -m 0640 my-license.key /etc/ebpfsentinel/license.key
sudo systemctl enable --now ebpfsentinel-enterprise-warden ebpfsentinel-enterprise
journalctl -u ebpfsentinel-enterprise -u ebpfsentinel-enterprise-warden -f
```

To install from the enterprise checkout instead, with the OSS repository beside
it, stage the same layout next to `dist/install.sh`:

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

### Restart, watchdog and stop budget

Both units carry the same four numbers as the community ones, for the same
reasons, which the
[binary deployment guide](binary.md#restart-watchdog-and-stop-budget) states in
full: `WatchdogSec=90s` fed by a ping every 45s, `TimeoutStopSec=20s`,
`StartLimitBurst=5` over `StartLimitIntervalSec=300`, and `NotifyAccess=main`
without which systemd would refuse the ping and kill a healthy agent every 90s.

One difference belongs to this edition. The ping is withheld when the datapath
has gone 60s without a ring-buffer pass, and an HA standby drains nothing by
design: it has never passed, which is read as having nothing to stall rather
than as a stall, so a follower is never restarted for being a follower. The
same holds on `/readyz`, where `datapath_stalled_secs` is reported on an active
node and left out on a standby.

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
`restartPolicy: Always`, Kubernetes 1.29+). Each release publishes it
beside the OSS chart, signed the same way, at
`oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-enterprise`:

```bash
helm install ebpfsentinel-enterprise oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-enterprise \
  --version <version> \
  --namespace ebpfsentinel --create-namespace \
  --set image.repository=ghcr.io/ebpfsentinel/ebpfsentinel-enterprise \
  --set wardenImage.repository=ghcr.io/ebpfsentinel/ebpfsentinel-enterprise-warden \
  --set 'agent.interfaces={eth0}' \
  --set-file license.key=./my-license.key
```

From a checkout of `ebpfsentinel-enterprise`, install the chart directory
`charts/ebpfsentinel-enterprise` with the same values instead.

Provide the license either inline (`--set-file license.key=…`, which creates a
Secret) or by referencing an existing one (`--set license.secretName=…` whose
`license.key` data entry holds the signed license). It is mounted read-only at
`/etc/ebpfsentinel-license/license.key` (the chart's `enterprise.license_path`).

The agent keeps its state under `/var/lib/ebpfsentinel`: the redb stores
under `data/`, captures, GeoIP databases, the portal enrolment under `portal/`,
and the HA, federation and analytics stores. The chart mounts a `state` volume
there, a node directory by default at
`/var/lib/ebpfsentinel/k8s/<namespace>/<release>`, so an agent reporting to the
portal keeps its enrolment across a rollout. Kubernetes applies no `fsGroup` to
a hostPath, so a `state-dir` init container runs `enterprise-warden
prepare-state` once as root, with `CHOWN` and `FOWNER` alone, to create the
directory at `0700` and hand it to the agent's uid. `daemonset.state.ephemeral`
puts it on an `emptyDir` instead, which survives a container restart but not
the pod being replaced: the agent then joins the portal again after every
rollout.

Key values:

| Value | Default | Purpose |
|-------|---------|---------|
| `agent.interfaces` | `[eth0]` | Host NICs to attach eBPF to (REQUIRED) |
| `license.secretName` / `license.key` | `""` | Enterprise license (OSS mode if unset) |
| `extendedTls.enabled` | `true` | Warden-brokered extended-TLS `/proc` scan |
| `daemonset.hostPID` | `true` | Node-wide DLP visibility (set `false` to scope to the pod) |
| `daemonset.bpfToken.bpffsEmptyDir` | `false` | Use an in-pod tmpfs bpffs on nested runtimes (kind, minikube) |
| `daemonset.state.hostPath` | `""` | Host directory backing `/var/lib/ebpfsentinel`; empty means `/var/lib/ebpfsentinel/k8s/<namespace>/<release>` |
| `daemonset.state.ephemeral` | `false` | Keep the state in an `emptyDir`, lost when the pod is replaced |
| `daemonset.preStopSleepSeconds` | `5` | Seconds the agent is held before `SIGTERM`, so the endpoint leaves every node's rules first; `0` removes the hook |
| `daemonset.terminationGracePeriodSeconds` | `30` | Covers that hook and the agent's 20s stop budget together |
| `portal.enabled` | `false` | Enrol with the vendor portal and report in |
| `portal.baseUrl` | `""` | Where the portal answers (required when enabled) |
| `portal.agentName` | `""` | Name each agent reports under; empty means the node's host name |
| `portal.joinSecret.secretName` / `portal.joinSecret.key` | `""` / `join-secret` | Existing Secret holding the join secret (required when enabled) |
| `portal.telemetry.enabled` | `false` | Send the optional analytics readings |
| `portal.telemetry.intervalSeconds` | `300` | Gap between two readings, held between 60 and 86400 |
| `portal.ingestSecret.secretName` / `portal.ingestSecret.key` | `""` / `ingest-secret` | Existing Secret holding the ingest secret (required when telemetry is enabled) |

The portal's two secrets are only ever read from Secrets you create, never from
values, so they stay out of the release history. They reach the agent container
alone, as `EBPFSENTINEL_PORTAL_JOIN_SECRET` and
`EBPFSENTINEL_PORTAL_INGEST_SECRET`, and the chart refuses to render when a
switch is on and the Secret it needs is not named. The portal prints the exact
commands beside each secret it mints and beside the key you download, with its
own address filled in; they read the secret from a prompt that does not echo
rather than taking it as an argument:

```bash
read -rsp 'Join secret: ' SECRET && echo
printf '%s' "$SECRET" | kubectl -n ebpfsentinel create secret generic ebpfsentinel-portal-join \
  --from-file=join-secret=/dev/stdin
unset SECRET

helm upgrade ebpfsentinel-enterprise oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-enterprise -n ebpfsentinel \
  --version <version> \
  --reuse-values \
  --set portal.enabled=true \
  --set portal.baseUrl=https://portal.ebpfsentinel.io \
  --set portal.joinSecret.secretName=ebpfsentinel-portal-join
```

What the agent does with them is described under
[Vendor portal reporting](../../configuration/enterprise.md#vendor-portal-reporting).

The warden holds the host capabilities
(`SYS_ADMIN, NET_ADMIN, NET_RAW, SYS_PTRACE, BPF, PERFMON`); the agent stays
`cap-drop: ALL`. Both containers mount host `/proc` read-only at `/host/proc`,
and the agent also mounts host `/sys/fs/cgroup` read-only for cgroup attribution.
The config is a ConfigMap whose checksum is a pod annotation, so a values change
rolls the DaemonSet. The chart exposes the enterprise API (8444) and the HA peer gRPC port (9443), and
nothing else: this binary opens one HTTP listener, so the REST surface,
`/metrics` and the `/healthz` and `/readyz` probes are all served on 8444 and
the OSS agent's own 8080, 50051 and 9090 are never started. The enterprise API
terminates no TLS of its own, so put a proxy in front of it if it leaves the
node. The HA port carries no authentication and no TLS either, so it must reach
the HA peers and nothing else - see
the [gRPC API reference](../../api-reference/grpc-api.md).

Stopping a pod works as it does in the community chart:
`daemonset.preStopSleepSeconds` (5 by default) holds the agent before the signal
so every node drops this endpoint first, the agent's own stop budget is 20s, and
`daemonset.terminationGracePeriodSeconds` (30) has to cover both. The sleep
action needs Kubernetes 1.30, which is the chart's floor.

> On Ubuntu 24.04+ nodes, set `kernel.apparmor_restrict_unprivileged_userns=0`
> per node (a privileged init DaemonSet, a node-bootstrap MachineConfig, or
> `/etc/sysctl.d/`) - the in-pod Unconfined profiles do not lift that host gate.
