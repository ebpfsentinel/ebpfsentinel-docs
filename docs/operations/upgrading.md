# Upgrading

An upgrade replaces two processes, the agent and the warden, and both come from
the same release: the warden protocol is versioned with the agent, so run them
at the same version. The agent's eBPF links belong to its process, so every
upgrade detaches the programs when the old agent exits and attaches them again
when the new one has started. For that window the node is not filtered, and its
length is the time the new agent takes to start, not a fixed figure.

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
