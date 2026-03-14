# QoS / Traffic Shaping

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: tc-qos** | **Domain: qos**

## Overview

eBPFsentinel provides kernel-speed QoS (Quality of Service) and traffic shaping via a TC egress classifier (`tc-qos`). The architecture follows a three-level hierarchy — **pipes**, **queues**, and **classifiers** — inspired by `dummynet` / `ipfw` semantics. Traffic is classified by 5-tuple + DSCP rules, assigned to queues with weighted fair scheduling, and shaped through pipes that enforce bandwidth limits, delay emulation, and packet loss.

## How It Works

### Three-Level Hierarchy

```
Classifiers (match traffic → assign to queue)
    │
    ▼
Queues (WF2Q+ weighted fair queuing within a pipe)
    │
    ▼
Pipes (bandwidth limit, delay, loss, burst)
    │
    ▼
Wire
```

1. **Classifiers** match packets by 5-tuple (src/dst IP, src/dst port, protocol) and DSCP value. Classifiers are evaluated in priority order; the first match assigns the packet to a queue.
2. **Queues** group traffic within a pipe. Each queue has a weight that determines its share of the pipe's bandwidth using WF2Q+ (Worst-case Fair Weighted Fair Queuing) scheduling.
3. **Pipes** enforce the actual traffic shaping: bandwidth limiting (token bucket), delay emulation, random packet loss, and burst allowance.

### Pipe Features

Each pipe defines a traffic shaping profile:

| Parameter | Description |
|-----------|-------------|
| `bandwidth_bps` | Maximum throughput in bytes per second (token bucket rate) |
| `burst_bytes` | Token bucket burst capacity — maximum bytes that can be sent in a burst |
| `delay_ms` | Fixed delay added to every packet (latency emulation) |
| `loss_percent` | Random packet drop probability (0-100, for link degradation simulation) |
| `scheduler` | Queue scheduling algorithm: `fifo`, `wf2q`, or `fq_codel` |

**Token bucket** shaping is implemented entirely in eBPF using `bpf_ktime_get_boot_ns` for timestamps. Tokens refill at `bandwidth_bps` rate up to `burst_bytes` capacity. If insufficient tokens are available when a packet arrives, it is queued or dropped depending on the scheduler configuration.

### Queue Features

Queues provide weighted fair scheduling within a pipe:

| Parameter | Description |
|-----------|-------------|
| `pipe_id` | Parent pipe this queue belongs to |
| `weight` | WF2Q+ weight (1-100, default 50) — higher weight = larger bandwidth share |

When multiple queues share a pipe, the WF2Q+ scheduler distributes the pipe's bandwidth proportionally to each queue's weight. A queue with weight 100 receives twice the bandwidth of a queue with weight 50, assuming both are backlogged.

### Classifier Features

Classifiers assign packets to queues based on match criteria:

| Field | Description |
|-------|-------------|
| `queue_id` | Target queue for matched traffic |
| `priority` | Lower values match first (0-65535) |
| `src_ip` | Source IP/CIDR (0 = wildcard) |
| `dst_ip` | Destination IP/CIDR (0 = wildcard) |
| `src_port` | Source port (0 = wildcard) |
| `dst_port` | Destination port (0 = wildcard) |
| `protocol` | IP protocol number (0 = wildcard) |
| `dscp` | DSCP value (255 = wildcard) |

**Progressive wildcard matching**: the eBPF classifier performs a 4-level lookup with increasingly relaxed keys. The first level tries the full 5-tuple + DSCP. If no match, subsequent levels progressively wildcard fields (ports, then IPs) until a match is found or the default queue is used.

### Scheduler Types

| Scheduler | Description |
|-----------|-------------|
| `fifo` | Simple first-in-first-out — packets dequeued in arrival order |
| `wf2q` | Worst-case Fair Weighted Fair Queuing — weighted bandwidth sharing across queues |
| `fq_codel` | Fair Queuing with Controlled Delay — reduces bufferbloat (flow-fair with CoDel AQM) |

### Interface Groups

QoS pipes and classifiers can be scoped to specific interface groups using the `interfaces` field. This allows different traffic shaping profiles per network zone — for example, stricter bandwidth limits on guest WiFi interfaces while allowing full throughput on server-facing interfaces. Rules without an `interfaces` field are floating and apply to all interfaces. See [Interface Groups](interface-groups.md).

### EDT Pacing

> **TODO**: Earliest Departure Time (EDT) pacing support is planned. EDT uses `skb->tstamp` to schedule per-packet departure times, enabling smoother traffic pacing without queuing. This requires `bpf_skb_set_tstamp` (kernel 5.18+).

## Configuration

```yaml
qos:
  enabled: true
  pipes:
    - id: 1
      bandwidth_bps: 10000000    # 10 MB/s
      burst_bytes: 65536         # 64 KB burst
      delay_ms: 0
      loss_percent: 0
      scheduler: wf2q
    - id: 2
      bandwidth_bps: 1000000     # 1 MB/s (low-priority pipe)
      burst_bytes: 16384
      delay_ms: 50               # 50ms added latency
      loss_percent: 1            # 1% random loss
      scheduler: fifo

  queues:
    - id: 1
      pipe_id: 1
      weight: 80                 # High-priority queue
    - id: 2
      pipe_id: 1
      weight: 20                 # Best-effort queue
    - id: 3
      pipe_id: 2
      weight: 50

  classifiers:
    - id: 1
      queue_id: 1
      priority: 10
      protocol: 6                # TCP
      dst_port: 443              # HTTPS → high-priority queue
      dscp: 46                   # EF (Expedited Forwarding)
    - id: 2
      queue_id: 1
      priority: 20
      protocol: 17               # UDP
      dst_port: 53               # DNS → high-priority queue
    - id: 3
      queue_id: 2
      priority: 100
      src_ip: "0.0.0.0"         # All remaining traffic → best-effort
      dst_ip: "0.0.0.0"
    - id: 4
      queue_id: 3
      priority: 50
      src_ip: "10.0.2.0/24"     # Dev subnet → low-priority pipe
```

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
  "id": 3,
  "bandwidth_bps": 5000000,
  "burst_bytes": 32768,
  "delay_ms": 0,
  "loss_percent": 0,
  "scheduler": "fq_codel"
}'

# Add a queue
ebpfsentinel-agent qos add-queue --json '{
  "id": 4,
  "pipe_id": 3,
  "weight": 50
}'

# Add a classifier
ebpfsentinel-agent qos add-classifier --json '{
  "id": 5,
  "queue_id": 4,
  "priority": 30,
  "protocol": 6,
  "dst_port": 8080
}'

# Delete a pipe / queue / classifier
ebpfsentinel-agent qos delete-pipe 3
ebpfsentinel-agent qos delete-queue 4
ebpfsentinel-agent qos delete-classifier 5

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
| `ebpf-programs` | `crates/ebpf-programs/tc-qos/` | TC egress kernel-side traffic shaping |
| `ebpf-common` | `crates/ebpf-common/src/qos.rs` | Shared `#[repr(C)]` types (pipe/queue/classifier map entries, flow state) |
| `domain` | `crates/domain/src/qos/` | QoS engine (entity, engine, error) |
| `ports` | `crates/ports/src/primary/qos.rs` | Port trait |
| `application` | `crates/application/src/qos_service_impl.rs` | App service (engine + eBPF map sync) |
| `adapters` | `crates/adapters/src/ebpf/qos_map_manager.rs` | eBPF map adapter |
| `adapters` | `crates/adapters/src/http/qos_handler.rs` | HTTP handler (10 endpoints) |
| `infrastructure` | `crates/infrastructure/src/config/qos.rs` | Config parsing |

## eBPF Program

The `tc-qos` program is attached as a **TC egress classifier**. It processes every outgoing packet through the following pipeline:

1. **Parse** — Extract L3/L4 headers (IPv4/IPv6, TCP/UDP), DSCP value
2. **Classify** — 4-level progressive wildcard lookup in `QOS_CLASSIFIERS` HashMap:
   - Level 1: full 5-tuple + DSCP
   - Level 2: wildcard ports
   - Level 3: wildcard source IP
   - Level 4: wildcard all (default classifier)
3. **Token bucket** — Check pipe's token bucket state in `QOS_FLOW_STATE`. Refill tokens based on elapsed time (`bpf_ktime_get_boot_ns`). Deduct packet size from available tokens.
4. **Loss** — If `loss_percent > 0`, generate random number via `bpf_get_prandom_u32` and drop with configured probability.
5. **Delay** — If `delay_ms > 0`, record delay timestamp for userspace enforcement (kernel TC scheduling).
6. **Emit** — Send `QosEvent` to RingBuf with shaping decision (shaped, dropped, delayed).

### Maps

| Map | Type | Max Entries | Description |
|-----|------|-------------|-------------|
| `QOS_PIPE_CONFIG` | Array | 64 | Pipe definitions (bandwidth, burst, delay, loss, scheduler) |
| `QOS_QUEUE_CONFIG` | Array | 256 | Queue definitions (pipe_id, weight) |
| `QOS_CLASSIFIERS` | HashMap | 1024 | Classifier rules (5-tuple + DSCP → queue_id) |
| `QOS_FLOW_STATE` | LruPerCpuHashMap | 65536 | Per-flow token bucket state (tokens, last_refill_ns) |
| `QOS_METRICS` | PerCpuArray | 7 | Per-CPU shaping counters |
| `EVENTS` | RingBuf | 1 MB | Kernel-to-userspace QoS events |

## Metrics

| Index | Metric | Description |
|-------|--------|-------------|
| 0 | `total_seen` | Total packets evaluated by the QoS classifier |
| 1 | `shaped` | Packets successfully shaped (passed through token bucket) |
| 2 | `dropped_loss` | Packets dropped by random loss emulation |
| 3 | `dropped_queue` | Packets dropped due to token bucket exhaustion (queue full) |
| 4 | `delayed` | Packets with delay applied |
| 5 | `errors` | Processing errors (parse failures, map lookup errors) |
| 6 | `events_dropped` | RingBuf events dropped due to backpressure (>75% full) |

Prometheus metrics:

- `ebpfsentinel_qos_total_seen` — total packets evaluated
- `ebpfsentinel_qos_shaped_total` — packets shaped
- `ebpfsentinel_qos_dropped_loss_total` — packets dropped by loss emulation
- `ebpfsentinel_qos_dropped_queue_total` — packets dropped by queue overflow
- `ebpfsentinel_qos_delayed_total` — packets delayed
- `ebpfsentinel_qos_errors_total` — processing errors
- `ebpfsentinel_qos_events_dropped_total` — RingBuf backpressure drops
- `ebpfsentinel_rules_loaded{domain="qos"}` — loaded classifier count
