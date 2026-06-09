# BPF Token Delegation

> **The default loading path.** The agent already requires kernel 6.9+,
> so BPF token delegation is enabled by default (`agent.bpf_token.enabled:
> true`) and is the standard way the agent loads eBPF — the systemd unit
> and Helm chart ship it out of the box. The process runs with **no
> `CAP_BPF` / `CAP_NET_ADMIN` / `CAP_SYS_ADMIN`**, only `CAP_NET_RAW` for
> pcap capture.

## What is BPF token delegation?

Kernel 6.9 introduced `BPF_TOKEN_CREATE` (`bpf(2)` command #36) and
the `BPF_F_TOKEN_FD` flag. A token is created by a privileged
process against a delegated bpffs mount. The mount's options scope
which BPF commands, map types, program types, and attach types the
token-bearer is allowed to use. Any subsequent `bpf()` syscall by a
process that holds the token fd is authorised by the token instead
of by the calling process's `CAP_BPF` capability.

For eBPFsentinel this means:

- The agent can run with **zero `CAP_BPF`, zero `CAP_NET_ADMIN`**
  once the token fd is obtained
- Kubernetes DaemonSets drop `privileged: true` entirely, keeping
  only `CAP_NET_RAW` for pcap-based manual captures
- systemd services strip `AmbientCapabilities` down to `CAP_NET_RAW`

> **Scope:** the token authorizes only **eBPF syscalls** (program load,
> map create, attach). Features that mutate host state through other
> privileged syscalls still need their own capability — notably
> **Multi-WAN routing** and **conntrack-based kill** (`ip rule` / netlink,
> `conntrack -D`) require `CAP_NET_ADMIN` in addition to the token. Add it
> to `capabilities.add` (or the systemd `AmbientCapabilities`) only when
> those features are enabled.

## Loading modes

The agent probes the kernel at startup and selects a loading mode.
`token` is the default and expected mode; the other two are fallbacks
that only apply when token creation is unavailable or
`fallback_allow_capabilities` is left on:

| Mode | Requirements | Metric value |
|------|--------------|-------------:|
| **`token`** (default) | Kernel 6.9+, `agent.bpf_token.enabled: true` (default), delegated bpffs mount, `BPF_TOKEN_CREATE` succeeds | `2` |
| **`capabilities`** (fallback) | `fallback_allow_capabilities: true` and `CAP_BPF + CAP_NET_ADMIN + CAP_SYS_ADMIN` in the process | `1` |
| **`privileged`** (fallback) | Root / `privileged: true` container | `0` |

Set `fallback_allow_capabilities: false` to make `token` the *only*
acceptable mode — the agent then refuses to start rather than silently
loading with capabilities.

The Prometheus gauge `ebpfsentinel_bpf_token_used{mode=...}` reports
the currently selected mode so operators can alert on unexpected
fallbacks.

## Host preparation

Run the `ebpfsentinel-token-setup.sh` helper as root. It mounts a
bpffs instance at `/sys/fs/bpf/ebpfsentinel` (override with a
positional argument) with the `delegate_cmds` / `delegate_maps` /
`delegate_progs` / `delegate_attachs` options required by the 14
eBPF programs the agent ships.

```bash
sudo /usr/local/bin/ebpfsentinel-token-setup.sh
```

Verify:

```bash
findmnt -T /sys/fs/bpf/ebpfsentinel -o OPTIONS
# rw,nosuid,nodev,noexec,relatime,delegate_cmds=map_create,prog_load,obj_get_info_by_fd,btf_load,delegate_maps=any,delegate_progs=any,delegate_attachs=any
```

The script is idempotent: re-running it detects an existing mount
and exits cleanly.

## Agent configuration

```yaml
agent:
  interfaces: [eth0]
  bpf_token:
    enabled: true
    bpffs_path: /sys/fs/bpf/ebpfsentinel
    # When false, token creation failures abort startup instead of
    # falling back to capability-based loading. Recommended in
    # production once the deployment is known to be on kernel 6.9+.
    fallback_allow_capabilities: true
```

## systemd deployment

The shipped unit (`dist/ebpfsentinel.service`, installed by
`dist/install.sh`) is already token-native — no override needed. It:

- Runs `ebpfsentinel-token-setup.sh` via a privileged `ExecStartPre`
  (the `+` prefix runs it outside the service sandbox to mount the bpffs)
- Sets `AmbientCapabilities` / `CapabilityBoundingSet` to `CAP_NET_RAW`
  only — no `CAP_BPF` / `CAP_NET_ADMIN` / `CAP_SYS_ADMIN`
- Enables `PrivateDevices`, `ProtectKernelTunables`,
  `ProtectControlGroups`, `LockPersonality`, and makes
  `/sys/fs/bpf/ebpfsentinel` read-only

```bash
sudo bash dist/install.sh         # installs binary, token-setup helper + unit
sudo systemctl enable --now ebpfsentinel
systemctl status ebpfsentinel
curl -s localhost:9090/metrics | grep bpf_token_used   # expect mode="token"
```

## Kubernetes deployment

In the Helm chart, BPF token delegation is on by default
(`agent.bpfToken.enabled: true`) — the chart renders the init container
and drops the agent container to `CAP_NET_RAW` automatically. For a raw
manifest, `dist/kubernetes/bpf-token-daemonset.yaml` ships an init
container that runs the token setup script against the host's bpffs,
then launches the agent with no `CAP_BPF` / `CAP_NET_ADMIN`:

```yaml
initContainers:
  - name: bpf-token-setup
    image: ebpfsentinel-agent:latest
    command: ["/usr/local/bin/ebpfsentinel-token-setup.sh"]
    args: ["/host/sys/fs/bpf/ebpfsentinel"]
    securityContext:
      privileged: true
    volumeMounts:
      - name: host-bpf
        mountPath: /host/sys/fs/bpf
        mountPropagation: Bidirectional
containers:
  - name: agent
    image: ebpfsentinel-agent:latest
    securityContext:
      privileged: false
      allowPrivilegeEscalation: false
      capabilities:
        drop: [ALL]
        add: [NET_RAW]
      readOnlyRootFilesystem: true
```

## Docker Compose deployment

A compose override at `dist/docker-compose.bpf-token.yml` mounts the
delegated bpffs via a one-shot `bpf-token-setup` service and runs
the agent with `cap_drop: [ALL]` + `cap_add: [NET_RAW]`:

```bash
docker compose -f docker-compose.yml -f docker-compose.bpf-token.yml up -d
```

## Troubleshooting

**Metric reports `mode="capabilities"` even though token is
enabled.**
The kernel is below 6.9, the bpffs mount is missing, or the
`delegate_*` options are absent. Check the agent logs for a line
like `BPF loading mode selected ... reason="token creation failed"`
and run `findmnt -T /sys/fs/bpf/ebpfsentinel -o OPTIONS` to verify
the mount options.

**Agent exits with `BPF token creation failed and fallback
disabled`.**
Expected behaviour when `fallback_allow_capabilities: false` is
set and token creation fails. Either re-enable fallback or fix the
host setup (kernel upgrade, mount options, permissions on the
bpffs path).

**aya does not yet expose native token support.**
The agent wraps `BPF_TOKEN_CREATE` via the raw `bpf(2)` syscall
because aya-rs upstream is still merging support in
[aya PR #1515](https://github.com/aya-rs/aya/pull/1515). The token
fd is kept alive by the agent process so any program loaded through
a future token-aware aya release will pick it up automatically.
