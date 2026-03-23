# eBPF Helper Functions

eBPFsentinel uses 30+ kernel helper functions across its programs. This page documents each helper, what it does, which program uses it, and the minimum kernel version required.

## Helper Reference

### Packet Access & Modification

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-conntrack | Rewrite packet bytes in-place (IP/port for NAT) |
| [`bpf_skb_load_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_load_bytes/) | 4.5+ | tc-ids | Load packet bytes into stack buffer for DPI |
| [`bpf_skb_pull_data`](https://docs.ebpf.io/linux/helper-function/bpf_skb_pull_data/) | 4.3+ | tc-ids, tc-dns | Linearize multi-fragment SKBs (jumbo frames, GRO aggregates) before payload inspection. Called with `ctx.len()` (full SKB size) to cover fragments beyond the linear buffer. |
| [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) | 4.15+ | xdp-firewall | Prepend metadata area before packet data for XDP-to-TC passing |
| [`bpf_xdp_adjust_tail`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_tail/) | 4.18+ | xdp-firewall, xdp-firewall-reject, xdp-ratelimit, xdp-ratelimit-syncookie | Grow or shrink packet tail for reject responses and SYN cookie SYN+ACK packets |
| [`bpf_skb_vlan_push`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_push/) | 4.3+ | tc-threatintel | Push 802.1Q VLAN tag for quarantine tagging |
| [`bpf_skb_vlan_pop`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_pop/) | 4.3+ | tc-threatintel | Remove VLAN tag |
| [`bpf_clone_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_clone_redirect/) | 4.2+ | tc-ids | Clone packet and redirect copy to a mirror interface for forensic capture (enterprise) |

### Checksum

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) | 4.6+ | xdp-firewall | Compute incremental checksum difference |
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | Update IP header checksum after field modification |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-* | Update TCP/UDP checksum after port/addr rewrite |

### Routing & Redirect

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_redirect/) | 4.4+ | xdp-firewall | Redirect packet to another interface or CPU |
| [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) | 4.14+ | xdp-firewall, xdp-loadbalancer | Redirect using DevMap (wire-speed LB forwarding) or CpuMap (DDoS CPU steering) |
| [`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/) | 4.18+ | xdp-firewall | FIB (routing table) lookup for next-hop resolution and policy routing |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer | Validate MTU before passing/forwarding — drops oversized packets and increments `mtu_exceeded` metric |

### Tail Call & Program Chaining

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/) | 4.2+ | xdp-firewall, xdp-ratelimit | Chain XDP programs: firewall → ratelimit → loadbalancer, firewall → reject, ratelimit → syncookie → loadbalancer |

### Event Emission (RingBuf)

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | All programs | Reserve space in the ring buffer for event writing |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | All programs | Submit a reserved ring buffer entry to userspace |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | tc-ids, tc-threatintel | Query ring buffer fill level for adaptive backpressure (skip emission when >75% full) |

### Timing & Randomness

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.8+ | tc-conntrack, tc-qos | Suspend-aware monotonic timestamp for state tracking |
| [`bpf_ktime_get_coarse_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_coarse_ns/) | 5.11+ | xdp-ratelimit | Coarse monotonic timestamp (~1-4ms precision, ~10x faster than boot_ns) for rate limiting |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.17+ | tc-ids, tc-scrub, tc-qos | Random sampling (IDS), IP ID randomization (scrub), loss emulation (QoS) |
| [`bpf_timer_init`](https://docs.ebpf.io/linux/helper-function/bpf_timer_init/) | 5.15+ | xdp-ratelimit | Initialize a timer in a map element for periodic maintenance |
| [`bpf_timer_set_callback`](https://docs.ebpf.io/linux/helper-function/bpf_timer_set_callback/) | 5.15+ | xdp-ratelimit | Set callback function for timer expiry (bucket cleanup) |
| [`bpf_timer_start`](https://docs.ebpf.io/linux/helper-function/bpf_timer_start/) | 5.15+ | xdp-ratelimit | Arm the timer with a timeout value |

### QoS & Traffic Control

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_skb_set_tstamp`](https://docs.ebpf.io/linux/helper-function/bpf_skb_set_tstamp/) | 5.18+ | tc-qos | Set EDT (Earliest Departure Time) timestamp for FQ pacing |
| [`bpf_skb_ecn_set_ce`](https://docs.ebpf.io/linux/helper-function/bpf_skb_ecn_set_ce/) | 5.1+ | tc-qos | Mark ECN Congestion Experienced when token bucket is low (<25% burst), signaling sender to slow down |

### String & Data Comparison

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_strncmp`](https://docs.ebpf.io/linux/helper-function/bpf_strncmp/) | 5.17+ | tc-ids | L7 protocol signature detection (HTTP, TLS, SSH) |

### Iteration

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall, tc-nat-ingress, tc-nat-egress | Iterate over large rule sets without hitting verifier loop limit |
| [`bpf_for_each_map_elem`](https://docs.ebpf.io/linux/helper-function/bpf_for_each_map_elem/) | 5.13+ | xdp-ratelimit | Iterate over all map entries for kernel-side maintenance |

### Socket & Connection

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/) | 4.12+ | tc-ids, tc-qos, tc-threatintel | Stable per-connection identifier for flow correlation across programs (TC context only) |
| [`bpf_probe_read_user`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_user/) | 5.5+ | uprobe-dlp | Read user-space memory for SSL buffer inspection |
| [`bpf_get_current_pid_tgid`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_pid_tgid/) | 4.2+ | uprobe-dlp | Process identification for DLP alerts |

### System Info

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_smp_processor_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_smp_processor_id/) | 4.1+ | All programs | Current CPU ID for per-CPU metrics and CpuMap steering |

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

## Packet Mirroring Pattern (Enterprise)

The IDS program supports cloning suspicious packets to a mirror interface for forensic capture:

```
// Controlled by IDS_MIRROR_CONFIG Array map (populated by enterprise forensics)
// Index 0: target ifindex, Index 1: enabled (1/0)
if mirror_enabled == 1 && mirror_ifindex > 0 {
    bpf_clone_redirect(skb, mirror_ifindex, 0);
    // Original packet continues normal processing
}
```

## XDP-to-TC Metadata Passing

The firewall uses `bpf_xdp_adjust_meta` to pass context to downstream TC programs without re-parsing:

```
XDP program:
  bpf_xdp_adjust_meta(ctx, -(int)sizeof(struct metadata))
  metadata->rule_id = matched_rule
  metadata->flags   = action_flags

TC program:
  struct metadata *md = (void *)(long)ctx->data_meta
  if (md + 1 > data) return TC_ACT_OK;
  // Use md->rule_id directly — no re-parsing needed
```

## Conntrack Lazy Timeout Eviction

The conntrack program implements per-protocol timeout enforcement on every lookup:

```
let elapsed = now - entry.last_seen_ns;
let timeout = select_timeout(state, protocol, config);
// TCP established: 300s, SYN: 120s, FIN: 60s, UDP: 180s, ICMP: 30s
if elapsed > timeout {
    map.remove(&key);
    // Treat as new connection
}
```
