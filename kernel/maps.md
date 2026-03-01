# eBPF Map Types

eBPF maps are the primary data structures shared between kernel programs and userspace. eBPFsentinel uses 10 distinct map types.

## Map Type Reference

### Data Maps

#### [`BPF_MAP_TYPE_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/)

**Kernel:** 3.19+ | **Used by:** xdp-firewall, tc-ids, tc-threatintel

General-purpose key/value hash table. Used for:
- Firewall IP set aliases (named groups of IPs)
- IDS rule configuration
- Threat intel IOC exact-match lookups (post-Bloom filter confirmation)

#### [`BPF_MAP_TYPE_LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/)

**Kernel:** 4.11+ | **Used by:** xdp-firewall

Longest-prefix-match trie for **O(log n) CIDR matching**. The firewall maintains 4 tries:

| Map | Purpose |
|-----|---------|
| `FW_LPM_SRC_V4` | Source IPv4 CIDR rules |
| `FW_LPM_DST_V4` | Destination IPv4 CIDR rules |
| `FW_LPM_SRC_V6` | Source IPv6 CIDR rules |
| `FW_LPM_DST_V6` | Destination IPv6 CIDR rules |

CIDR-only rules (no port/protocol/VLAN filter) are loaded exclusively into LPM tries, bypassing the slower linear scan phase entirely.

#### [`BPF_MAP_TYPE_LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/)

**Kernel:** 4.10+ | **Used by:** tc-conntrack

Hash table with built-in **LRU eviction**. Used for the connection tracking table:
- Normalized bidirectional 5-tuple keys (lower IP:port always = "source")
- Automatic eviction of oldest entries when table is full
- No explicit garbage collection needed for stale entries

### Per-CPU Maps

#### [`BPF_MAP_TYPE_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_HASH/)

**Kernel:** 4.6+ | **Used by:** xdp-ratelimit

Per-CPU hash map providing **lock-free** per-IP rate limiting counters. Each CPU core maintains its own copy of the counter — no atomic operations or spinlocks needed. Values are aggregated when read from userspace.

#### [`BPF_MAP_TYPE_PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/)

**Kernel:** 4.6+ | **Used by:** All programs

Fixed-size per-CPU array for **metrics counters**. Each program maintains its own metrics array:

| Index | Metric (example: xdp-ratelimit) |
|-------|----------------------------------|
| 0 | `SYN_RECEIVED` |
| 1 | `SYNCOOKIES_SENT` |
| 2 | `ICMP_PASSED` |
| 3 | `ICMP_DROPPED` |
| 4 | `AMP_PASSED` |
| 5 | `AMP_DROPPED` |
| ... | ... |

Per-CPU arrays avoid contention — each core writes to its own slot, and userspace sums across CPUs when scraping Prometheus metrics.

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

**Kernel:** 5.8+ | **Used by:** All programs

Lock-free, MPSC (multi-producer, single-consumer) ring buffer for **kernel→userspace event streaming**. Replaces the older `perf_event_array` with better performance:

- Single shared buffer (not per-CPU) — less memory waste
- Variable-length records
- Supports backpressure queries via [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/)

All programs emit `PacketEvent` (56 bytes) through the ring buffer using the reserve/submit pattern:

```
entry = bpf_ringbuf_reserve(&EVENTS, sizeof(PacketEvent), 0);
if (!entry) return;  // buffer full
entry->src_addr = ...;
entry->dst_addr = ...;
bpf_ringbuf_submit(entry, 0);
```

### Probabilistic Maps

#### [`BPF_MAP_TYPE_BLOOM_FILTER`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/)

**Kernel:** 5.16+ | **Used by:** tc-threatintel

Probabilistic data structure for **fast IOC pre-filtering**:

- **No false negatives** — if the Bloom filter says "not present", the IP is definitely clean
- **Possible false positives** — a positive match triggers a full hash map lookup for confirmation
- O(1) lookup with minimal memory footprint

Flow: `Bloom filter check → negative? skip → positive? full hash lookup → confirmed? emit alert`

## Map Synchronization (Userspace → Kernel)

Several maps are written from userspace when configuration changes:

| Map | Direction | Trigger |
|-----|-----------|---------|
| Firewall LPM tries (×4) | Userspace → Kernel | Rule add/delete, config reload |
| Firewall IP set maps | Userspace → Kernel | Alias update, URL table refresh |
| Rate limit configs | Userspace → Kernel | Policy CRUD |
| DDoS protection configs | Userspace → Kernel | SYN/ICMP/amp threshold changes |
| Threat intel Bloom filter | Userspace → Kernel | Feed refresh (periodic) |
| Threat intel hash map | Userspace → Kernel | IOC add/remove |
| IPS blacklist | Userspace → Kernel | Auto-block from IPS engine |
| DNS blocklist | Userspace → Kernel | Domain block/unblock |
| Scrub config array | Userspace → Kernel | Config reload |
| LB service/backend maps | Userspace → Kernel | Service add/delete |
| LB metrics (PerCpuArray) | Kernel → Userspace | Per-CPU forwarding counters |

Maps are updated atomically per-entry. Bulk updates (e.g., threat intel feed refresh) iterate and batch-update entries while the old values remain visible to the eBPF program until overwritten.
