# Kernel Drop Reasons

When the kernel throws a packet away it says why. Every `kfree_skb` carries an
`skb_drop_reason`, and the agent counts those drops by reason and by the
interface the packet was on, so "the packet never arrived" becomes "the kernel
dropped 1200 packets on `eth0` because nothing listened on the port" rather than
an afternoon with `tcpdump`.

This is the first thing to read when traffic goes missing, and the
[troubleshooting guide](../operations/troubleshooting.md#packets-go-missing)
starts from it.

## How It Works

1. A raw tracepoint on `kfree_skb` runs once per packet the kernel drops. A
   packet the kernel delivers is freed through `consume_skb`, which is not
   hooked, so delivered traffic costs nothing.
2. The program reads the reason and the packet's device, and adds one to a
   per-CPU counter keyed by the reason, the device's index and its name.
3. The agent reads the counters on an interval, names each reason from the
   running kernel's own BTF, and publishes the increments as a Prometheus
   counter and the totals on the REST API and the command line.

Reasons are named from the kernel the agent runs on rather than from a list
compiled in, because the numbering changes between kernel releases. A reason
this kernel defines but the agent does not describe is still counted under its
kernel name; a value the kernel's BTF does not name is counted as
`UNKNOWN_<value>`, and a reason raised by a subsystem's own table (wireless,
Open vSwitch) is counted as `SUBSYS_<name>`.

## Reading It

```bash
ebpfsentinel-agent ebpf drops
```

```text
REASON          INTERFACE  PACKETS  MEANING
NO_SOCKET       eth0       1204     Nothing listens on the destination port, or the socket closed before the packet arrived.
NETFILTER_DROP  eth0       318      A netfilter rule (iptables or nftables) dropped it.
NOT_SPECIFIED   wlan0      17       Freed without a reason: the path that dropped it was not annotated.
```

The same reading is `GET /api/v1/ebpf/drop-reasons` (see the
[REST API reference](../api-reference/rest-api.md)), and the increments are
`ebpfsentinel_kernel_drops_total{reason, interface}` (see the
[metrics reference](../api-reference/prometheus-metrics.md)).

The interface is the device's name in its own network namespace. A packet freed
after the stack let go of its device keeps only the index it arrived on, and is
labelled `if<index>`: that index belongs to the namespace the packet arrived in,
so resolving it in the agent's namespace could name the wrong device. A packet
with neither is labelled `none`.

## Bounds

The counter keeps at most 4096 distinct reason and interface pairs. A drop on a
pair the table has no room for is counted in
`ebpfsentinel_kernel_drops_uncounted_total` and in the `uncounted` field of the
API, never folded into another pair, so a reading says how much it is missing.
The table is a plain hash rather than an LRU: an eviction would make a counter go
backwards, which a reader takes for a restart.

Both labels are bounded. The reasons are the kernel's enumeration, under two
hundred values on current kernels, and the interfaces are the devices a node has.

## Cost

Measured with the kernel's own run-time accounting
(`kernel.bpf_stats_enabled=1`) on kernel 7.0 and an i7-1370P: about **50 ns per
dropped packet**, at about 450000 drops a second, and nothing per delivered
packet. A host dropping 10000 packets a second spends about half a millisecond
of CPU per second counting them. The runs and the method are recorded in the
agent repository under `tests/perf/results/`.

## Requirements

The tracepoint and the reason enumeration are in every kernel the agent supports.
The agent reads the `sk_buff` and `net_device` field offsets and the reason
names from `/sys/kernel/btf/vmlinux`; a kernel without BTF loads nothing and the
API answers `counting: false` with the reason.

## Configuration

```yaml
kernel_drops:
  enabled: true
  poll_interval_secs: 10
```

See the [configuration reference](../configuration/kernel-drops.md).

## What The Reasons Mean

The agent describes the reasons below in plain language, and the command line
and the API print the description beside the count. A reason not in this table
is still counted, under the kernel's name for it.

| Reason | What it means |
|---|---|
| `NOT_SPECIFIED` | Freed without a reason: the path that dropped it was not annotated. |
| `NO_SOCKET` | Nothing listens on the destination port, or the socket closed before the packet arrived. |
| `SOCKET_CLOSE` | The socket was closed with data still queued on it. |
| `SOCKET_FILTER` | A socket filter (classic BPF, for instance a capture filter) refused the packet. |
| `SOCKET_RCVBUFF` | The receiving socket's buffer was full: the application is reading too slowly. |
| `SOCKET_BACKLOG` | The socket's backlog was full while the application held the socket. |
| `PROTO_MEM` | The protocol's global memory limit was reached (net.ipv4.tcp_mem or udp_mem). |
| `PKT_TOO_SMALL` | The packet is shorter than its own headers say. |
| `PKT_TOO_BIG` | The packet is larger than the path or the device accepts. |
| `HDR_TRUNC` | A header is cut short. |
| `OTHERHOST` | The packet is addressed to another host's hardware address. |
| `IP_CSUM` | The IPv4 header checksum is wrong. |
| `IP_INHDR` | The IP header is malformed: bad version, length or options. |
| `IP_RPFILTER` | Reverse path filtering refused it: the source is not routed back through this interface. |
| `IP_NOPROTO` | No handler is registered for the IP protocol the packet carries. |
| `IP_INADDRERRORS` | The destination address is not valid for this host. |
| `IP_INNOROUTES` | No route matches the destination of an incoming packet. |
| `IP_OUTNOROUTES` | No route matches the destination of an outgoing packet. |
| `IP_TUNNEL_ECN` | A tunnelled packet carries an ECN marking that cannot be decapsulated. |
| `UNICAST_IN_L2_MULTICAST` | A unicast IP packet arrived in a link-layer multicast or broadcast frame. |
| `IPV6DISABLED` | IPv6 is disabled on the interface the packet arrived on. |
| `IPV6_BAD_EXTHDR` | An IPv6 extension header is malformed. |
| `TCP_CSUM` | The TCP checksum is wrong. |
| `UDP_CSUM` | The UDP checksum is wrong. |
| `ICMP_CSUM` | The ICMP checksum is wrong. |
| `TCP_FLAGS` | The TCP flags make no sense for the connection's state. |
| `TCP_ZEROWINDOW` | The receiver advertised a zero window and the sender sent anyway. |
| `TCP_OLD_DATA` | The segment carries data that was already received. |
| `TCP_OVERWINDOW` | The segment lies beyond the receive window. |
| `TCP_OFOMERGE` | An out-of-order segment was already held. |
| `TCP_RFC7323_PAWS` | The timestamp is older than the last one seen (protection against wrapped sequences). |
| `TCP_INVALID_SEQUENCE` | The sequence number is outside what the connection accepts. |
| `TCP_INVALID_ACK_SEQUENCE` | The acknowledgement number is outside what the connection accepts. |
| `TCP_OLD_ACK` | The acknowledgement covers data acknowledged already. |
| `TCP_TOO_OLD_ACK` | The acknowledgement is too old to be meaningful. |
| `TCP_ACK_UNSENT_DATA` | The peer acknowledges data that was never sent. |
| `TCP_RESET` | The segment is a reset, and the connection is torn down. |
| `TCP_INVALID_SYN` | A SYN arrived on a connection that does not accept one. |
| `TCP_CLOSE` | The connection is closed and takes no more data. |
| `TCP_FASTOPEN` | A TCP Fast Open cookie was refused. |
| `TCP_OFO_QUEUE_PRUNE` | Out-of-order segments were pruned to free memory. |
| `TCP_OFO_DROP` | An out-of-order segment was dropped for lack of room. |
| `TCP_MINTTL` | The TTL is below the minimum the socket requires. |
| `TCP_MD5NOTFOUND` | The segment lacks the TCP MD5 signature the socket requires. |
| `TCP_MD5UNEXPECTED` | The segment carries a TCP MD5 signature the socket does not expect. |
| `TCP_MD5FAILURE` | The TCP MD5 signature does not verify. |
| `NETFILTER_DROP` | A netfilter rule (iptables or nftables) dropped it. |
| `BPF_CGROUP_EGRESS` | A cgroup eBPF program refused an outgoing packet. |
| `SECURITY_HOOK` | A security module (SELinux, AppArmor, a BPF LSM) refused it. |
| `XFRM_POLICY` | An IPsec policy refused it. |
| `XDP` | An XDP program dropped it, or an XDP redirect failed. |
| `TC_INGRESS` | A traffic-control program or filter dropped it on the way in. |
| `TC_EGRESS` | A traffic-control program or filter dropped it on the way out. |
| `QDISC_DROP` | The queueing discipline dropped it: an egress queue is full or a shaper limits it. |
| `CPU_BACKLOG` | The per-CPU input backlog was full (net.core.netdev_max_backlog). |
| `FULL_RING` | The device's ring was full. |
| `NOMEM` | Memory could not be allocated for the packet. |
| `DEV_HDR` | The device could not build the link-layer header. |
| `DEV_READY` | The device is down or not ready to transmit. |
| `UNHANDLED_PROTO` | No handler is registered for the link-layer protocol. |
| `NEIGH_CREATEFAIL` | No neighbour entry could be created for the next hop. |
| `NEIGH_FAILED` | The next hop's hardware address could not be resolved (ARP or neighbour discovery failed). |
| `NEIGH_QUEUEFULL` | Too many packets wait for the next hop's address to resolve. |
| `NEIGH_DEAD` | The neighbour entry was removed while packets waited on it. |
| `SKB_CSUM` | The checksum could not be computed. |
| `SKB_GSO_SEG` | A large packet could not be segmented. |
| `SKB_UCOPY_FAULT` | Copying the payload from the application faulted. |
| `TAP_FILTER` | A tap device's filter refused it. |
| `TAP_TXFILTER` | A tap device's transmit filter refused it. |
| `INVALID_PROTO` | The protocol field is not one this path handles. |
| `DUP_FRAG` | A fragment was received twice. |
| `FRAG_REASM_TIMEOUT` | Fragments did not all arrive before reassembly timed out. |
| `FRAG_TOO_FAR` | A fragment arrived too far out of order to be kept. |
| `QUEUE_PURGE` | A queue was purged, for instance when a device or socket went away. |
| `TC_CHAIN_NOTFOUND` | A traffic-control action jumped to a chain that does not exist. |
| `TC_RECLASSIFY_LOOP` | A traffic-control reclassification looped. |
| `VXLAN_INVALID_HDR` | The VXLAN header is malformed. |
| `VXLAN_VNI_NOT_FOUND` | No VXLAN device is configured for the packet's VNI. |
| `MAC_INVALID_SOURCE` | The source hardware address is invalid. |
| `MAC_IS_MULTICAST` | The source hardware address is a multicast address. |
| `LOCAL_MAC` | The source hardware address is the receiving device's own. |
