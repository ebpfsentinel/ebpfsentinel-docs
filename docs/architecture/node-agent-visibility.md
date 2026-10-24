# What a Node Agent Sees

A node agent sees the packets that cross a link its programs are attached to,
and nothing else. That is a property of where an eBPF program runs, not a
fault to be fixed by a later release: a packet that never reaches a hooked
link is a packet no program on the node is handed. This page says which
traffic of a pod that leaves out, why, and what changes it.

The agent does not leave the reader to work this out. It judges every pod on
its node from the links its chain is actually on, rather than from what the
configuration asked for, and serves the verdict at
[`GET /api/v1/ebpf/coverage`](../api-reference/rest-api.md#get-apiv1ebpfcoverage),
through `ebpfsentinel-agent ebpf coverage`, on the dashboard's **Pod
coverage** screen and, under the operator, in the status of the agent
resource (see
[the operator page](../features/enterprise/kubernetes-operator.md#what-each-node-agent-sees-of-its-pods)).
A pod whose traffic is half seen never shows the same state as one whose
traffic is fully seen.

## Where the programs sit

In a DaemonSet the agent runs on the host network and attaches to two kinds
of link:

- **the node's uplinks**, the interfaces listed in `agent.interfaces`, which
  carry what enters and leaves the machine;
- **each pod's own link** on the host side - a veth, netkit, macvlan or
  ipvlan device, or a bridge member - attached as the pod appears and
  released when it goes (see
  [netkit and link hot-plug](../operations/deployment/kubernetes.md#netkit)).

A pod's traffic is sorted into four classes, and each class is seen when a
hooked link lies on its path:

| Class | Path | Seen when |
|---|---|---|
| `north_south` | the pod to or from outside the cluster | the pod's link or an uplink carries the chain |
| `east_west_across_nodes` | the pod to a pod on another node | the pod's link carries the chain, or an uplink does and the node does not wrap that traffic in a tunnel |
| `east_west_on_node` | the pod to a pod on the same node | the pod's link carries the chain; an uplink never sees it |
| `loopback` | between the containers of one pod | never, from any node agent |

A pod is `full` when the first three are seen, `none` when none of them is,
and `partial` in between. Loopback is reported as a gap on every pod and
lowers none of them, since no agent on the node can see it.

## What is not seen, and why

Each gap carries a stable code, the same one on every surface.

### Loopback inside the pod

`loopback_stays_in_pod`. Containers of one pod share a network namespace and
talk over its `lo`, which never leaves the pod and crosses no link on the
host. Nothing changes this for a node agent. Traffic that matters between two
processes of one pod is better watched where it is produced: the DLP uprobes
read TLS payloads in the process, whichever interface the bytes later take.

### Host-network pods

`host_network_stays_on_host`. A pod with `hostNetwork: true` has no link of
its own; it uses the node's stack. What it sends off the node crosses an
uplink and is seen there, but its traffic to a pod on the same node, or to a
local process, stays inside the host's stack and is not.

Options, in order of preference:

- run the workload off the host network when nothing requires it, which gives
  it a link of its own the agent attaches to;
- accept the gap for node daemons that need the host network by design
  (exporters, the CNI's own agent, storage drivers), and exclude them from
  the judgement if the noise outweighs the information, as below.

### No link, or a link kind the agent leaves alone

`no_link_found`, `link_kind_unknown`, `attach_mode_skips_kind`. The agent
found no host-side link leading into the pod, found one of a kind it does
not attach to, or `agent.attach_mode` excludes it - `netkit` mode leaves a
veth alone and `tc` mode leaves netkit alone. `auto`, the default, attaches
to both. Set `attach_mode` back to `auto`, or read the
[deployment matrix](../features/deployment-matrix.md) for what each device
type is expected to do.

### Programs refused on the link

`programs_refused`. Only part of the chain went on the pod's link: the kernel
refused a program, or a program the agent did not attach runs ahead of its
own on that hook and the agent refused to sit behind it (see
[TCX order beside a CNI](../operations/deployment/kubernetes.md#tcx-order-beside-a-cni)).
The interface entry of the verdict carries the refusal and the agent's log
carries the program ids ahead of it.

### No uplink attached

`no_uplink_attached`. Neither the pod's link nor any configured interface of
the node carries the chain, so nothing on the pod's path is hooked. Check
`agent.interfaces` against the node's actual uplink names; the dashboard
names every node in this state at the top of the screen.

### Encapsulated on the uplink

`encapsulated_on_uplink`. When only the uplink carries the chain, traffic
between nodes leaves wrapped in an outer header - VXLAN, Geneve, WireGuard,
IP-in-IP or GRE - so what the uplink sees is the tunnel and not the pod's
packet inside it. This is the CNI's behaviour, not the agent's. It is lifted
by the pod's own link carrying the chain, which sees the packet before it is
wrapped, or by a CNI configured for native routing with no encapsulation.

## Leaving a pod out of the judgement

The pods judged are those the Kubernetes enricher watches on the node, so
`container.kubernetes.label_filter` narrows both at once: a pod the selector
excludes carries no metadata on alerts and is not counted on the coverage
surfaces either (see
[container configuration](../configuration/container.md)). Without the
enricher there is no inventory to judge, and the route answers `404` rather
than an empty, reassuring list.

## A pod-scoped agent

A per-pod deployment, the sidecar of the
[deployment matrix](../features/deployment-matrix.md), sits inside the pod's
network namespace and sees the pod's own interface whatever the host side
of the link is, and before any tunnel wraps the packet. It trades that for
everything the node agent covers: it cannot protect the host or other pods,
and its blocking reaches only that pod. It closes the link-kind and
encapsulation gaps for the one pod it runs in. It does not close loopback,
and it does not help a host-network pod, whose sidecar shares the host's
stack exactly as the pod does.
