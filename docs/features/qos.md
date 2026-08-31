# QoS / Traffic Shaping

> **Edition: OSS** | **eBPF Program: tc-qos** | **Domain: qos**

## Overview

eBPFsentinel provides kernel-speed QoS (Quality of Service) and traffic shaping via a TC classifier (`tc-qos`) attached to both the ingress and the egress hook. The architecture follows a three-level hierarchy - **pipes**, **queues**, and **classifiers** - inspired by `dummynet` / `ipfw` semantics. Traffic is matched by 5-tuple + DSCP rules, assigned to a queue, and shaped by the pipe that queue hangs from: a token bucket for bandwidth, EDT pacing for delay, and a random drop for loss emulation.

## How It Works

### Three-Level Hierarchy

```
Classifiers (match traffic → assign to queue)
    │
    ▼
Queues (name the pipe that shapes them)
    │
    ▼
Pipes (bandwidth limit, delay, loss, burst, direction)
    │
    ▼
Wire
```

1. **Classifiers** match packets by 5-tuple (src/dst IP, src/dst port, protocol), DSCP value, and optionally VLAN ID. The lookup is by specificity, not by list order (see below).
2. **Queues** exist so that a set of classifiers can be moved between pipes, or switched off, in one edit. A queue carries no shaping parameters of its own.
3. **Pipes** do the shaping: bandwidth limiting (token bucket), delay (EDT pacing), random packet loss, and burst allowance. Each pipe declares which hook it shapes.

### Pipe Features

Each pipe defines a traffic shaping profile:

| Parameter | Description |
|-----------|-------------|
| `bandwidth` | Rate cap, e.g. `"100mbps"`. Userspace converts it to nanoseconds per byte for the kernel-side token bucket |
| `burst` | Token bucket capacity - the amount that may be sent back to back after an idle period |
| `delay` | Latency added to every packet of the flow, in milliseconds |
| `loss` | Random packet drop probability (0.0-100.0), for link degradation simulation |
| `direction` | Hook the pipe shapes: `egress`, `ingress`, or `both` |

**One bucket per pipe.** The token bucket belongs to the pipe, not to the flow: a pipe declaring 100 Mbps caps everything classified into it at 100 Mbps in total, however many flows there are. Reserving bandwidth for a class of traffic therefore means giving it its own pipe, not its own queue. The bucket entry is shared by every CPU, so accounting under a multi-queue NIC is approximate at the individual packet level and exact over any meaningful interval.

Tokens are refilled from `bpf_ktime_get_boot_ns` timestamps: one byte of credit per `ns_per_byte` elapsed, capped at the burst size. A packet that finds insufficient credit is dropped.

**Both hooks, one program.** `tc-qos` is attached to TC ingress and TC egress. A forwarded packet crosses both, so a pipe only accounts for a packet on the hook it declares - without that, a pipe would be charged twice for every forwarded packet and would enforce half its configured rate.

**ECN before drops.** While a bucket holds less than a quarter of its burst, packets passing through it are marked with ECN Congestion Experienced (`bpf_skb_ecn_set_ce`). An ECN-capable sender slows down before the bucket empties, which avoids the drop entirely.

### Queue Features

| Parameter | Description |
|-----------|-------------|
| `pipe_id` | Pipe this queue is attached to |
| `enabled` | Whether the queue is active |

Disabling a queue stops every classifier pointing at it in one move, without editing them. That is the queue's whole purpose: it is the level of indirection between the match rules and the shaper.

### Classifier Features

Classifiers assign packets to queues based on match criteria:

| Field | Description |
|-------|-------------|
| `queue_id` | Target queue for matched traffic |
| `priority` | Tie-break between classifiers sharing one lookup key (lower wins) |
| `src_ip` | Source host, exact IPv4 address (omit = wildcard) |
| `dst_ip` | Destination host, exact IPv4 address (omit = wildcard) |
| `src_port` | Source port (0 = wildcard) |
| `dst_port` | Destination port (0 = wildcard) |
| `protocol` | IP protocol number (0 = wildcard) |
| `dscp` | DSCP value (0 = wildcard) |
| `vlan_id` | 802.1Q VLAN ID; omit to match any VLAN, `0` matches untagged traffic only |

**Matching is by specificity, not by list order.** A classifier encodes "any" as a zero in the match tuple, and the data plane finds it by rebuilding the key from the packet with the open fields zeroed out. It walks from the most specific shape to the least: exact 5-tuple, then wildcard source port, then both ports, then a port pair on any host, then destination port alone, then source port alone, then a protocol-wide rule, and finally the wildcard (`match: {}`). At each step a rule that names a DSCP is tried before the equivalent rule that leaves it open, because an operator who wrote the DSCP down meant it to take precedence.

`priority` therefore never reorders that walk. It only decides which classifier wins when two of them collapse onto the same lookup key - the lowest number is installed, the others never fire.

**Addresses are matched exactly.** The classifier map is keyed on a 32-bit address, so a prefix shorter than `/32` and an IPv6 address are both rejected at load, with the reason, instead of being accepted and then shaping nothing. Shape IPv6 traffic by port, protocol or DSCP.

**VLAN scoping**: the whole cascade runs twice - first against classifiers bound to the packet's own VLAN, then against classifiers that name no VLAN. A classifier scoped to a VLAN therefore beats a broader one on the same flow.

### Interface Groups

QoS pipes and classifiers can be scoped to specific interface groups using the `interfaces` field. This allows different traffic shaping profiles per network zone - for example, stricter bandwidth limits on guest WiFi interfaces while allowing full throughput on server-facing interfaces. Rules without an `interfaces` field are floating and apply to all interfaces. See [Interface Groups](interface-groups.md).

### EDT Pacing

Delay is applied by Earliest Departure Time pacing: the program sets `skb->tstamp` via `bpf_skb_set_tstamp` to `max(now, previous departure) + delay`, per flow, and the kernel queuing discipline holds the packet until then. Two consequences follow:

- The interface needs the `fq` qdisc, which is what honours the departure timestamp. Without it the timestamp is set and ignored.
- Departure times only exist on the way out, so `delay` has no effect on a pipe whose direction is `ingress`. Such a pipe still enforces its bandwidth and loss.

## Configuration

```yaml
qos:
  enabled: true
  pipes:
    - id: wan-uplink
      bandwidth: "100mbps"
      burst: "128kb"
      direction: egress
    - id: voip-reserved
      bandwidth: "10mbps"
      burst: "16kb"
      direction: both
    - id: degraded-link
      bandwidth: "10mbps"
      burst: "32kb"
      delay: 50                # 50 ms added latency (egress only, needs fq)
      loss: 1.0                # 1% random loss
      direction: egress
      enabled: false           # For link-emulation testing

  queues:
    # Realtime traffic gets its own pipe: sharing one with bulk traffic would
    # mean sharing its token bucket.
    - id: realtime
      pipe_id: voip-reserved
    - id: best-effort
      pipe_id: wan-uplink

  classifiers:
    - id: sip-signalling
      queue_id: realtime
      match:
        protocol: udp
        dst_port: 5060
    - id: rtp-media
      queue_id: realtime
      match:
        dscp: 46               # EF (Expedited Forwarding)
    - id: catch-all
      queue_id: best-effort
      match: {}                # Everything not matched above
```

See [QoS Configuration](../configuration/qos.md) for the full field reference.

## CLI Usage

```bash
# View QoS status (enabled, pipe/queue/classifier counts)
ebpfsentinel-agent qos status

# List all pipes
ebpfsentinel-agent qos pipes

# List all queues
ebpfsentinel-agent qos queues

# List all classifiers
ebpfsentinel-agent qos classifiers

# Add a pipe
ebpfsentinel-agent qos add-pipe --json '{
  "id": "wan-uplink",
  "rate_bps": 100000000,
  "burst_bytes": 131072,
  "direction": "egress",
  "delay_ms": 0,
  "loss_pct": 0.0
}'

# Add a queue
ebpfsentinel-agent qos add-queue --json '{
  "id": "best-effort",
  "pipe_id": "wan-uplink"
}'

# Add a classifier
ebpfsentinel-agent qos add-classifier --json '{
  "id": "https",
  "queue_id": "best-effort",
  "priority": 30,
  "match_rule": { "protocol": 6, "dst_port": 443 }
}'

# Delete a pipe / queue / classifier
ebpfsentinel-agent qos delete-pipe wan-uplink
ebpfsentinel-agent qos delete-queue best-effort
ebpfsentinel-agent qos delete-classifier https

# JSON output for scripting
ebpfsentinel-agent --output json qos status
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/qos/status` | QoS status (enabled, pipe/queue/classifier counts) |
| GET | `/api/v1/qos/pipes` | List all pipes |
| POST | `/api/v1/qos/pipes` | Create a pipe (requires `admin` role) |
| DELETE | `/api/v1/qos/pipes/{id}` | Delete a pipe (requires `admin` role) |
| GET | `/api/v1/qos/queues` | List all queues |
| POST | `/api/v1/qos/queues` | Create a queue (requires `admin` role) |
| DELETE | `/api/v1/qos/queues/{id}` | Delete a queue (requires `admin` role) |
| GET | `/api/v1/qos/classifiers` | List all classifiers |
| POST | `/api/v1/qos/classifiers` | Create a classifier (requires `admin` role) |
| DELETE | `/api/v1/qos/classifiers/{id}` | Delete a classifier (requires `admin` role) |

See [REST API Reference](../api-reference/rest-api.md) for details.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/tc-qos/` | TC ingress + egress kernel-side traffic shaping |
| `ebpf-common` | `crates/ebpf-common/src/qos.rs` | Shared `#[repr(C)]` types (pipe/queue/classifier map entries, pipe and flow state) |
| `domain` | `crates/domain/src/qos/` | QoS engine (entity, engine, error) |
| `ports` | `crates/ports/src/primary/qos.rs` | Port trait |
| `application` | `crates/application/src/qos_service_impl.rs` | App service (engine + eBPF map sync) |
| `adapters` | `crates/adapters/src/ebpf/qos_map_manager.rs` | eBPF map adapter |
| `agent` | `crates/agent/src/http/qos_handler.rs` | HTTP handler (10 endpoints) |
| `infrastructure` | `crates/infrastructure/src/config/qos.rs` | Config parsing |

## eBPF Program

`tc-qos` is attached as a TC classifier on both hooks, through two entry points (`tc_qos` on egress, `tc_qos_ingress` on ingress) because the running hook cannot be read from the packet context. Each packet goes through:

1. **Parse** - Extract L3/L4 headers (IPv4/IPv6, TCP/UDP), VLAN tag, DSCP value
2. **Classify** - Progressive wildcard lookup in `QOS_CLASSIFIERS`, run first within the packet's VLAN scope and then within the any-VLAN scope
3. **Scope** - Skip the pipe if it does not shape this hook, does not cover this interface group, or belongs to another tenant
4. **Loss** - If `loss > 0`, draw from `bpf_get_prandom_u32` and drop with the configured probability
5. **Token bucket** - Refill the pipe's bucket in `QOS_PIPE_STATE` from the elapsed time, deduct the packet size, mark ECN CE if the bucket is running low, drop if there is no credit
6. **Pace** - If `delay > 0`, set the packet's departure timestamp in `skb->tstamp` from the flow's previous departure in `QOS_FLOW_STATE`
7. **Emit** - Send an event to the RingBuf with the shaping decision (shaped, dropped)

### Maps

| Map | Type | Max Entries | Description |
|-----|------|-------------|-------------|
| `QOS_PIPE_CONFIG` | Array | 64 | Pipe definitions (rate, burst, delay, loss, direction, scoping) |
| `QOS_QUEUE_CONFIG` | Array | 256 | Queue definitions (pipe_id, enabled) |
| `QOS_CLASSIFIERS` | HashMap | 1024 | Classifier rules (5-tuple + DSCP + VLAN → queue_id) |
| `QOS_PIPE_STATE` | Array | 64 | Per-pipe token bucket (tokens, last_refill_ns), shared across CPUs |
| `QOS_FLOW_STATE` | LruPerCpuHashMap | 65536 | Per-flow pacing state (last departure time) |
| `QOS_METRICS` | PerCpuArray | 7 | Per-CPU shaping counters |
| `EVENTS` | RingBuf | 1 MB | Kernel-to-userspace QoS events |
| `INTERFACE_GROUPS` | HashMap | 64 | Interface group membership bitmask per ifindex |
| `TENANT_VLAN_MAP` | HashMap | 1024 | VLAN ID → tenant ID resolution |
| `TENANT_SUBNET_V4` / `TENANT_SUBNET_V6` | LpmTrie | - | Subnet → tenant ID resolution |

## Metrics

| Index | Metric | Description |
|-------|--------|-------------|
| 0 | `total_seen` | Total packets evaluated by the QoS classifier |
| 1 | `shaped` | Packets successfully shaped (passed through token bucket) |
| 2 | `dropped_loss` | Packets dropped by random loss emulation |
| 3 | `dropped_queue` | Packets dropped because the pipe had no credit left |
| 4 | `delayed` | Packets given a departure timestamp |
| 5 | `errors` | Processing errors (parse failures, map lookup errors) |
| 6 | `events_dropped` | RingBuf events dropped due to backpressure (>75% full) |

Prometheus metrics:

QoS exports no family of its own. Its counters are slots in the per-CPU
`QOS_METRICS` map, folded onto `ebpfsentinel_packets_total` with
`interface="QOS_METRICS"` and `action` naming the slot:

- `action="total_seen"` - total packets evaluated
- `action="shaped"` - packets shaped
- `action="dropped_loss"` - packets dropped by loss emulation
- `action="dropped_queue"` - packets dropped for want of credit
- `action="delayed"` - packets delayed
- `action="errors"` - processing errors
- `action="events_dropped"` - ring buffer backpressure drops

Alongside them, `ebpfsentinel_rules_loaded{component="qos"}` is the loaded
classifier count.
