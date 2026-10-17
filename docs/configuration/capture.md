# Capture Configuration

The `capture` section bounds manual packet capture: the longest capture `POST /api/v1/captures/manual` and `ebpfsentinel-agent capture start` will accept, and how long the files they write are kept.

It is not the [`auto_capture`](auto-capture.md) section. That one decides whether a capture starts on its own when an alert fires and carries its own, tighter, duration cap. The ceiling here applies to every capture the agent runs, whoever asked for it.

## Reference

```yaml
capture:
  max_duration_secs: 300
  retention_days: 7
  max_total_size_mb: 1024
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_duration_secs` | u64 | `300` | Longest capture the agent accepts, in seconds. Minimum `1`, maximum `3600` |
| `retention_days` | u32 | `7` | How long a capture file is kept. `0` keeps every file for ever. Maximum `365` |
| `max_total_size_mb` | u64 | `1024` | How much room every capture file together may take. `0` is no ceiling. Maximum `1048576` |

A request above the duration ceiling is refused, not clamped. A value of `0`, or one above `3600`, is refused at config load: a capture holds a socket and writes to disk for its whole duration, so the bound is an hour rather than open-ended.

## Retention

Capture files are written to `/var/lib/ebpfsentinel/captures/` and outlive the
session that wrote them, so they are swept: once at startup and once after each
capture ends. The sweep deletes what is past `retention_days`, then, if the
directory still holds more than `max_total_size_mb`, the oldest files until it
fits. It never deletes the file of a capture that is still writing, and the
bytes of that file still count towards the total.

What the defaults cost is worth reading against the duration ceiling. A capture
at the default 300 seconds and a 1500 byte snap length writes as fast as the
filtered traffic arrives: at 10 Mbps of matching traffic that is about 375 MB,
and at 100 Mbps the 1 GB ceiling is reached inside the capture itself. The
ceiling is a bound on the directory, not on one capture, so a capture that
exceeds it on its own is not interrupted - the sweep that follows it removes
older files instead. Narrow the filter or lower `snap_length` if a single
capture has to stay small, and raise `max_total_size_mb` only as far as the
state filesystem can afford.

At startup, a `.pcap` left by an earlier run is listed by `GET /api/v1/captures`
as an `interrupted` session carrying its file size, so a short file in the
directory is accounted for rather than unexplained. Those files are swept like
any other.

## Example

```yaml
capture:
  max_duration_secs: 900
  retention_days: 2
  max_total_size_mb: 4096
```

Keeping every capture, which is what the agent did before the sweep existed:

```yaml
capture:
  retention_days: 0
  max_total_size_mb: 0
```
