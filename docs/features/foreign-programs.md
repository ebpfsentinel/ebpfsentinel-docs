# Foreign eBPF Programs

The agent's XDP and tc programs are not the only ones that can sit on the
network path. A CNI attaches its own, so does a load balancer or a capture
tool, and so can any process holding `CAP_BPF` and `CAP_NET_ADMIN`. A program
that runs before the agent's sees each packet first and can drop, rewrite or
redirect it before the agent decides anything.

The agent lists every eBPF program on the network path that it did not load,
where each one runs and which processes hold it.

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

A link names its interface by index, and an index means nothing outside its
own network namespace. The interface is named only when the host's interface
of that index carries the same program; otherwise only the index is given, and
the program sits in a pod's or a container's namespace.

## What It Does Not See

- **Legacy XDP and `tc` attachments inside a pod's namespace.** They carry no
  link, and the host's interfaces are the only ones read for them. A program
  attached that way in a pod still appears, as `unplaced`.
- **Where a legacy cgroup attachment sits.** The program appears as
  `unplaced`; its cgroup is not read.
- **A program attached and detached between two readings.** The inventory is a
  sample, on the interval of the [network inventory](../configuration/network-inventory.md).
- **A program the agent dropped its descriptor on.** The agent's own set is
  what it holds; a program of its own that it no longer holds would read as
  foreign.

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
- Configuration: [`network_inventory`](../configuration/network-inventory.md)
