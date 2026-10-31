# TCP Health Configuration

The TCP health counter attaches four raw tracepoints of the TCP stack and
counts retransmissions, resets and connections opened, failed and closed, per
edge between two services. What it counts and how to read it is in the
[feature page](../features/tcp-health.md).

Nothing here enforces anything: the counter only reads.

## Configuration

```yaml
tcp_health:
  enabled: true
  poll_interval_secs: 10
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Load and attach the tracepoints |
| `poll_interval_secs` | u64 | `10` | How often the counts are read into the metrics, in seconds |

`poll_interval_secs` is accepted between `1` and `3600`. The kernel counts
every event whatever the interval; the interval only decides how fresh the
metrics are.

Turning the counter off detaches the tracepoints and removes the program from
the `ebpf_program_status` gauge.
