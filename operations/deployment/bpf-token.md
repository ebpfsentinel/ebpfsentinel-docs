# BPF token delegation

> **The only loading path.** eBPFsentinel loads eBPF **exclusively** through a
> BPF token (kernel 6.9+); the agent never loads programs with `CAP_BPF`, and
> there is no capability-based fallback. The deployment is two components: a
> small privileged **warden** broker and the **rootless agent**. The agent
> self-unshares a user namespace, has the warden delegate a bpffs over a shared
> socket, and creates the token there — holding **no** capabilities over the
> host.

## What is BPF token delegation?

Kernel 6.9 introduced `BPF_TOKEN_CREATE` (`bpf(2)` command #36) and the
`BPF_F_TOKEN_FD` flag. A token is created against a delegated bpffs mount whose
options scope which BPF commands, map types, program types, and attach types the
token-bearer may use. Any subsequent `bpf()` syscall by a process holding the
token fd is authorised by the token instead of by `CAP_BPF`.

`BPF_TOKEN_CREATE` succeeds only when **two** conditions hold for the target
bpffs:

1. its superblock is **owned by a user namespace the caller is in**, and
2. it was created with the `delegate_cmds` / `delegate_maps` / `delegate_progs` /
   `delegate_attachs` mount options.

These two conditions fall on opposite sides of the capability boundary, which is
why eBPFsentinel splits the bpffs setup between the agent and the warden.

## The trampoline: how the agent creates a token without host privilege

At startup the agent runs a single-threaded **trampoline** (before any async
runtime), then re-execs itself to continue normally. The trampoline and the
warden split the bpffs setup precisely along the capability boundary:

```text
AGENT (rootless)                          WARDEN (CAP_SYS_ADMIN in init_user_ns)
─────────────────                         ─────────────────────────────────────
1. unshare(CLONE_NEWUSER | CLONE_NEWNS)
   → root *inside its own* userns
     (full caps there, none on the host)
2. fsopen("bpf")
   → superblock owned by that userns   ──fs_fd (SCM_RIGHTS)──▶
                                           3. fsconfig delegate_*=any
                                              + FSCONFIG_CMD_CREATE
                                              (requires ns_capable(&init_user_ns,
                                               CAP_SYS_ADMIN) — only the warden)
                          ◀── Delegated{btf_names, pcap_count} + fds (SCM_RIGHTS) ──
4. fsmount + move_mount the delegated bpffs
5. setenv(EBPF_MODULE_BTF_FDS, EBPFSENTINEL_PCAP_FDS,
   EBPFSENTINEL_USERNS_READY=1) → execv self
   ── second pass ──
6. BPF_TOKEN_CREATE against the bpffs
   ✓ succeeds: the caller is capable in the
     userns that owns the superblock (1+2),
     and the bpffs carries delegate_* (3)
7. BPF_MAP_CREATE / PROG_LOAD with BPF_F_TOKEN_FD
   ✓ authorised by the token — never CAP_BPF
```

**Why the warden is required.** Applying the `delegate_*` mount options and
creating the superblock (`FSCONFIG_CMD_CREATE`) is gated on `CAP_SYS_ADMIN` in
the **initial** user namespace. The agent, in a descendant user namespace, holds
`CAP_SYS_ADMIN` only over *its own* namespace — never over the host — so it
fails that one step. It passes the `fs_fd` to the warden over `SCM_RIGHTS`, the
warden stamps the delegation, and the agent resumes. Token creation and every
later `bpf()` then happen entirely in the agent's own user namespace.

The trampoline is a no-op when no warden socket is configured
(`EBPFSENTINEL_WARDEN_SOCK` unset) or on the post-`execv` second pass
(`EBPFSENTINEL_USERNS_READY` set).

## The warden broker

The warden is a small privileged binary (`warden serve <socket> --uid <n>`) that
loads no eBPF and holds no maps. It runs in the **initial network namespace**
with `CAP_SYS_ADMIN` / `CAP_NET_ADMIN` / `CAP_NET_RAW`, and answers only a
narrow, typed, peer-authenticated protocol over an `AF_UNIX` socket:

- **bpffs delegation** + handing back the module-BTF fds (so module kfuncs like
  `nf_conntrack` / `fou` resolve in the agent) and the pre-opened `AF_PACKET`
  pcap fds.
- **conntrack** table read, single-flow teardown, and flush.
- **route** programming (multi-WAN failover).
- **gratuitous ARP** on VIP takeover.
- on-demand **pcap** capture sockets.

`--uid` is the only uid served, checked via `SO_PEERCRED`: on bare-metal the
agent runs as root and maps namespace-0 to real root, so it presents `0`; in a
container it drops to `65534` and presents that.

## Capability matrix

The agent holds **no** host capabilities. Everything it cannot do from its user
namespace is either an in-kernel eBPF path or brokered to the warden, which holds
the capabilities in the init network namespace:

| Operation | Path | Held by |
|-----------|------|---------|
| All eBPF load/attach (firewall, IDS, IPS, DLP, DNS, DDoS, NAT, QoS, LB) | BPF token | agent (token) |
| IPS active flow-kill | eBPF `bpf_ct_change_status` IPS_DYING (tc-ids) | agent (token) |
| Load-balancer VIP reply | eBPF `xdp-vip-announcer` (XDP_TX) | agent (token) |
| pcap manual/auto capture | `AF_PACKET` fd opened by the warden, passed to the agent | warden (`CAP_NET_RAW`) |
| Conntrack snapshot / event poller | warden reads `/proc/net/nf_conntrack` | warden (init netns) |
| `conntrack -D` retroactive teardown on a new deny rule | warden netlink | warden (`CAP_NET_ADMIN`) |
| Multi-WAN policy routing (`ip rule` / `ip route`) | warden netlink | warden (`CAP_NET_ADMIN`) |
| Gratuitous ARP on VIP takeover | warden `AF_PACKET` | warden (`CAP_NET_RAW`) |

Because the warden runs in the init network namespace, the host-netns operations
that a userns agent cannot perform (conntrack teardown, route programming,
gratuitous ARP, packet capture) **all work** — they are brokered, not dropped.

### Why not just run the agent as root?

The blocker is the user namespace, not the user ID, and the two requirements are
mutually exclusive:

- **Root inside the agent's user namespace**: capabilities apply only to
  resources owned by that namespace. The host network namespace is owned by the
  *initial* user namespace, and a descendant is never privileged over an
  ancestor — so the agent's `CAP_NET_ADMIN` is unusable against the host netns.
  This is exactly why those operations are brokered to the warden.
- **Root in the initial user namespace**: those caps would work, but
  `BPF_TOKEN_CREATE` returns `EOPNOTSUPP` outside a user namespace, so the agent
  could not load **any** eBPF.

The split resolves the contradiction: the agent gets its token inside its own
userns, and the warden — which genuinely lives in the init namespace — performs
the host-netns operations on its behalf.

## systemd deployment

`dist/install.sh` installs both binaries and two units: `ebpfsentinel-warden.service`
(the broker) and `ebpfsentinel.service` (the agent, which `Wants` the warden and
waits for its socket before starting).

```ini
# ebpfsentinel-warden.service
ExecStart=/usr/local/bin/warden serve /run/ebpfsentinel/warden.sock --uid 0

# ebpfsentinel.service
Environment=EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock
ExecStartPre=/bin/sh -c 'for _ in $(seq 1 100); do [ -S /run/ebpfsentinel/warden.sock ] && exit 0; sleep 0.1; done; exit 1'
ExecStart=/usr/local/bin/ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
```

On bare-metal the agent runs as root (it maps namespace-0 to real root to create
the bpffs mountpoint under `/sys/fs/bpf`), so the warden serves `--uid 0`. Do not
set `NoNewPrivileges` on either unit — it would block the user-namespace setup.

```bash
sudo bash dist/install.sh                       # agent, warden, eBPF programs, units
sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel
curl -s localhost:9090/metrics | grep bpf_token_used   # expect value 1
```

## Docker deployment

`docker compose up` runs two containers — the `warden` broker (image
`ebpfsentinel-warden`, holding the capabilities) and the rootless `agent` (image
`ebpfsentinel`, uid 65534, `cap_drop: ALL`) — sharing the control-socket volume.

```bash
# The agent runs as uid 65534 and rejects a world-readable config:
sudo chown 65534:65534 config/ebpfsentinel.yaml && sudo chmod 640 config/ebpfsentinel.yaml
docker compose up -d
docker compose logs -f
```

The warden container holds `CAP_SYS_ADMIN` / `CAP_NET_ADMIN` / `CAP_NET_RAW` with
`apparmor=unconfined` + `seccomp=unconfined` (it does `fsconfig` + netlink +
`AF_PACKET`). The agent container holds **no** capabilities but still runs
`apparmor=unconfined` + `seccomp=unconfined`: it self-unshares a user namespace
and issues `mount` / `fsopen` / `bpf` syscalls, and without `CAP_SYS_ADMIN` the
default seccomp profile (which gates those on `CAP_SYS_ADMIN`) would block them.
A container's `/sys` is read-only, so the agent backs its bpffs mountpoint with a
`tmpfs` at `/sys/fs/bpf`. See the [full Docker guide](docker.md) for the
container-awareness mounts.

## Kubernetes deployment

The Helm chart runs the warden as a **native sidecar** (an init container with
`restartPolicy: Always`) plus the agent as the main container, sharing an
`emptyDir` socket volume.

```yaml
# values.yaml — the warden sidecar holds the capabilities …
daemonset:
  warden:
    securityContext:
      runAsUser: 0
      capabilities:
        add: [SYS_ADMIN, NET_ADMIN, NET_RAW]
        drop: [ALL]
      appArmorProfile: { type: Unconfined }
      seccompProfile: { type: Unconfined }
  # … the agent holds none
  securityContext:
    runAsUser: 65534
    runAsGroup: 65534
    capabilities:
      drop: [ALL]
    allowPrivilegeEscalation: true
    appArmorProfile: { type: Unconfined }
    seccompProfile: { type: Unconfined }
```

`daemonset.bpfToken.bpffsPath` drives both the agent's `EBPFSENTINEL_BPFFS` mount
target and its `agent.bpf_token.bpffs_path` config. The pod needs a writable
`/sys/fs/bpf` (host `hostPath` with `mountPropagation: HostToContainer`, or
`daemonset.bpfToken.bpffsEmptyDir=true` for an in-pod tmpfs on nested runtimes).
See the [full Kubernetes guide](kubernetes.md) for the complete DaemonSet.

```bash
helm install ebpfsentinel ebpfsentinel/ebpfsentinel \
  --namespace ebpfsentinel --create-namespace \
  --set agent.interfaces='{eth0}'
```

> **Note:** nested user namespaces + bpffs delegation inside a pod can require
> cluster-specific runtime configuration (the node must allow unprivileged user
> namespaces; some Pod Security Admission levels or runtimes block
> `CAP_SYS_ADMIN`). On nested runtimes such as **kind** or **minikube** the node
> is itself a container — set `daemonset.bpfToken.bpffsEmptyDir=true`, and the
> extra user-namespace layer can require relaxed runtime settings. Validate on
> your cluster before rolling out fleet-wide.

## Troubleshooting

**Metric `ebpfsentinel_bpf_token_used` reads `0` / log says "BPF token
unavailable — running in API-only mode".**
The agent could not create a token (no eBPF attached). The usual cause is that
the warden was unreachable at startup (`EBPFSENTINEL_WARDEN_SOCK` unset, or the
broker not yet listening). Confirm the warden is running and the socket exists
before the agent starts.

**Agent logs `warden self-bootstrap failed` / `fsopen` / `unshare USER` errors.**
The host disallows unprivileged user namespaces, or (the warden) lacks
`CAP_SYS_ADMIN`. Enable user namespaces (`kernel.unprivileged_userns_clone=1`
where applicable; `kernel.apparmor_restrict_unprivileged_userns=0` on AppArmor
hosts) and grant the warden `CAP_SYS_ADMIN`.

**Agent logs `move_mount: No such file or directory` or "bpffs path does not
exist" (container only).**
A container's `/sys` is mounted read-only, so the agent cannot create the bpffs
mountpoint there. Give the agent a **writable `/sys/fs/bpf`**: bind in the host
bpffs (`-v /sys/fs/bpf:/sys/fs/bpf` / a `hostPath` volume), or mount a tmpfs
(`--tmpfs /sys/fs/bpf` / an `emptyDir: { medium: Memory }`).

**Agent logs `mount`/`move_mount` denied, or `uid_map: Operation not permitted`.**
The container's AppArmor or seccomp profile is blocking the agent's mount and
user-namespace setup. Run it unconfined — `--security-opt apparmor=unconfined
--security-opt seccomp=unconfined` (Docker) or `appArmorProfile.type: Unconfined`
+ `seccompProfile.type: Unconfined` (Kubernetes).

**The warden rejects the agent (`rejecting peer uid …`).**
The warden's `--uid` must match the uid the agent presents over `SO_PEERCRED`:
`0` on a bare-metal root host (the agent maps namespace-0 to real root), `65534`
in a container (the agent drops to nobody before unsharing).

**A `conntrack -D` teardown, route change, or VIP ARP does nothing.**
Confirm the warden is reachable — these are brokered to it. If the agent runs
without a warden (`EBPFSENTINEL_WARDEN_SOCK` unset), they are unavailable while
the eBPF datapath (including IPS_DYING flow-kill and `xdp-vip-announcer`) keeps
working.
