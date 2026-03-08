# Connection Tracking Configuration

Connection tracking maintains a kernel-side state table for TCP, UDP, and ICMP connections. See [Connection Tracking](../features/conntrack.md) for the feature overview.

## Configuration

```yaml
conntrack:
  enabled: false
  half_open_threshold: 100
  rst_threshold: 50
  fin_threshold: 50
  ack_threshold: 200
  tcp_established_timeout_secs: 432000
  tcp_syn_timeout_secs: 120
  tcp_fin_timeout_secs: 120
  udp_timeout_secs: 30
  udp_stream_timeout_secs: 120
  icmp_timeout_secs: 30
  max_src_states: 0
  max_src_conn_rate: 0
  conn_rate_window_secs: 5
  overload_ttl_secs: 3600
```

## Reference

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable connection tracking |

### Timeouts

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `tcp_established_timeout_secs` | u64 | `432000` (5 days) | Timeout for established TCP connections |
| `tcp_syn_timeout_secs` | u64 | `120` | Timeout for half-open (SYN-sent) connections |
| `tcp_fin_timeout_secs` | u64 | `120` | Timeout for closing (FIN-sent) connections |
| `udp_timeout_secs` | u64 | `30` | Timeout for single-packet UDP entries |
| `udp_stream_timeout_secs` | u64 | `120` | Timeout for bidirectional UDP streams |
| `icmp_timeout_secs` | u64 | `30` | Timeout for ICMP echo/reply tracking |

All timeouts must be greater than 0.

### Connection Limits

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_src_states` | u32 | `0` | Max connections per source IP (0 = unlimited) |
| `max_src_conn_rate` | u32 | `0` | Max new connections per source per window (0 = unlimited) |
| `conn_rate_window_secs` | u32 | `5` | Window for connection rate measurement |
| `overload_ttl_secs` | u32 | `3600` | Duration to track sources that exceeded limits |

### Flood Detection

These thresholds trigger alerts when anomalous connection patterns are detected in the eBPF program:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `half_open_threshold` | u32 | `100` | Half-open connections before alerting |
| `rst_threshold` | u32 | `50` | RST packets per window before alerting |
| `fin_threshold` | u32 | `50` | FIN packets per window before alerting |
| `ack_threshold` | u32 | `200` | ACK-only packets per window before alerting |
