# Bare-Metal Load Balancer

> **Edition: Enterprise** (the Kubernetes operator, licence feature `kubernetes-operator`)

## Overview

A cluster with no cloud provider behind it has nothing that answers a
`Service` of type `LoadBalancer`: the Service sits with an empty ingress and
nothing reaches it from outside. Under the operator, eBPFsentinel answers
it. The operator gives the Service an address from a pool you declare, the
agents serve that address on the XDP load balancer they already run, and one
node announces it to the network, over ARP on a flat segment or over BGP to
the routers above it.

There is no second datapath. The program that balances the traffic is the
one that already carries the agent's own load balancer services, with Maglev
consistent hashing and DNAT to the Service's ready endpoints, so a node runs
one thing rather than a security agent beside a load balancer.

## How a Service gets an address

1. **Pools.** A `LoadBalancerConfig` declares `addressPools`: CIDRs, ranges
   and single addresses, optionally restricted to some namespaces and
   optionally kept for Services that ask for them by name. A pool that
   overlaps another, or reuses its name, is refused whole and the policy's
   status says why.
2. **Claim.** The operator serves Services whose `loadBalancerClass` is
   `ebpfsentinel.io/xdp`, and unclassed ones too when you ask it to. A
   Service can name a pool, an address, or a sharing key.
3. **Allocation.** Only the operator replica holding the lease allocates, so
   an address is never given twice. A Service keeps the address it holds for
   as long as its pool still admits it; the others are served in creation
   order, each the lowest free address of the first pool that has one.
4. **Programming.** The allocation is recorded on the policy with each port
   and the ready endpoints behind it, the agents' configuration is rendered
   from that record, and the address joins the announced VIPs.
5. **Status.** The address is written to `status.loadBalancer.ingress`, and
   every claimed Service carries the condition
   `ebpfsentinel.io/AddressAllocated`. A Service that cannot be served, an
   exhausted pool or a requested address already held, says so in that
   condition and in an event instead of sitting pending.
6. **Release.** A finalizer withdraws the address from the agents before the
   ingress is cleared, so a deleted Service never leaves an address answered
   by nobody or by two Services.

[Services of type LoadBalancer](../../configuration/loadbalancer.md#services-of-type-loadbalancer)
has every field, annotation, reason and ceiling.

## Announcement modes

| Mode | What reaches the network | When to use it |
|------|-------------------------|----------------|
| ARP | The speaker answers ARP for the addresses and sends gratuitous ARP when it takes over. | A flat L2 segment, where the addresses come out of the nodes' own subnet. |
| BGP | Every node holds its BGP sessions up, and only the speaker exports a route per address. | A routed network, where the top-of-rack routers have to learn where the addresses live. |

BGP is not a stack of ours. The agent drives [BIRD 2](https://bird.network.cz/),
a routing daemon the operator runs beside it from an image you name, by
writing BIRD's whole configuration and reading the sessions back. No BIRD
image is published under this project's name. Each session's state and last
error reach the policy's `status.bgp` and the
`ebpfsentinel_operator_bgp_sessions` gauge;
[BGP announcement](../../configuration/loadbalancer.md#bgp-announcement)
covers the keys.

## Leader election and failover

One node speaks for a policy's addresses at a time. The operator elects it:
it grants the speaker role to one agent for 30 seconds and renews the grant
every 2 seconds, and the agent counts that grant on its own clock, so a
node that loses the operator falls silent on time without hearing from
anybody. When the speaker stops answering, the operator grants nobody until
the old grant has run out, and only then picks the next agent. That fence is
what keeps two nodes from answering for one address, at the price of a gap.

| Event | Addresses unanswered |
|-------|----------------------|
| Speaker node lost, network cut or agent stopped | Up to 32 seconds |
| Operator leader lost | None: the standby takes over and renews the same speaker before its grant lapses |
| Every operator replica gone | The speaker keeps answering for up to 30 seconds, then falls silent |

Under BGP, a takeover is a route appearing on a session that is already
established, so the routers converge as soon as the new speaker exports.
[Elected speaker](../../configuration/loadbalancer.md#elected-speaker) gives
the full timings.

## What this does not do

- **No ECMP.** One node speaks at a time, so a policy's addresses enter the
  cluster through one node and its NIC sets the ceiling. Spreading the load
  means spreading the Services across several policies with different
  speakers.
- **Failover is bounded, not instant.** Losing the speaker costs up to 32
  seconds, because the fence that prevents two speakers is the grant
  running out. There is no BFD to shorten it.
- **A narrow BGP.** Sessions export one host route per address and import
  nothing: no communities, no local preference, no per-peer advertisement
  rules, no route learned from the peers.
- **One family per Service.** The address is of the Service's first family;
  a dual-stack Service gets one address, not one of each.
- **`externalTrafficPolicy` is not read.** Traffic goes to every ready
  endpoint the Service has, wherever it runs, rather than only to the
  endpoints on the node that received it.
- **TCP and UDP only.** An SCTP port is reported and left unserved.
- **Not a replacement for kube-proxy.** ClusterIP and NodePort stay with
  whatever serves them today.

## Compared with MetalLB

MetalLB is the obvious alternative, and on most of what an estate weighs it
is the more mature choice. It has years of production estates behind it and
a matrix of routers it has been run against; this has its documentation and
its tests. It runs in BGP mode from every node with endpoints, so ECMP
spreads the load across the cluster; it can speak BFD and set communities
through its FRR mode; and its advertisements can be scoped to node subsets
and peers. It needs nothing else installed and costs nothing.

What eBPFsentinel offers in exchange is narrower: the addresses are served
by the XDP program the security agent already runs, so the packet that is
balanced is the packet the firewall, the rate limiter and the DDoS
mitigation have already decided on, on one datapath and one agent per node.
If you already run the agent under the operator and the limits above are
acceptable, there is no second component to run. If you need ECMP, BFD,
fine-grained BGP policy or a dual-stack Service, MetalLB is the better fit,
and it can run beside the agent: give the Services it serves no
`ebpfsentinel.io/xdp` class and leave `claimUnclassed` off.
