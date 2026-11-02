# Share Writes Configuration

Follows the writes this host pushes over SMB to file servers and raises an
alert when one process writes to several servers this host has never written
to before. What it reads and what it cannot say is on
[Mass Encryption](../features/mass-encryption.md#writes-to-other-hosts-shares).
It is off by default.

Nothing here enforces anything: the reading only counts flows.

## Configuration

```yaml
share_writes:
  enabled: true
  learning_secs: 604800
  window_secs: 300
  min_new_peers: 5
  min_bytes_per_peer: 1048576
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Follow the writes at all |
| `learning_secs` | u64 | `604800` | How long every server written to is taken as ordinary, from the first write the agent sees, in seconds |
| `window_secs` | u64 | `300` | How long one process's writes to new servers are added up, in seconds |
| `min_new_peers` | usize | `5` | New servers in one window that raise the alert |
| `min_bytes_per_peer` | u64 | `1048576` | Bytes a new server must receive in the window to count |

`learning_secs` is accepted between `1` and `7776000` (90 days), `window_secs`
between `1` and `86400`, `min_new_peers` between `2` and `256`, and
`min_bytes_per_peer` from `1`. One new server is never enough: a host reaching
one server it had not reached before is a host doing its job.

The reading needs the connection table. On a host where it cannot be read the
agent says so at startup and follows nothing. It runs a flow collector of its
own, sized and timed by the `flow_export` table settings, with no sampling
whatever `flow_export.sampling` says, so a volume is never undercounted; it
runs whether or not flow export is turned on.

The history is held in memory and learned again after every restart.
