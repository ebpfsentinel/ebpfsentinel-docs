# eBPF Helper Functions

eBPFsentinel uses 25+ kernel helper functions across its 14 programs. This page documents each helper, what it does, which program uses it, and the minimum kernel version required.

## Helper Reference

### Packet Access & Modification

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-ingress, tc-nat-egress | Rewrite packet bytes in-place (IP/port for NAT) |
| [`bpf_skb_load_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_load_bytes/) | 4.5+ | tc-ids, tc-dns | Load packet bytes into stack buffer for L7/DNS payload capture |
| [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/) | 4.15+ | xdp-firewall | Prepend metadata area before packet data for XDP-to-TC passing |
| [`bpf_xdp_adjust_tail`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_tail/) | 4.18+ | xdp-firewall-reject, xdp-ratelimit-syncookie | Grow or shrink packet tail for reject responses and SYN cookie forging |
| [`bpf_clone_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_clone_redirect/) | 4.2+ | tc-ids | Clone packet and redirect copy to mirror interface for forensic capture (enterprise) |

### Checksum

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | Update IP header checksum after field modification |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | Update TCP/UDP checksum after port/addr rewrite or MSS clamping |

### Routing & Redirect

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) | 4.14+ | xdp-firewall, xdp-loadbalancer | Redirect using DevMap (wire-speed LB forwarding) or CpuMap (DDoS CPU steering) |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer | Validate MTU before passing/forwarding — drops oversized packets |

### Tail Call & Program Chaining

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/) | 4.2+ | xdp-firewall, xdp-ratelimit | Chain XDP programs via `ProgramArray.tail_call()`: firewall → ratelimit → loadbalancer, firewall → reject, ratelimit → syncookie |

### Event Emission (RingBuf + Arena)

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | All programs with events | Reserve space in ring buffer for event writing |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | All programs with events | Submit a reserved ring buffer entry to userspace |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | All programs with events | Query ring buffer fill level for 75% backpressure (via `ringbuf_has_backpressure!` macro) |

Five programs also use **arena zero-copy** (`bpf_arena_alloc_pages` kfunc) as the primary event path, with RingBuf as fallback. See [KFuncs: Arena Maps](kfuncs.md#arena-maps-kernel-69).

### Timing & Randomness

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.8+ | All programs | Suspend-aware monotonic timestamp for events and state tracking |
| [`bpf_ktime_get_coarse_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_coarse_ns/) | 5.11+ | xdp-ratelimit | Coarse monotonic timestamp (~1-4ms precision, ~10x faster) for rate limiting windows |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.17+ | tc-ids, tc-scrub, tc-qos | Random sampling (IDS), IP ID randomization (scrub), loss emulation (QoS) |

### QoS & Traffic Control

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_skb_set_tstamp`](https://docs.ebpf.io/linux/helper-function/bpf_skb_set_tstamp/) | 5.18+ | tc-qos | Set EDT (Earliest Departure Time) timestamp for FQ pacing |
| [`bpf_skb_ecn_set_ce`](https://docs.ebpf.io/linux/helper-function/bpf_skb_ecn_set_ce/) | 5.1+ | tc-qos | Mark ECN Congestion Experienced when token bucket is low |

### Iteration

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall, tc-nat-ingress, tc-nat-egress | Iterate over large rule sets without hitting verifier loop limit |

### Socket & Process

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/) | 4.12+ | tc-ids, tc-qos, tc-threatintel | Stable per-connection identifier for flow correlation (TC context only) |
| [`bpf_probe_read_user`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_user/) | 5.5+ | uprobe-dlp | Read user-space SSL buffer for DLP inspection |
| [`bpf_probe_read_kernel`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_kernel/) | 5.5+ | tc-conntrack, xdp-firewall | Read `nf_conn->status` at runtime BTF-resolved offsets |
| [`bpf_get_current_pid_tgid`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_pid_tgid/) | 4.2+ | uprobe-dlp | Process identification for DLP alerts |
| [`bpf_get_current_cgroup_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_cgroup_id/) | 4.18+ | uprobe-dlp, tc-ids | Cgroup ID for container/pod correlation |

### System Info

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_smp_processor_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_smp_processor_id/) | 4.1+ | All programs | Current CPU ID for per-CPU metrics and CpuMap steering |

## Backpressure Pattern

All event-emitting programs implement adaptive backpressure to avoid overwhelming userspace:

```
if bpf_ringbuf_query(BPF_RB_AVAIL_DATA) > capacity * 0.75 {
    // Buffer >75% full — skip event emission
    metrics.events_dropped += 1;
    return TC_ACT_OK;
}
// Normal path: try arena first, RingBuf fallback
if try_emit_arena(...) { return; }
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
