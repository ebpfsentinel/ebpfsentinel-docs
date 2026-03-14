# Program Details

Detailed documentation for each of the 12 eBPF kernel programs.

## XDP Programs

### xdp-firewall

**Hook:** [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | **Path:** `crates/ebpf-programs/xdp-firewall/`

The most feature-rich program. Processes every incoming packet through a **5-phase pipeline**:

#### Phase 0 — Conntrack Fast-Path (O(1))

ESTABLISHED and RELATED connections bypass all rule evaluation. The conntrack table is a shared [`LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) map (pinned via BPF filesystem) maintained by `tc-conntrack`.

- Lookup by normalized 5-tuple key
- If state = ESTABLISHED or RELATED → `XDP_PASS` immediately
- Overload check via IP set (index 255) — blocked sources are dropped instantly

#### Phase 1 — LPM Trie (O(log n))

CIDR-only rules are loaded into 4 [`LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/) maps:

| Map | Key | Description |
|-----|-----|-------------|
| `FW_LPM_SRC_V4` | `{prefix_len, IPv4}` | Source IPv4 CIDR |
| `FW_LPM_DST_V4` | `{prefix_len, IPv4}` | Destination IPv4 CIDR |
| `FW_LPM_SRC_V6` | `{prefix_len, IPv6}` | Source IPv6 CIDR |
| `FW_LPM_DST_V6` | `{prefix_len, IPv6}` | Destination IPv6 CIDR |

Rules that only have source/destination CIDR (no port, protocol, or VLAN filter) are matched here, avoiding the linear scan entirely.

#### Phase 2 — Linear Scan

Rules with complex match criteria are evaluated in priority order (lowest priority number wins). Uses [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) (kernel 5.17+) to iterate without hitting the verifier loop limit.

Match fields (all optional — omitted = wildcard):

| Field | Match Logic |
|-------|------------|
| `src_ip` / `dst_ip` | CIDR subnet |
| `src_port` / `dst_port` | Range (e.g., `1024-65535`) or single port |
| `protocol` | Exact: `tcp`, `udp`, `icmp` |
| `vlan_id` | Exact 802.1Q VLAN ID (0 = any) |
| `state` | Conntrack: `new`, `established`, `related`, `invalid` |
| `src_alias` / `dst_alias` | IP set lookup (GeoIP, blocklists) |
| `tcp_flags` | Match/mask notation |
| `icmp_type` / `icmp_code` | Exact match |
| `mac_src` / `mac_dst` | L2 MAC address |
| `dscp` | DSCP classification value |

Maximum **4096 rules** per address family (IPv4/IPv6).

#### Phase 3 — Connection Limits

Per-source and per-rule state limits. If a source exceeds the configured limit, it is added to the overload IP set (blacklist).

#### Phase 4 — Routing Actions

Policy routing via [`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/):
- `route-to` — forward via specific next-hop
- `reply-to` — force reply path
- `dup-to` — duplicate to monitoring (via [`DEVMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_DEVMAP/) + [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/))

MTU validated with [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) before any redirect.

#### Reject Action (XDP_TX)

When a rule has `action: reject`, the firewall forges a response packet and transmits it back via `XDP_TX`:

- **TCP**: Constructs a TCP RST with correct seq/ack numbers per RFC 793 by swapping addresses/ports and rewriting headers in-place
- **UDP/other IPv4**: Constructs an ICMP Destination Unreachable (type 3, code 3) using [`bpf_xdp_adjust_tail`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_tail/) to resize the packet
- **IPv6 + TCP**: TCP RST with IPv6 headers
- **IPv6 + UDP**: ICMPv6 Destination Unreachable (type 1, code 4)

If packet construction fails, the program silently falls back to `XDP_DROP`.

#### Tail-Call to Rate Limiter

When the firewall passes a packet, it tail-calls into `xdp-ratelimit` via [`PROG_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PROG_ARRAY/) + [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/). This means only one XDP program needs to be attached to the interface.

#### XDP Metadata

Before passing, the firewall writes metadata via [`bpf_xdp_adjust_meta`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_meta/):

| Field | Content |
|-------|---------|
| `rule_id` | ID of the matched firewall rule |
| `flags` | Action flags (log, alert, etc.) |
| `status` | Rate limit result (from tail-call return) |

Downstream TC programs read this metadata without re-parsing packet headers.

---

### xdp-ratelimit

**Hook:** [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) (via tail-call) | **Path:** `crates/ebpf-programs/xdp-ratelimit/`

Per-IP rate limiting and DDoS protection at XDP speed.

#### Rate Limiting Algorithms

5 algorithms, configurable per-rule:

| Algorithm | Map Type | Behavior |
|-----------|----------|----------|
| Token Bucket | [`PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_HASH/) | Steady rate with burst allowance |
| Fixed Window | PERCPU_HASH | Counter resets every interval |
| Sliding Window | PERCPU_HASH | Weighted average of current + previous window |
| Leaky Bucket | PERCPU_HASH | Constant drain rate, queued excess |
| SYN Cookie | — | XDP SYN cookie forging via `XDP_TX` (see below) |

Per-CPU maps eliminate lock contention: each CPU core maintains independent counters, aggregated at read time.

#### DDoS Protections

| Protection | Mechanism |
|-----------|-----------|
| **SYN flood** | SYN cookie forging — forges SYN+ACK with FNV-1a cookie via `XDP_TX`, validates ACK with dual-window check |
| **ICMP flood** | Rate limiting + oversized payload detection (potential tunneling indicator) |
| **UDP amplification** | Per-source-per-port rate limiting on amplification ports (DNS/53, NTP/123, SSDP/1900, etc.) |
| **TCP connection floods** | Half-open connection monitoring, RST/FIN/ACK flood detection |

#### SYN Cookie Forging

When SYN protection is active, incoming SYN packets are answered with a forged SYN+ACK transmitted back via `XDP_TX` instead of being dropped:

1. **Cookie generation**: FNV-1a hash over the 4-tuple (src IP, dst IP, src port, dst port), a minute-granularity time counter, and a 32-byte secret from the `SYNCOOKIE_SECRET` Array map. MSS is encoded as a 3-bit index (8 standard MSS values) in the cookie.
2. **SYN+ACK forging**: The original SYN packet is rewritten in-place — Ethernet MACs swapped, IP src/dst swapped, TCP ports swapped, SYN+ACK flags set, `seq_num` set to the cookie value. [`bpf_xdp_adjust_tail`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_tail/) is used to trim any payload. Checksums are recomputed.
3. **ACK validation**: When a completing ACK arrives, `ack_no - 1` is checked against cookies computed for both the current and previous minute windows (handles clock boundary). Valid ACKs pass through; invalid ones are dropped.
4. **Fallback**: If forging fails, the packet is silently dropped (`XDP_DROP`).

The `SYNCOOKIE_SECRET` map is a 1-entry Array map holding a 32-byte random secret generated at agent startup.

#### Per-Country Rate Limit Tiers (LPM)

3 additional maps for country-based rate limiting:

| Map | Type | Purpose |
|-----|------|---------|
| `RL_LPM_SRC_V4` | LPM Trie (131,072 entries) | Source IPv4 → tier_id lookup |
| `RL_LPM_SRC_V6` | LPM Trie (131,072 entries) | Source IPv6 → tier_id lookup |
| `RL_TIER_CONFIG` | Array (16 entries) | tier_id → `RateLimitConfig` (rate, burst, algorithm) |

The LPM lookup runs **before** per-IP rule matching. If a source IP falls within a country tier's CIDR range, the tier's `RateLimitConfig` is applied instead of the per-IP or default config. Country CIDRs are loaded from the GeoIP database at startup and config reload.

#### Kernel-Side Timer

[`bpf_timer`](https://docs.ebpf.io/linux/helper-function/bpf_timer_init/) (kernel 5.15+) runs periodic maintenance directly in the kernel:
- Expires stale rate limit buckets
- Cleans up DDoS tracking state
- No userspace intervention needed for housekeeping

Timestamps use [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) — monotonic and suspend-aware (accurate after sleep/hibernate).

---

### xdp-loadbalancer

**Hook:** [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | **Path:** `crates/ebpf-programs/xdp-loadbalancer/`

L4 load balancing at XDP speed. Rewrites destination IP/port to the selected backend before the kernel allocates an SKB.

| Feature | Description |
|---------|-------------|
| **Service lookup** | Maps incoming `(port, protocol)` to a service definition |
| **Backend selection** | Per-service round-robin index stored in eBPF map, updated per packet |
| **MAC address swap** | Swaps source and destination MAC addresses after DNAT rewrite so the packet is routed correctly at L2 |
| **Packet rewriting** | Destination IP/port rewrite with L3/L4 checksum fixup |
| **Health awareness** | Backends marked unhealthy by userspace are skipped |
| **Event emission** | RingBuf events for forward/no-backend actions |
| **Per-CPU metrics** | `LB_METRICS` PerCpuArray for high-frequency counters |

Supports TCP, UDP, and TLS passthrough (TLS is forwarded without termination). IPv4 and IPv6 packets are both handled with appropriate checksum strategies:

- **IPv4**: L3 IP header checksum + L4 TCP/UDP checksum (incremental update for address + port diff)
- **IPv6**: L4 pseudo-header checksum only (8 × u16 words for 128-bit address diff + port diff, no IP header checksum in IPv6)

---

## TC Programs

### tc-conntrack

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-conntrack/`

Full stateful connection tracking with a 9-state TCP state machine. Uses a unified state machine for both IPv4 and IPv6, with `ConnValue` / `ConnValueV6` value types (the V6 variant carries 128-bit NAT addresses). Tracks both packet and byte counters per connection.

```
SYN_SENT → SYN_RECV → ESTABLISHED → FIN_WAIT → CLOSE_WAIT → TIME_WAIT → [expired]
```

| Protocol | States | Behavior |
|----------|--------|----------|
| TCP | 9 states | Full state machine with timeout per-state |
| UDP | 2 states | NEW → ESTABLISHED (after bidirectional traffic seen) |
| ICMP | 2 states | Request → Reply tracking |

Key design decisions:
- **Unified state machine**: a single TCP state machine implementation handles both IPv4 and IPv6, reducing code duplication and maintenance burden
- **Byte counters**: each connection tracks both packet count and byte count, enabling volume-based analysis
- **Normalized keys**: lower IP:port is always "source" — one entry covers both directions
- **[`LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) map**: automatic eviction when table is full, no GC pauses
- **Shared map** (BPF filesystem pinning): written by tc-conntrack, read by xdp-firewall for fast-path lookup
- **[`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/)**: unique per-connection ID for flow correlation
- **[`bpf_sk_lookup_tcp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_tcp/)** / **[`bpf_sk_lookup_udp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_udp/)**: socket lookup for process attribution

---

### tc-scrub

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-scrub/`

Packet normalization running after XDP. Configuration via `SCRUB_CONFIG` [`PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/) map.

| Normalization | Helper | Metric Index | Description |
|--------------|--------|-------------|-------------|
| TTL normalization | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 0 | Raise TTL to configured minimum (IPv4) |
| Hop limit normalization | direct byte write | 0 | Raise hop limit to configured minimum (IPv6, no header checksum) |
| MSS clamping | [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 1 | Scan TCP SYN options, rewrite if exceeding max_mss (IPv4/IPv6) |
| DF bit clearing | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | — | Clear Don't Fragment flag (IPv4 only) |
| IP ID randomization | [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | — | Set `ip.id` to random value (IPv4 only, prevents fingerprinting) |
| TCP flags scrubbing | direct byte write + [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 2 | Clear TCP reserved/NS/CWR/ECE bits (preserves ECN negotiation on SYN) |
| ECN stripping | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 3 | Clear ECN bits in IPv4 TOS and IPv6 Traffic Class |
| TOS normalization | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4 | Force TOS/DSCP to configured value (default 0) |
| TCP timestamp stripping | [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 5 | Remove TCP timestamp option (kind=8) for anti-fingerprinting |

> **Note:** `reassemble_fragments` was removed — fragment reassembly is infeasible within eBPF program constraints.

---

### tc-nat-ingress

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-nat-ingress/`

Destination NAT for incoming packets (IPv4 and IPv6):

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation — rewrites destination prefix from `external_prefix` to `internal_prefix` using `NPTV6_RULES` and `NPTV6_RULE_COUNT` maps. Checked **before** stateful DNAT rules. Checksum-neutral via pre-computed adjustment word.
- **Hairpin NAT**: detects when a DNAT target and source are in the same internal subnet. Applies additional SNAT (source → `hairpin_snat_ip`) and stores reverse mapping in `NAT_HAIRPIN_CT` LRU map. Return path reverses both translations. Configured via `NAT_HAIRPIN_CONFIG` map. IPv4 only.
- **DNAT**: rewrite destination IP/port for port forwarding and 1:1 NAT
- **Redirect**: rewrite destination to local address
- **Rule scanning via [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/)**: iterates over NAT rules without hitting the verifier loop limit (same approach as the firewall linear scan)
- Packet rewriting via [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/)
- IPv4: checksum updates via [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) + [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/)
- IPv6: L4 pseudo-header checksum update only (4-word loop, no IP header checksum in IPv6)
- `NatRuleEntryV6` with `[u32; 4]` address/mask fields for IPv6 rule matching
- Conntrack integration: writes NAT mapping for stateful return path

---

### tc-nat-egress

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (egress) | **Path:** `crates/ebpf-programs/tc-nat-egress/`

Source NAT for outgoing packets (IPv4 and IPv6):

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation — rewrites source prefix from `internal_prefix` to `external_prefix` using `NPTV6_RULES` and `NPTV6_RULE_COUNT` maps. Checked **before** stateful SNAT rules. Checksum-neutral via pre-computed adjustment word.
- **SNAT**: static source IP rewrite
- **Masquerade**: dynamic source rewrite to outgoing interface address
- **Port allocation**: hash-based ephemeral port selection (IPv6 uses XOR-fold of `[u32; 4]` to `u32`)
- **Rule scanning via [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/)**: iterates over NAT rules without hitting the verifier loop limit
- Reverse mapping lookup from conntrack entries
- Same checksum strategy as tc-nat-ingress (L3+L4 for IPv4, L4-only for IPv6)

---

### tc-ids

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-ids/`

Kernel-side intrusion detection with sampling and L7 protocol awareness.

| Feature | Helper | Description |
|---------|--------|-------------|
| Random sampling | [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | Sample N% of packets to reduce userspace load |
| L7 detection | [`bpf_strncmp`](https://docs.ebpf.io/linux/helper-function/bpf_strncmp/) | Match protocol signatures: `GET ` / `POST ` (HTTP), `\x16\x03` (TLS), `SSH-` (SSH) |
| Backpressure | [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | Skip emission when ring buffer >75% full |

Uses a **port-only key** for IDS rule matching — IP-version-agnostic (same rules apply to IPv4 and IPv6 traffic).

---

### tc-threatintel

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-threatintel/`

Threat intelligence IOC matching with two-phase lookup:

1. **[Bloom filter](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/) pre-check** — O(1), no false negatives. If negative → packet is clean, skip.
2. **[LRU hash map](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) confirmation** — only on Bloom filter positive. Confirms the IOC and retrieves metadata. LRU eviction ensures the map stays within capacity.

VLAN quarantine: matched IOCs can trigger [`bpf_skb_vlan_push`](https://docs.ebpf.io/linux/helper-function/bpf_skb_vlan_push/) to tag the packet with a quarantine VLAN ID, isolating the source without dropping traffic.

Separate V6 maps for IPv6 IOC lookups. Same RingBuf backpressure pattern as tc-ids.

---

### tc-dns

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-dns/`

Passive DNS capture:
- Identifies UDP port 53 traffic
- Forwards raw DNS wire-format packets to userspace via RingBuf
- Userspace DNS engine parses, caches domain↔IP mappings, and checks blocklists

---

### tc-qos

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (egress) | **Path:** `crates/ebpf-programs/tc-qos/`

QoS traffic shaping on the egress path. Implements a three-level pipe/queue/classifier hierarchy for bandwidth limiting, delay emulation, and packet loss simulation.

#### Maps

| Map | Type | Max Entries | Description |
|-----|------|-------------|-------------|
| `QOS_PIPE_CONFIG` | [`ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/) | 64 | Pipe definitions (bandwidth_bps, burst_bytes, delay_ms, loss_percent, scheduler) |
| `QOS_QUEUE_CONFIG` | [`ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/) | 256 | Queue definitions (pipe_id, weight) |
| `QOS_CLASSIFIERS` | [`HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/) | 1024 | 5-tuple + DSCP classifier rules → queue_id |
| `QOS_FLOW_STATE` | [`LRU_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_PERCPU_HASH/) | 65536 | Per-flow token bucket state (tokens, last_refill_ns) |
| `QOS_METRICS` | [`PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/) | 7 | Per-CPU shaping counters (total_seen, shaped, dropped_loss, dropped_queue, delayed, errors, events_dropped) |
| `EVENTS` | [`RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/) | 1 MB | QoS events emitted to userspace |

#### Processing Pipeline

1. **Parse** — Extract L3/L4 headers (IPv4/IPv6, TCP/UDP), read DSCP from IP header
2. **Classify** — 4-level progressive wildcard lookup in `QOS_CLASSIFIERS`:
   - Level 1: full 5-tuple + DSCP (exact match)
   - Level 2: wildcard ports (src_port=0, dst_port=0)
   - Level 3: wildcard source IP (src_ip=0)
   - Level 4: wildcard all fields (default classifier)
   First match determines the target queue and its parent pipe.
3. **Token bucket** — Look up flow state in `QOS_FLOW_STATE`. Refill tokens based on elapsed time since last packet ([`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/)). If tokens >= packet size, deduct and pass. Otherwise drop (`TC_ACT_SHOT`).
4. **Loss** — If pipe has `loss_percent > 0`, call [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) and drop with the configured probability.
5. **Delay** — If pipe has `delay_ms > 0`, record delay metadata for userspace scheduling.
6. **Emit** — Send `QosEvent` to `EVENTS` RingBuf with shaping decision. Same 75% backpressure pattern as other programs.

---

## Uprobe Programs

### uprobe-dlp

**Hook:** [uprobe](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_KPROBE/) | **Path:** `crates/ebpf-programs/uprobe-dlp/`

Data Loss Prevention via SSL/TLS interception:
- Attaches to `SSL_write` and `SSL_read` in OpenSSL/BoringSSL
- Captures plaintext **before** encryption (write) and **after** decryption (read)
- Forwards captured content to userspace DLP engine via RingBuf
- Userspace engine runs pattern matching (credit card, SSN, API keys, JWT, etc.)

This is the only program that operates at the application layer — all others work at L3/L4.
