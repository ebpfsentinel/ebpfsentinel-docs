# Capture Configuration

The `capture` section bounds manual packet capture: the longest capture `POST /api/v1/capture` and `ebpfsentinel-agent capture start` will accept.

It is not the [`auto_capture`](auto-capture.md) section. That one decides whether a capture starts on its own when an alert fires and carries its own, tighter, duration cap. The ceiling here applies to every capture the agent runs, whoever asked for it.

## Reference

```yaml
capture:
  max_duration_secs: 300
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_duration_secs` | u64 | `300` | Longest capture the agent accepts, in seconds. Minimum `1`, maximum `3600` |

A request above the ceiling is refused, not clamped. A value of `0`, or one above `3600`, is refused at config load: a capture holds a socket and writes to disk for its whole duration, so the bound is an hour rather than open-ended.

## Example

```yaml
capture:
  max_duration_secs: 900
```
