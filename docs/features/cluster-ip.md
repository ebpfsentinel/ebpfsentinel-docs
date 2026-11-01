# Cluster address resolution

> **Edition: OSS**

## Overview

A pod connecting to a Service's cluster address goes through the node's
kube-proxy rules: the packet leaves with the cluster address as its
destination, and a NAT rule rewrites it to one of the Service's backends on
its way out. The agent can make that choice earlier, for the pods you name:
when such a pod calls `connect()` on a cluster address, the destination is
replaced by one of the Service's ready backends before a packet exists, so
the connection carries the backend address from its first packet and no NAT
rule is read for it.

It is off unless turned on, and it applies to the pods a selector names and
to no other. Every pod that is not named, the node itself, and every
connection the agent leaves alone keep going through kube-proxy exactly as
before. **This is not a kube-proxy replacement**, and it is not meant to
grow into one: kube-proxy stays installed and keeps serving everything this
page does not list.

```yaml
container:
  kubernetes:
    enabled: true
    cluster_ip:
      enabled: true
      workloads:
        - namespaces:
            match_labels:
              kubernetes.io/metadata.name: shop
          pods:
            match_labels:
              app: checkout
```

A pod is resolved here when it matches any entry of `workloads`. An entry
setting both `pods` and `namespaces` takes the pods matching the first in a
namespace matching the second. See
[container configuration](../configuration/container.md#cluster-address-resolution)
for the fields.

## What it does

- **TCP and connected UDP.** The hooks run at `connect()`, for IPv4 and IPv6.
  A UDP socket that calls `connect()` before sending, which is what most DNS
  resolvers and clients do, is resolved like a TCP one.
- **Ready backends only.** A backend is taken from the Service's endpoint
  slices when its endpoint is ready, in the address family of the cluster
  address and on the target port the Service port names.
- **Session affinity.** A Service with `sessionAffinity: ClientIP` sends every
  connection from one pod's network namespace to the same backend for the
  timeout the Service sets (three hours when it sets none), as long as that
  backend stays ready.
- **The address the task asked for.** `getpeername()` on a resolved socket,
  and the source address `recvmsg()` reports on a connected UDP socket, are
  the cluster address and not the backend's, so a client that checks who it
  is talking to reads the address it connected to.

## What it leaves to kube-proxy

These are the cases the agent recognises and declines on purpose. Each goes
through kube-proxy, unchanged.

| Case | Why |
|---|---|
| Pods no `workloads` entry names, and pods on the host network | Not opted in. A host-network pod's connections are the node's |
| The node's own connections | Not a pod |
| `NodePort`, `LoadBalancer` and external addresses | Only cluster addresses are in the table |
| Unconnected UDP, a `sendto()` naming the cluster address on each datagram | No `connect()` happens, so there is nothing to translate at; kube-proxy's rules handle it |
| `internalTrafficPolicy: Local` | Only the node's own backends may be chosen, which the node's kube-proxy already knows |
| Topology-aware routing (`trafficDistribution`, or the `service.kubernetes.io/topology-mode` annotation) | The zone hints are kube-proxy's to read |
| SCTP ports | Only TCP and UDP are resolved |
| A Service with no ready backend | kube-proxy answers it the way it answers every other client |
| A Service past 4,096 backends, or a table past 16,384 Service ports or 131,072 backends in total | The table is full; the Service stays on kube-proxy and is listed as such |
| Opted-in containers past 4,096 cgroups on one node | The cgroup table is full; the agent warns and the rest stay with kube-proxy |
| `externalTrafficPolicy`, `hostPort`, `ExternalName` Services | Outside the cluster address path entirely |

The agent logs every Service port it leaves to kube-proxy and why, when that
list changes.

## Beside the CNI

Resolution happens in the socket layer, before the packet reaches the CNI,
so the CNI sees a connection from the pod to the backend's pod address, which
it routes and polices like any pod-to-pod connection. A `NetworkPolicy`
selecting the backend's pods therefore applies to the resolved connection
exactly as it applies to one kube-proxy translated.

Cilium in kube-proxy replacement mode already resolves cluster addresses at
`connect()` for every pod. Turning this on beside it gives the same pods two
resolvers; leave it off there. Beside Cilium with kube-proxy, and beside
Calico, it is asserted in CI that a pod that is not opted in still reaches a
Service through kube-proxy and an opted-in pod reaches it through a backend
chosen here.

## Turning it off

Resolution leaves nothing on the node that outlives the agent's own hold on
it. The tables are created for this object alone and pinned nowhere, and the
six cgroup hooks are links only the agent holds, the warden closing its own
copy when it brokers the attach. Whatever the agent lets go of, the kernel
removes: the hooks come off the cgroup, the programs and tables are freed,
and every pod is back on kube-proxy, which was never taken out of the path.

Any of these turns it off:

- `cluster_ip.enabled: false` and a configuration reload. The hooks are
  detached and the tables released without restarting the agent.
- The chart's `container.kubernetes.clusterIp.enabled: false` and a
  `helm upgrade`, which rolls the agents.
- `clusterIp.enabled: false` on the `EbpfSentinelAgent`, which rolls the
  agents the same way.
- Stopping the agent, or deleting the `EbpfSentinelAgent` that renders it.
  Removing the Kubernetes operator with `helm uninstall` alone leaves the
  agents it rendered running, resolution included, so delete the agent
  resources first; see
  [Uninstalling](enterprise/kubernetes-operator.md#uninstalling).

To check that a node kept nothing, read the kernel rather than the agent,
from the node itself or anywhere sharing its kernel:

```bash
# No program and no table of the object. The kernel keeps fifteen characters
# of each name, which keeps the prefix.
bpftool -j prog show | jq '[.[] | select(.name // "" | startswith("clusterip_"))] | length'
bpftool -j map show  | jq '[.[] | select(.name // "" | startswith("CLUSTERIP_"))] | length'

# No hook on any cgroup.
bpftool -j cgroup tree | jq '[.[].programs[] | select(.name | startswith("clusterip_"))] | length'

# Nothing pinned under the BPF filesystem.
find /sys/fs/bpf -iname '*clusterip*'
```

Each count is `0` and the search prints nothing. The agent's status says the
same from its side: `cgroup-clusterip` is absent from `/api/v1/ebpf/status`
or reported `loaded: false`. Beside both supported CNIs, CI turns
resolution off on a running cluster, and deletes the agent resource, and
checks each time that the counts are zero, that nothing is pinned on any node,
and that a pod which was opted in reaches its Service through kube-proxy.

## Counters

- `ebpfsentinel_packets_total{interface="CLUSTERIP_METRICS", action}`: `translated`, `left_to_kube_proxy`, `affinity_hit`, `reversed`.

| Counter | Meaning |
|---|---|
| `translated` | Connections of opted-in pods sent straight to a backend |
| `left_to_kube_proxy` | Connections of opted-in pods to a cluster address in the table that were left to kube-proxy: the list was empty, a backend could not be read, or the record that lets `getpeername()` answer could not be written |
| `affinity_hit` | Of the translated ones, those sent to the backend a session affinity remembered |
| `reversed` | Peer and datagram source addresses rewritten back to the cluster address |

## Requirements

- The Kubernetes enricher on, with an in-cluster ServiceAccount allowed to
  `list` and `watch` `namespaces`, `pods` and `services`, and `endpointslices`
  in `discovery.k8s.io`.
- The host's cgroup v2 hierarchy visible at `attribution.cgroup_root`, where
  the hooks attach and where the pods' cgroups are found.
- The rights to attach cgroup programs, directly or through the warden.

When any of these is missing the hooks are not attached, the agent says why
under the program's status, and every connection keeps going through
kube-proxy.
