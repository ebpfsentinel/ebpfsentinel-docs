# Foreign eBPF Programs

The agent's XDP and tc programs are not the only ones that can sit on the
network path. A CNI attaches its own, so does a load balancer or a capture
tool, and so can any process holding `CAP_BPF` and `CAP_NET_ADMIN`. A program
that runs before the agent's sees each packet first and can drop, rewrite or
redirect it before the agent decides anything.

The agent lists every eBPF program on the network path that it did not load,
where each one runs and which processes hold it, and raises an alert when the
path changes under its own programs.

## How It Works

On an interval, the node's eBPF objects are read in four places:

1. **BPF links**, enumerated by id across every network namespace: XDP, TCX,
   netkit, cgroup, netfilter, and the flow dissector and socket lookup hooks of
   a network namespace.
2. **Legacy XDP**, attached through netlink without a link, read from each host
   interface.
3. **Legacy `tc` filters**, `cls_bpf` classifiers on the ingress and egress
   hooks of each host interface.
4. **Network programs found on none of those**, listed as `unplaced`: a socket
   filter, a tail-call target, a program attached to a cgroup the legacy way, or
   one loaded and not attached.

For each program the agent finds the processes holding a descriptor on it or on
its link, through `/proc/<pid>/fdinfo`, and resolves each process to its
executable, container and pod. The programs and links the agent itself holds
are set apart and only counted.

Enumerating programs by id needs `CAP_SYS_ADMIN`, which no BPF token grants, so
in the rootless posture the reading is made by the warden. The warden reads
each program's description and closes its descriptor: no program ever leaves
it.

## Reading the Place

| Hook | Where the program runs |
|------|------------------------|
| `xdp` | In the driver, before the kernel builds a packet |
| `tc_ingress`, `tc_egress` | A legacy `tc` classifier |
| `tcx_ingress`, `tcx_egress` | A TCX program |
| `netkit_primary`, `netkit_peer` | Either side of a netkit device |
| `cgroup` | A cgroup hook, with its attach point (`inet_ingress`, `inet4_connect`, ...) |
| `netfilter` | A netfilter hook, with its family, hook and priority |
| `netns` | A network namespace's flow dissector or socket lookup |
| `unplaced` | A network program found on none of the above |

On the hooks that run several programs in turn, `tc`, TCX and netkit, each
program also carries its position on that hook of that interface, `0` being the
first to run. A program at a lower position than the agent's sees the packet
first.

A link names its interface by index, and an index means nothing outside its
own network namespace. The interface is named only when the host's interface
of that index carries the same program; otherwise only the index is given, and
the program sits in a pod's or a container's namespace.

## The Alert

Each reading is compared with the one before. Three changes raise an alert,
because each one changes what the agent sees:

| Rule | When |
|------|------|
| `network-path-program-ahead` | Another program now runs before one of the agent's, on the same hook of the same host interface |
| `network-path-program-replaced` | One of the agent's programs is no longer where it was, and another program sits there now, including one put in the agent's own link |
| `network-path-link-detached` | One of the agent's programs is no longer where it was, while the agent still holds it |

| Field | Value |
|-------|-------|
| Component | `network_path` |
| Severity | `high` |
| MITRE ATT&CK | T1014, Rootkit, for a program ahead; T1562.001, Impair Defenses: Disable or Modify Tools, for a replacement or a detach (defense evasion) |

The alert names both programs and carries the process holding the other one,
with its executable, container and pod where they resolve.

The agent's own reload is not a change: a program the agent closed disappears
from the reading, and a link it dropped disappears from its descriptors, so
neither raises anything. A program the agent still holds and that is no longer
where it was has been moved by somebody else. The first reading only primes:
the programs already ahead of the agent's when it starts are listed and raise
nothing.

## What It Does Not See

- **Legacy XDP and `tc` attachments inside a pod's namespace.** They carry no
  link, and the host's interfaces are the only ones read for them. A program
  attached that way in a pod still appears, as `unplaced`.
- **Where a legacy cgroup attachment sits.** The program appears as
  `unplaced`; its cgroup is not read.
- **A program attached and detached between two readings.** The inventory is a
  sample, on the interval of the [network inventory](../configuration/network-inventory.md),
  and so is the alert: a program put ahead of the agent's and taken away
  within one interval raises nothing.
- **A program ahead of the agent's on another hook.** XDP runs before any `tc`
  or TCX program, and TCX before legacy `tc`; the position compares programs on
  the same hook only, and a program on an earlier hook is listed without an
  alert.
- **A program the agent dropped its descriptor on.** The agent's own set is
  what it holds; a program of its own that it no longer holds would read as
  foreign.

## The Agent's Own Objects

Seeing a program put ahead of the agent's is after the fact. Where the BPF LSM
is active, the kernel also refuses the two moves that take the agent off the
path from the side: no task but the agent, and its warden when it runs rootless,
can open one of the agent's links, which detaching it or replacing the program
behind it needs, or open one of the agent's maps for writing, which rewriting a
rule, a set or a configuration slot needs. A map opened read-only is let
through.

The guard needs nothing configured. It loads after every other program, reads
the ids of the maps and links the agent holds from its own descriptors, and
refuses nothing until both are written. Whether it is in force is the
`self_protection` block of
[`GET /api/v1/ebpf/kernel-features`](../api-reference/rest-api.md#get-apiv1ebpfkernel-features)
and of `ebpfsentinel-agent ebpf kernel-features`; a node without the BPF LSM
says it is unprotected and why. Refusals are counted on
`ebpfsentinel_packets_total{interface="BPF_GUARD_METRICS"}` under `checked`,
`refused_map` and `refused_link`. The BPF LSM is a boot parameter rather than a kernel version;
[The BPF LSM](../kernel/requirements.md#the-bpf-lsm-a-boot-parameter-not-a-version)
says how to tell and how to turn it on.

What it does not cover:

- **Legacy `tc` filters.** A `cls_bpf` classifier is removed through netlink
  without ever opening the program, so the guard does not see it. The agent's
  own `tc` programs sit on TCX links where the kernel has them; where it falls
  back to legacy `tc`, a deletion is seen by the inventory above, not refused.
- **Stopping the agent.** A process allowed to kill the agent removes every
  link with it. That is the supervisor's and the restart's to answer, and the
  agent going quiet is visible from the outside.
- **Tools that open by id for writing.** `bpftool map show` and `bpftool map
  dump` by id open the map for reading and writing by default and are refused
  on an agent map; the refusal is counted like any other.
- **A descriptor obtained before the guard was armed**, or on a map the agent
  no longer holds. The sets name what the agent holds now, read again every
  30 seconds.
- **The kernel itself.** A module loaded into the kernel, or a process with
  write access to kernel memory, is past any hook.
- **The files on disk.** The objects the agent loads, its binary and its
  configuration are files, and a rewrite of one waits for the next start. With
  the file watch on, a change another process makes to any of them is an
  alert: see [the agent's own files](../configuration/file-watch.md#the-agents-own-files).

## Legitimate Holders

Programs on the network path are common on a Kubernetes node. Cilium attaches
TCX or netkit programs to every pod interface and the host's devices, Calico in
eBPF mode attaches `tc` programs, `systemd` attaches cgroup socket filters for
its units' `IPAddressAllow=`, and `tcpdump` compiles its filter into a socket
filter that appears as `unplaced` for the length of a capture. A program held by
one of those is expected; the inventory is there so that one held by something
else is seen.

## Reading the Inventory

- REST: [`GET /api/v1/ebpf/foreign-programs`](../api-reference/rest-api.md#get-apiv1ebpfforeign-programs)
- CLI: `ebpfsentinel-agent ebpf foreign-programs`
- Dashboard: the node panel, read as described in [Who Else Reads the Network on a Node](../operations/node-observers.md)
- Configuration: [`network_inventory`](../configuration/network-inventory.md)
