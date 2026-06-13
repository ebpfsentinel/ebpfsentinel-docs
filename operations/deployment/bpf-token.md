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

The agent runs in a child user namespace, so it cannot itself acquire
capabilities over host-owned resources — including the host network namespace it
shares. The token covers all eBPF; for the few userspace features that need a
host-netns socket, the launcher hands the agent a **pre-opened fd**:

| Operation | Path | Works rootless? |
|-----------|------|-----------------|
| All eBPF load/attach (firewall, IDS, IPS, DLP, DNS, DDoS, NAT, QoS, LB) | BPF token | ✅ |
| IPS active flow-kill | eBPF `bpf_ct_change_status` IPS_DYING (tc-ids) | ✅ |
| Load-balancer VIP ARP | eBPF `xdp-vip-announcer` (XDP_TX replies) | ✅ |
| pcap manual/auto capture | `AF_PACKET` fd pre-opened by the launcher (`EBPFSENTINEL_PCAP_FDS`) | ✅ |
| `conntrack -D` retroactive teardown on a new deny rule | netlink (host netns, `CAP_NET_ADMIN`) | ❌ unavailable |
| Multi-WAN policy routing (`ip rule` / `ip route` apply) | netlink (host netns, `CAP_NET_ADMIN`) | ❌ unavailable (probes still run) |
| Gratuitous ARP on VIP takeover | `AF_PACKET` (host netns, `CAP_NET_RAW`) | ❌ unavailable |

pcap capture works because `CAP_NET_RAW` on an `AF_PACKET` socket is checked
**only at `socket()`** — which the launcher does while still global root. It
pre-opens a small pool (`EBPFSENTINEL_PCAP_POOL`, default 2) and passes the fds;
the agent binds, filters and reads on them with no capability of its own.

The same fd-passing trick does **not** work for `conntrack -D`: netlink
re-checks `CAP_NET_ADMIN` against the *sending* task on every message
(`__netlink_ns_capable`), so the user-namespace agent is rejected regardless of
who opened the socket. Gratuitous ARP is the same `AF_PACKET` mechanism as pcap
and could be provisioned the same way, but is not today. The unavailable items
**degrade gracefully** — the agent logs a warning and continues — and their eBPF
equivalents (IPS_DYING flow-kill, xdp-vip-announcer) keep working.

### Does running the agent as root help (for the remaining `❌` items)?

No — and neither does `cap_add`/`securityContext.capabilities`. The blocker is
the user namespace, not the user ID, and the two requirements are mutually
exclusive:

- **Root inside the child user namespace** (where the agent runs): capabilities
  only apply to resources owned by that namespace. The host network namespace is
  owned by the **initial** user namespace, and a descendant namespace is never
  privileged over an ancestor — so `CAP_NET_ADMIN` is present but unusable
  against the host netns.
- **Root in the initial (host) user namespace**: those caps would work, but
  `BPF_TOKEN_CREATE` returns `EOPNOTSUPP` outside a user namespace, so the agent
  would fail to load **any** eBPF and fall back to API-only mode.

This is why pcap is solved by **fd-passing** instead — the launcher opens the
`AF_PACKET` socket while it is still global root and hands the agent the fd, and
`CAP_NET_RAW` is never re-checked afterwards. `conntrack -D` cannot use the same
trick because netlink re-checks the cap of the *sending* task on every message,
not just at socket creation; the user-namespace agent fails that check no matter
who opened the fd. Rely on the in-kernel equivalents (IPS_DYING flow-kill, VIP
announcement) for those paths.

## systemd deployment

The shipped unit (`dist/ebpfsentinel.service`, installed by `dist/install.sh`)
runs the launcher, which execs the agent rootless:

```ini
ExecStart=/usr/local/bin/ebpfsentinel-token-launch \
    --bpffs /sys/fs/bpf/ebpfsentinel \
    /usr/local/bin/ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
```

The launcher ships as a cargo-built binary alongside the agent
(`cargo build --release --bin ebpfsentinel-token-launch`), installed by
`install.sh`. The service runs as root only long enough for the launcher to set
up delegation; the agent it execs holds no host capabilities.

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
  --cap-add NET_RAW \
  --security-opt apparmor=unconfined \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  ghcr.io/ebpfsentinel/ebpfsentinel:latest
```

The launcher drops into the user namespace before exec'ing the agent, so the
long-running agent is unprivileged even though the container grants
`CAP_SYS_ADMIN` for the bootstrap. The `/sys/fs/bpf` bind-mount is **required**:
a container's `/sys` is read-only, so the launcher cannot create the bpffs
mountpoint without a writable `/sys/fs/bpf` — bind in the host bpffs (or, on a
host with no bpffs mounted, `--tmpfs /sys/fs/bpf`). `CAP_NET_RAW` lets the
launcher pre-open the `AF_PACKET` pcap pool; drop it if you never capture. See
the [full Docker guide](docker.md) for the container-awareness mounts.

## Kubernetes deployment

The Helm chart runs the agent container through the launcher entrypoint with
`securityContext.capabilities.add: [SYS_ADMIN]`. There is no init container —
the launcher does the bpffs setup in-process.

```yaml
securityContext:
  capabilities:
    drop: [ALL]
    add: [SYS_ADMIN, NET_RAW]   # NET_RAW: launcher pre-opens the pcap pool
  allowPrivilegeEscalation: true
  appArmorProfile:
    type: Unconfined            # launcher does mount/move_mount + uid_map write
  seccompProfile:
    type: Unconfined
```

The pod also needs a writable `/sys/fs/bpf` (a container's `/sys` is read-only)
— mount the host bpffs as a `hostPath` with `mountPropagation: HostToContainer`.
See the [full Kubernetes guide](kubernetes.md) for the complete DaemonSet.

> **Note:** nested user namespaces + bpffs delegation inside a pod can require
> cluster-specific runtime configuration (the node must allow unprivileged user
> namespaces; some Pod Security Admission levels or runtimes block
> `CAP_SYS_ADMIN`). On nested runtimes such as **kind** or **minikube** the node
> is itself a container — its `/sys/fs/bpf` may be read-only (use an in-pod
> `emptyDir: { medium: Memory }` instead of the host `hostPath`), and the extra
> user-namespace layer can require `privileged: true` for the `uid_map` write.
> Validate on your cluster before rolling out fleet-wide.

## Split-broker deployment (rootless agent)

In the deployments above the launcher is the container entrypoint, so the
**agent container's** spec is granted `CAP_SYS_ADMIN` + `allowPrivilegeEscalation`
— even though the long-running agent drops that privilege at runtime, an auditor
reading the manifest sees a full-access workload.

The **split-broker** layout moves the privileged step into a separate, small
`broker` container so the agent container runs **non-root + `cap-drop: ALL` + no
`CAP_SYS_ADMIN` / `CAP_NET_RAW`**:

```text
broker  (CAP_SYS_ADMIN + NET_RAW)   agent  (runAsUser 65534, cap-drop ALL)
  opens module-BTF + AF_PACKET         shim: own userns → fsopen(bpf)
  listens on a unix socket  ◄───────── hands its bpffs fd to the broker
  delegate_* + FSCONFIG_CMD_CREATE     mounts the delegated bpffs
  returns BTF + pcap fds (SCM_RIGHTS) ─► creates the token, loads every program
```

Both containers run the same image; only the entrypoint differs:

```text
broker : ebpfsentinel-token-launch --broker-serve   <sock>
agent  : ebpfsentinel-token-launch --broker-connect <sock> --bpffs <path> \
         ebpfsentinel-agent --config <file>
```

The `delegate_*` mount options still require `CAP_SYS_ADMIN` in the initial user
namespace, so that privilege is **relocated**, not removed — concentrated in the
~250-line broker an auditor can reason about in seconds. The agent container
still needs `allowPrivilegeEscalation: true` (the shim creates its own user
namespace and writes `uid_map`) and a seccomp/AppArmor profile permitting the
userns + mount syscalls — but a **narrow profile** (the runtime default plus
`unshare`/`mount`/`move_mount`/`fsopen`/`fsmount`/`fsconfig`/`bpf`) replaces
`Unconfined`; ship `dist/seccomp/ebpfsentinel-agent.json`.

Ready-to-use assets:

- **Docker Compose:** `dist/docker-compose.broker.yml` (a `broker` + an `agent`
  service sharing the broker socket; the agent runs as uid 65534, `cap-drop:
  ALL`, with the narrow seccomp profile).
- **Kubernetes:** `dist/kubernetes/bpf-token-broker-daemonset.yaml` (a two-
  container DaemonSet; the agent container holds no `CAP_SYS_ADMIN`).
- **Helm:** set `daemonset.brokerSidecar.enabled=true` to render the split layout.

```bash
helm install ebpfsentinel ebpfsentinel/ebpfsentinel \
  --namespace ebpfsentinel --create-namespace \
  --set agent.interfaces='{eth0}' \
  --set daemonset.brokerSidecar.enabled=true
```

Trade-offs vs the single-container launcher:

- The agent container runs **non-root** (`runAsUser: 65534`): the single-uid
  `uid_map` self-map is rejected for a cap-dropped root container. Mount config
  (`0640`, group-readable via `fsGroup`/ownership) and data accordingly.
- A container's `/sys` is read-only, so the agent container mounts a writable
  `/sys/fs/bpf` (an in-pod `emptyDir: { medium: Memory }`, or `--tmpfs
  /sys/fs/bpf:mode=1777` under Compose) for the delegated bpffs + pinned maps.
- One extra container per node, kept running so it can re-serve on agent restart.

Module kfuncs (conntrack, fou) and rootless pcap keep working: the broker holds
the module-BTF and `AF_PACKET` fds and passes them to the agent over the socket,
so the agent needs neither `CAP_SYS_ADMIN` nor `CAP_NET_RAW`.

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

**Launcher fails with `move_mount: No such file or directory`, or the agent
logs "bpffs path `/sys/fs/bpf/ebpfsentinel` does not exist" (container only).**
A container's `/sys` is mounted read-only, so the launcher cannot create the
bpffs mountpoint there. Give the container a **writable `/sys/fs/bpf`**: bind in
the host bpffs (`-v /sys/fs/bpf:/sys/fs/bpf` / a `hostPath` volume), or — on a
host or nested runtime whose `/sys/fs/bpf` is itself read-only — mount a tmpfs
(`--tmpfs /sys/fs/bpf` / an `emptyDir: { medium: Memory }`).

**Launcher fails with `failed to write uid/gid map` (`mount`/`move_mount`
denied, or `uid_map: Operation not permitted`).**
The container's AppArmor or seccomp profile is blocking the launcher's mount and
user-namespace setup. Run it unconfined — `--security-opt apparmor=unconfined`
(Docker) or `securityContext.appArmorProfile.type: Unconfined` +
`seccompProfile.type: Unconfined` (Kubernetes). On deeply nested runtimes (kind,
minikube) the extra user-namespace layer can still reject the `uid_map` write
under a reduced capability set — `privileged: true` resolves it there.

**A pcap capture logs "no AF_PACKET socket provisioned by the launcher".**
The agent was started without the launcher, or the launcher could not open the
capture sockets (no `CAP_NET_RAW` during bootstrap). Launch via
`ebpfsentinel-token-launch`; bump the pool with `EBPFSENTINEL_PCAP_POOL` if you
run many concurrent captures.

**A `conntrack -D` teardown does nothing.**
Expected: it needs `CAP_NET_ADMIN` re-checked per netlink message against the
user-namespace agent, which fails — and unlike pcap it cannot be solved by
fd-passing. The eBPF datapath (including IPS_DYING flow-kill) is unaffected.
