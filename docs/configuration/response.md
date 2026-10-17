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

## What survives a restart

A response action is written down when it is taken, in `mitigations.redb`
beside the audit store (the directory is the one `audit.storage_path` names),
and read back when the agent starts. An action comes back for the time left on
its TTL rather than for its original TTL, and an action that expired or was
revoked while the agent was down is dropped on the way in. Each restored action
is written to the audit log with a detail line naming the restart and how much
of the TTL was left.

`max_ttl_secs` is re-applied to what comes back: an action written down under a
higher ceiling, with the ceiling since lowered, is dropped rather than
reinstalled. The configuration in force now is what decides, and nothing
reaches the data plane before the ceiling is checked.

**A throttle's token bucket is not restored.** The rate is reinstalled, the
credit the source had already spent against its bucket is not: the buckets live
in a kernel map that went with the old process, and there is no safe way to
reconstruct them. A throttled source therefore gets one bucket's worth of burst
across a restart. The alternative, starting a restored bucket empty, would
punish every source for a restart it did not cause, so the burst is the
deliberate choice. Containment that must not have that gap belongs in a
firewall rule, which the restart does not widen.

If the store cannot be opened or written, the agent logs it once and keeps
going: an action taken while the store is unavailable is in force until it
expires, and is lost if the agent restarts first.

## Example

```yaml
response:
  max_ttl_secs: 604800
```
