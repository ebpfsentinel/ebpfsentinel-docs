# Program Details

Detailed documentation for each of the 11 eBPF kernel programs.

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
| SYN Cookie | — | [`bpf_tcp_gen_syncookie`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_gen_syncookie/) for stateless SYN flood protection |

Per-CPU maps eliminate lock contention: each CPU core maintains independent counters, aggregated at read time.

#### DDoS Protections

| Protection | Mechanism |
|-----------|-----------|
| **SYN flood** | Per-source SYN rate tracking, configurable PPS threshold, SYN cookie fallback |
| **ICMP flood** | Rate limiting + oversized payload detection (potential tunneling indicator) |
| **UDP amplification** | Per-source-per-port rate limiting on amplification ports (DNS/53, NTP/123, SSDP/1900, etc.) |
| **TCP connection floods** | Half-open connection monitoring, RST/FIN/ACK flood detection |

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
| **Backend selection** | Round-robin index stored in eBPF map, updated per packet |
| **Packet rewriting** | Destination IP/port rewrite with L3/L4 checksum fixup |
| **Health awareness** | Backends marked unhealthy by userspace are skipped |

Supports TCP, UDP, and TLS passthrough (TLS is forwarded without termination). IPv4 and IPv6 packets are both handled with appropriate checksum strategies.

---

## TC Programs

### tc-conntrack

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-conntrack/`

Full stateful connection tracking with a 9-state TCP state machine. Supports both IPv4 (`ConnValue`) and IPv6 (`ConnValueV6` with 128-bit NAT addresses):

```
SYN_SENT → SYN_RECV → ESTABLISHED → FIN_WAIT → CLOSE_WAIT → TIME_WAIT → [expired]
```

| Protocol | States | Behavior |
|----------|--------|----------|
| TCP | 9 states | Full state machine with timeout per-state |
| UDP | 2 states | NEW → ESTABLISHED (after bidirectional traffic seen) |
| ICMP | 2 states | Request → Reply tracking |

Key design decisions:
- **Normalized keys**: lower IP:port is always "source" — one entry covers both directions
- **[`LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) map**: automatic eviction when table is full, no GC pauses
- **Shared map** (BPF filesystem pinning): written by tc-conntrack, read by xdp-firewall for fast-path lookup
- **[`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/)**: unique per-connection ID for flow correlation
- **[`bpf_sk_lookup_tcp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_tcp/)** / **[`bpf_sk_lookup_udp`](https://docs.ebpf.io/linux/helper-function/bpf_sk_lookup_udp/)**: socket lookup for process attribution

---

### tc-scrub

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-scrub/`

Packet normalization running after XDP. Configuration via `SCRUB_CONFIG` [`PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/) map.

| Normalization | Helper | Description |
|--------------|--------|-------------|
| TTL normalization | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | Raise TTL to configured minimum (IPv4) |
| Hop limit normalization | direct byte write | Raise hop limit to configured minimum (IPv6, no header checksum) |
| MSS clamping | [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | Scan TCP SYN options, rewrite if exceeding max_mss (IPv4/IPv6) |
| DF bit clearing | [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | Clear Don't Fragment flag (IPv4 only) |
| IP ID randomization | [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | Set `ip.id` to random value (IPv4 only, prevents fingerprinting) |

---

### tc-nat-ingress

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-nat-ingress/`

Destination NAT for incoming packets (IPv4 and IPv6):

- **DNAT**: rewrite destination IP/port for port forwarding and 1:1 NAT
- **Redirect**: rewrite destination to local address
- Packet rewriting via [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/)
- IPv4: checksum updates via [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) + [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/)
- IPv6: L4 pseudo-header checksum update only (4-word loop, no IP header checksum in IPv6)
- `NatRuleEntryV6` with `[u32; 4]` address/mask fields for IPv6 rule matching
- Conntrack integration: writes NAT mapping for stateful return path

---

### tc-nat-egress

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (egress) | **Path:** `crates/ebpf-programs/tc-nat-egress/`

Source NAT for outgoing packets (IPv4 and IPv6):

- **SNAT**: static source IP rewrite
- **Masquerade**: dynamic source rewrite to outgoing interface address
- **Port allocation**: hash-based ephemeral port selection (IPv6 uses XOR-fold of `[u32; 4]` to `u32`)
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
2. **Hash map confirmation** — only on Bloom filter positive. Confirms the IOC and retrieves metadata.

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

## Uprobe Programs

### uprobe-dlp

**Hook:** [uprobe](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_KPROBE/) | **Path:** `crates/ebpf-programs/uprobe-dlp/`

Data Loss Prevention via SSL/TLS interception:
- Attaches to `SSL_write` and `SSL_read` in OpenSSL/BoringSSL
- Captures plaintext **before** encryption (write) and **after** decryption (read)
- Forwards captured content to userspace DLP engine via RingBuf
- Userspace engine runs pattern matching (credit card, SSN, API keys, JWT, etc.)

This is the only program that operates at the application layer — all others work at L3/L4.
