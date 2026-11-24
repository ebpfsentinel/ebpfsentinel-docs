# TCP Health Per Edge

Retransmissions, resets and connections that fail are the first sign that a
path between two services is going wrong, and a node-wide counter cannot say
which path. The agent counts them per edge: the service holding the local
socket, the service at the other end, and which of the two opened the
connection. "Retransmissions went up" becomes "`shop/api` retransmits to
`shop/postgres` and nothing else does".

## How It Works

1. Four raw tracepoints of the TCP stack are attached:
   `tcp_retransmit_skb`, `tcp_send_reset`, `tcp_receive_reset` and
   `inet_sock_set_state`. Each runs on an event the stack already treats as
   exceptional or as a change of state, never on a segment delivered in order,
   so a healthy connection costs a handful of counter updates over its whole
   life.
2. Each event adds one to a per-CPU counter keyed by the edge: the two
   addresses, the service port (the lower of the two ports), which end is
   local, and the cgroup of the local socket. Nothing leaves the kernel but
   the counters.
3. The agent reads the counters on an interval and names both ends before
   publishing them:
   - the local end is the workload listening on the port when this end is the
     server, otherwise the workload whose cgroup holds the socket, otherwise
     `unattributed`;
   - the peer is the name of the other end when it runs on this node too,
     since the kernel then holds the same connection from both sockets, and
     `off_node` otherwise. The agent on the other node counts the same
     connection under its own names.

When a connection reaches the established state and again when it leaves it,
the same `inet_sock_set_state` program also reads the round-trip time the
kernel smoothed for that socket and adds it to a histogram of the edge, in a
table shared by every CPU. That is two samples per connection taken at
moments the stack already marks, and none per segment: a long connection
contributes its round trip at the start and at the end rather than a stream
of them, which is enough to tell a slow path from a fast one and costs
nothing on the data path.

## Time Spent Sending

A round trip says how far the peer is; it does not say where a write waits.
Where the kernel runs it, a `sock_ops` program attached to the attribution
cgroup root (`attribution.cgroup_root`, the whole host by default) times
writes from the kernel's own transmit timestamps, the ones the stack takes for
`SO_TIMESTAMPING`, and adds them to three histograms per edge:

- `scheduled`: from the write handed to the TCP stack until the queueing
  discipline of the interface took the segment carrying its last byte;
- `sent`: until the driver was handed that segment;
- `acked`: until the peer acknowledged it.

A connection that reaches the established state after the program is attached
opts in to the callbacks; one already open when the agent starts is not timed.
Each socket has at most one write timed at a time: a write handed over while
the previous one is still in flight is not tagged, and a write never
acknowledged frees its socket after ten seconds. The cost is a tag on one
write in flight per socket and three callbacks for it, not a sample per
segment. The hardware timestamp the stack can also take is not used: it is the
network card's clock, which the kernel's monotonic clock cannot be subtracted
from.

The callbacks and the `bpf_sock_ops_enable_tx_tstamp` kfunc that turns them on
are in every kernel from 6.15, below the agent's floor. The program is still
optional: a kernel that refuses it, a cgroup it cannot attach to, or
`tcp_health.send_latency: false` leaves the counters and the round-trip
histogram above untouched, and the capability report names
`tcp_send_timestamps` inactive with the reason (see
[kernel capabilities](../operations/compatibility.md)). A socket that refuses
to opt in, or a write the kernel refuses to tag, is counted in
`ebpfsentinel_tcp_health_uncounted_total`.

A reset sent where no socket exists, which is what a port scan draws, has no
local workload and no service port. It is counted under the service
`no_listener` with one edge per scanning source, so a scan reads as many
`no_listener` resets rather than disappearing into a busy service.

## Reset Scan Alert

A source that draws resets from many closed ports is probing them. Each
reading, the agent sums the resets every source drew over a sliding window
(sixty seconds by default) and raises an alert when the sum crosses the line,
with the rule `tcp-reset-scan` under the component `tcp_health` and the
MITRE ATT&CK technique T1046, Network Service Discovery:

- a reset sent where no socket listens counts for the address that sent the
  probe, so a scan from anywhere against this node is seen;
- a connect from this node that was answered with a reset counts for this
  node, and the alert names the workload whose socket was refused, so a pod
  sweeping its neighbours is seen too.

A source is alerted on once per window however long it keeps going, and the
agent follows at most 4096 sources, letting the one seen longest ago go
first. The severity is `high` when the sum is ten times the line, `medium`
otherwise.

The open-source agent holds every source to the same fixed line,
`reset_scan.resets`. With an Enterprise licence for detection, each source
learns its own usual rate instead, as an exponentially weighted mean and
variance of what it drew per window, and its line is that mean plus four
standard deviations, never below ten. A monitoring probe that walks a few
closed ports every minute then stops raising the same alert, and a source
that usually draws nothing is alerted on well below the fixed line. A source
too new to have a baseline is held to the rate of every source on the node,
and until that has warmed up, to the fixed line. A window above a learnt
line is not learnt from, so a scan that lasts does not become the source's
normal; the alert's message gives the baseline it was judged against.

## Reading It

The counters are Prometheus series (see the
[metrics reference](../api-reference/prometheus-metrics.md#tcp-health)):

```text
ebpfsentinel_tcp_retransmits_total{service="shop/api",peer="shop/postgres",role="client"} 42
ebpfsentinel_tcp_resets_total{service="no_listener",peer="off_node",role="server",direction="sent"} 1200
ebpfsentinel_tcp_connections_total{service="shop/api",peer="off_node",role="server",outcome="failed"} 3
```

- `role` is `client` when the local end opened the connection and `server`
  when it accepted it.
- `direction` is `sent` for a reset this node emitted and `received` for one
  it was answered with.
- `outcome` is `opened` for a connection that reached the established state,
  `failed` for one torn down before it did, and `closed` for one that ended
  after it did.

Round-trip times are a histogram per edge, in seconds, with sixteen buckets
doubling from 64 microseconds; the last one is open and holds everything
past about one second:

```text
ebpfsentinel_tcp_rtt_seconds_bucket{le="0.001024",service="shop/api",peer="shop/postgres",role="client"} 58
ebpfsentinel_tcp_rtt_seconds_count{service="shop/api",peer="shop/postgres",role="client"} 76
```

Timed writes use the same buckets, one histogram per stage:

```text
ebpfsentinel_tcp_send_latency_seconds_bucket{le="0.000064",service="shop/api",peer="shop/postgres",role="client",stage="scheduled"} 412
ebpfsentinel_tcp_send_latency_seconds_count{service="shop/api",peer="shop/postgres",role="client",stage="acked"} 420
```

A stage no write on the edge reached writes no series.

Two queries worth keeping:

```promql
# Edges retransmitting the most over five minutes
topk(10, sum by (service, peer) (rate(ebpfsentinel_tcp_retransmits_total[5m])))

# Share of connects that fail, per service
sum by (service) (rate(ebpfsentinel_tcp_connections_total{outcome="failed"}[5m]))
  / sum by (service) (rate(ebpfsentinel_tcp_connections_total{outcome=~"opened|failed"}[5m]))

# 99th percentile round trip per edge
histogram_quantile(0.99, sum by (service, peer, le) (rate(ebpfsentinel_tcp_rtt_seconds_bucket[5m])))

# 99th percentile time a write waits before the driver has it, per edge
histogram_quantile(0.99, sum by (service, peer, le) (rate(ebpfsentinel_tcp_send_latency_seconds_bucket{stage="sent"}[5m])))
```

The same samples ride the [service graph](l7-firewall.md#service-map):
each edge read from a connection's end carries a `round_trip` histogram of the
last minutes, matched on the two addresses, the service port and the side, and
`flows services` prints its 50th and 99th percentiles. A transit edge carries
none, since a node the connection only crosses holds no socket for it. A
quantile is read as the bound of the bucket it falls in, so it errs high by at
most one bucket.

## Bounds

The kernel keeps at most 8192 edges, and as many round-trip histograms and
timed-write histograms; the timed writes add about 3.9 MB of keys and values
for the histograms and 0.6 MB for the 8192 writes in flight it follows at
once, a least recently used table. An
event on an edge the table has no
room for, an event that arrived before the agent wrote the kernel layout, and
an event on a socket whose fields could not be read are each counted in
`ebpfsentinel_tcp_health_uncounted_total`, never folded into another edge.
The table is a plain hash rather than an LRU: an eviction would make a counter
go backwards, which a reader takes for a restart.

The labels are bounded in userspace: `service` and `peer` share the same cap
of 256 names as the L7 request meter, and a name beyond it is counted under
`other`. Addresses never become labels.

## Requirements

The tracepoints and the timestamp callbacks are in every kernel the agent
supports; the callbacks also need the cgroup v2 hierarchy at
`attribution.cgroup_root`. The agent reads the
`sock`, `sock_common`, `tcp_sock`, `sk_buff` and cgroup field offsets from
`/sys/kernel/btf/vmlinux`, so a kernel without BTF loads nothing, and the
`ebpf_program_status{program="tracepoint-tcp-health"}` gauge reads `0` with
the reason in the agent's log.

## Configuration

```yaml
tcp_health:
  enabled: true
  poll_interval_secs: 10
  send_latency: true
  reset_scan:
    enabled: true
    window_secs: 60
    resets: 100
```

See the [configuration reference](../configuration/tcp-health.md).
