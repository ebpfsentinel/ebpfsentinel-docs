# When to Run an Agent Inside Pods

The node agent is the deployment. An agent running under
[`profile: pod`](../../configuration/agent.md#pod-profile) inside selected
pods is an addition for a few pods whose traffic the node agent has been shown
not to see, and this page is about deciding whether you have any. Most estates
do not, and for them the right answer is to leave the profile off.

The decision starts from the coverage verdict, never from the feature list.

## Read the verdict first

Every node agent judges each pod on its node from the links its chain is
actually on, and says so on four surfaces (see
[What a Node Agent Sees](../../architecture/node-agent-visibility.md)):

```bash
ebpfsentinel-agent ebpf coverage
```

or `GET /api/v1/ebpf/coverage`, the dashboard's **Pod coverage** screen, and
under the operator the status of the `EbpfSentinelAgent` resource. Read it on
every node, since each node agent judges only its own pods.

Two fields answer the question:

- `pod_profile_recommended` at the top counts the pods for which a pod agent
  would close a gap other than loopback. When it is `0`, stop here: the
  profile buys nothing but loopback on this node.
- On each pod, `closed_by_pod_profile` on a class with a gap says whether an
  agent inside that pod would observe it.

## What it closes, and what it does not

| Gap code | Closed by the pod profile | Why |
|---|---|---|
| `no_link_found` | Yes | The pod agent hooks the pod's own interface, whatever leads to it on the host |
| `link_kind_unknown` | Yes | Inside the namespace the interface is the pod's end, not the host's device |
| `attach_mode_skips_kind` | Yes, but change `agent.attach_mode` first | `auto` attaches to both veth and netkit; the setting is usually the cheaper fix |
| `programs_refused` | Yes, when the program ahead of the agent sits on the host side only | A CNI program on the host hook does not stand in front of the pod's own interface |
| `no_uplink_attached` | Yes, for the pods selected | Fix `agent.interfaces` instead: it covers every pod of the node at no cost per pod |
| `encapsulated_on_uplink` | Yes | The pod agent reads the packet before the CNI wraps it |
| `loopback_stays_in_pod` | Yes | The chain is attached to the pod's `lo` too |
| `host_network_stays_on_host` | **No** | A host-network pod has no namespace of its own, and is never selected |

Where the verdict names a gap the node agent can close itself, close it there
first: a setting fixes every pod of the node, the profile fixes only the pods
it selects.

What the pod profile never gives you is what lives on the node: the firewall,
rate limiting, DDoS, load balancing, NAT, routing, shaping, zones, DLP,
attribution, the process table and automated capture. A configuration that
enables one of those under `profile: pod` is refused at startup. Inside a pod
the agent runs the TC chain and what reads from it - `ids`, `ips`,
`threatintel`, `dns`, `conntrack`, `l7`, `alerting`, `audit` - and its
blocking reaches that pod alone.

Loopback alone is never a reason to deploy it. Two processes of one pod
talking to each other are better read where the bytes are produced, which is
what the DLP uprobes on the node already do for TLS.

## What it costs per pod

- **Memory.** The programs and maps are loaded once per pod agent, which is
  one per node, not one per pod. Its memory is sized by its configuration
  exactly like a node agent's of the same configuration and does not grow
  with the number of pods it selects.
- **Kernel links.** Each selected pod gets every loaded TC program on each of
  its interfaces, loopback included: with the usual `eth0` and `lo`, that is
  twice the number of TC programs loaded, held by the agent for as long as
  the pod is selected.
- **Per packet.** Every packet the pod sends or receives, loopback included,
  makes one pass through the chain inside the pod. Measure it on the pods you
  select with `ebpfsentinel-agent ebpf status` rather than assuming a figure;
  loopback-heavy workloads pay the most, because their loopback was free
  before.
- **One file per pod** in the node's claims directory, rewritten every
  fifteen seconds, which is how the node agent stands back from that pod's
  link so a flow between two pods of the node is read once (see
  [One flow, counted once](../../configuration/agent.md#one-flow-counted-once)).
  Traffic between a selected pod and the outside world is still read again at
  the node's uplink.
- **A second DaemonSet** to run and upgrade, with the warden sidecar that
  holds `SYS_ADMIN` to enter the pods' namespaces.

## When not to deploy it

- The verdict shows `pod_profile_recommended: 0` on every node.
- The only gaps are `host_network_stays_on_host`: the profile does not reach
  those pods, and the answer is to move the workload off the host network
  when nothing requires it.
- The gaps are `attach_mode_skips_kind` or `no_uplink_attached`, which a
  setting on the node agent closes for every pod.
- You want the node-level enforcement - firewall, NAT, DDoS - inside a pod.
  The profile refuses it; those decisions belong to the node.

When the verdict does name pods the node agent cannot see, select those pods
and no others with `pod_selector`, then read the verdict again: the pods it
now holds report every class observed, and the node agent reports their links
as `inspected_inside`.
