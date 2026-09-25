# eBPF Helper Functions

eBPFsentinel calls 33 kernel helper functions across its 16 programs. This page documents each helper, what it does, which program uses it, and the minimum kernel version required. The authoritative list is the requirement table the agent probes with (`crates/adapters/src/ebpf/helper_probe.rs`), which a unit test keeps in step with the program sources in both directions: a helper a program calls must be listed, and a helper listed must be called. The test follows the calls a program makes through the `ebpf_helpers` macros (`emit_packet_event!`, `ringbuf_has_backpressure!`) and through aya's methods (`tail_call`, `redirect`, `load`, `store`), not only the ones spelled `bpf_*(` in its own source.

## Helper Reference

### Packet Access & Modification

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-scrub | Rewrite packet bytes in place (address and port for NAT, TTL, IP ID and TCP options for scrub) |
| [`bpf_skb_load_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_load_bytes/) | 4.5+ | tc-ids, tc-dns, tc-scrub | Load packet bytes into a stack buffer: L7 and DNS payload capture, TCP option normalisation |
| [`bpf_xdp_adjust_tail`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_tail/) | 4.15+ | xdp-firewall-reject, xdp-ratelimit-syncookie | Grow or shrink packet tail for reject responses and SYN cookie forging |
| [`bpf_clone_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_clone_redirect/) | 4.2+ | tc-ids | Clone the packet to a mirror interface for forensic capture (enterprise) |

### Checksum

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | Update IP header checksum after field modification |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-*, tc-scrub | Update TCP/UDP checksum after port/addr rewrite or MSS clamping |
| [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) | 4.6+ | tc-scrub | Checksum delta for the rewritten IP fields and TCP options |

### Routing & Redirect

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) | 4.14+ | xdp-loadbalancer | Redirect through `DevMap.redirect()` for wire-speed LB forwarding |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer | Validate MTU before passing/forwarding - drops oversized packets |
| [`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/) | 4.18+ | xdp-firewall | Kernel FIB lookup for route enrichment |

### Tail Call & Program Chaining

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/) | 4.2+ | xdp-firewall, xdp-ratelimit | Chain XDP programs via `ProgramArray.tail_call()`: the firewall hands over to reject, the VIP announcer, ratelimit or the load balancer; ratelimit hands over to syncookie or the load balancer |

### Event Emission (RingBuf)

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | The eight event-emitting programs | Reserve space in ring buffer for event writing |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | The eight event-emitting programs | Submit a reserved ring buffer entry to userspace |
| [`bpf_ringbuf_discard`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_discard/) | 5.8+ | The eight event-emitting programs | Drop a reservation whose payload read failed, instead of submitting stale ring bytes |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | The eight event-emitting programs | Unconsumed bytes in the ring: the 75% backpressure check and the choice of wakeup flag on submit |

`RingBuf` is the sole event transport. Arena zero-copy delivery was evaluated but is not usable on the Rust `bpfel` target - see [KFuncs: Arena maps](kfuncs.md#arena-maps-kernel-69---evaluated-not-used).

### Timing & Randomness

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.8+ | xdp-firewall, xdp-firewall-reject, xdp-ratelimit, xdp-loadbalancer, tc-ids, tc-dns, tc-threatintel, tc-qos, uprobe-dlp | Suspend-aware monotonic timestamp for events and state tracking |
| [`bpf_ktime_get_coarse_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_coarse_ns/) | 5.11+ | xdp-ratelimit | Coarse monotonic timestamp (~1-4ms precision, ~10x faster) for rate limiting windows |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.1+ | tc-ids, tc-scrub, tc-qos | IDS sampling check (the config map is never written, so it never skips), IP ID randomization (scrub), loss emulation (QoS) |

### QoS & Traffic Control

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_skb_set_tstamp`](https://docs.ebpf.io/linux/helper-function/bpf_skb_set_tstamp/) | 5.18+ | tc-qos | Set EDT (Earliest Departure Time) timestamp for FQ pacing |
| [`bpf_skb_ecn_set_ce`](https://docs.ebpf.io/linux/helper-function/bpf_skb_ecn_set_ce/) | 5.1+ | tc-qos | Mark ECN Congestion Experienced when token bucket is low |

### SYN Cookies

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_tcp_raw_gen_syncookie_ipv4`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_raw_gen_syncookie_ipv4/) / `_ipv6` | 6.0+ | xdp-ratelimit-syncookie | Forge a SYN cookie with no socket on the receive path |
| [`bpf_tcp_raw_check_syncookie_ipv4`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_raw_check_syncookie_ipv4/) / `_ipv6` | 6.0+ | xdp-ratelimit | Validate the ACK that returns the cookie |

### Iteration

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall, tc-nat-ingress, tc-nat-egress, tc-scrub | Iterate over large rule sets without hitting verifier loop limit |

### Socket & Process

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/) | 4.12+ | tc-ids, tc-threatintel, tc-qos | Stable per-connection identifier for flow correlation (TC context only) |
| [`bpf_probe_read_user`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_user/) | 5.5+ | uprobe-dlp | Read user-space SSL buffer for DLP inspection |
| [`bpf_probe_read_kernel`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_kernel/) | 5.5+ | tc-conntrack, xdp-firewall | Read `nf_conn->status` at runtime BTF-resolved offsets |
| [`bpf_get_current_pid_tgid`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_pid_tgid/) | 4.2+ | uprobe-dlp | Process identification for DLP alerts |
| [`bpf_get_current_cgroup_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_cgroup_id/) | 4.18+ | uprobe-dlp, tc-ids, tc-dns, tc-threatintel, tc-qos | Cgroup ID for container/pod correlation |
| [`bpf_skb_cgroup_id`](https://docs.ebpf.io/linux/helper-function/bpf_skb_cgroup_id/) | 4.18+ | tc-ids | Cgroup ID of the socket behind an egress packet |

### System Info

| Helper | Kernel | Used By | Purpose |
|--------|--------|---------|---------|
| [`bpf_get_smp_processor_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_smp_processor_id/) | 4.1+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer, tc-ids, tc-threatintel, tc-qos | CPU recorded in each packet event |
| [`bpf_map_lookup_elem`](https://docs.ebpf.io/linux/helper-function/bpf_map_lookup_elem/) | 3.19+ | All programs (the probe's base set) | Map read on every packet path |

## Backpressure Pattern

Every event-emitting program except `uprobe-dlp` refuses to reserve once the
ring is more than three quarters full, counting the skipped event in its own
metrics map. The threshold is computed at compile time from the ring's size
(`ebpf_helpers::ringbuf`):

```
let backlog = bpf_ringbuf_query(&EVENTS, BPF_RB_AVAIL_DATA);
if backlog > EVENTS_MAX_ENTRIES * 3 / 4 {
    metrics.events_dropped += 1;   // skip the event, keep the packet verdict
    return;
}
let entry = bpf_ringbuf_reserve(&EVENTS, size_of::<PacketEvent>());
// ... fill fields ...
bpf_ringbuf_submit(entry, if backlog >= 64 KiB { BPF_RB_FORCE_WAKEUP }
                          else { BPF_RB_NO_WAKEUP });
```

The submit flag batches reader wakeups: below 64 KiB of backlog the record is
committed without waking userspace, and the reader's periodic drain picks it
up. `uprobe-dlp` uses the same wakeup rule without the 75% cut, so a reserve
there fails only when the ring is full. `tc-dns` checks backpressure but keeps
the kernel's default wakeup, because a DNS answer has to reach the domain
cache before the connection it resolved for.

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

## Parse Once per TC Chain

No metadata is passed from XDP to TC. The TC programs on one interface share a
single parse instead: the first classifier of the chain writes the offsets,
ports, VLAN, flags and tenant it found into the 20 bytes of `skb->cb`, and the
ones after it read them back (`ebpf_helpers::pktmeta`). The words are guarded
by a magic byte and a check word folded over the payload words, the packet
length and the interfaces, so a control block written by the transport or by
another device's chain fails the check and the packet is parsed again. The two
NAT classifiers invalidate the words after rewriting a packet.
