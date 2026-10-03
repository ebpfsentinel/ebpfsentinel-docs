# Program Details

Detailed documentation for each of the 16 eBPF kernel programs (the
tail-call helpers `xdp-firewall-reject` and `xdp-ratelimit-syncookie` are
described inline under their parent programs).

## XDP Programs

### xdp-firewall

**Hook:** [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | **Path:** `crates/ebpf-programs/xdp-firewall/`

The most feature-rich program. Every IPv4 and IPv6 packet goes through the
same ordered checks in `process_firewall_v4` / `process_firewall_v6`; the first
rule that matches decides.

#### Overload Set and Conntrack State

Two lookups happen before any rule is read:

- **Overload set.** A source that exceeded a connection limit sits in the IP
  set `FW_IPSET_V4` under set id 255. Such a source is dropped at once, unless
  its overload TTL has run out, in which case the entry is removed and the packet
  carries on. The probe is skipped entirely while no rule declares a limit.
- **Kernel conntrack.** `bpf_xdp_ct_lookup` asks **kernel netfilter** for the
  flow; there is no BPF-side connection table. `nf_conn->status` is read with
  `bpf_probe_read_kernel` at offsets resolved from the running kernel's BTF
  (`CT_NF_CONN_OFFSETS`): `IPS_CONFIRMED`/`IPS_SEEN_REPLY` give ESTABLISHED,
  `IPS_EXPECTED` gives RELATED, `IPS_DYING` gives INVALID, nothing gives NEW.

The state does **not** skip rule evaluation. It is matched by rules carrying a
`state` filter, and an ESTABLISHED or RELATED flow that no rule matched is
passed instead of falling to the default policy. Because the rules are still
read for live flows, a `deny` added while a connection is open drops it on its
next packet, and `kill_flow_via_xdp_ct` marks the kernel entry DYING so the
flow does not come back through conntrack.

#### Rule Lookup, Fastest First

| Order | Map | Complexity | Matches |
|-------|-----|-----------|---------|
| 1 | `FW_LPM_SRC_V4/V6`, then `FW_LPM_DST_V4/V6` ([`LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/), 131,072 entries each) | O(log n) | Rules that are only a source or only a destination CIDR |
| 2 | `FW_HASH_5TUPLE` (HashMap, 65,536) | O(1) | Exact 5-tuple |
| 3 | `FW_HASH_PORT` (HashMap, 16,384) | O(1) | Destination port + protocol |
| 4 | `FIREWALL_RULES` / `FIREWALL_RULES_V6` (Array, 4096) + `bpf_loop` | O(n) | Every other rule |

Userspace places each rule in the cheapest map able to express it, so only
rules combining several criteria reach the scan. A rule scoped to a tenant or
an interface group, or carrying a state ceiling or a DSCP mark, goes to the
scan whatever its criteria, because the LPM and hash levels answer with an
action and no rule to read the rest from. The scan uses
[`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) (kernel 5.17+),
so the verifier checks the callback body once whatever the rule count.

Match fields (all optional - omitted = wildcard):

| Field | Match Logic |
|-------|------------|
| `src_ip` / `dst_ip` | CIDR subnet |
| `src_port` / `dst_port` | Range (e.g., `1024-65535`) or single port |
| `protocol` | Exact: `tcp`, `udp`, `icmp` |
| `vlan_id` | 802.1Q VLAN ID: `0xFFFF` any, 0 untagged only, 1-4094 exact |
| `state` | Conntrack: `new`, `established`, `related`, `invalid` |
| `src_alias` / `dst_alias` | IP set lookup (GeoIP, blocklists) |
| `tcp_flags` | Match/mask notation |
| `icmp_type` / `icmp_code` | Exact match |
| `src_mac` / `dst_mac` | L2 MAC address |
| `dscp` | DSCP value of the packet |

Maximum **4096 scanned rules** per address family (IPv4/IPv6); the LPM and hash levels hold more.

Each rule carries a `group_mask` field for **interface group filtering**. Before evaluating a rule, the program looks up the current ifindex in the `INTERFACE_GROUPS` map and checks the bitmask. Rules with `group_mask == 0` are floating (apply everywhere). See [Interface Groups](../features/interface-groups.md).

#### Connection Limits

A `pass` or `log` rule on a NEW flow checks its per-source limits
(`check_connection_limits`, counters in `CT_SRC_COUNTERS`). A source over the
limit is refused, flagged overloaded and inserted into the overload set above,
where it stays until the configured TTL runs out.

#### DSCP Marking

A `pass` or `log` rule carrying `dscp_mark` rewrites the packet's DSCP before
the packet goes on, keeping the two ECN bits. On IPv4 the TOS byte is written
and the header checksum is patched incrementally over the one 16-bit word that
holds it; on IPv6 the traffic class is written across the first two bytes and
the flow label is left alone. The transport checksums cover neither field, so
they stay valid. The mark is read off the matched rule by its index, so
userspace never puts a marking rule in the LPM or hash levels: it always goes
through the scan. `deny`, `reject` and a packet refused by a connection limit
are not marked.

#### Zone Resolution

At ingress the destination zone belongs to whichever interface the packet would
leave by, so the program asks the kernel FIB with
[`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/)
in `BPF_FIB_LOOKUP_DIRECT` mode and maps the answer to a zone. A route that
cannot be resolved falls back to the zone's own posture. This is the only use
of the FIB here: a rule carries no per-rule routing action, and the egress
gateway is picked by the [`routing`](../features/routing.md) section instead.

MTU validated with [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) before any redirect or pass. Packets exceeding the interface MTU are dropped and the `mtu_exceeded` metric is incremented.

#### Reject Action (Tail-Call to xdp-firewall-reject)

When a rule has `action: reject`, the firewall returns a sentinel value (`0xFF`) to the entry point, which tail-calls into `xdp-firewall-reject` via `PROG_ARRAY` slot 1. The reject program runs with its own fresh 512-byte stack:

- **TCP**: Constructs a TCP RST with correct seq/ack numbers per RFC 793
- **UDP/other IPv4**: Constructs an ICMP Destination Unreachable (type 3, code 3)
- **IPv6 + TCP**: TCP RST with IPv6 headers
- **IPv6 + UDP**: ICMPv6 Destination Unreachable (type 1, code 4)

The reject program reads packet context from the shared `PKT_CTX` PerCpuArray map (populated by `process_firewall_v4/v6`), rebuilds the packet at constant offsets (stripping any VLAN tags), and transmits via `XDP_TX`. If the reject program is not loaded, the tail-call silently fails and the packet is dropped (`XDP_DROP`).

Verifier-safe patterns used:
- `copy_mac_asm!` for MAC address swaps (prevents LLVM memcpy outlining)
- `barrier()` after `bpf_xdp_adjust_tail` (prevents pointer hoisting)
- Constant write offsets (14/34/54) for verifier-provable packet writes
- `REJECT_SCRATCH` PerCpuArray for ICMP payload buffers (avoids stack overflow)
- Shared checksum functions from `ebpf_helpers::checksum` with fixed-iteration folds

#### XDP Tail-Call Chain

The firewall entry point dispatches via `XDP_PROG_ARRAY`:

| Slot | Target | Condition |
|------|--------|-----------|
| 0 | `xdp-ratelimit` | On `XDP_PASS` (first attempt) |
| 1 | `xdp-firewall-reject` | On the reject sentinel (`0xFF`); `XDP_DROP` if the slot is empty |
| 2 | `xdp-loadbalancer` | On `XDP_PASS` if the ratelimit slot is empty |
| 3 | `xdp-vip-announcer` | On an ARP frame; `XDP_PASS` if the slot is empty |

When ratelimit is loaded, it continues the chain itself through its own
`RL_PROG_ARRAY` (slot 0 `xdp-ratelimit-syncookie`, slot 1 `xdp-loadbalancer`).
The firewall's slot 2 is the path used when ratelimit is disabled and the load
balancer is enabled.

XDP passes nothing to the TC programs: the TC chain parses once for itself and shares the result through `skb->cb`, see [Pipeline](pipeline.md#one-parse-per-tc-chain).

---

### xdp-ratelimit

**Hook:** XDP (standalone or via tail-call from xdp-firewall) | **Path:** `crates/ebpf-programs/xdp-ratelimit/`

Per-IP rate limiting and DDoS protection at XDP speed.

#### Rate Limiting Algorithms

4 algorithms, configurable per-rule. All 4 share a single consolidated [`LRU_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_PERCPU_HASH/) map (`RL_BUCKETS`, 65,536 entries by default, set with `ratelimit.max_buckets`) using a discriminated union (`RateLimitBucketUnion`, 64 bytes per entry).

| Algorithm | Union Variant | Behavior |
|-----------|---------------|----------|
| Token Bucket | `RateLimitBucketUnion::TokenBucket` | Steady rate with burst allowance |
| Fixed Window | `RateLimitBucketUnion::FixedWindow` | Counter resets every interval |
| Sliding Window | `RateLimitBucketUnion::SlidingWindow` | Weighted average of current + previous window |
| Leaky Bucket | `RateLimitBucketUnion::LeakyBucket` | Constant drain rate, queued excess |

SYN cookie forging is not a fifth algorithm and `algorithm: syn_cookie` is rejected at config load. It is configured under [`ddos.syn_protection`](../features/ddos.md) and runs in the same program, described below.

Per-CPU maps eliminate lock contention: each CPU core maintains independent counters, aggregated at read time.

Rate limit rules carry a `group_mask` field for **interface group filtering** via the `INTERFACE_GROUPS` map. Rules with `group_mask == 0` are floating (apply everywhere). See [Interface Groups](../features/interface-groups.md).

#### DDoS Protections

| Protection | Mechanism |
|-----------|-----------|
| **SYN flood** | SYN cookies computed by the kernel's raw syncookie helpers; the SYN+ACK is forged by `xdp-ratelimit-syncookie` and sent with `XDP_TX` |
| **ICMP flood** | Rate limiting + oversized payload detection (potential tunneling indicator) |
| **UDP amplification** | Per-source-per-port rate limiting on amplification ports (DNS/53, NTP/123, SSDP/1900, etc.) |
| **TCP connection floods** | Half-open connection monitoring, RST/FIN/ACK flood detection |

#### SYN Cookie Forging

When SYN protection is active, a SYN over the threshold is answered with a
forged SYN+ACK instead of reaching the host:

1. **Handoff**: `xdp-ratelimit` records the parsed offsets in the per-CPU
   `SYNCOOKIE_CTX` map and tail-calls `xdp-ratelimit-syncookie` through
   `RL_PROG_ARRAY` slot 0, which gives the forge its own 512-byte stack.
2. **Cookie**: `bpf_tcp_raw_gen_syncookie_ipv4` / `_ipv6` computes the cookie
   with the kernel's own algorithm and secret, so the kernel accepts the ACK
   that comes back. It needs `net.ipv4.tcp_syncookies` enabled.
3. **Forge**: the SYN is rewritten in place (MACs, addresses and ports swapped,
   SYN+ACK flags, the cookie as sequence number, checksums recomputed) and sent
   back with `XDP_TX`. Any failure is `XDP_DROP`.
4. **ACK validation**: the completing ACK is checked in `xdp-ratelimit` with
   `bpf_tcp_raw_check_syncookie_ipv4` / `_ipv6`; a valid one passes, an invalid
   one is dropped.

#### Per-Country Rate Limit Tiers (LPM)

3 additional maps for country-based rate limiting:

| Map | Type | Purpose |
|-----|------|---------|
| `RL_LPM_SRC_V4` | LPM Trie (131,072 entries) | Source IPv4 → tier_id lookup |
| `RL_LPM_SRC_V6` | LPM Trie (131,072 entries) | Source IPv6 → tier_id lookup |
| `RL_TIER_CONFIG` | Array (16 entries) | tier_id → `RateLimitConfig` (rate, burst, algorithm) |

The LPM lookup runs **before** per-IP rule matching. If a source IP falls within a country tier's CIDR range, the tier's `RateLimitConfig` is applied instead of the per-IP or default config. Country CIDRs are loaded from the GeoIP database at startup and config reload.

Bucket refills and window checks read `bpf_ktime_get_coarse_ns`, whose millisecond precision is enough for rate limiting and which costs far less per packet. Event timestamps use [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/), monotonic and suspend-aware.

---

### xdp-loadbalancer

**Hook:** [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | **Path:** `crates/ebpf-programs/xdp-loadbalancer/`

L4 load balancing at XDP speed, before the kernel allocates an SKB.

| Feature | Description |
|---------|-------------|
| **Service lookup** | `LB_SERVICES` (HashMap, 4096 services) holds each service's backend slots, up to 256 per service; `LB_BACKENDS` (HashMap, 65,536) holds the backends themselves |
| **Backend selection** | Round-robin (per-CPU index in `LB_RR_STATE`, 4096), IP hash (the NIC's `xdp_rx_hash` when the driver offers it), weighted, or Maglev (FNV-1a of the source address into the service's prime-sized table in `LB_MAGLEV`) |
| **Health awareness** | The chosen slot is probed linearly until a backend marked healthy by userspace is found |
| **Forwarding** | L2 direct server return when `LB_BACKEND_MAC` holds the backend's MAC: only the Ethernet addresses are rewritten, the VIP stays in the packet and the backend answers the client itself. Otherwise DNAT: destination address and port rewritten, checksums fixed up |
| **Transmit** | DNAT: `bpf_fib_lookup` with neighbour resolution names the next hop towards the backend, and both MACs are rewritten from its answer; the frame leaves with `XDP_TX` when that next hop is on the receiving interface, otherwise through `LB_DEVMAP` (`bpf_redirect_map`) or `bpf_redirect` to the interface the FIB named. A route whose neighbour is not resolved yet is handed to the stack (`XDP_PASS`) so the kernel resolves it; with no route at all the MACs are swapped and the frame goes back to the router it came from. L2 DSR: the destination MAC is the backend's and the source becomes this interface's own |
| **Event emission** | RingBuf events for forward/no-backend actions |
| **Per-CPU metrics** | `LB_METRICS` PerCpuArray for high-frequency counters |

Supports TCP, UDP, and TLS passthrough (TLS is forwarded without termination). On the DNAT path IPv4 and IPv6 use different checksum strategies:

- **IPv4**: L3 IP header checksum + L4 TCP/UDP checksum (incremental update for address + port diff)
- **IPv6**: L4 pseudo-header checksum only (8 × u16 words for 128-bit address diff + port diff, no IP header checksum in IPv6)

---

### xdp-vip-announcer

**Hook:** [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | **Path:** `crates/ebpf-programs/xdp-vip-announcer/`

A bounded XDP ARP responder for load-balancer virtual IPs (VIPs). It is kept off the load-balancer hot path: `xdp-firewall` tail-calls it via `XDP_PROG_ARRAY` slot 3 **only for ARP frames**. When an ARP "who-has" targets an owned VIP and this node is the elected speaker, it forges an ARP reply (`sha` = this node's NIC MAC), rewrites a fixed 28 bytes, and `XDP_TX`s it back out the receiving interface - no loops, no SKB allocation.

| Aspect | Description |
|--------|-------------|
| **Speaker election** | Userspace populates `VIP_SET` **only** while this node is the elected speaker; a standby node keeps an empty set and never answers, so two nodes never claim the same VIP (split-brain safe) |
| **Gratuitous ARP** | On takeover, userspace broadcasts a gratuitous ARP per VIP (raw `AF_PACKET`, not eBPF) so upstream switches relearn the MAC immediately |
| **Metrics** | `ebpfsentinel_lb_vip_arp_replies` (forged replies per VIP) and `ebpfsentinel_lb_vip_takeovers_total` |

Configured via the `loadbalancer.announce` block. See [Load balancer → L2 VIP announcer](../features/loadbalancer.md#l2-vip-announcer).

---

### xdp-pass

**Hook:** [XDP](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_XDP/) | **Path:** `crates/ebpf-programs/xdp-pass/`

A minimal program that returns `XDP_PASS` for every frame. **Test-rig only - never attached in production.** The kernel arms a veth's receive-side XDP path (and so delivers `XDP_TX`'d frames from the peer) only when that end has an XDP program loaded; the integration harness attaches `xdp-pass` on the netns-side veth so the agent's native `XDP_TX` reflections (forged ARP replies, TCP RSTs) reach the probing namespace. On a physical NIC no such helper is needed.

---

## TC Programs

### tc-conntrack

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-conntrack/`

Lightweight kernel netfilter conntrack probe. Parses L3/L4 headers (IPv4/IPv6, TCP/UDP/ICMP) and queries **kernel netfilter** directly via `bpf_skb_ct_lookup` kfunc - no userspace shadow tables, no BPF-side state machine.

| Feature | Mechanism |
|---------|-----------|
| CT lookup | `bpf_skb_ct_lookup` kfunc (kernel 5.18+) |
| Field reading | `bpf_probe_read_kernel` at runtime BTF offsets |
| Fields read | `nf_conn->status`, `nf_conn->mark` |
| Offset resolution | `CT_NF_CONN_OFFSETS` Array map populated at startup from vmlinux BTF |

Key design decisions:
- **Kernel netfilter is the sole CT engine** - no shadow `CT_TABLE_V4/V6` maps, no BPF-side TCP state machine. Kernel manages timeouts, state transitions, and eviction.
- **Runtime BTF offsets**: `nf_conn` field offsets are resolved at agent startup by reading `/sys/kernel/btf/vmlinux` directly and pushed to the `CT_NF_CONN_OFFSETS` map. This bypasses aya's lack of CO-RE support.
- **Userspace coherence**: `/proc/net/nf_conntrack` parsing provides a userspace view of kernel CT state for the REST API and SSE event stream.
- **Metrics**: `CT_METRIC_KFUNC_LOOKUPS`, `CT_METRIC_KFUNC_HITS`, `CT_METRIC_KFUNC_MISSES` track kfunc probe success rate.

---

### tc-scrub

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-scrub/`

Packet normalization running after XDP. Configuration via the `SCRUB_CONFIG` [`ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/) map (one `ScrubFlags` entry); counters in the `SCRUB_METRICS` per-CPU array.

| Normalization | Helper | Metric Index | Description |
|--------------|--------|-------------|-------------|
| TTL normalization | [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) + [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 1 | Raise TTL to configured minimum (IPv4) |
| DF bit clearing | same write as TTL | 3 | Clear Don't Fragment flag (IPv4 only) |
| IP ID randomization | [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/), same write as TTL | 4 | Set `ip.id` to a random value (IPv4 only, prevents fingerprinting) |
| Hop limit normalization | direct store | 6 | Raise hop limit to configured minimum (IPv6, no header checksum) |
| MSS clamping | `bpf_csum_diff` + [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 2 | On a SYN, walk the TCP options with `bpf_loop` and lower an MSS above `max_mss` (IPv4/IPv6) |
| TCP flags scrubbing | `bpf_l4_csum_replace` | 8 | Clear the reserved and NS bits; CWR/ECE are cleared only off a SYN, so ECN negotiation survives |
| ECN stripping | `bpf_l3_csum_replace` (IPv4), Traffic Class write (IPv6) | 9 | Clear the ECN bits |
| TOS normalization | `bpf_l3_csum_replace` (IPv4), Traffic Class write (IPv6) | 10 | Force TOS/DSCP to the configured value (default 0) |
| TCP timestamp stripping | `bpf_csum_diff` + `bpf_l4_csum_replace` | 11 | Replace the timestamp option (kind 8) with NOPs, against fingerprinting |
| Fragment drop | `TC_ACT_SHOT` | 12 | With `drop_fragments`, drop IPv4 fragments |

The TTL, DF and IP ID changes are coalesced into one header write and one checksum update. Index 0 counts packets inspected while scrubbing is enabled, 5 errors, and 7 every packet the program sees.

> **Note:** fragments can be dropped but not reassembled; reassembly does not fit within eBPF program constraints.

---

### tc-nat-ingress

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-nat-ingress/`

Destination NAT for incoming packets (IPv4 and IPv6):

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation - rewrites destination prefix from `external_prefix` to `internal_prefix` using `NPTV6_RULES` and `NPTV6_RULE_COUNT` maps. Checked **before** stateful DNAT rules. Checksum-neutral via pre-computed adjustment word.
- **Hairpin NAT**: detects when a DNAT target and source are in the same internal subnet. Applies additional SNAT (source → `hairpin_snat_ip`) and stores reverse mapping in `NAT_HAIRPIN_CT` LRU map (16,384). Return path reverses both translations. Configured via `NAT_HAIRPIN_CONFIG` map. IPv4 only, and never for a redirect.
- **DNAT**: rewrite destination IP/port for port forwarding
- **1:1 NAT**: rewrite the destination address of a whole mapped address
- **Redirect**: keep the destination address and rewrite the port, so the flow lands on a local socket
- **Rule lookup**: `NAT_DNAT_RULES` / `NAT_DNAT_RULES_V6` (Array, 256 rules each, live count in `NAT_DNAT_RULE_COUNT`) scanned with [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/); first match wins. A rule may also require the packet to have arrived through an IPsec state
- Packet rewriting via [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/)
- IPv4: checksum updates via [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) + [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/)
- IPv6: L4 pseudo-header checksum update only (4-word loop, no IP header checksum in IPv6)
- `NatRuleEntryV6` with `[u32; 4]` address/mask fields for IPv6 rule matching
- **Return path**: each DNAT records the reply tuple in `NAT_DNAT_REVERSE` / `NAT_DNAT_REVERSE_V6` (LRU, 65,536 with `nat.enabled`), which tc-nat-egress reads to rewrite the reply source back to the address and port the client first saw; replies to SNAT flows are looked up here in `NAT_SNAT_REVERSE` / `NAT_SNAT_REVERSE_V6` and their destination rewritten back. Netfilter only sees the translated tuple and tracks it as an ordinary flow
- **Interface groups and tenants**: NAT rules carry a `group_mask` (`INTERFACE_GROUPS` map) and a `tenant_id` (`TENANT_SUBNET_V4/V6`)

---

### tc-nat-egress

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (egress) | **Path:** `crates/ebpf-programs/tc-nat-egress/`

Source NAT for outgoing packets (IPv4 and IPv6):

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation - rewrites source prefix from `internal_prefix` to `external_prefix` using `NPTV6_RULES` and `NPTV6_RULE_COUNT` maps. Checked **before** stateful SNAT rules. Checksum-neutral via pre-computed adjustment word.
- **SNAT**: static source IP rewrite
- **Masquerade**: source rewritten to the outgoing interface's address, which userspace writes into the rule
- **Port allocation**: hash-based ephemeral port selection (IPv6 uses XOR-fold of `[u32; 4]` to `u32`)
- **Rule lookup**: `NAT_SNAT_RULES` / `NAT_SNAT_RULES_V6` (Array, 256 rules each) scanned with `bpf_loop`, the same way as tc-nat-ingress
- **Tunnel steering**: a matched rule can set the XFRM interface metadata and the FOU/GUE encapsulation of the packet
- **Return path**: each SNAT records the reply tuple in `NAT_SNAT_REVERSE` / `NAT_SNAT_REVERSE_V6` (LRU, 65,536 with `nat.enabled`) for tc-nat-ingress to reverse, and replies to DNAT flows are looked up here in `NAT_DNAT_REVERSE` / `NAT_DNAT_REVERSE_V6` and their source rewritten back
- Same checksum strategy as tc-nat-ingress (L3+L4 for IPv4, L4-only for IPv6)
- **Interface groups and tenants**: NAT rules carry a `group_mask` (`INTERFACE_GROUPS` map) and a `tenant_id`

---

### tc-ids

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress, and egress when `inspect_egress` or the resolver is enabled) | **Path:** `crates/ebpf-programs/tc-ids/`

Kernel-side intrusion detection with sampling and L7 protocol awareness.

| Feature | Helper | Description |
|---------|--------|-------------|
| Random sampling | [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | Sample N% of matches against `IDS_SAMPLING_CONFIG`, written from `ids.sampling` in `random` mode; an IPS drop is enforced whatever the draw |
| Packet sizing | [`bpf_dynptr_size`](https://docs.ebpf.io/linux/kfuncs/bpf_dynptr_size/) | Measure the full packet, fragments included, so the payload copy is bounded by what the packet carries |
| Payload copy | [`bpf_skb_load_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_load_bytes/) | Reads across SKB fragments (jumbo frames, GRO aggregates) without linearizing |
| Backpressure | [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | Skip emission when ring buffer >75% full |
| Tiered L7 events | fixed-size reservations | Up to 512 bytes of TCP payload go into `L7EventSmall` (608 bytes), more into `L7EventBuf` (2144 bytes, up to 2048 payload bytes) |
| Mirroring | [`bpf_clone_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_clone_redirect/) | Copy matched traffic to the interface named in `IDS_MIRROR_CONFIG` |
| Cgroup attribution | `bpf_skb_cgroup_id` | On egress, tag the event with the sending container's cgroup, mapped to a tenant through `TENANT_CGROUP_MAP` |

Rules are keyed by **tenant, destination port and protocol** in `IDS_PATTERNS`, with a second map `IDS_SRC_PATTERNS` for source-port rules; the tenant's key is tried first, then the global one (tenant 0). The key carries no address, so the same rules apply to IPv4 and IPv6. `L7_PORTS` names the ports whose payload is captured for L7 inspection.

IDS rules carry a `group_mask` field for **interface group filtering** via the `INTERFACE_GROUPS` map. Rules with `group_mask == 0` are floating (apply everywhere). See [Interface Groups](../features/interface-groups.md).

---

### tc-threatintel

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-threatintel/`

Threat intelligence IOC matching with two-phase lookup:

1. **[Bloom filter](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/) pre-check** - O(1), no false negatives. If negative → packet is clean, skip.
2. **[LRU hash map](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) confirmation** - only on Bloom filter positive. Confirms the IOC and retrieves metadata. LRU eviction ensures the map stays within capacity.

A match is either alerted or dropped, per the matched IOC's action. VLAN and QinQ tags are parsed and carried onto the emitted event so a match is attributable to the VLAN it arrived on; no tag is pushed, popped or rewritten.

Separate V6 maps for IPv6 IOC lookups. Same RingBuf backpressure pattern as tc-ids.

---

### tc-dns

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress) | **Path:** `crates/ebpf-programs/tc-dns/`

Passive DNS capture:
- Identifies UDP and TCP port 53 traffic (queries and responses)
- Reads the DNS payload, up to 512 bytes, with `bpf_skb_load_bytes`, which reads across SKB fragments without linearizing; the length is the full SKB length (`ctx.len()`) minus the DNS offset
- Tiered events: up to 128 bytes of payload in a small record, more in the 512-byte one
- DNS events delivered to userspace via `RingBuf` (`DNS_EVENTS`, 256 KB)
- Userspace DNS engine parses, caches domain↔IP mappings, and checks blocklists

---

### tc-qos

**Hook:** [TC classifier](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_SCHED_CLS/) (ingress and egress) | **Path:** `crates/ebpf-programs/tc-qos/`

QoS traffic shaping. The program sits on both hooks; a pipe shapes one direction unless it declares both, so forwarded traffic is not charged twice. Implements a three-level pipe/queue/classifier hierarchy for bandwidth limiting, delay emulation, and packet loss simulation.

#### Maps

| Map | Type | Max Entries | Description |
|-----|------|-------------|-------------|
| `QOS_PIPE_CONFIG` | [`ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/) | 64 | Pipe definitions (ns_per_byte, burst_bytes, delay_ns, loss_rate in basis points, direction, group_mask, tenant_id) |
| `QOS_QUEUE_CONFIG` | [`ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/) | 256 | Queue definitions (pipe_id, enabled); a queue only names the pipe that shapes it |
| `QOS_CLASSIFIERS` | [`HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/) | 1024 | 5-tuple + DSCP classifier rules → queue_id |
| `QOS_PIPE_STATE` | [`ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/) | 64 | Token bucket per pipe (tokens, last refill) |
| `QOS_FLOW_STATE` | [`LRU_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_PERCPU_HASH/) | 65536 | Per-flow departure time for delay pacing |
| `QOS_METRICS` | [`PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/) | 7 | Per-CPU shaping counters (total_seen, shaped, dropped_loss, dropped_queue, delayed, errors, events_dropped) |
| `EVENTS` | [`RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/) | 1 MB | QoS events emitted to userspace |

#### Processing Pipeline

1. **Parse** - Extract L3/L4 headers (IPv4/IPv6, TCP/UDP), read DSCP from IP header. IPv6 addresses are XOR-folded to 32 bits for the classifier key.
2. **Classify** - progressive wildcard lookups in `QOS_CLASSIFIERS`, first against classifiers naming the packet's VLAN, then against VLAN-agnostic ones. A classifier leaves a field open by holding zero there; within a scope the ladder goes from most specific to least:
   - exact 5-tuple; hosts with any source port; hosts with any ports; ports with any hosts; destination port only; source port only
   - that ladder is tried first at the packet's DSCP, then with the DSCP left open
   - then DSCP-only rules, protocol-wide rules, and the catch-all
   Shapes no classifier uses are skipped. First match determines the target queue and its parent pipe; no match passes the packet.
3. **Group and tenant** - the classifier and the pipe must both apply to this interface and tenant, otherwise the packet passes.
4. **Loss** - If the pipe has a loss rate, call [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) and drop with the configured probability.
5. **Token bucket** - Refill the pipe's bucket in `QOS_PIPE_STATE` from the time elapsed ([`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/)). If tokens >= packet size, deduct and pass, marking the packet ECN CE with `bpf_skb_ecn_set_ce` once the bucket is below 25% of its burst. Otherwise drop (`TC_ACT_SHOT`).
6. **Delay** - If the pipe has a delay, set the packet's earliest departure time with `bpf_skb_set_tstamp` to `max(now + delay, previous departure)` per flow (`QOS_FLOW_STATE`), `now` read from [`bpf_ktime_get_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_ns/) because the delivery time is `CLOCK_MONOTONIC`. The `fq` qdisc on the interface honours it; without `fq` the delay is not applied.
7. **Emit** - Send a `PacketEvent` to the `EVENTS` RingBuf on a drop or a shaped packet. Same 75% backpressure pattern as other programs.

QoS pipes and classifiers carry a `group_mask` field for **interface group filtering** via the `INTERFACE_GROUPS` map. Rules with `group_mask == 0` are floating (apply everywhere). See [Interface Groups](../features/interface-groups.md).

---

## Uprobe Programs

### uprobe-dlp

**Hook:** [uprobe and kprobe](https://docs.ebpf.io/linux/program-type/BPF_PROG_TYPE_KPROBE/) | **Path:** `crates/ebpf-programs/uprobe-dlp/`

Data Loss Prevention via SSL/TLS interception. One object carries nine programs in three sets:

- **C TLS libraries** (`ssl_write`, `ssl_read_entry`, `ssl_read_ret`): `SSL_write` (entry) and `SSL_read` (entry and return) in `libssl.so` and `libboringssl.so`; the `SSL_read` buffer pointer is kept in `SSL_READ_ARGS` (LRU, 10,240) between the two. The Enterprise extended scan reuses the same three programs on wolfSSL, mbedTLS, s2n-tls, GnuTLS and statically linked BoringSSL, whose write and read calls share the `(handle, buffer, length)` shape.
- **Go `crypto/tls`** (`go_tls_write`, `go_tls_read_entry`, `go_tls_read_ret`): uprobes on `(*Conn).Write` and `(*Conn).Read` that read Go's register ABI rather than the C one, with one `go_tls_read_ret` probe on every return instruction of `Read`. The read context sits in `GO_READ_ARGS`, keyed by process and goroutine, because a goroutine blocked inside `Read` resumes on whichever thread the scheduler picks.
- **Kernel TLS** (`ktls_sendmsg`, `ktls_recvmsg_entry`, `ktls_recvmsg_ret`): kprobes on the kernel's `tls_sw_sendmsg` and `tls_sw_recvmsg` through a `kprobe_multi` link, which cover every software kTLS socket on the host whatever its library. The message-iterator offsets come from the running kernel's BTF through `KTLS_ITER_OFFSETS`, and the read buffer waits in `KTLS_READ_ARGS` for the kretprobe. Hardware-offloaded sockets do not pass through `tls_sw_*` and stay unread.
- The two C-library entry probes stamp `DLP_UPROBE_ACTIVE` per thread; a kernel probe firing within 100 ms of that stamp on the same thread stands down, so an OpenSSL build with kernel TLS enabled raises one event and not two.
- Captures plaintext **before** encryption (write) and **after** decryption (read)
- Tiered event emission via RingBuf (`EVENTS`, 4 MB): small payloads (≤256 B) → `DlpEventSmall`, large payloads → full `DlpEvent`
- Userspace engine runs pattern matching (credit card, SSN, API keys, JWT, etc.)

The OSS agent attaches the C-library set to OpenSSL and BoringSSL. The Go and kernel TLS sets, and the other libraries, are attached by the Enterprise extended TLS scan; see [Enterprise DLP](../features/enterprise/dlp.md).

This is the only program that operates at the application layer - all others work at L3/L4.
