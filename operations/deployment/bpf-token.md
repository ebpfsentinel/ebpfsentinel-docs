# BPF Token Delegation

> **The only loading path.** eBPFsentinel loads eBPF **exclusively** through a
> BPF token (kernel 6.9+); the agent never loads programs with `CAP_BPF`, and
> there is no capability-based fallback. Because BPF tokens are a
> **user-namespace** feature, the agent is started by a small privileged
> launcher (`ebpfsentinel-token-launch`) that sets up the delegated bpffs in a
> child user namespace and execs the agent there. The long-running agent runs
> **rootless** — no capabilities over the host.

## What is BPF token delegation?

Kernel 6.9 introduced `BPF_TOKEN_CREATE` (`bpf(2)` command #36) and the
`BPF_F_TOKEN_FD` flag. A token is created against a delegated bpffs mount whose
options scope which BPF commands, map types, program types, and attach types the
token-bearer may use. Any subsequent `bpf()` syscall by a process holding the
token fd is authorised by the token instead of by `CAP_BPF`.

Crucially, `BPF_TOKEN_CREATE` is **only valid inside a user namespace** that owns
the delegated bpffs — in the initial (host) user namespace it returns
`EOPNOTSUPP`. So a token-only agent **cannot** run directly under systemd or a
plain container in the host user namespace; it must run inside a child user
namespace. eBPFsentinel handles this with the launcher.

## The launcher

`ebpfsentinel-token-launch` is a minimal privileged bootstrap. As root it:

1. Enumerates every loaded kernel module's BTF object and inherits an fd for
   each (advertised to the agent via `EBPF_MODULE_BTF_FDS`), so module kfuncs
   (`nf_conntrack`, `fou`) resolve without `CAP_SYS_ADMIN` in the agent.
2. Sets up a delegated bpffs via the kernel fd-passing dance: a child process
   unshares a user namespace and `fsopen("bpf")` (the superblock is owned by the
   child userns); the privileged parent applies `delegate_*=any` +
   `FSCONFIG_CMD_CREATE`; the child `fsmount`s + `move_mount`s it at the bpffs
   path.
3. Execs the agent inside that user namespace. The agent finds the delegated
   bpffs, creates a BPF token, and loads/attaches every program through it with
   no host capabilities.

```text
ebpfsentinel-token-launch [--bpffs <path>] <agent-binary> [agent-args...]
```

`--bpffs` (default `/sys/fs/bpf/ebpfsentinel`) must match the agent's
`agent.bpf_token.bpffs_path`.

## Capability matrix

The agent runs in a child user namespace, so it has **no capabilities over
host-owned resources** — including the host network namespace it shares. The
token covers all eBPF; nothing else is available to the agent:

| Operation | Path | Works rootless? |
|-----------|------|-----------------|
| All eBPF load/attach (firewall, IDS, IPS, DLP, DNS, DDoS, NAT, QoS, LB) | BPF token | ✅ |
| IPS active flow-kill | eBPF `bpf_ct_change_status` IPS_DYING (tc-ids) | ✅ |
| Load-balancer VIP ARP | eBPF `xdp-vip-announcer` (XDP_TX replies) | ✅ |
| pcap manual/auto capture | `AF_PACKET` (host netns, `CAP_NET_RAW`) | ❌ unavailable |
| `conntrack -D` retroactive teardown on a new deny rule | netlink (host netns, `CAP_NET_ADMIN`) | ❌ unavailable |
| Gratuitous ARP on VIP takeover | `AF_PACKET` (host netns, `CAP_NET_RAW`) | ❌ unavailable |

The unavailable items **degrade gracefully** — the agent logs a warning and
continues — and their eBPF equivalents (IPS_DYING flow-kill, xdp-vip-announcer)
keep working. If you require pcap capture or the netlink-based teardown, the
rootless token-only model is not compatible with them; that is an inherent
consequence of the user-namespace requirement, not a configuration choice.

## systemd deployment

The shipped unit (`dist/ebpfsentinel.service`, installed by `dist/install.sh`)
runs the launcher, which execs the agent rootless:

```ini
ExecStart=/usr/local/bin/ebpfsentinel-token-launch \
    --bpffs /sys/fs/bpf/ebpfsentinel \
    /usr/local/bin/ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
```

`install.sh` builds the launcher from `dist/ebpfsentinel-token-launch.c` with
`cc` (or installs a prebuilt binary). The service runs as root only long enough
for the launcher to set up delegation; the agent it execs holds no host
capabilities.

```bash
sudo bash dist/install.sh            # binary, launcher, eBPF programs, unit
sudo systemctl enable --now ebpfsentinel
curl -s localhost:9090/metrics | grep bpf_token_used   # expect value 1
```

## Docker deployment

The image entrypoint is the launcher. The container needs `CAP_SYS_ADMIN`
(bpffs delegation + module BTF fds) and the ability to create a user namespace;
`docker compose up` wires this. By hand:

```bash
docker run --network host \
  --cap-add SYS_ADMIN \
  --security-opt apparmor=unconfined \
  -v ./config:/etc/ebpfsentinel \
  ghcr.io/ebpfsentinel/ebpfsentinel:latest
```

The launcher drops into the user namespace before exec'ing the agent, so the
long-running agent is unprivileged even though the container grants
`CAP_SYS_ADMIN` for the bootstrap.

## Kubernetes deployment

The Helm chart runs the agent container through the launcher entrypoint with
`securityContext.capabilities.add: [SYS_ADMIN]`. There is no init container —
the launcher does the bpffs setup in-process.

```yaml
securityContext:
  capabilities:
    drop: [ALL]
    add: [SYS_ADMIN]
  allowPrivilegeEscalation: true
```

> **Note:** nested user namespaces + bpffs delegation inside a pod can require
> cluster-specific runtime configuration (the node must allow unprivileged user
> namespaces; some Pod Security Admission levels or runtimes block
> `CAP_SYS_ADMIN`). Validate on your cluster before rolling out fleet-wide.

## Troubleshooting

**Metric `ebpfsentinel_bpf_token_used` reads `0` / log says "BPF token
unavailable — running in API-only mode".**
The agent could not create a token (no eBPF attached). On a kernel ≥ 6.9 the
usual cause is that the agent was started **without** the launcher (directly,
in the host user namespace) — `BPF_TOKEN_CREATE` is `EOPNOTSUPP` there. Always
launch via `ebpfsentinel-token-launch`.

**Launcher fails with `fsopen` / `unshare USER` errors.**
The host disallows unprivileged user namespaces or the container lacks
`CAP_SYS_ADMIN`. Enable user namespaces (`kernel.unprivileged_userns_clone=1`
where applicable) and grant `CAP_SYS_ADMIN` to the launcher (not the agent).

**A pcap capture or `conntrack -D` teardown does nothing.**
Expected: these need host-network-namespace capabilities a user-namespace agent
cannot hold. The eBPF datapath (including IPS_DYING flow-kill) is unaffected.
