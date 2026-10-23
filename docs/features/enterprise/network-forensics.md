# Network Forensics

> **Edition: Enterprise**

## Overview

Automatic context freezing and flow timeline reconstruction for incident investigation. A userspace ring buffer continuously stores alert context from all OSS security components. When a high-severity event occurs, the system freezes the events the flow produced around the trigger, records how many it kept and over what window, and enables retrospective timeline analysis around any alert.

### What a freeze keeps, and what a capture adds

A context freeze copies the ring buffer's own records of a flow: alert
identifiers, timestamps, the 5-tuple, components, severities, messages,
MITRE techniques and JA4 fingerprints. A freeze on its own keeps **no
packet** and writes no file.

The packets are the capture's job. When `forensics.capture` is enabled, every
freeze also asks a ring of recent frames for the flow's packets around the
trigger and writes them to one pcapng file, recorded beside the freeze as a
capture with its own state, digest, custody entry and expiry - see
[Alert-triggered packet capture](#alert-triggered-packet-capture). With capture
off, a freeze is exactly what it was, and two other ways of reading packets
remain:

- **Packet mirror** - `POST /api/v1/enterprise/forensics/mirror/start` makes
  `tc-ids` clone suspicious packets to an interface with
  `bpf_clone_redirect`, where Wireshark or `tcpdump` reads them. The mirror
  is a live wire, not a store: whatever is not read is gone.
- **OSS auto-capture** - event-triggered PCAP on high-severity alerts, one at
  a time, 60 seconds maximum, with a BPF filter derived from the alert. See
  [Auto-Capture (OSS)](../operational-essentials.md#auto-capture). It starts at
  the alert, so it holds nothing from before it.

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

## Alert-triggered packet capture

Off unless `forensics.capture.enabled` is set. The freeze keeps the events a
flow produced; the capture keeps its packets, including the ones from before
the alert, which is the part no capture started by the alert can hold.

### The ring

Each interface listed under `capture.interfaces` is read by one `AF_PACKET`
socket held for the life of the agent, on a thread of its own, and every frame
is kept in an in-memory ring cut at `snap_length` bytes. The ring holds at most
`ring_max_bytes` per interface and drops its oldest frame to make room, so its
depth in seconds is whatever that budget buys on that link: 64 MiB is a few
seconds on a saturated 10 Gbit/s interface and minutes on a quiet one. The
budget counts 48 bytes of bookkeeping beside every frame, so the memory the ring
costs is the number configured, times the number of interfaces, and not that
number plus overhead.

**Nothing is written without a trigger.** In the absence of a freeze the frames
live in memory only and are overwritten as the ring turns, so nothing about the
traffic outlives the budget.

The socket comes from the launcher's pre-opened pool, then from the warden,
and only then from the agent itself, which works only where it holds
`CAP_NET_RAW`. An interface the agent could not get a socket for is reported
in the log at startup and its captures hold the other interfaces' frames only.

### The window

A freeze asks for the flow's frames from `pre_window_secs` before the trigger
to `post_window_secs` after it. The capture waits out the post-window, cuts the
frames of the flow (both directions, matched on the 5-tuple) out of every ring,
and writes them as one pcapng file with one interface block per interface.
`pre_window_secs` is bounded by what the ring still holds: a ring that turned
over faster than the window reaches back only as far as its oldest frame, and
the record says how many packets it kept and whether any frame was cut at the
snap length (`truncated`).

At most `max_pending` captures wait for their window at once. One more than
that fails rather than queueing.

### The record

Each capture is a record beside its freeze:

| Field | Description |
|-------|-------------|
| `id` | Capture identifier |
| `freeze_id` | The context freeze it belongs to |
| `trigger_alert_id` / `trigger_component` / `trigger_severity` | The alert that asked for it |
| `flow` | 5-tuple the frames were matched on |
| `interfaces` | Interfaces whose frames it holds |
| `trigger_ns`, `window_start_ns`, `window_end_ns` | The trigger and the window the file covers |
| `packet_count` | Frames written |
| `truncated` | Whether any frame was cut at `snap_length` |
| `file_name` | The pcapng file, absent unless written |
| `size_bytes` | Size of the file |
| `sha256` | SHA-256 of the file, absent unless written |
| `custody` | `{seq, tag}`: the custody log entry that recorded the outcome |
| `created_at_ns` / `expires_at_ns` | When it was recorded and when the agent deletes it |
| `state` | `pending`, `written`, or `failed` with a `reason` |

A capture that could not be written is a `failed` record with a reason, in the
same way a freeze that kept nothing is, rather than a missing file:

| Reason | What happened |
|--------|---------------|
| `no packet of the flow in the window` | The rings held no frame of the flow between the two bounds |
| `captures have reached their volume cap` | Writing it would take every capture on disk past `max_total_bytes` |
| `free space on the capture volume is below its floor` | The volume holding `directory` has less than `min_free_bytes` free |
| `too many captures waiting for their window to close` | `max_pending` captures were already waiting |
| `write failed: ...` | The file could not be written, with the error |

### Retention and disk pressure

The agent deletes every capture `retention_hours` after it was recorded, file
and record, on its own sweep and again at startup for whatever expired while it
was stopped, so retention does not depend on a cron job somebody has to write.
Deleting a freeze deletes its capture with it.

Disk pressure stops capture rather than filling the volume: a capture is never
written while the volume holding `directory` has less than `min_free_bytes`
free, nor once every capture on disk adds up to `max_total_bytes`. Both are
failed outcomes with their reason, counted under that reason, so a volume that
is too small is visible on the freeze list and in the metrics rather than in a
full-disk alert from somewhere else.

### On disk and in custody

`directory` is created owner-only (`0700`) and every file in it is
owner-readable only (`0600`): each capture's pcapng file and its JSON record,
plus two files of the store's own, `custody.key` and `custody.jsonl`.

Every event a capture goes through - `written`, `failed`, `expired`, `deleted`,
and `downloaded by <name>` - is one line of `custody.jsonl`, chained to the line
before it with HMAC-SHA256 under `custody.key`, the key generated the first
time the directory is used. A line names the event, the capture and the file's
SHA-256, and for a download who downloaded it; it never carries a packet or an
address. A line edited, removed or reordered behind the agent's back breaks the
chain, and the agent **refuses to start capturing** over a log that does not
verify rather than appending to one it cannot vouch for.

A download is checked too: the file is read, its SHA-256 compared with the
record, and the download chained into the log under the caller's name before
a byte is served. A file that no longer matches its digest is refused with a
**500**, never served.

### Downloading a capture

`GET /api/v1/enterprise/forensics/captures/{id}/pcapng` answers the file with
`Content-Type: application/x-pcapng`, `Content-Disposition: attachment`,
`Cache-Control: no-store` and `X-Capture-Sha256` carrying the digest the file
was checked against. It is the one read on the surface that needs the
**write** grant (`config:write`) rather than the read every viewer holds,
because it hands out the payload of somebody's traffic, and it is charged to the
write rate-limit bucket because each one reads a file and appends to the
custody log.

| Status | When |
|--------|------|
| 200 | The file, checked against its digest |
| 404 | No capture carries the id, or capture is off |
| 409 | The capture exists and wrote no file (`pending` or `failed`) |
| 500 | The file is missing or no longer matches its digest |

The file opens in Wireshark, `tshark` or `tcpdump -r` as it is.

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
| `GET` | `/api/v1/enterprise/forensics/status` | viewer | network-forensics | Ring buffer depth and oldest event, context freeze count, trigger policy in force, current packet mirror configuration, whether capture is on, the captures held and the bytes they take on disk. |
| `GET` | `/api/v1/enterprise/forensics/mirror` | viewer | network-forensics | Return the current packet mirror configuration. |
| `POST` | `/api/v1/enterprise/forensics/mirror/start` | operator | network-forensics | Enable eBPF packet mirroring. Suspicious packets matched by `tc-ids` are cloned via `bpf_clone_redirect` to the specified interface for forensic capture by tools such as Wireshark or `tcpdump`. |
| `POST` | `/api/v1/enterprise/forensics/mirror/stop` | operator | network-forensics | Disable eBPF packet mirroring. The `tc-ids` program stops cloning packets. |
| `GET` | `/api/v1/enterprise/forensics/context-freezes` | viewer | network-forensics | List all context freezes. |
| `GET` | `/api/v1/enterprise/forensics/context-freezes/{id}` | viewer | network-forensics | Get a single context freeze. |
| `DELETE` | `/api/v1/enterprise/forensics/context-freezes/{id}` | operator | network-forensics | Delete a context freeze. |
| `GET` | `/api/v1/enterprise/forensics/captures` | viewer | network-forensics | List every capture, newest trigger first; empty when capture is off. |
| `GET` | `/api/v1/enterprise/forensics/captures/{id}` | viewer | network-forensics | Get one capture's record. |
| `GET` | `/api/v1/enterprise/forensics/captures/{id}/pcapng` | operator | network-forensics | Download a written capture, checked against its digest and recorded in custody under the caller's name. Needs the write grant and pays the write bucket. |
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
| `ebpfsentinel_ent_forensics_captures_written_total` | Counter | - | Captures written to disk |
| `ebpfsentinel_ent_forensics_captures_failed_total` | Counter | `reason` | Captures that wrote nothing, by reason: `no_packets`, `volume_cap`, `disk_pressure`, `too_many_pending`, `write_failed` |
| `ebpfsentinel_ent_forensics_captures_expired_total` | Counter | - | Captures deleted by retention |
| `ebpfsentinel_ent_forensics_captures_downloaded_total` | Counter | - | Capture files served |
| `ebpfsentinel_ent_forensics_capture_bytes_on_disk` | Gauge | - | Bytes every written capture adds up to |
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
    capture:
      enabled: false
      interfaces: [eth0]
      ring_max_bytes: 67108864        # per interface, held in memory
      snap_length: 1600               # bytes kept of each frame
      pre_window_secs: 10             # before the alert
      post_window_secs: 5             # waited out after the alert
      directory: /var/lib/ebpfsentinel/captures
      retention_hours: 72
      max_total_bytes: 2147483648     # every capture on disk together
      min_free_bytes: 1073741824      # nothing is written below this
      max_pending: 32
```

| Setting | Default | Rule |
|---------|---------|------|
| `capture.enabled` | `false` | Nothing below is read while it is off |
| `capture.interfaces` | `[]` | At least one, each 1 to 15 bytes |
| `capture.ring_max_bytes` | 64 MiB | At least 1 MiB; held in memory per interface |
| `capture.snap_length` | 1600 | 64 to 65535 |
| `capture.pre_window_secs` | 10 | Not 0 together with `post_window_secs` |
| `capture.post_window_secs` | 5 | At most 300 |
| `capture.directory` | `/var/lib/ebpfsentinel/captures` | Absolute path |
| `capture.retention_hours` | 72 | Greater than 0 |
| `capture.max_total_bytes` | 2 GiB | Greater than 0 |
| `capture.min_free_bytes` | 1 GiB | 0 turns the floor off |
| `capture.max_pending` | 32 | Greater than 0 |

The memory the feature costs is `ring_max_bytes` times the number of
interfaces, all the time, whether or not anything triggers.

## Feature Gating

Network Forensics requires a valid license with the `network-forensics` feature. Without a license, the forensics subsystem is disabled.
