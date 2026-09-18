# Connection Tracking

Connection tracking (conntrack) provides stateful packet inspection by querying **kernel netfilter** directly via BPF kfuncs. The `tc-conntrack` eBPF program probes kernel CT entries for every packet, while the `xdp-firewall` uses the same kfuncs for fast-path bypass of established connections.

## How It Works

1. The `tc-conntrack` TC classifier program parses L3/L4 headers and calls `bpf_skb_ct_lookup` to probe kernel netfilter
2. `nf_conn->status` and `nf_conn->mark` are read via `bpf_probe_read_kernel` at runtime BTF-resolved offsets
3. The firewall fast-path uses conntrack state to skip full rule evaluation for established connections
4. Userspace queries kernel CT state via `/proc/net/nf_conntrack` parsing for the REST API and SSE event stream, falling back to dumping through conntrack-tools (`conntrack -L`) on a kernel built without `CONFIG_NF_CONNTRACK_PROCFS`
5. Kernel netfilter manages all timeouts, state transitions, and eviction - no BPF-side state machine

## Connection States

Nine states exist, and every reading of one spells it the same way: the
connection list, the event stream and the command line all print the lower-case
form below.

| State | Meaning |
|-------|---------|
| `new` | First packet seen, no response yet |
| `established` | Bidirectional traffic confirmed |
| `related` | Related to an existing connection (for example an ICMP error) |
| `invalid` | The kernel reported a state this agent does not model |
| `syn_sent` | A SYN went out and nothing has come back |
| `syn_recv` | A SYN was received and the handshake has not completed |
| `fin_wait` | Closing, waiting for the peer's FIN |
| `close_wait` | The peer closed, the local side has not |
| `time_wait` | Closed and held against late segments |

Two producers fill that vocabulary, and they do not fill all of it.

The kernel side maps `nf_conn->status` flags: `IPS_CONFIRMED` or
`IPS_SEEN_REPLY` to `established`, `IPS_EXPECTED` to `related`, `IPS_DYING` to
`invalid`, and none of the above to `new`.

The userspace reader that answers the REST API maps the TCP state word printed
by `/proc/net/nf_conntrack`: `ESTABLISHED`, `SYN_SENT`, `SYN_RECV`, `FIN_WAIT`
and `CLOSE_WAIT` to their counterparts, `TIME_WAIT`, `CLOSE`, `LAST_ACK`,
`LISTEN` and `CLOSING` all to `time_wait`, `NONE` to `new`, and anything else to
`invalid`. A non-TCP flow is reported as `established`, because the proc file
prints no state word for it. **`related` never appears on the REST API**: it is
a kernel-side classification the proc reader has no field to recover.

## Connection Limits

Connection limits are enforced in `xdp-firewall` (not tc-conntrack) via per-source counters:

| Setting | Default | Description |
|---------|---------|-------------|
| `max_src_states` | 0 (unlimited) | Max connections per source address |
| `max_src_conn_rate` | 0 (unlimited) | Max new connections per source per window |
| `conn_rate_window_secs` | 5 | Connection rate measurement window |
| `overload_ttl_secs` | 3600 | How long an overloaded source stays refused (0 = until restart) |

All four are `conntrack:` keys. A source that exceeds the rate is refused on the XDP fast path until its overload window has passed. See [Connection Tracking Configuration](../configuration/conntrack.md).

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
| GET | `/api/v1/conntrack/status` | Whether tracking is on, how many entries are held and the table ceiling |
| GET | `/api/v1/conntrack/connections` | List active connections from `/proc/net/nf_conntrack` |
| GET | `/api/v1/conntrack/events` | SSE stream of conntrack state changes |
| POST | `/api/v1/conntrack/flush` | Empty the table, answering `{"flushed": n}` |

The flush needs write access; the three reads do not. Turning connection
tracking off does not take the three reads away: they keep answering, and
`status` says `enabled: false`. Only the event stream disappears, and for a
reason of its own - see below.

### Status Fields

| Field | Type | Meaning |
|-------|------|---------|
| `enabled` | boolean | Whether connection tracking is turned on |
| `connection_count` | integer or `null` | Entries the kernel holds. **`null` when the agent could not read the table**, which is not the same answer as a table holding nothing |
| `max_connections` | integer | The eBPF connection map's fixed capacity, `262144`. It is the agent's ceiling, not the kernel's `nf_conntrack_max` |

### Connection Fields

`GET /api/v1/conntrack/connections` answers a bare array in the order the
kernel table was read, bounded by `limit` (default `100`). Each entry carries `src_ip`, `dst_ip`,
`src_port`, `dst_port`, `protocol` (the IP protocol number), `state`,
`packets_fwd`, `packets_rev`, `bytes_fwd` and `bytes_rev`. There is no
envelope and no total: the list is a sample of the table, not the table.

### Event Frames

`GET /api/v1/conntrack/events` is Server-Sent Events. The SSE `event:` name is
`new`, `update` or `destroy`, and the frame's `data` is one JSON object
carrying `event_type` with that same word and `connection` with exactly the
shape the list route answers: a frame carries no instant either, because the
kernel table reports counters and a state and no moment a flow started or was
last seen at.
A `:keepalive` comment is sent every 15 s; a client that falls behind silently
skips the events it missed rather than being disconnected.

The stream is produced by a poller that diffs successive reads of the table
every 2 s, so it reports what changed between two reads rather than every
kernel transition, and a flow that opens and closes inside one interval never
appears.

The route is the one that can go missing. At boot the agent probes whether it
can read the table at all - `/proc/net/nf_conntrack` if the kernel was built
with `CONFIG_NF_CONNTRACK_PROCFS`, otherwise a `conntrack -L` it actually
runs, since conntrack-tools can be installed and still fail for want of
`CAP_NET_ADMIN`. If neither answers, no poller is started and this route
answers `404 SERVICE_NOT_AVAILABLE`. A missing proc file is therefore not on
its own a reason for the stream to be absent, and the boot log says so rather
than leaving the `404` as the only evidence.

See [REST API Reference](../api-reference/rest-api.md) for details.

## CLI Usage

```bash
ebpfsentinel-agent conntrack status          # enabled, entries held, ceiling
ebpfsentinel-agent conntrack list -n 500     # list entries, default 100
ebpfsentinel-agent conntrack watch           # follow the event stream
ebpfsentinel-agent conntrack flush           # empty the table
```

`conntrack watch` reads the SSE route and reconnects on its own with a backoff.
Where that route answers `404` it falls back to diffing the connection list
every `--interval` seconds (default `2`) and says on screen that it did,
including that a short flow can open and close between two reads and never
appear, so a quiet screen is never mistaken for a quiet network.

`conntrack status` prints `unknown` where the table could not be read, for the
same reason the API answers `null` there.
