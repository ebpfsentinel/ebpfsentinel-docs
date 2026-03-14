# Connection Tracking

Connection tracking (conntrack) provides stateful packet inspection by maintaining a kernel-side TCP/UDP/ICMP state machine. The `tc-conntrack` eBPF program tracks every connection bidirectionally, allowing the firewall to enforce state-based rules (e.g., allow established connections, drop invalid packets).

## How It Works

1. The `tc-conntrack` TC classifier program intercepts packets and maintains a unified state machine (shared across IPv4 and IPv6) in eBPF maps
2. Each connection tracks: source/destination IP and port, protocol, state, **packet counters, byte counters**, timestamps
3. The firewall fast-path uses conntrack state to skip full rule evaluation for established connections
4. Userspace can query and flush the connection table via the REST API

Byte counters are updated on every packet, enabling volume-based analysis and reporting per connection.

## Connection States

| State | Description |
|-------|-------------|
| `new` | First packet seen, no response yet |
| `syn_sent` | TCP SYN sent, awaiting SYN-ACK |
| `syn_recv` | TCP SYN-ACK received, awaiting final ACK |
| `established` | Bidirectional traffic confirmed |
| `related` | Related to an existing connection (e.g., ICMP error) |
| `fin_wait` | TCP FIN sent, connection closing |
| `close_wait` | TCP FIN received, waiting for local close |
| `time_wait` | Connection closed, waiting for stale packets |
| `invalid` | Packet does not match any known connection state |

## Timeouts

All timeouts are configurable per protocol:

| Setting | Default | Description |
|---------|---------|-------------|
| `tcp_established_timeout_secs` | 432000 (5 days) | Established TCP connection timeout |
| `tcp_syn_timeout_secs` | 120 | Half-open TCP connection timeout |
| `tcp_fin_timeout_secs` | 120 | Closing TCP connection timeout |
| `udp_timeout_secs` | 30 | Single-packet UDP timeout |
| `udp_stream_timeout_secs` | 120 | Bidirectional UDP stream timeout |
| `icmp_timeout_secs` | 30 | ICMP echo/reply timeout |

## Connection Limits

| Setting | Default | Description |
|---------|---------|-------------|
| `max_src_states` | 0 (unlimited) | Max connections per source IP |
| `max_src_conn_rate` | 0 (unlimited) | Max new connections per source per window |
| `conn_rate_window_secs` | 5 | Connection rate measurement window |
| `overload_ttl_secs` | 3600 | Duration to track overloaded sources |

## Flood Detection Thresholds

The eBPF program raises alerts when anomalous connection patterns are detected:

| Setting | Default | Description |
|---------|---------|-------------|
| `half_open_threshold` | 100 | Half-open connections before alerting |
| `rst_threshold` | 50 | RST packets per window before alerting |
| `fin_threshold` | 50 | FIN packets per window before alerting |
| `ack_threshold` | 200 | ACK-only packets per window before alerting |

## Integration

- **Firewall**: Established connections bypass full rule evaluation via conntrack fast-path
- **DDoS Protection**: Half-open connection counts feed the SYN flood detector
- **IPS**: Connection state used for blacklist enforcement
- **NAT**: Conntrack entries paired with NAT mappings for bidirectional translation

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/conntrack/status` | Enabled status and active connection count |
| GET | `/api/v1/conntrack/connections` | List active connections (supports `?limit=`) |
| POST | `/api/v1/conntrack/flush` | Flush all tracked connections (admin) |

See [REST API Reference](../api-reference/rest-api.md) for details.
