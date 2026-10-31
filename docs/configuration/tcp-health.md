# TCP Health Configuration

The TCP health counter attaches four raw tracepoints of the TCP stack and
counts retransmissions, resets and connections opened, failed and closed, per
edge between two services. What it counts and how to read it is in the
[feature page](../features/tcp-health.md).

Nothing here enforces anything: the counter only reads, and the one alert it
raises, a source drawing too many resets, is a detection.

## Configuration

```yaml
tcp_health:
  enabled: true
  poll_interval_secs: 10
  reset_scan:
    enabled: true
    window_secs: 60
    resets: 100
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Load and attach the tracepoints |
| `poll_interval_secs` | u64 | `10` | How often the counts are read into the metrics, in seconds |
| `reset_scan.enabled` | bool | `true` | Raise an alert when a source draws more resets than the line |
| `reset_scan.window_secs` | u64 | `60` | The sliding window each source's resets are summed over, in seconds |
| `reset_scan.resets` | u64 | `100` | The line: resets in one window above which a source is alerted on |

`poll_interval_secs` is accepted between `1` and `3600`. The kernel counts
every event whatever the interval; the interval only decides how fresh the
metrics are.

`reset_scan.window_secs` is accepted between `1` and `3600` and
`reset_scan.resets` must be at least `1`. With an Enterprise licence for
detection, `resets` is only the line a source is held to until the node has
learnt a baseline; see the [feature page](../features/tcp-health.md#reset-scan-alert).

Turning the counter off detaches the tracepoints and removes the program from
the `ebpf_program_status` gauge.
