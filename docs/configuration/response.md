# Response Configuration

The `response` section bounds manual response actions: the longest TTL `POST /api/v1/response` and `ebpfsentinel-agent response block` will accept.

It is not the [`auto_response`](auto-response.md) section. That one decides whether an action fires on its own when an alert matches a policy and carries its own per-policy TTL. The ceiling here applies to every response action the agent installs, whoever asked for it.

## Reference

```yaml
response:
  max_ttl_secs: 86400
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_ttl_secs` | u64 | `86400` | Longest TTL the agent accepts on a response action, in seconds. Minimum `1`, maximum `2592000` |

A request above the ceiling is refused, not clamped. A value of `0`, or one above `2592000` (thirty days), is refused at config load: a response action is a temporary measure that a firewall rule should replace, so the bound is not open-ended.

## Example

```yaml
response:
  max_ttl_secs: 604800
```
