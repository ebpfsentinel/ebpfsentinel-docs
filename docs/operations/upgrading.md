# Upgrading

An upgrade replaces two processes, the agent and the warden, and both come from
the same release: the warden protocol is versioned with the agent, so run them
at the same version. The agent's eBPF links belong to its process, so every
upgrade detaches the programs when the old agent exits and attaches them again
when the new one has started. For that window the node is not filtered, and its
length is the time the new agent takes to start, not a fixed figure.

## What a stop does

`systemctl stop`, `docker stop` and a pod deletion all send SIGTERM, and both
agents treat it as a stop rather than as a kill: the HTTP listener stops
accepting and lets the requests in flight finish, the background loops are told
to stop and write out what they are still holding, and the eBPF programs are
then detached. On the Enterprise agent what gets written at that moment is the
SIEM batch that has not left yet and the current analytics window; on both, the
audit and alert stores are written as they go and owe nothing to a stop.

On the community agent a packet capture in progress is ended first, before the
programs are detached, so a capture never records a window the datapath was no
longer watching: the session is marked `interrupted`, the file is closed and
what it holds is a short capture rather than a half-written one. That wait is
two seconds, and a capture is not a reason to hold a stop open longer than
that.

Both halves are bounded, five seconds each, so a stop takes at most ten seconds
and does not grow with the number of features a licence carries. The unit file
allows twenty (`TimeoutStopSec`) and the chart thirty
(`terminationGracePeriodSeconds`), both above that bound on purpose: a stop that
runs past the shorter of the two is finished with SIGKILL, and what the loops
had not written by then is lost. Lower either value below ten seconds and that
is what you are choosing.

A kill loses that work and nothing else. The eBPF programs are attached through
links the process owns, so the kernel detaches them when the process goes, and
the pin directory is rewritten at the next start: an agent killed with SIGKILL
leaves no attachment and no stale pin behind, which is why a crash recovers by
restarting and needs no cleanup step.

## Binary

From a release tarball, `install.sh` replaces the binaries and the eBPF objects
and leaves an existing `/etc/ebpfsentinel/config.yaml` untouched. The new
tarball comes from the [releases page](https://github.com/ebpfsentinel/ebpfsentinel-release/releases):

```bash
tar xzf ebpfsentinel-<version>-linux-<arch>.tar.gz
cd ebpfsentinel-<version>-linux-<arch>
sudo systemctl stop ebpfsentinel ebpfsentinel-warden
sudo ./install.sh
sudo systemctl start ebpfsentinel-warden ebpfsentinel
```

The redb stores under `/var/lib/ebpfsentinel/data/` are kept. See
[Binary deployment](deployment/binary.md) for what the installer does.

To keep a way back, copy the two binaries and the object directory aside before
running the installer:

```bash
sudo cp /usr/local/bin/ebpfsentinel-agent /usr/local/bin/ebpfsentinel-agent.bak
sudo cp /usr/local/bin/warden /usr/local/bin/warden.bak
sudo cp -a /usr/local/lib/ebpfsentinel /usr/local/lib/ebpfsentinel.bak
```

A rollback puts all three back and restarts both units. The objects are part of
it: an agent loads the programs it was built with, and an older agent against
newer objects is not a combination anybody tested.

## Docker Compose

The compose file builds both images from the checkout. Rebuild at the new
version and recreate the containers; the `ebpfsentinel-state` volume survives:

```bash
git fetch --tags && git checkout <version>
docker compose build
docker compose up -d
```

To run the published images instead, point the two services' `image:` at
`ghcr.io/ebpfsentinel/ebpfsentinel:<version>` and
`ghcr.io/ebpfsentinel/ebpfsentinel-warden:<version>`, then
`docker compose pull && docker compose up -d`. See
[Docker deployment](deployment/docker.md).

## Kubernetes

```bash
helm upgrade ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  --version <version> -n ebpfsentinel --reuse-values
kubectl -n ebpfsentinel rollout status daemonset/ebpfsentinel
```

The chart's `appVersion` is the image tag for both containers, so a chart
version moves the agent and the warden together. The DaemonSet rolls with
`maxUnavailable: 1` (`daemonset.updateStrategy`), one node at a time. Roll back
with `helm rollback ebpfsentinel -n ebpfsentinel`. See
[Kubernetes deployment](deployment/kubernetes.md).

A rollout replaces every pod. What the agent kept under
`/var/lib/ebpfsentinel` is on a node directory by default and carries over;
with `daemonset.state.ephemeral=true` the redb stores and captures start empty
on the new pod. The telemetry installation identifier is unaffected, being
derived from the node's `/etc/machine-id`.

The Enterprise chart is published beside it and upgrades the same way:

```bash
helm upgrade ebpfsentinel-enterprise oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-enterprise \
  --version <version> -n ebpfsentinel --reuse-values
kubectl -n ebpfsentinel rollout status daemonset/ebpfsentinel-enterprise
```

## Configuration changes

A configuration change does not need an upgrade or a restart for most sections:

```bash
sudo systemctl reload ebpfsentinel        # sends SIGHUP
# or
ebpfsentinel-agent config reload          # POST /api/v1/config/reload
```

The agent also watches its config file. API keys, DNS blocklists, alerting and
audit settings and `agent.interfaces` are read at startup only. See
[Hot Reload](hot-reload.md) for the full list.

The Enterprise agent has no reload at all: an edit to its config takes a restart.
See [Enterprise deployment](deployment/enterprise.md).

## Upgrading onto a shut API

Before this release an agent with no authentication configured answered
anything that could reach it, and `auth.enabled` defaulted to `false`. It now
defaults to `true`, and an upgrade changes the behaviour of a deployment whose
configuration says nothing about authentication. Four things to expect:

1. **A key appears.** With no `auth.api_keys`, no JWT secret and no OIDC
   issuer, the agent writes one to `auth.bootstrap_key_path`
   (`/var/lib/ebpfsentinel/auth/api-key`, `0600` in a `0700` directory) at
   first start and logs it once. On Kubernetes it is per pod until
   `auth.existingSecret` names one. `bootstrap_key_path: ""` refuses the key
   outright, and the agent then refuses to serve an unauthenticated API off
   loopback.
2. **Scripts need a credential.** Anything calling `/api/v1` adds
   `-H "Authorization: Bearer $EBPFSENTINEL_TOKEN"` or `-H "X-API-Key: ..."`.
   The CLI run on the agent's own host reads the generated key by itself, so
   `sudo ebpfsentinel-agent status` keeps working unchanged.
3. **`/metrics` follows the control plane.** It is gated whenever
   authentication is on, unless `auth.metrics_auth_required: false` says
   otherwise. The chart ships `metrics.authRequired: false` so an existing
   ServiceMonitor keeps scraping; a Prometheus outside the chart either gets
   the same setting or a `credentials_file`, see [Monitoring](monitoring.md).
4. **A non-loopback bind is now two decisions.** An API reachable off
   loopback refuses to start without authentication unless
   `agent.allow_unauthenticated_api: true`, and refuses to serve plaintext
   unless TLS is configured or `agent.allow_plaintext_api: true`. The
   Kubernetes chart sets the plaintext one, because the pod binds `0.0.0.0`
   and the chart terminates no TLS.

Keeping the previous behaviour exactly is `auth.enabled: false` plus
`agent.allow_unauthenticated_api: true`, which is a deliberate sentence to
write in a file rather than a default anybody inherits.
