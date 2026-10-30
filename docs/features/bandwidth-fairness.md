# Bandwidth Fairness

> **Edition: OSS** | **eBPF Program: tc-qos** | **Domain: qos**

## Overview

Workloads on one node share its links, and without an arbiter the loudest one sets everybody's latency. This page says what the agent arbitrates today, what it promises, what it does not, the kernel conditions it depends on, and how to check the behaviour on your own node.

The short version: the agent can hold each selected workload to an **egress ceiling**, measured per cgroup and paced rather than dropped. It does **not** divide a link into shares, it does not give any workload a floor, and it does not shape ingress.

## What Is Shared

Everything leaving the node through an interface the agent is attached to. A workload is a cgroup: a systemd unit, a container, a pod, or anything under a cgroup v2 path. Traffic a workload sends from its own sockets and traffic it sends from a container network namespace through a host-side link are both attributed to its cgroup.

## What Is Guaranteed

- **A ceiling per cgroup.** Each cgroup selected by a `qos.cgroup_shaping` rule leaves the node at no more than the rule's rate, measured over any interval longer than one packet's serialisation at that rate.
- **Pacing, not policing.** A packet over the rate is held until its departure time rather than dropped, so a TCP sender sees delay and slows down instead of retransmitting. Other workloads on the same interface are not queued behind it: `fq` keeps one queue per flow.
- **A bounded queue.** A packet whose departure would fall further ahead than the rule's horizon (two seconds by default) is dropped and counted, so a workload far above its rate cannot build an unbounded backlog.
- **A measured result.** The rate each cgroup actually achieved over the last read interval is exposed, so the configuration can be checked against what happened.
- **Absent, not approximate.** On an interface whose qdisc cannot honour a departure time the shaper does nothing to the packet, and the agent reports that interface as not shaping rather than appearing to.

## What Is Not Guaranteed

- **No floor and no share.** A ceiling stops one workload taking too much; it does not reserve anything for another. Two unshaped workloads still compete for whatever is left, and an idle link is not lent to a capped workload. There is no work-conserving scheduler dividing the link between tenants in this build.
- **The rate is per cgroup, not per rule or per tenant.** A rule matching ten containers holds each of them to the rate, so together they may send ten times it. A selector over a tenant's cgroup subtree caps each workload of the tenant, not the tenant as a whole.
- **Egress only.** Traffic arriving at the node has already crossed the link; there is no departure time to set. Ingress limits are a pipe with `direction: ingress`, which drops rather than paces.
- **Forwarded container traffic pays in drops past the horizon.** A local socket feels the queue through TCP small queues and slows down early. A packet that crossed from a container network namespace no longer belongs to the sender's socket on the host, so the sender learns about the queue only from delay and, past the horizon, from a drop.
- **Tasks the agent has not seen.** A cgroup is shaped once the agent has seen a task in it execute, which needs the [process table](../configuration/process-table.md) (on by default). A process already running when the agent starts is picked up at its next exec, or when its container is resolved from the link it sends through.

## Kernel Conditions

| Condition | Why | How to check |
|-----------|-----|--------------|
| `fq` as the root qdisc, or `mq` with `fq` under every queue | `fq` is what holds a packet until `skb->tstamp`; any other qdisc sends it at once | `ebpfsentinel-agent qos shaping`, column `HONOURED` |
| cgroup v2 | the cgroup id behind a packet is a cgroup v2 id | `stat -fc %T /sys/fs/cgroup` prints `cgroup2fs` |
| `tc-qos` loaded | the shaper is part of the QoS program | `ebpfsentinel-agent qos shaping` prints `Supported: yes` |

The agent's kernel floor already covers every helper the shaper calls. The qdisc is the condition that varies between hosts: many distributions default to `fq_codel`, and a cloud image may leave `mq` with `fq_codel` children. To make an interface eligible:

```bash
tc qdisc replace dev eth0 root fq
```

or set `net.core.default_qdisc = fq` and recreate the interface's root qdisc. The agent reads the qdiscs again at every read interval, so the change is picked up without a restart.

## Verifying on a Node

1. Check the interfaces:

   ```bash
   ebpfsentinel-agent qos shaping
   ```

   Every interface the agent attaches to is listed with its root qdisc and whether shaping acts there. `Active: no` with rules configured means no interface qualifies.

2. Send from a shaped workload and read the achieved rate, in the same command or in Prometheus:

   ```promql
   ebpfsentinel_cgroup_shaping_achieved_bps{rule_id="batch-jobs"}
   rate(ebpfsentinel_cgroup_shaping_dropped_horizon_total[5m])
   ```

3. Confirm the qdisc is holding packets: `tc -s qdisc show dev eth0` reports `throttled` on `fq` while a shaped workload is above its rate.

## Worked Example: Docker Host

A host runs a build cache container that saturates the uplink while other containers serve requests. Hold it to 200 Mbit/s:

```yaml
container:
  docker:
    enabled: true
qos:
  enabled: true
  cgroup_shaping:
    - id: build-cache
      workload:
        container: build-cache
      rate: "200mbps"
```

Naming the container by name needs the Docker enricher turned on, as above; an id prefix of at least twelve characters works without it. The container's traffic leaves its network namespace through a host-side veth, is masqueraded, and leaves through `eth0`. The agent maps that veth to the container's cgroup, so the packet is attributed even though it no longer carries the container's socket. With `fq` on `eth0`, `qos shaping` lists `build-cache` with an achieved rate settling at or below 200000000, and the serving containers are unaffected because their flows sit in queues of their own.

## Worked Example: Multi-Tenant Host

Two tenants run under `/tenants/acme.slice` and `/tenants/globex.slice`, each with several services. A rule per tenant caps every one of the tenant's workloads:

```yaml
qos:
  enabled: true
  cgroup_shaping:
    - id: acme-noisy-export
      workload:
        unit: export.service
        cgroup: /tenants/acme.slice
      rate: "50mbps"
    - id: acme
      workload:
        cgroup: /tenants/acme.slice
      rate: "300mbps"
    - id: globex
      workload:
        cgroup: /tenants/globex.slice
      rate: "300mbps"
```

The first matching rule wins, so the export service is held to 50 Mbit/s and every other `acme` workload to 300 Mbit/s each. Neither tenant is held to 300 Mbit/s in total, and neither is guaranteed any bandwidth when the other is quiet or busy: these are ceilings per workload, which is what this build can promise.

## Related

- [QoS / Traffic Shaping](qos.md) - pipes, queues, classifiers and the shaper's maps
- [QoS configuration](../configuration/qos.md) - every `cgroup_shaping` field
- [Container Awareness](container-awareness.md) - how a container is named and resolved
