# Kubernetes NetworkPolicy

> **Edition: OSS**

## Overview

A Kubernetes `NetworkPolicy` is only as good as the CNI that reads it, and
several do not read it at all: Flannel, the default kubenet, and a fair number
of managed node pools leave every policy object in the API server and enforce
nothing. The agent can carry those policies out itself, on the pods of the
node it runs on, through the same cgroup hooks that decide
[workload rules](../configuration/workload-firewall.md).

Each agent watches the cluster's `NetworkPolicy` objects, pods, namespaces,
services and endpoint slices, works out which policies select the pods of its
own node, and compiles them into a longest-prefix table per distinct rule set.
Each container cgroup of a selected pod is then pointed at its table. Nothing
is rendered into the agent's configuration and nothing restarts when a pod
comes or goes: the compile runs inside the agent, a second after the last
change of a burst, so a rollout costs one compile rather than one per pod.

## Modes

| Mode | What happens |
|------|--------------|
| `off` (default) | Nothing is watched and nothing is loaded |
| `observe` | Every new connection is checked and what the policy would refuse is counted, then let through |
| `enforce` | What the policy refuses is refused. The agent refuses to start when the hooks cannot attach or the cluster cannot be read |

Start with `observe`. The counters below say what `enforce` would have done,
on real traffic, before anything is refused.

```yaml
container:
  kubernetes:
    enabled: true
    network_policy:
      mode: observe
```

The agent enforces where the cluster's CNI enforces nothing. Running it in
`enforce` beside a CNI that also enforces `NetworkPolicy` (Cilium, Calico,
Antrea and the like) puts two enforcers on one policy, and when they read it
differently nobody can tell which one refused a connection. Deployed through
the Kubernetes operator, `enforce` is rendered as `observe` when the operator
finds such a CNI or cannot tell, unless the resource says to run alongside
it; the [operator page](enterprise/kubernetes-operator.md#when-the-cni-already-enforces)
carries the decision table. Deployed through the agent's own chart, nobody
makes that check for you: choose `enforce` only on a CNI you know enforces
nothing.

Policies written as `CiliumNetworkPolicy` are read by nothing once Cilium is
gone. The operator image translates them into `NetworkPolicy` offline and
reports, by object, field and reason, everything it could not carry; see
[importing policies written for Cilium](enterprise/kubernetes-operator.md#importing-policies-written-for-cilium).

The mode needs the Kubernetes enricher on and an in-cluster ServiceAccount.
See [container configuration](../configuration/container.md#networkpolicy) for
the field, and [Kubernetes deployment](../operations/deployment/kubernetes.md)
for the chart value and the RBAC it grants.

## Where it is decided

- **Egress** is decided in `connect()` and `sendmsg()`, before a packet
  exists, so a refused connection returns `EPERM` to the application rather
  than timing out. It is checked ahead of the workload rules, so a connection
  must be allowed by both.
- **Ingress** is decided by a `cgroup_skb` ingress program on the first packet
  of a TCP connection or on a UDP datagram that does not answer one the pod
  sent. Every later packet belongs to a connection the policy already let in.
- **Replies** to what the pod opened are admitted whatever the ingress policy
  says, which is what the specification means by a policy applying to new
  connections only. For TCP that falls out of checking the opening `SYN`
  alone. For UDP a datagram from an address and port the pod sent to within
  the last two minutes is a reply.

## Semantics

The upstream specification is followed, with the points below stated because
each one is a place where an implementation can differ.

- A policy with no `policyTypes` isolates ingress always and egress only when
  it carries egress rules. Rules are unioned across every policy selecting a
  pod; an empty peer list means every peer and an empty port list every port.
  Named ports are resolved against the destination pod's container ports.
- **A Service address is open on egress only when every ready backend behind
  it is allowed.** The connection is made to the virtual IP and translated
  after the hook has decided, so the hook cannot tell which backend it will
  reach. A service whose backends are only partly allowed stays closed, and
  the agent logs which service, which port and how many backends of how many
  were allowed.
- **A pod's own addresses are not implicitly open.** A pod reaching itself
  through its own IP is subject to its egress policy like any other
  destination.
- **Node addresses and loopback are always open**, in both directions, so the
  kubelet's probes keep working. The node addresses are taken from the
  `hostIPs` the API reports for the pods of the node.
- `hostNetwork` pods and pods that have finished are never selected.
- **ICMP and SCTP inbound are not filtered.** Egress is decided at the socket,
  so it covers every protocol a socket can open.
- One peer carries at most 16 port ranges. A peer with more keeps the first 16
  and the agent logs the pod, the direction and how many were dropped; the
  dropped ranges stay closed.
- The tables hold 65,536 entries across 4,096 distinct rule sets, for 8,192
  container cgroups. A pod whose rule set does not fit is closed where it is
  isolated rather than left open, and the agent logs it. A cgroup that does
  not fit in the cgroup table is not enforced, and the agent logs how many.
- A new container is picked up when its cgroup is seen, which happens on the
  pod's own status change and on a rescan every ten seconds. Until then the
  container's traffic is not checked.

## Metrics

Published under `ebpfsentinel_packets_total{interface="NETPOL_METRICS"}`:

| `action` | Meaning |
|----------|---------|
| `egress_checked` | Connections and datagrams a selected pod opened |
| `egress_refused` | Refused in `enforce` mode |
| `egress_would_refuse` | Would have been refused, counted in `observe` mode |
| `ingress_checked` | Opening `SYN`s and unsolicited UDP datagrams reaching a selected pod |
| `ingress_refused` | Dropped in `enforce` mode |
| `ingress_would_refuse` | Would have been dropped, counted in `observe` mode |
| `reply_admitted` | Inbound UDP datagrams let in as replies to what the pod sent |

## See also

- [Container awareness](container-awareness.md)
- [Workload rules](../configuration/workload-firewall.md)
- [Container configuration](../configuration/container.md)
