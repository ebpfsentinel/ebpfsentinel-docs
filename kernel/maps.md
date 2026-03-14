# eBPF Map Types

eBPF maps are the primary data structures shared between kernel programs and userspace. eBPFsentinel uses 11 distinct map types.

## Map Type Reference

### Data Maps

#### [`BPF_MAP_TYPE_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/)

**Kernel:** 3.19+ | **Used by:** xdp-firewall, xdp-ratelimit, tc-nat-ingress, tc-nat-egress, tc-ids, tc-qos

General-purpose key/value hash table. Used for:
- Firewall IP set aliases (named groups of IPs)
- IDS rule configuration
- QoS classifier rules (`QOS_CLASSIFIERS` — 5-tuple + DSCP → queue_id, 1024 entries)
- Interface group membership (`INTERFACE_GROUPS` — ifindex → bitmask, 64 entries, present in 6 programs)

#### [`BPF_MAP_TYPE_LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/)

**Kernel:** 4.11+ | **Used by:** xdp-firewall, xdp-ratelimit

Longest-prefix-match trie for **O(log n) CIDR matching**. Two sets of LPM tries:

**Firewall LPM tries** (managed by `LpmCoordinator`):

| Map | Purpose |
|-----|---------|
| `FW_LPM_SRC_V4` | Source IPv4 CIDR rules |
| `FW_LPM_DST_V4` | Destination IPv4 CIDR rules |
| `FW_LPM_SRC_V6` | Source IPv6 CIDR rules |
| `FW_LPM_DST_V6` | Destination IPv6 CIDR rules |

CIDR-only rules (no port/protocol/VLAN filter) are loaded exclusively into LPM tries, bypassing the slower linear scan phase entirely. The `LpmCoordinator` tracks entry provenance by source tag (`alias`, `ddos:<CC>`, `ips`) so that GeoIP alias rules, DDoS country auto-blocks, and IPS subnet injections can coexist without overwriting each other.

**Rate limit LPM tries** (managed by `RateLimitLpmManager`):

| Map | Purpose |
|-----|---------|
| `RL_LPM_SRC_V4` | Source IPv4 country → rate limit tier |
| `RL_LPM_SRC_V6` | Source IPv6 country → rate limit tier |
| `RL_TIER_CONFIG` | Array map (up to 16 entries) mapping tier_id → `RateLimitConfig` |

Country CIDRs are resolved from the GeoIP database and mapped to tier IDs. The LPM lookup in xdp-ratelimit runs before per-IP rule matching — if a source IP matches a country tier, that tier's rate/burst/algorithm is used.

#### [`BPF_MAP_TYPE_LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/)

**Kernel:** 4.10+ | **Used by:** tc-conntrack, tc-threatintel

Hash table with built-in **LRU eviction**. Used for:

**Connection tracking table:**
- Normalized bidirectional 5-tuple keys (lower IP:port always = "source")
- Automatic eviction of oldest entries when table is full
- No explicit garbage collection needed for stale entries

**Threat intel IOC maps:**
- `THREATINTEL_IOCS` and `THREATINTEL_IOCS_V6` use LRU hash for IOC exact-match lookups (post-Bloom filter confirmation)
- LRU eviction ensures the map stays within capacity when large feed volumes are loaded

#### [`BPF_MAP_TYPE_LRU_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_PERCPU_HASH/)

**Kernel:** 4.10+ | **Used by:** tc-qos

Combines per-CPU value storage with LRU eviction. Each CPU core maintains its own copy of the value (no locking), while the map automatically evicts the least-recently-used entries when capacity is reached. Used for:

- `QOS_FLOW_STATE` (65,536 entries): per-flow token bucket state. Each entry stores `tokens_remaining` and `last_refill_ns`. Per-CPU storage avoids contention on the hot path — each core independently tracks token state for flows it processes.

### Per-CPU Maps

#### [`BPF_MAP_TYPE_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_HASH/)

**Kernel:** 4.6+ | **Used by:** xdp-ratelimit

Per-CPU hash map providing **lock-free** per-IP rate limiting counters. Each CPU core maintains its own copy of the counter — no atomic operations or spinlocks needed. Values are aggregated when read from userspace.

**Memory budget by algorithm:**

The value size stored per entry depends on the rate limit algorithm selected:

| Algorithm | Value struct | Size per entry |
|-----------|-------------|----------------|
| Token bucket | `RateLimitValue` | 16 bytes |
| Fixed window | `FixedWindowValue` | 16 bytes |
| Sliding window (8 slots) | `SlidingWindowValue` | 56 bytes |
| Leaky bucket | `LeakyBucketValue` | 16 bytes |

Because `PerCpuHash` replicates the value on every CPU core, the total kernel memory consumed is:

```
memory = value_size * max_entries * num_CPUs
```

For the sliding window algorithm, which has the largest value (56 bytes due to 8 `u32` slots plus metadata), the cost can be significant:

| `max_entries` | CPUs | Memory |
|---------------|------|--------|
| 65 536 | 4 | ~14 MB |
| 65 536 | 8 | ~28 MB |
| 65 536 | 16 | ~56 MB |
| 131 072 | 8 | ~56 MB |

Token bucket and fixed/leaky bucket use 16-byte values, so the same 65 536 entries on 8 CPUs cost only ~8 MB. Choose the algorithm and `max_entries` accordingly to stay within your memory budget.

#### [`BPF_MAP_TYPE_PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/)

**Kernel:** 4.6+ | **Used by:** All programs

Fixed-size per-CPU array for **metrics counters**. Each program maintains its own metrics array:

| Index | Metric (example: xdp-ratelimit) |
|-------|----------------------------------|
| 0 | `SYN_RECEIVED` |
| 1 | `SYN_FLOOD_DROPS` |
| 2 | `ICMP_PASSED` |
| 3 | `ICMP_DROPPED` |
| 4 | `AMP_PASSED` |
| 5 | `AMP_DROPPED` |
| ... | ... |

Per-CPU arrays avoid contention — each core writes to its own slot, and userspace sums across CPUs when scraping Prometheus metrics.

The `SCRUB_CONFIG` PerCpuArray stores a 14-byte `ScrubConfig` struct (expanded from the original 8 bytes) with fields for: `min_ttl`, `min_hop_limit`, `max_mss`, `clear_df`, `random_ip_id`, `scrub_tcp_flags`, `strip_ecn`, `normalize_tos`, `normalize_tos_value`, and `strip_tcp_timestamps`.

#### `SYNCOOKIE_SECRET` (Array)

**Kernel:** 4.6+ | **Used by:** xdp-ratelimit

A single-entry Array map holding a 32-byte random secret used for SYN cookie generation. The secret is generated at agent startup and written into the map before the xdp-ratelimit program is attached. The FNV-1a cookie hash combines this secret with the packet 4-tuple and a minute-granularity timestamp.

### Program & Redirect Maps

#### [`BPF_MAP_TYPE_PROG_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PROG_ARRAY/)

**Kernel:** 4.2+ | **Used by:** xdp-firewall → xdp-ratelimit

Enables **tail-call chaining**: the firewall program jumps to the rate limiter via [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/). This allows both programs to share a single XDP attach point on the interface:

```
xdp-firewall:
    if action == PASS:
        bpf_tail_call(ctx, &PROG_ARRAY, RATELIMIT_INDEX)
        // If tail_call fails, fall through to XDP_PASS
```

#### [`BPF_MAP_TYPE_DEVMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_DEVMAP/)

**Kernel:** 4.14+ | **Used by:** xdp-firewall

Device map for **packet mirroring**. Maps interface index to redirect target. Used with [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) to mirror traffic to a monitoring port without slowing down the forwarding path.

#### [`BPF_MAP_TYPE_CPUMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_CPUMAP/)

**Kernel:** 4.15+ | **Used by:** xdp-firewall

CPU map for **NUMA-aware packet distribution**. Redirects packets to specific CPUs via [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/), ensuring processing stays on the same NUMA node as the NIC for optimal cache locality.

### Event Maps

#### [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/)

**Kernel:** 5.8+ | **Used by:** xdp-firewall, xdp-ratelimit, xdp-loadbalancer, tc-ids, tc-threatintel, tc-qos, uprobe-dlp, tc-dns

Lock-free, MPSC (multi-producer, single-consumer) ring buffer for **kernel→userspace event streaming**. Replaces the older `perf_event_array` with better performance:

- Single shared buffer (not per-CPU) — less memory waste
- Variable-length records
- Supports backpressure queries via [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/)

Most programs emit `PacketEvent` (64 bytes) through the ring buffer using the reserve/submit pattern:

```
entry = bpf_ringbuf_reserve(&EVENTS, sizeof(PacketEvent), 0);
if (!entry) return;  // buffer full
entry->src_addr = ...;
entry->dst_addr = ...;
bpf_ringbuf_submit(entry, 0);
```

**Memory budget:** Each program allocates its own independent RingBuf (no map pinning or sharing between programs). The total kernel memory footprint for all RingBuf maps is:

| Program | Map | Size |
|---------|-----|------|
| xdp-firewall | `EVENTS` | 1 MB (256 pages) |
| xdp-ratelimit | `EVENTS` | 1 MB (256 pages) |
| xdp-loadbalancer | `EVENTS` | 1 MB (256 pages) |
| tc-ids | `EVENTS` | 1 MB (256 pages) |
| tc-threatintel | `EVENTS` | 1 MB (256 pages) |
| uprobe-dlp | `EVENTS` | 4 MB (1024 pages) |
| tc-qos | `EVENTS` | 1 MB (256 pages) |
| tc-dns | `DNS_EVENTS` | 0.25 MB (64 pages) |
| **Total** | | **10.25 MB** |

Programs without a RingBuf (tc-conntrack, tc-scrub, tc-nat-ingress, tc-nat-egress) do not emit events to userspace and therefore have zero RingBuf overhead.

All RingBuf maps implement 75% backpressure: when the buffer exceeds 75% utilization, event emission is skipped and a drop counter is incremented instead.

### Probabilistic Maps

#### [`BPF_MAP_TYPE_BLOOM_FILTER`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/)

**Kernel:** 5.16+ | **Used by:** tc-threatintel

Probabilistic data structure for **fast IOC pre-filtering**:

- **No false negatives** — if the Bloom filter says "not present", the IP is definitely clean
- **Possible false positives** — a positive match triggers a full LRU hash map lookup for confirmation
- O(1) lookup with minimal memory footprint

Flow: `Bloom filter check → negative? skip → positive? full LRU hash lookup → confirmed? emit alert`

### Interface Group Maps

#### `INTERFACE_GROUPS` (HashMap)

**Kernel:** 3.19+ | **Used by:** xdp-firewall, xdp-ratelimit, tc-nat-ingress, tc-nat-egress, tc-ids, tc-qos

A HashMap map (key = `u32` ifindex, value = `u32` bitmask, max 64 entries) that stores interface-to-group membership. Each program has its own copy of the map. Userspace writes the mapping when configuration is loaded or reloaded.

The bitmask encodes group membership (up to 31 groups, bits 0-30). Each rule carries a `group_mask` field: if `group_mask == 0`, the rule is a **floating rule** and applies to all interfaces. Otherwise, the eBPF program looks up the current interface's ifindex in `INTERFACE_GROUPS`, ANDs the result with the rule's `group_mask`, and skips the rule if the result is zero. Bit 31 is the inversion flag — when set, the match logic is inverted (rule applies to all interfaces *except* those in the specified groups).

## Map Synchronization (Userspace → Kernel)

Several maps are written from userspace when configuration changes:

| Map | Direction | Trigger |
|-----|-----------|---------|
| Firewall LPM tries (×4) | Userspace → Kernel | Rule add/delete, config reload |
| Firewall IP set maps | Userspace → Kernel | Alias update, URL table refresh |
| Rate limit configs | Userspace → Kernel | Policy CRUD |
| Rate limit country LPM (×2) | Userspace → Kernel | GeoIP country tier reload |
| Rate limit tier configs | Userspace → Kernel | Country tier config reload |
| DDoS protection configs | Userspace → Kernel | SYN/ICMP/amp threshold changes |
| Threat intel Bloom filter | Userspace → Kernel | Feed refresh (periodic) |
| Threat intel LRU hash maps | Userspace → Kernel | IOC add/remove |
| IPS blacklist | Userspace → Kernel | Auto-block from IPS engine |
| DNS blocklist | Userspace → Kernel | Domain block/unblock |
| Scrub config array | Userspace → Kernel | Config reload (14-byte `ScrubConfig` struct with 4 new fields) |
| `SYNCOOKIE_SECRET` (Array, 1 entry) | Userspace → Kernel | Agent startup (32-byte random secret for SYN cookie generation) |
| `INTERFACE_GROUPS` (HashMap, ×6 programs) | Userspace → Kernel | Config reload, interface group changes |
| LB service/backend maps | Userspace → Kernel | Service add/delete |
| LB metrics (PerCpuArray) | Kernel → Userspace | Per-CPU forwarding counters |

| NAT NPTv6 rules (×2) | Userspace → Kernel | NPTv6 prefix translation rules |
| NAT NPTv6 rule count (×2) | Userspace → Kernel | NPTv6 rule count for `bpf_loop` |
| NAT hairpin config | Userspace → Kernel | Hairpin NAT enabled/subnet/SNAT IP |
| NAT hairpin CT (LRU) | Kernel ↔ Kernel | Hairpin reverse mapping (forward/return) |
| QoS pipe configs (Array) | Userspace → Kernel | Pipe add/delete |
| QoS queue configs (Array) | Userspace → Kernel | Queue add/delete |
| QoS classifiers (HashMap) | Userspace → Kernel | Classifier add/delete |
| QoS metrics (PerCpuArray) | Kernel → Userspace | Per-CPU shaping counters |

Maps are updated atomically per-entry. Bulk updates (e.g., threat intel feed refresh) iterate and batch-update entries while the old values remain visible to the eBPF program until overwritten.

### NAT Maps

#### NPTv6 Maps

| Map | Type | Max Entries | Value Size | Used By |
|-----|------|-------------|------------|---------|
| `NPTV6_RULES` (ingress) | Array | 64 | NPTv6 rule entry | tc-nat-ingress |
| `NPTV6_RULE_COUNT` (ingress) | Array | 1 | `u32` | tc-nat-ingress |
| `NPTV6_RULES` (egress) | Array | 64 | NPTv6 rule entry | tc-nat-egress |
| `NPTV6_RULE_COUNT` (egress) | Array | 1 | `u32` | tc-nat-egress |

Each NPTv6 rule entry contains: `internal_prefix: [u32; 4]`, `external_prefix: [u32; 4]`, `prefix_len: u8`, and a pre-computed `adjustment: u16` for checksum-neutral translation. The rule count map drives the `bpf_loop` iteration bound.

#### Hairpin NAT Maps

| Map | Type | Max Entries | Value Size | Used By |
|-----|------|-------------|------------|---------|
| `NAT_HAIRPIN_CONFIG` | Array | 1 | 16 bytes | tc-nat-ingress |
| `NAT_HAIRPIN_CT` | LruHashMap | 16,384 | Hairpin CT value | tc-nat-ingress |

`NAT_HAIRPIN_CONFIG` holds: `enabled: u32`, `internal_subnet: u32`, `internal_mask: u32`, `hairpin_snat_ip: u32`. The `NAT_HAIRPIN_CT` LRU map stores reverse mappings keyed by the rewritten 5-tuple, enabling the return path to undo both DNAT and hairpin SNAT translations.
