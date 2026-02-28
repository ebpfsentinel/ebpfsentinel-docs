# eBPF Helper Functions

eBPFsentinel uses 25+ kernel helper functions across its programs. This page documents each helper, what it does, which program uses it, and the minimum kernel version required.

## Helper Reference

### Packet Access & Modification

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-conntrack | Rewrite packet bytes in-place (IP/port for NAT) |
| [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) | 4.15+ | xdp-firewall | Prepend metadata area before packet data for XDP→TC passing |
| [`bpf_skb_vlan_push`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_push/) | 4.3+ | tc-threatintel | Push 802.1Q VLAN tag for quarantine tagging |
| [`bpf_skb_vlan_pop`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_pop/) | 4.3+ | tc-threatintel | Remove VLAN tag |

### Checksum

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) | 4.1+ | xdp-firewall | Compute incremental checksum difference |
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | Update IP header checksum after field modification |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-* | Update TCP/UDP checksum after port/addr rewrite |

### Routing & Redirect

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_redirect/) | 4.4+ | xdp-firewall | Redirect packet to another interface (via DEVMAP) or CPU (via CPUMAP) |
| [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) | 4.14+ | xdp-firewall | Redirect using DEVMAP/CPUMAP lookup |
| [`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/) | 4.18+ | xdp-firewall | FIB (routing table) lookup for next-hop resolution, policy routing, and routing anomaly detection |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall | Validate MTU before redirect to avoid silent drops |

### Tail Call & Program Chaining

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/) | 4.2+ | xdp-firewall | Jump to `xdp-ratelimit` via `PROG_ARRAY` — single attach point, chained processing |

### Event Emission (RingBuf)

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | All programs | Reserve space in the ring buffer for event writing |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | All programs | Submit a reserved ring buffer entry to userspace |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | tc-ids, tc-threatintel | Query ring buffer fill level for adaptive backpressure (skip emission when >75% full) |

### Timing & Randomness

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.7+ | xdp-ratelimit, tc-conntrack | Suspend-aware monotonic timestamp (accurate across sleep/hibernate) |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.1+ | tc-ids, tc-scrub | Kernel-side random sampling (IDS), IP ID randomization (scrub) |
| [`bpf_timer_init`](https://docs.ebpf.io/linux/helper-function/bpf_timer_init/) | 5.15+ | xdp-ratelimit | Initialize a timer in a map element for periodic maintenance |
| [`bpf_timer_set_callback`](https://docs.ebpf.io/linux/helper-function/bpf_timer_set_callback/) | 5.15+ | xdp-ratelimit | Set callback function for timer expiry (bucket cleanup) |
| [`bpf_timer_start`](https://docs.ebpf.io/linux/helper-function/bpf_timer_start/) | 5.15+ | xdp-ratelimit | Arm the timer with a timeout value |

### String & Data Comparison

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_strncmp`](https://docs.ebpf.io/linux/helper-function/bpf_strncmp/) | 5.17+ | tc-ids | L7 protocol signature detection (HTTP `GET `/`POST `, TLS `\x16\x03`, SSH `SSH-`) |

### Iteration

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall | Iterate over large rule sets without hitting the verifier loop limit |
| [`bpf_for_each_map_elem`](https://docs.ebpf.io/linux/helper-function/bpf_for_each_map_elem/) | 5.13+ | xdp-ratelimit | Iterate over all map entries for kernel-side maintenance/cleanup |

### Socket & Connection

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/) | 4.12+ | tc-conntrack | Unique per-connection identifier for flow correlation |
| [`bpf_sk_lookup_tcp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_tcp/) | 4.20+ | tc-conntrack | Socket lookup for process attribution (find which process owns a connection) |
| [`bpf_sk_lookup_udp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_udp/) | 4.20+ | tc-conntrack | Same as above for UDP |
| [`bpf_tcp_gen_syncookie`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_gen_syncookie/) | 5.10+ | xdp-ratelimit | Generate SYN cookies at XDP speed for SYN flood mitigation |

### System Info

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_smp_processor_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_smp_processor_id/) | 4.1+ | All programs | Current CPU ID — embedded in `PacketEvent` for NUMA analysis |

## Backpressure Pattern

The IDS and threat intel programs implement adaptive backpressure to avoid overwhelming userspace:

```
if bpf_ringbuf_query(BPF_RB_AVAIL_DATA) > capacity * 0.75 {
    // Buffer >75% full — skip event emission
    metrics.events_dropped += 1;
    return TC_ACT_OK;
}
// Normal path: reserve + fill + submit
let entry = bpf_ringbuf_reserve(sizeof(PacketEvent));
// ... fill fields ...
bpf_ringbuf_submit(entry);
```

This prevents kernel events from piling up when the userspace consumer falls behind.

## XDP→TC Metadata Passing

The firewall uses [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) to pass context to downstream TC programs without re-parsing the packet:

```
XDP program:
  bpf_xdp_adjust_meta(ctx, -(int)sizeof(struct metadata))
  metadata->rule_id = matched_rule
  metadata->flags   = action_flags
  metadata->status  = rate_limit_status

TC program:
  struct metadata *md = (void *)(long)ctx->data_meta
  if (md + 1 > data)  // bounds check
      return TC_ACT_OK;
  // Use md->rule_id directly — no header re-parsing needed
```
