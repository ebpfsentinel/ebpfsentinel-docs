# eBPF Programs

## Overview

eBPFsentinel includes 12 eBPF kernel programs, all written in Rust using the [Aya](https://aya-rs.dev/) framework. Programs are compiled for the `bpfel-unknown-none` target (little-endian BPF) using the nightly Rust toolchain.

## Programs

| Program | Hook | Crate Path | Purpose |
|---------|------|-----------|---------|
| `xdp-firewall` | XDP | `crates/ebpf-programs/xdp-firewall/` | L3/L4 stateful packet filtering + reject (XDP_TX) |
| `xdp-ratelimit` | XDP | `crates/ebpf-programs/xdp-ratelimit/` | DDoS protection + per-country rate limit tiers (LPM) |
| `xdp-loadbalancer` | XDP | `crates/ebpf-programs/xdp-loadbalancer/` | L4 load balancing (TCP/UDP/TLS passthrough) |
| `tc-conntrack` | TC classifier | `crates/ebpf-programs/tc-conntrack/` | Connection tracking (TCP/UDP/ICMP state machine) |
| `tc-scrub` | TC classifier | `crates/ebpf-programs/tc-scrub/` | Packet normalization (TTL, MSS, DF, IP ID, TCP flags, ECN, TOS, TCP timestamps) |
| `tc-nat-ingress` | TC ingress | `crates/ebpf-programs/tc-nat-ingress/` | DNAT (destination NAT, ingress direction) |
| `tc-nat-egress` | TC egress | `crates/ebpf-programs/tc-nat-egress/` | SNAT (source NAT, egress direction) |
| `tc-ids` | TC classifier | `crates/ebpf-programs/tc-ids/` | Intrusion detection |
| `tc-threatintel` | TC classifier | `crates/ebpf-programs/tc-threatintel/` | Threat intelligence |
| `tc-dns` | TC classifier | `crates/ebpf-programs/tc-dns/` | DNS capture |
| `tc-qos` | TC egress | `crates/ebpf-programs/tc-qos/` | QoS / traffic shaping |
| `uprobe-dlp` | uprobe | `crates/ebpf-programs/uprobe-dlp/` | SSL/TLS DLP |

## Interface Groups (Cross-Cutting)

Six programs (`xdp-firewall`, `xdp-ratelimit`, `tc-nat-ingress`, `tc-nat-egress`, `tc-ids`, `tc-qos`) share a common **interface group** mechanism. Each program has an `INTERFACE_GROUPS` HashMap (key = `u32` ifindex, value = `u32` bitmask, max 64 entries). Rule structs in these programs include a `group_mask` field:

- `group_mask == 0` — **floating rule**, applies to all interfaces (backward compatible default)
- `group_mask != 0` — rule applies only when the interface's bitmask ANDed with `group_mask` is non-zero
- Bit 31 — **inversion flag**: when set, the match is inverted (rule applies to interfaces *not* in the specified groups)

Up to 31 named interface groups are supported. The bitmask check adds negligible overhead (one map lookup + one AND + one compare per rule).

## Shared Types (ebpf-common)

All programs share types via `crates/ebpf-common/`:

- `PacketEvent` (64 bytes) — the standard event emitted to userspace via RingBuf
- `#[repr(C)]` structs for eBPF map keys and values
- Shared constants (`FLAG_IPV6`, `FLAG_VLAN`, etc.)

## XDP Firewall (xdp-firewall)

The most feature-rich eBPF program. Processes packets through a 5-phase pipeline:

1. **Phase 0 — Conntrack fast-path**: Overload check (IP set 255), connection tracking lookup. Established connections skip rule evaluation.
2. **Phase 1 — LPM Trie** (O(log n)): CIDR-only rules in four tries (`FW_LPM_SRC_V4`, `FW_LPM_DST_V4`, `FW_LPM_SRC_V6`, `FW_LPM_DST_V6`).
3. **Phase 2 — Linear scan**: Rules with port ranges, protocol, VLAN, TCP flags, ICMP type/code, MAC, DSCP, aliases, negation. Priority order, first match wins.
4. **Phase 3 — Connection limits**: Per-source and per-rule state limits. Overloaded sources added to blacklist.
5. **Phase 4 — Routing actions**: Policy routing (`route-to`, `reply-to`, `dup-to`).

Key eBPF features:

- **LPM Trie** maps for O(log n) CIDR matching (4 tries: src/dst × IPv4/IPv6)
- **PROG_ARRAY** tail-call to `xdp-ratelimit` for chained processing
- **DEVMAP** for packet mirroring to monitoring interfaces
- **CPUMAP** for NUMA-aware CPU steering
- **bpf_fib_lookup** for FIB routing enrichment and policy routing
- **bpf_xdp_adjust_meta** for metadata passing to TC programs (rule ID, DSCP mark, route action)
- **bpf_check_mtu** for MTU validation before redirect
- **bpf_csum_diff** / `bpf_l3_csum_replace` / `bpf_l4_csum_replace` for checksums
- Inline `VlanHdr` / `Ipv6Hdr` parsing
- `bpf_loop` for iterating large rule sets (kernel 5.17+)
- TCP flags matching (`match/mask` notation), ICMP type/code filtering
- MAC address matching (L2), DSCP classification
- IP set maps for aliases and overload blacklist
- Per-source state counters for connection limit enforcement
- **Reject action** via `XDP_TX` — forges TCP RST (IPv4/IPv6) or ICMP/ICMPv6 Destination Unreachable and transmits back to sender using `bpf_xdp_adjust_tail`

## XDP Rate Limiter (xdp-ratelimit)

- **LPM Trie** maps for per-country rate limit tiers (`RL_LPM_SRC_V4/V6` → `RL_TIER_CONFIG`). Lookup runs before per-IP matching — if a source IP falls within a country tier's CIDR range, the tier config is used
- **PerCPU Hash** maps for lock-free per-IP counters
- **bpf_timer** for periodic bucket expiration
- **XDP SYN cookies** — forges SYN+ACK with FNV-1a cookie (4-tuple + minute counter + 32-byte secret from `SYNCOOKIE_SECRET` map) via `XDP_TX`, validates ACK with dual-window check; replaces `bpf_tcp_gen_syncookie`
- **bpf_xdp_adjust_tail** for packet resizing during SYN+ACK forging
- **bpf_ktime_get_boot_ns** for suspend-aware timestamps
- 5 algorithms: token bucket, fixed window, sliding window, leaky bucket, SYN cookie

### DDoS Protections (within xdp-ratelimit)

The xdp-ratelimit program also hosts DDoS-specific protections:

- **SYN protection (SYN cookies)** — forges SYN+ACK responses with cryptographic cookies via `XDP_TX` instead of dropping SYNs; ACK validation checks cookie against current and previous minute windows
- **ICMP protection** — rate limiting + oversized payload detection (potential tunneling)
- **UDP amplification protection** — per-source-per-port rate limiting on configurable amplification ports (DNS/53, NTP/123, SSDP/1900, etc.)
- **TCP connection tracking** — half-open connection monitoring, RST/FIN/ACK flood detection with per-source thresholds
- **17-slot PerCpuArray** metrics: SYN_RECEIVED, SYN_FLOOD_DROPS, ICMP_PASSED/DROPPED, AMP_PASSED/DROPPED, OVERSIZED_ICMP, ERRORS, EVENTS_DROPPED, CONN_TRACKED, HALF_OPEN_DROPS, RST/FIN/ACK_FLOOD_DROPS, SYNCOOKIE_SENT, SYNCOOKIE_VALID, SYNCOOKIE_INVALID

## XDP Load Balancer (xdp-loadbalancer)

- **Service map** lookup by `(port, protocol)` to find service definitions
- **Backend selection** via per-service round-robin index in eBPF map
- **DNAT packet rewriting**: destination IP/port rewrite for selected backend
- **MAC address swap**: swaps source/destination MACs after DNAT for correct L2 routing
- **IPv4 checksum**: L3 IP header + L4 TCP/UDP incremental update
- **IPv6 checksum**: L4 pseudo-header incremental update (8 × u16 words for 128-bit address diff + port diff)
- **RingBuf events**: `EVENT_TYPE_LB` with `LB_ACTION_FORWARD` or `LB_ACTION_NO_BACKEND`
- **LB_METRICS PerCpuArray**: per-CPU forwarding counters read by `MetricsReader`
- Health-aware: unhealthy backends are skipped in selection

## TC IDS (tc-ids)

- **bpf_get_prandom_u32** for kernel-side sampling
- **bpf_strncmp** for L7 protocol signature detection (HTTP, TLS, SSH)
- **bpf_ringbuf_query** for adaptive backpressure (skip at >75% fill)
- Port-only key for IP-version-agnostic matching

## TC Threat Intel (tc-threatintel)

- **BPF_MAP_TYPE_BLOOM_FILTER** for fast IOC pre-check (no false negatives)
- **BPF_MAP_TYPE_LRU_HASH** for IOC confirmation maps (`THREATINTEL_IOCS`, `THREATINTEL_IOCS_V6`) — LRU eviction keeps maps within capacity
- **bpf_skb_vlan_push/pop** for VLAN quarantine tagging
- Separate V6 maps for IPv6 IOC lookups
- RingBuf backpressure

## TC Connection Tracking (tc-conntrack)

- Unified TCP state machine for both IPv4 and IPv6 (SYN_SENT → SYN_RECV → ESTABLISHED → FIN_WAIT → TIME_WAIT)
- Per-connection packet and byte counters for volume-based analysis
- UDP bidirectional detection (NEW → ESTABLISHED after reply seen)
- ICMP request/reply state tracking
- Conntrack key normalization (lower IP:port always "src") for bidirectional matching
- Garbage collection for expired connections
- Per-source counter decrement on connection expiry
- `bpf_skb_store_bytes` for packet modification

## TC Scrub (tc-scrub)

Packet normalization running after XDP processing:

- **TTL normalization**: Raise TTL to configured minimum via `bpf_l3_csum_replace`
- **MSS clamping**: Scan TCP SYN options, rewrite if exceeding `max_mss`, update L4 checksum
- **DF bit clearing**: Clear Don't Fragment flag, update L3 checksum
- **IP ID randomization**: Set `ip.id = bpf_get_prandom_u32()`, update L3 checksum
- **TCP flags scrubbing**: Clear reserved/NS/CWR/ECE bits (preserves ECN negotiation on SYN)
- **ECN stripping**: Clear ECN bits in IPv4 TOS and IPv6 Traffic Class
- **TOS normalization**: Force TOS/DSCP to configured value (default 0)
- **TCP timestamp stripping**: Remove TCP timestamp option (kind=8) for anti-fingerprinting
- Configuration via `SCRUB_CONFIG` array map (14-byte `ScrubConfig` struct, expanded from 8 bytes)

## TC NAT Ingress (tc-nat-ingress)

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation (destination rewrite), checked before DNAT rules
- **Hairpin NAT**: detects internal-to-internal DNAT, applies additional SNAT, stores reverse mapping in `NAT_HAIRPIN_CT` LRU map (IPv4 only)
- Destination NAT (DNAT) for incoming packets
- Port mapping and IP rewriting
- `bpf_loop` for NAT rule scanning without hitting verifier loop limits
- L3/L4 checksum updates via `bpf_l3_csum_replace` / `bpf_l4_csum_replace`
- Conntrack integration for stateful NAT

## TC NAT Egress (tc-nat-egress)

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation (source rewrite), checked before SNAT rules
- Source NAT (SNAT) for outgoing packets
- `bpf_loop` for NAT rule scanning without hitting verifier loop limits
- Reverse mapping from conntrack entries
- L3/L4 checksum updates
- Stateful return path matching

## TC DNS (tc-dns)

- UDP port 53 traffic identification
- DNS wire-format packet forwarding to userspace

## TC QoS (tc-qos)

- TC egress classifier for traffic shaping
- Three-level hierarchy: pipes (bandwidth/delay/loss) → queues (WF2Q+ weighted fair) → classifiers (5-tuple + DSCP matching)
- **Token bucket** bandwidth limiting with `bpf_ktime_get_boot_ns` timestamps
- **4-level progressive wildcard** classifier lookup in `QOS_CLASSIFIERS` HashMap
- **Random loss** emulation via `bpf_get_prandom_u32`
- **LRU_PERCPU_HASH** (`QOS_FLOW_STATE`, 65536 entries) for per-flow token bucket state
- **PerCpuArray** metrics: total_seen, shaped, dropped_loss, dropped_queue, delayed, errors, events_dropped
- Scheduler types: fifo, wf2q, fq_codel
- RingBuf backpressure (same 75% pattern)

## Uprobe DLP (uprobe-dlp)

- Attaches to `SSL_write` / `SSL_read` in OpenSSL/BoringSSL
- Captures plaintext before encryption / after decryption
- Forwards to userspace DLP engine via RingBuf

## Kernel Requirements

All features require Linux kernel 6.1+ with BTF. See the [Compatibility](../operations/compatibility.md) page for the full feature-to-kernel-version matrix.

## Build

```bash
cargo xtask ebpf-build    # Builds all 12 programs with nightly
```

See [eBPF Development](../development/ebpf-development.md) for the development workflow.
