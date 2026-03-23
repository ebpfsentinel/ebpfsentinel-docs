# Network Forensics

> **Edition: Enterprise** | **Status: Shipped**

## Overview

> **OSS includes basic auto-capture**: event-triggered PCAP on high-severity alerts (1 capture at a time, max 60s, auto-generated BPF filter). See [Auto-Capture (OSS)](../operational-essentials.md#auto-capture). Enterprise adds continuous ring buffer, multi-capture, flow timeline, and forensics API.

Automated forensic capture and flow timeline reconstruction for incident investigation. A userspace ring buffer continuously stores alert context from all OSS security components. When a high-severity event occurs, the system automatically freezes the surrounding context, registers a forensic capture, and enables retrospective timeline analysis around any alert.

## Architecture

```
OSS Alert Pipeline
  └── SIEM Broadcast Channel
        └── Forensics Bridge (tokio task)
              └── ForensicsService.ingest_siem_event()
                    ├── ForensicsEngine.ingest() → Ring Buffer (VecDeque, capped)
                    ├── should_trigger() → Trigger Policy evaluation
                    │     └── freeze_context() → Pre-event flow context
                    │           └── register_capture() → Capture registry
                    └── Metrics (ingested, depth, triggered, completed, failed, expired)
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
| `component` | OSS component that generated the alert |
| `severity` | Alert severity level |
| `alert_id` | Original alert identifier |
| `message` | Alert message (truncated to 256 bytes) |
| `mitre_technique` | MITRE ATT&CK technique ID (if mapped) |
| `ja4_fingerprint` | JA4 TLS fingerprint (if available) |

The ring buffer is evicted both by capacity (oldest dropped when full) and by age (periodic GC every 60 seconds removes events older than `ring_buffer_max_age_secs`).

## Event-Triggered Capture

When an alert matches the trigger policy, the engine automatically:

1. **Freezes context** — extracts all ring buffer events matching the same flow (bidirectional 5-tuple match) within a 30-second pre-event window
2. **Registers a capture** — creates a `ForensicCapture` record with the trigger alert metadata and pre-context event count
3. **Transitions state** — `Running` → `Completed` (or `Failed` on error)
4. **Emits metrics** — trigger count, completion count, failure count

### Trigger Policy

The trigger policy controls which alerts generate automatic captures:

| Setting | Default | Description |
|---------|---------|-------------|
| `trigger.components` | `[ids, threatintel, ddos, dlp]` | Alert components that trigger captures |
| `trigger.min_severity` | `high` | Minimum severity: `low`, `medium`, `high`, `critical` |

Only alerts from the listed components AND at or above the minimum severity trigger automatic captures. All other alerts are still ingested into the ring buffer for context.

### Flow Matching

Flow matching is **bidirectional** — a flow tuple `(A:port1 → B:port2, TCP)` also matches events in the reverse direction `(B:port2 → A:port1, TCP)`. This ensures both sides of a conversation are captured in the pre-event context.

## Forensic Captures

Each capture records:

| Field | Description |
|-------|-------------|
| `id` | Capture identifier (`forensic-{timestamp_ns}`) |
| `trigger_alert_id` | The alert that triggered this capture |
| `trigger_component` | Component that generated the trigger |
| `trigger_severity` | Severity of the trigger alert |
| `flow` | 5-tuple flow identifier |
| `pre_context_count` | Number of pre-event context events frozen |
| `status` | `running`, `completed`, or `failed` |
| `created_at_ns` | When the capture was created |

Captures are automatically cleaned up after `retention_days` (default: 7 days).

## Flow Timeline Reconstruction

The timeline engine reconstructs network activity around any alert or flow:

- **By alert ID** — `GET /timeline/{alert_id}?window_before_secs=3600&window_after_secs=3600` returns all flows and related alerts within the time window centered on the specified alert
- **By flow tuple** — `GET /timeline/flow?src_addr=...&dst_addr=...&from_ns=...&to_ns=...` returns the timeline for a specific flow over a time range

Each timeline contains:

| Field | Description |
|-------|-------------|
| `center_alert_id` | The alert at the center of the timeline |
| `center_timestamp_ns` | Center timestamp |
| `flows` | Aggregated flow entries (first/last seen, event count, component) |
| `related_alerts` | Other alerts in the time window |
| `capture_id` | Associated forensic capture (if any) |

Flow entries group events by `(src_port, dst_port, protocol)` and track first/last seen timestamps and event counts.

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/forensics/status` | Ring buffer status, capture count, trigger policy |
| `GET` | `/api/v1/enterprise/forensics/captures` | List all forensic captures |
| `GET` | `/api/v1/enterprise/forensics/captures/{id}` | Get single capture metadata |
| `DELETE` | `/api/v1/enterprise/forensics/captures/{id}` | Delete a capture |
| `GET` | `/api/v1/enterprise/forensics/timeline/{alert_id}` | Flow timeline around an alert |
| `GET` | `/api/v1/enterprise/forensics/timeline/flow` | Timeline for a specific flow tuple |

### Timeline Query Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `window_before_secs` | 3600 | Seconds before the center alert |
| `window_after_secs` | 3600 | Seconds after the center alert |

### Flow Timeline Query Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `src_addr` | Yes | Source address |
| `dst_addr` | Yes | Destination address |
| `src_port` | No | Source port (default: 0) |
| `dst_port` | No | Destination port (default: 0) |
| `protocol` | No | IP protocol (default: 6/TCP) |
| `from_ns` | Yes | Start of time range (epoch nanoseconds) |
| `to_ns` | Yes | End of time range (epoch nanoseconds) |

## Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `forensics_events_ingested` | Counter | Events ingested into ring buffer |
| `forensics_ring_buffer_depth` | Gauge | Current ring buffer depth |
| `forensics_captures_triggered` | Counter | Automatic captures triggered (by component) |
| `forensics_captures_completed` | Counter | Captures completed successfully |
| `forensics_captures_failed` | Counter | Captures that failed |
| `forensics_captures_expired` | Counter | Captures expired by retention policy |
| `forensics_ingestion_latency_us` | Histogram | Per-event ingestion latency in microseconds |

## Configuration

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
