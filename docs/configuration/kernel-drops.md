# Kernel Drop Counter Configuration

The kernel drop counter attaches one raw tracepoint to `kfree_skb` and counts
every packet the kernel drops by the reason the kernel gave and the interface
the packet was on. What it counts and how to read it is in the
[feature page](../features/kernel-drops.md).

Nothing here enforces anything: the counter only reads.

## Configuration

```yaml
kernel_drops:
  enabled: true
  poll_interval_secs: 10
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Load and attach the tracepoint |
| `poll_interval_secs` | u64 | `10` | How often the counts are read into the metrics and the API, in seconds |

`poll_interval_secs` is accepted between `1` and `3600`. The kernel counts
every drop whatever the interval; the interval only decides how fresh the
metric and the API are.

Turning the counter off detaches the tracepoint, and the API answers
`counting: false` with the reason.
