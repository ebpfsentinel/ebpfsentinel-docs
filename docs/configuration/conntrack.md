# Connection Tracking Configuration

Connection tracking probes kernel netfilter via `bpf_skb_ct_lookup` kfuncs. The kernel manages all TCP/UDP/ICMP state, timeouts, and eviction. The userspace config controls flood detection thresholds and the per-source connection guard. See [Connection Tracking](../features/conntrack.md) for the feature overview.

## Configuration

```yaml
conntrack:
  enabled: false
  half_open_threshold: 100
  rst_threshold: 50
  fin_threshold: 50
  ack_threshold: 200
  max_src_states: 0
  max_src_conn_rate: 0
  conn_rate_window_secs: 5
  overload_ttl_secs: 3600
```

## Reference

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable connection tracking probe |

This section keeps no table of its own: the probe reads the kernel's own conntrack entries. The connection table the DDoS guard fills is sized by `ddos.connection_tracking.max_entries`, and that key is refused here.

### Flood Detection

These thresholds trigger alerts when anomalous connection patterns are detected in the eBPF program:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `half_open_threshold` | u32 | `100` | Half-open connections before alerting |
| `rst_threshold` | u32 | `50` | RST packets per window before alerting |
| `fin_threshold` | u32 | `50` | FIN packets per window before alerting |
| `ack_threshold` | u32 | `200` | ACK-only packets per window before alerting |

### Per-Source Connection Guard

Enforced by `xdp-firewall` on new connections that matched an allow rule, per source address and for both IPv4 and IPv6. Both ceilings default to `0`, which is no ceiling: the guard costs nothing until one of them is set.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_src_states` | u32 | `0` | Concurrent connections one source may hold (`0` = unlimited) |
| `max_src_conn_rate` | u32 | `0` | New connections one source may open within the window (`0` = unlimited) |
| `conn_rate_window_secs` | u32 | `5` | Width of the window `max_src_conn_rate` is measured over |
| `overload_ttl_secs` | u32 | `3600` | How long a source that exceeded the rate stays refused (`0` = until the agent restarts) |

A source that exceeds `max_src_conn_rate` is marked overloaded and refused on the XDP fast path, before any rule is evaluated, until `overload_ttl_secs` has passed. Setting `max_src_conn_rate` without a window is refused at startup.

`max_src_states` counts connections that are open. A connection is counted when the firewall admits it, and the agent gives the room back once the kernel connection table no longer holds it open: a closed connection (`TIME_WAIT` included) stops counting within about fifteen seconds, the agent's five-second pass plus the ten seconds it keeps a just-admitted connection the kernel has not recorded yet. A source that reaches `max_src_states` has its next connection refused and is not marked overloaded. The same applies to a firewall rule's `max_states`, counted per rule; a reload that replaces a rule starts its count again. Both need the kernel connection table to be readable; the agent says so at startup when it is not, and warns when these ceilings are set with `enabled: false`, which leaves them unenforced.

> **Note:** TCP/UDP/ICMP timeouts and the kernel connection table are managed by kernel netfilter, not by the agent. Use `sysctl net.netfilter.nf_conntrack_*` to tune kernel-side timeouts.
>
> The kernel only follows a connection once something hooks its state: a stateful netfilter rule, NAT, or a container runtime's rules. On a host with none of these the table stays empty and so does every reading built on it; a single rule such as `nft add rule inet filter output ct state new accept` in an output chain is enough.
