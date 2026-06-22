# Connection Tracking

Connection tracking (conntrack) provides stateful packet inspection by querying **kernel netfilter** directly via BPF kfuncs. The `tc-conntrack` eBPF program probes kernel CT entries for every packet, while the `xdp-firewall` uses the same kfuncs for fast-path bypass of established connections.

## How It Works

1. The `tc-conntrack` TC classifier program parses L3/L4 headers and calls `bpf_skb_ct_lookup` to probe kernel netfilter
2. `nf_conn->status` and `nf_conn->mark` are read via `bpf_probe_read_kernel` at runtime BTF-resolved offsets
3. The firewall fast-path uses conntrack state to skip full rule evaluation for established connections
4. Userspace queries kernel CT state via `/proc/net/nf_conntrack` parsing for the REST API and SSE event stream
5. Kernel netfilter manages all timeouts, state transitions, and eviction — no BPF-side state machine

## Connection States

Kernel `nf_conn->status` flags are mapped to domain states:

| Kernel Flag | Domain State | Description |
|-------------|-------------|-------------|
| `IPS_CONFIRMED` or `IPS_SEEN_REPLY` | `established` | Bidirectional traffic confirmed |
| `IPS_EXPECTED` | `related` | Related to an existing connection (e.g., ICMP error) |
| `IPS_DYING` | `invalid` | Entry marked for removal |
| (none of the above) | `new` | First packet seen, no response yet |

## Connection Limits

Connection limits are enforced in `xdp-firewall` (not tc-conntrack) via per-source counters:

| Setting | Default | Description |
|---------|---------|-------------|
| `max_src_states` | 0 (unlimited) | Max connections per source IP |
| `max_src_conn_rate` | 0 (unlimited) | Max new connections per source per window |
| `conn_rate_window_secs` | 5 | Connection rate measurement window |
| `overload_ttl_secs` | 3600 | Duration to track overloaded sources |

## Kernel CT Configuration

The `CT_CONFIG` Array map (shared via BPF pinning) holds conntrack thresholds. The `CT_NF_CONN_OFFSETS` Array map holds runtime-resolved `nf_conn` field offsets populated at agent startup from vmlinux BTF via `bpftool btf dump -j`.

## Integration

- **Firewall**: Established/related connections bypass full rule evaluation via kfunc-based CT fast-path
- **DDoS Protection**: Half-open connection counts feed the SYN flood detector
- **IPS**: `kill_flow_via_skb_ct` / `kill_flow_via_xdp_ct` mark CT entries as DYING on DROP verdict
- **NAT**: `bpf_skb_ct_alloc` + `bpf_ct_set_nat_info` delegate NAT to kernel netfilter

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/conntrack/status` | Enabled status and kfunc hit/miss metrics |
| GET | `/api/v1/conntrack/connections` | List active connections from `/proc/net/nf_conntrack` |
| GET | `/api/v1/conntrack/events` | SSE stream of conntrack state changes |

See [REST API Reference](../api-reference/rest-api.md) for details.
