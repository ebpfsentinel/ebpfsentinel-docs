# Packet Trace

"Why is this packet dropped" answered by the programs that would drop it. A
trace crafts one packet from a five-tuple and runs it through the eBPF programs
the node has loaded, in the order their hooks run them, and each program says
what it decided and which rule decided it. The trace stops where the packet
would have stopped.

Nothing goes on the wire and nothing on the node changes: the packet never
reaches an interface, and every program reads its maps and skips its writes,
so a trace adds no connection, spends no rate budget and counts in no metric.

## How It Works

1. The agent builds the packet: the addresses, the ports and the protocol
   asked for, a TCP SYN for TCP. A source port left out is an ephemeral one.
2. The programs of the direction asked for are run one at a time with
   `BPF_PROG_TEST_RUN`, each handed the packet as the previous one left it,
   because a translation upstream changes what a later stage matches. The XDP
   entry program follows its own tail calls and leaves one record per stage;
   each tc classifier leaves its own.
3. The walk stops at the first program whose answer keeps the packet from the
   next hook. Each record names the stage, the hook, the verdict, why the stage
   decided and the rule by its number; the agent then names the rule from the
   configuration in force: a firewall rule by its identifier, an IDS rule by
   its own, a threat-intelligence match by the feed that listed the address.

Programs of that direction that are not loaded on the node are listed rather
than skipped silently, so a trace that passed is never read as "the IDS let it
through" on a node where the IDS is not running.

## What a Verdict Holds For

A trace answers for **this packet, now**. Most stages decide from the packet
and the rules alone, and their verdict holds for every packet of the
five-tuple. Two kinds of answer do not:

- `established`: the flow is already tracked, so the rules were not consulted.
  A first packet of the same five-tuple is decided by the rules.
- `rate`: a rate or a state budget was exceeded at the moment of the trace.
  The same packet under the limit is decided otherwise.

The agent names each stage whose verdict depends on state in
`state_dependent`, and the command line and the console print the sentence
beside that stage rather than under the whole answer.

## Reading It

```bash
ebpfsentinel-agent trace 10.0.0.2 --src 203.0.113.9 --dport 443
```

```text
TCP 203.0.113.9 -> 10.0.0.2 40000 -> 443 (ingress)
STAGE       HOOK  VERDICT  REASON   RULE        DETAIL
rate_limit  xdp   pass     default  -           -
firewall    xdp   drop     rule     deny-https  -
Stopped at firewall: drop.
Not loaded, so not asked: tc_qos_ingress.
```

`--workload namespace/name` takes the source address from a pod rather than
from `--src`, and `--direction egress` runs the programs of the egress path.
The same reading is `POST /api/v1/trace` (see the
[REST API reference](../api-reference/rest-api.md#packet-trace)) and the
`trace` command (see the [CLI reference](../cli-reference/index.md#trace)).

In the console, the trace screen is reached from an alert, from a sampled
connection and from a firewall rule, each opening the form filled with the
packet it names. The press stays the operator's: a link runs nothing. Running
a trace is an analyst's act, held to a permission of its own, and a viewer is
shown no form.

## Bounds

- One packet per trace. A trace says nothing about the packets that came
  before it, beyond what the maps already hold.
- A stage that returned without recording why reads `unrecorded`, and its
  verdict is still the program's own.
- A node with no eBPF program loaded answers `404`, and a kernel refusing to
  run the programs answers `503`: neither is a verdict about the packet.
