# Segments

> **Edition: OSS, every tier** | **Enforcement: Userspace** | **Domain: learning**

## What it shows

Which workloads belong together, read off what they actually reached. Each
agent watches its node for a [learning window](learning-mode.md) and keeps
every destination its workloads dialled. Read across a fleet, those windows are
a graph, and the proposal groups workloads into segments from it:

- **A segment** is a set of workloads held together by at least two
  independent paths, listed with the links that join them, so the grouping can
  be checked rather than trusted.
- **A bridge** is a link whose removal would split the graph: the one flow
  keeping two segments joined.
- **A shared address**, one several workloads dialled from, joins nothing: its
  flows are listed with the candidates rather than used to guess.

Every segment carries the shortest window it was read off, and a window that
was interrupted or filled up is named.

## One example

On one node, the raw reading and the rules it implies:

```bash
ebpfsentinel-agent learning start -d 3600
ebpfsentinel-agent learning edges
ebpfsentinel-agent learning policy
```

Across the fleet, the proposal is `GET /api/v1/{tenant}/segments/proposal` on
the dashboard and its **Segments** screen under the network section. The same
windows written as workload rules are `GET /api/v1/{tenant}/segments/policy`:
one allow per destination, port and protocol, then one refusal per workload,
every rule in `observe` mode, with a replay of the observed flows against them.
Nothing is applied; the text goes through the ordinary rollout.

The reading on each node is part of the open source agent; the fleet proposal
is computed by the dashboard and gated on no licence feature of its own.

## Configuration

The window's keys are in [Learning mode configuration](../configuration/learning.md).
An agent holds at most 64 workload rules, so a workload that does not fit is
left out whole and listed as `unrestricted`. What a window cannot know, and the
detail of the proposal, are in
[Segments across the fleet](learning-mode.md#segments-across-the-fleet) and
[The proposal as policy](learning-mode.md#the-proposal-as-policy).
