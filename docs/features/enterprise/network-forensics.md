# Network Forensics

> **Edition: Enterprise**

## Overview

Automatic context freezing and flow timeline reconstruction for incident investigation. A userspace ring buffer continuously stores alert context from all OSS security components. When a high-severity event occurs, the system freezes the events the flow produced around the trigger, records how many it kept and over what window, and enables retrospective timeline analysis around any alert.

### What a freeze keeps, and what it does not

A context freeze copies the ring buffer's own records of a flow: alert
identifiers, timestamps, the 5-tuple, components, severities, messages,
MITRE techniques and JA4 fingerprints. It keeps **no packet**. There is no
file on disk, no PCAP, nothing to download, and the API answers a freeze with
its event count and window rather than with a path - which is why nothing on
this page offers a byte count or a capture file.

For packets today, run packet capture alongside it. Two ways, both supported:

- **Packet mirror** - `POST /api/v1/enterprise/forensics/mirror/start` makes
  `tc-ids` clone suspicious packets to an interface with
  `bpf_clone_redirect`, where Wireshark or `tcpdump` reads them. The mirror
  is a live wire, not a store: whatever is not read is gone.
- **OSS auto-capture** - event-triggered PCAP on high-severity alerts, one at
  a time, 60 seconds maximum, with a BPF filter derived from the alert. See
  [Auto-Capture (OSS)](../operational-essentials.md#auto-capture). This is
  the one path in the product that writes a packet file.

Alert-triggered PCAP written by the enterprise layer itself, so that a freeze
and its packets arrive as one record, is on the roadmap and is listed as a
roadmap item on the pricing page. It does not ship today.

## Architecture

```
OSS Alert Pipeline
  └── SIEM Broadcast Channel
        └── Forensics Bridge (tokio task)
              └── ForensicsService.ingest_siem_event()
                    ├── ForensicsEngine.ingest() → Ring Buffer (VecDeque, capped)
                    ├── should_trigger() → Trigger Policy evaluation
                    │     └── freeze_context() → Flow context in the window
                    │           └── record_freeze() → Context freeze registry
                    └── Metrics (ingested, depth, triggered, recorded, failed, expired)
```

## Ring Buffer

The forensics ring buffer stores recent `ForensicEvent` records converted from OSS alerts. It operates as a fixed-capacity circular buffer with age-based eviction.

| Setting | Default | Description |
|---------|---------|-------------|
| `ring_buffer_max_events` | 10,000 | Maximum events in the ring buffer |
| `ring_buffer_max_age_secs` | 300 | Events older than this are evicted |

Each `ForensicEvent` contains:

| Field | Description |
|-------|-------------|
| `id` | UUIDv7 from the original SIEM event |
| `timestamp_ns` | Alert timestamp |
| `src_addr` / `dst_addr` | Source and destination addresses |
| `src_port` / `dst_port` | Ports |
| `protocol` | IP protocol number |
| `is_ipv6` | Whether the addresses are IPv6 |
| `component` | OSS component that generated the alert |
| `severity` | Alert severity, written as the alert carries it: `Low`, `Medium`, `High` or `Critical` |
| `alert_id` | Original alert identifier |
| `message` | Alert message (truncated to 256 bytes) |
| `mitre_technique` | MITRE ATT&CK technique ID (if mapped) |
| `ja4_fingerprint` | JA4 TLS fingerprint (if available) |

Addresses are held as four 32-bit words: IPv4 uses the first word only, IPv6 uses all four in network order.

The ring buffer is evicted both by capacity (oldest dropped when full) and by age (periodic GC every 60 seconds removes events older than `ring_buffer_max_age_secs`).

## Event-Triggered Context Freeze

When an alert matches the trigger policy, the engine automatically:

1. **Freezes context** - extracts all ring buffer events matching the same flow (bidirectional 5-tuple match) within a 30-second window ending at the trigger
2. **Records the freeze** - creates a `ContextFreeze` record carrying the trigger alert metadata, the number of events frozen and the width of the window
3. **States an outcome** - `frozen` when it kept at least one event, `failed` with a reason when it kept none. There is no in-flight state: a freeze is over by the time it is recorded
4. **Emits metrics** - triggered, recorded, failed

### Trigger Policy

The trigger policy controls which alerts freeze context automatically:

| Setting | Default | Description |
|---------|---------|-------------|
| `trigger.components` | `[ids, threatintel, ddos, dlp]` | Alert components that trigger a freeze |
| `trigger.min_severity` | `high` | Minimum severity: `low`, `medium`, `high`, `critical` |

Only alerts from the listed components AND at or above the minimum severity trigger an automatic freeze. All other alerts are still ingested into the ring buffer for context.

`min_severity` is matched by name and not validated at startup, so `low` and any word the engine does not recognise both mean "every severity triggers". A typo here widens the policy silently rather than being refused.

The component match is exact and case-sensitive, so use the names alerts actually carry: `ids`, `threatintel`, `ddos`, `dlp`, `dns`, `routing`, `ai-security`, `ml-anomaly`. An empty `trigger.components` list accepts every component rather than none.

### Flow Matching

Flow matching is **bidirectional** - a flow tuple `(A:port1 → B:port2, TCP)` also matches events in the reverse direction `(B:port2 → A:port1, TCP)`. This ensures both sides of a conversation are frozen together.

## Context Freezes

Each freeze records:

| Field | Description |
|-------|-------------|
| `id` | Freeze identifier (`forensic-{timestamp_ns}`) |
| `trigger_alert_id` | The alert that triggered this freeze |
| `trigger_component` | Component that generated the trigger |
| `trigger_severity` | Severity of the trigger alert |
| `flow` | 5-tuple flow identifier |
| `frozen_event_count` | Number of ring buffer events frozen for the flow |
| `window_ns` | Width of the frozen window in nanoseconds, ending at `created_at_ns` |
| `outcome` | `{"state": "frozen"}`, or `{"state": "failed", "reason": "..."}` |
| `created_at_ns` | Timestamp of the alert that triggered the freeze, not the wall clock at registration |

The freeze identifier is built from that same timestamp, and `trigger_severity` repeats the alert's own word (`Low`, `Medium`, `High`, `Critical`).

A freeze that matched no event in the window is recorded as `failed` with the
reason, rather than as an empty success: an investigator reading the list has
to be able to tell "the flow was quiet" from "nothing was kept".

Freezes are automatically cleaned up after `retention_days` (default: 7 days), counted from `created_at_ns`.

## Flow Timeline Reconstruction

The timeline engine reconstructs network activity around any alert or flow:

- **By alert ID** - `GET /timeline/{alert_id}?window_before_secs=3600&window_after_secs=3600` returns all flows and related alerts within the time window centered on the specified alert
- **By flow tuple** - `GET /timeline/flow?src_addr=...&dst_addr=...&from_ns=...&to_ns=...` returns the timeline for a specific flow over a time range

Each timeline contains:

| Field | Description |
|-------|-------------|
| `center_alert_id` | The alert at the center of the timeline, empty on a flow-tuple timeline |
| `center_timestamp_ns` | Center timestamp |
| `window_before_ns` | Span covered before the center, in nanoseconds |
| `window_after_ns` | Span covered after the center, in nanoseconds |
| `flows` | Aggregated flow entries (first/last seen, event count, component) |
| `related_alerts` | Other alerts in the time window |
| `context_freeze_id` | Associated context freeze (if any), always absent on a flow-tuple timeline |

Flow entries group events by `(src_port, dst_port, protocol)` and track first/last seen timestamps and event counts.

A timeline by alert ID is centered on that alert and answers **404** when no event in the ring buffer carries it. A timeline by flow tuple is centered on the first matching event instead, or on `from_ns` when the range holds none, so its two window figures are the distance from that center to the ends of the range asked for rather than the two query parameters.

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/forensics/status` | viewer | network-forensics | Ring buffer depth and oldest event, context freeze count, trigger policy in force, current packet mirror configuration. |
| `GET` | `/api/v1/enterprise/forensics/mirror` | viewer | network-forensics | Return the current packet mirror configuration. |
| `POST` | `/api/v1/enterprise/forensics/mirror/start` | operator | network-forensics | Enable eBPF packet mirroring. Suspicious packets matched by `tc-ids` are cloned via `bpf_clone_redirect` to the specified interface for forensic capture by tools such as Wireshark or `tcpdump`. |
| `POST` | `/api/v1/enterprise/forensics/mirror/stop` | operator | network-forensics | Disable eBPF packet mirroring. The `tc-ids` program stops cloning packets. |
| `GET` | `/api/v1/enterprise/forensics/context-freezes` | viewer | network-forensics | List all context freezes. |
| `GET` | `/api/v1/enterprise/forensics/context-freezes/{id}` | viewer | network-forensics | Get a single context freeze. |
| `DELETE` | `/api/v1/enterprise/forensics/context-freezes/{id}` | operator | network-forensics | Delete a context freeze. |
| `GET` | `/api/v1/enterprise/forensics/timeline/{alert_id}` | viewer | network-forensics | Flow timeline around an alert. |
| `GET` | `/api/v1/enterprise/forensics/timeline/flow` | viewer | network-forensics | Timeline for a specific flow tuple. |
| `GET` | `/api/v1/forensics/events/stream` | viewer | network-forensics | Server-Sent Events live forensic event feed. |

### Timeline Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `window_before_secs` | 3600 | Seconds before the center alert |
| `window_after_secs` | 3600 | Seconds after the center alert |

### Flow Timeline Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `src_addr` | Yes | Source address, written as a dotted quad or an IPv6 literal |
| `dst_addr` | Yes | Destination address, same family as `src_addr` |
| `src_port` | No | Source port (default: 0) |
| `dst_port` | No | Destination port (default: 0) |
| `protocol` | No | IP protocol (default: 6/TCP) |
| `from_ns` | Yes | Start of time range (epoch nanoseconds) |
| `to_ns` | Yes | End of time range (epoch nanoseconds) |

An address that does not parse, or a pair mixing IPv4 and IPv6, is answered **400** rather than matched against nothing: a zeroed tuple would return an empty timeline, which reads as a quiet flow.

## Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_forensics_events_ingested_total` | Counter | - | Events ingested into ring buffer |
| `ebpfsentinel_ent_forensics_ring_buffer_depth` | Gauge | - | Current ring buffer depth |
| `ebpfsentinel_ent_forensics_context_freezes_triggered_total` | Counter | `component` | Automatic context freezes triggered |
| `ebpfsentinel_ent_forensics_context_freezes_recorded_total` | Counter | - | Freezes that kept at least one event |
| `ebpfsentinel_ent_forensics_context_freezes_failed_total` | Counter | - | Freezes that kept nothing |
| `ebpfsentinel_ent_forensics_context_freezes_expired_total` | Counter | - | Freezes expired by retention policy |
| `ebpfsentinel_ent_forensics_ingestion_seconds_total` | Counter | - | Cumulative seconds spent ingesting events |
| `ebpfsentinel_ent_forensics_sse_subscribers` | Gauge | - | Live subscribers on the event stream |

Ingestion cost is a **counter of seconds**, not a latency histogram: it carries the
total time spent ingesting and never a distribution, so there is no percentile to
read off it. Mean per-event cost is the ratio of the two counters:

```promql
rate(ebpfsentinel_ent_forensics_ingestion_seconds_total[5m])
  / rate(ebpfsentinel_ent_forensics_events_ingested_total[5m])
```

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  forensics:
    enabled: true
    ring_buffer_max_events: 10000
    ring_buffer_max_age_secs: 300
    retention_days: 7
    trigger:
      components: [ids, threatintel, ddos, dlp]
      min_severity: high
```

## Feature Gating

Network Forensics requires a valid license with the `network-forensics` feature. Without a license, the forensics subsystem is disabled.
