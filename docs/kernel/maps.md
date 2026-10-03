# eBPF Map Types

eBPF maps are the primary data structures shared between kernel programs and userspace. eBPFsentinel uses 11 distinct map types.

## Map Type Reference

### Data Maps

#### [`BPF_MAP_TYPE_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/)

**Kernel:** 3.19+ | **Used by:** xdp-firewall, xdp-ratelimit, xdp-loadbalancer, xdp-vip-announcer, tc-nat-ingress, tc-nat-egress, tc-ids, tc-qos

General-purpose key/value hash table. Used for:
- Firewall IP set aliases (`FW_IPSET_V4`) and the exact-match rule indexes (`FW_HASH_PORT`, `FW_HASH_5TUPLE`)
- Zones (`ZONE_MAP`, `ZONE_POLICY_MAP`, `ZONE_DEFAULT_POLICY`) and per-source state counters (`CT_SRC_COUNTERS`)
- IDS patterns (`IDS_PATTERNS`, `IDS_SRC_PATTERNS`) and L7 ports
- Rate limit policies (`RATELIMIT_CONFIG`) and amplification protection (`AMP_PROTECT_CONFIG`)
- Load balancer services, backends, Maglev tables and resolved backend MACs
- Owned VIPs and interface MACs for the VIP ARP responder
- Tenant resolution by VLAN, ifindex and cgroup
- QoS classifier rules (`QOS_CLASSIFIERS` - 5-tuple + DSCP → queue_id, 1024 entries)
- Interface group membership (`INTERFACE_GROUPS` - ifindex → bitmask, 64 entries, present in 6 programs)

#### [`BPF_MAP_TYPE_LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/)

**Kernel:** 4.11+ | **Used by:** xdp-firewall, xdp-ratelimit, tc-ids, tc-nat-ingress, tc-nat-egress, tc-qos

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

Country CIDRs are resolved from the GeoIP database and mapped to tier IDs. The LPM lookup in xdp-ratelimit runs before per-IP rule matching - if a source IP matches a country tier, that tier's rate/burst/algorithm is used.

**Tenant subnet tries**: `TENANT_SUBNET_V4` (4,096) and `TENANT_SUBNET_V6` (2,048) map a source subnet to a tenant, in every program that resolves one.

#### [`BPF_MAP_TYPE_LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/)

**Kernel:** 4.10+ | **Used by:** tc-threatintel, tc-nat-ingress, xdp-firewall-reject, uprobe-dlp

Hash table with built-in **LRU eviction**. Used for:

- `THREATINTEL_IOCS` and `THREATINTEL_IOCS_V6`: IOC exact-match lookups after the Bloom filter pre-check. LRU eviction keeps the map within capacity when large feed volumes are loaded. The DNS blocklist writes the addresses its blocked domains resolve to into the same maps.
- `NAT_HAIRPIN_CT`: hairpin NAT reverse mappings (see [Hairpin NAT Maps](#hairpin-nat-maps)).
- `REJECT_RATELIMIT`: per-source throttle on forged TCP RST / ICMP unreachable replies.
- `SSL_READ_ARGS` (10,240): `SSL_read` arguments saved by the uprobe for the uretprobe, so an entry left by a process killed mid-call is reclaimed rather than leaked.
- `GO_READ_ARGS` (10,240): the Go `crypto/tls` read buffer saved at `(*Conn).Read` entry, keyed by `(tgid, goroutine)` rather than by thread.
- `KTLS_READ_ARGS` (10,240): the destination buffer `tls_sw_recvmsg` was entered with, for the kretprobe. A map of its own because `SSL_read` reaches `tls_sw_recvmsg` inside its own frame on the same thread, so sharing `SSL_READ_ARGS` would overwrite the uprobe's saved arguments.
- `DLP_UPROBE_ACTIVE` (10,240): per-thread time of the last C-library TLS call, which the kernel TLS probes read to skip plaintext a uprobe already captured.

#### [`BPF_MAP_TYPE_LRU_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_PERCPU_HASH/)

**Kernel:** 4.10+ | **Used by:** xdp-ratelimit, tc-qos

Combines per-CPU value storage with LRU eviction. Each CPU core maintains its own copy of the value (no locking), while the map automatically evicts the least-recently-used entries when capacity is reached. Used for:

- `RL_BUCKETS` (`ratelimit.max_buckets` entries, 65,536 by default): consolidated rate limit bucket state using a discriminated union (`RateLimitBucketUnion`, 64 bytes). All 4 rate limiting algorithms share one map. LRU eviction handles bucket expiration.
- The DDoS per-source and connection tables (`SYN_RATE_TRACKER`, `ICMP_RATE_BUCKETS`, `AMP_RATE_BUCKETS`, `HALF_OPEN_COUNTERS`, `FLOOD_COUNTERS`, `CONN_TABLE`).
- `QOS_FLOW_STATE` (65,536 entries): per-flow pacing state for EDT (`last_edt_ns`, plus the flow's pipe and queue). A flow's departure times only matter relative to its own past packets, so each core tracks the flows it sees without contention.

The consolidated rate limit bucket map replaces four separate per-algorithm maps with one discriminated union:

| Field | Type | Size |
|-------|------|------|
| Discriminant | `u8` | 1 byte |
| Padding | `[u8; 7]` | 7 bytes |
| Data (union) | `[u64; 7]`, algorithm-specific | 56 bytes |
| **Total** | `RateLimitBucketUnion` | **64 bytes** |

Because a per-CPU map replicates the value on every CPU core, the value memory is:

```
memory = value_size * max_entries * num_CPUs
```

| `max_entries` | CPUs | `RL_BUCKETS` values |
|---------------|------|---------------------|
| 65 536 | 4 | 16 MiB |
| 65 536 | 8 | 32 MiB |
| 262 144 | 8 | 128 MiB |

The kernel adds a per-entry element header on top of that, which is not replicated per CPU.

The capacity is a configuration choice rather than a compile-time constant, and so are the DDoS per-source tables (`SYN_RATE_TRACKER`, `ICMP_RATE_BUCKETS`, `AMP_RATE_BUCKETS`, `HALF_OPEN_COUNTERS`, `FLOOD_COUNTERS`, sized by `ddos.max_tracked_sources`), the DDoS connection table (`CONN_TABLE`, `ddos.connection_tracking`), which are LRU per-CPU hashes as well, and the threat intelligence IOC tables (`threatintel.max_entries`): the agent sizes them at load and logs the plan. What each costs is in [Performance tuning](../operations/performance-tuning.md#ebpf-map-sizes).

### Per-CPU Maps

#### [`BPF_MAP_TYPE_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_HASH/)

**Kernel:** 4.6+ | **Used by:** xdp-vip-announcer

`VIP_ARP_REPLIES` counts ARP replies per VIP for the Prometheus `{vip}` label. Each CPU increments its own copy without atomics, and userspace sums the copies when it reads.

#### [`BPF_MAP_TYPE_PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/)

**Kernel:** 4.6+ | **Used by:** every program but xdp-pass

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

Per-CPU arrays avoid contention - each core writes to its own slot, and userspace sums across CPUs when scraping Prometheus metrics.

Per-CPU arrays also serve as scratch space too large for the 512-byte stack: `PKT_CTX` (the parsed packet shared between xdp-firewall and xdp-firewall-reject), `SYNCOOKIE_CTX` (shared between xdp-ratelimit and xdp-ratelimit-syncookie), `FIB_PARAMS` (one each in xdp-firewall and xdp-loadbalancer), `CT_STATE_SCRATCH` and `REJECT_SCRATCH`.

#### [`BPF_MAP_TYPE_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/)

**Kernel:** 3.19+ | **Used by:** most programs

Single-entry and indexed configuration: firewall rule arrays and counts, default policy, NAT rule arrays and counts, QoS pipes and queues, DDoS SYN / ICMP configuration, rate limit tiers, conntrack configuration and the feature gates. uprobe-dlp keeps `KTLS_ITER_OFFSETS` here: the `msghdr` and `iov_iter` field offsets userspace resolves from the running kernel's BTF, without which the kernel TLS probes read nothing.

The `SCRUB_CONFIG` Array stores a 14-byte `ScrubFlags` struct: `enabled`, `min_ttl`, `clear_df`, `random_ip_id`, `max_mss`, `min_hop_limit`, `scrub_tcp_flags`, `strip_ecn`, `normalize_tos`, `tos_value`, `strip_tcp_timestamps` and `drop_fragments`.

SYN cookies need no map for their secret: xdp-ratelimit-syncookie calls the kernel's `bpf_tcp_raw_gen_syncookie_ipv4/ipv6` helpers, and xdp-ratelimit validates the returning ACK with `bpf_tcp_raw_check_syncookie_ipv4/ipv6`, so the kernel's own syncookie secret is the one in use.

### Program & Redirect Maps

#### [`BPF_MAP_TYPE_PROG_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PROG_ARRAY/)

**Kernel:** 4.2+ | **Used by:** xdp-firewall, xdp-ratelimit

Enables **tail-call chaining** via [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/), so every XDP stage shares the firewall's single attach point on the interface:

| Map | Slot | Target |
|-----|------|--------|
| `XDP_PROG_ARRAY` (xdp-firewall) | 0 | xdp-ratelimit |
| | 1 | xdp-firewall-reject |
| | 2 | xdp-loadbalancer (when rate limiting is off) |
| | 3 | xdp-vip-announcer (ARP for an owned VIP) |
| `RL_PROG_ARRAY` (xdp-ratelimit) | 0 | xdp-ratelimit-syncookie |
| | 1 | xdp-loadbalancer |

An empty slot makes the tail call fail and the caller falls through to its own verdict, usually `XDP_PASS`.

#### [`BPF_MAP_TYPE_DEVMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_DEVMAP/)

**Kernel:** 4.14+ | **Used by:** xdp-loadbalancer

Device map for **wire-speed load balancer forwarding**. Maps `backend_id` to the backend's network interface index. On the DNAT path the next hop comes from `bpf_fib_lookup`: when it leaves by another interface the load balancer uses `DevMap.redirect()` if the entry is populated (via `LbMapManager`) and `bpf_redirect` to the FIB's interface otherwise, and a next hop on the receiving interface leaves with `XDP_TX`. In L2 DSR mode the entry is used when present, `XDP_TX` otherwise.

| Map | Max Entries | Key | Value | Purpose |
|-----|-------------|-----|-------|---------|
| `LB_DEVMAP` | 256 | `backend_id` (u32) | `ifindex` (u32) | Backend interface redirect |

Userspace resolves the ifindex from an IPv4 backend address via `ip route get` + `/sys/class/net/{dev}/ifindex` and populates the DevMap when a backend is synced. IPv6 backends are not resolved into the DevMap; their DNAT packets are still routed by the FIB lookup and redirected with `bpf_redirect` when the next hop is on another interface.

### Event Maps

#### [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/)

**Kernel:** 5.8+ | **Used by:** xdp-firewall, xdp-ratelimit, xdp-loadbalancer, tc-ids, tc-threatintel, tc-qos, uprobe-dlp, tc-dns

Lock-free, MPSC (multi-producer, single-consumer) ring buffer for **kernel→userspace event streaming**. Replaces the older `perf_event_array` with better performance:

- Single shared buffer (not per-CPU) - less memory waste
- Supports backpressure queries via [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/)

Most programs emit a fixed-size `PacketEvent` through the ring buffer using the reserve/submit pattern. The two programs that carry payload reserve one of two fixed record sizes rather than one sized to the packet: tc-ids 512 bytes or 2,048 bytes of L7 payload, uprobe-dlp a 256-byte or 4,096-byte excerpt, the small one whenever the data fits.

The submit flag depends on the backlog: below 64 KiB of unconsumed data a record is committed with `BPF_RB_NO_WAKEUP` and the reader's own drain tick collects it, above it with `BPF_RB_FORCE_WAKEUP`, so a steady event rate costs one wakeup per batch rather than one per record.

**Memory budget:** Each program allocates its own independent RingBuf (no map pinning or sharing between programs). The total kernel memory footprint for all RingBuf maps is:

| Program | Map | Size |
|---------|-----|------|
| xdp-firewall | `EVENTS` | 1 MB (256 pages) |
| xdp-ratelimit | `EVENTS` | 1 MB (256 pages) |
| xdp-loadbalancer | `EVENTS` | 1 MB (256 pages) |
| tc-ids | `EVENTS` | 4 MB (1024 pages) |
| tc-threatintel | `EVENTS` | 1 MB (256 pages) |
| uprobe-dlp | `EVENTS` | 4 MB (1024 pages) |
| tc-qos | `EVENTS` | 1 MB (256 pages) |
| tc-dns | `DNS_EVENTS` | 0.25 MB (64 pages) |
| **Total** | | **13.25 MB** |

Programs without a RingBuf (tc-conntrack, tc-scrub, tc-nat-ingress, tc-nat-egress, xdp-firewall-reject, xdp-ratelimit-syncookie, xdp-vip-announcer) do not emit events to userspace and therefore have zero RingBuf overhead.

Every packet program applies 75% backpressure: when the buffer exceeds 75% utilization, event emission is skipped and a drop counter is incremented instead. uprobe-dlp does not: it reserves directly and counts a failed reservation as a drop.

### Arena maps - not used

`BPF_MAP_TYPE_ARENA` (kernel 6.9+) was evaluated for zero-copy event
delivery but is **not used**. All programs emit events through `RingBuf`
exclusively. The arena alloc kfunc returns an untyped scalar on the Rust
`bpfel` target (the verifier rejects writes through it) and is
sleepable-only (unavailable in XDP/TC hooks). See
[KFuncs: Arena maps](kfuncs.md#arena-maps-kernel-69---evaluated-not-used).

### Config Maps

#### `IDS_MIRROR_CONFIG` (Array)

**Kernel:** 3.19+ | **Used by:** tc-ids | **Written by:** `IdsMirrorMapManager`, driven by the Enterprise forensics module

A 2-entry Array map controlling packet mirroring for forensic capture:

| Index | Value | Purpose |
|-------|-------|---------|
| 0 | `ifindex` (u32) | Target interface for mirrored packets |
| 1 | `enabled` (u32) | 1 = mirror active, 0 = disabled |

When enabled, `bpf_clone_redirect` clones every packet that matches an IDS pattern, and transmits the copy on the mirror interface. The original packet continues normal processing. Controlled by the enterprise forensics API (`POST /api/v1/enterprise/forensics/mirror/start`, `POST /api/v1/enterprise/forensics/mirror/stop`, `GET /api/v1/enterprise/forensics/mirror`).

### Probabilistic Maps

#### [`BPF_MAP_TYPE_BLOOM_FILTER`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/)

**Kernel:** 5.16+ | **Used by:** tc-threatintel

Probabilistic data structure for **fast IOC pre-filtering**:

- **No false negatives** - if the Bloom filter says "not present", the IP is definitely clean
- **Possible false positives** - a positive match triggers a full LRU hash map lookup for confirmation
- O(1) lookup with minimal memory footprint

Flow: `Bloom filter check → negative? skip → positive? full LRU hash lookup → confirmed? emit alert`

### Interface Group Maps

#### `INTERFACE_GROUPS` (HashMap)

**Kernel:** 3.19+ | **Used by:** xdp-firewall, xdp-ratelimit, tc-nat-ingress, tc-nat-egress, tc-ids, tc-qos

A HashMap map (key = `u32` ifindex, value = `u32` bitmask, max 64 entries) that stores interface-to-group membership. Pinned to `/sys/fs/bpf/ebpfsentinel/` and shared across all 6 programs. Userspace writes the mapping when configuration is loaded or reloaded.

The bitmask encodes group membership (up to 31 groups, bits 0-30). Each rule carries a `group_mask` field: if `group_mask == 0`, the rule is a **floating rule** and applies to all interfaces. Otherwise, the eBPF program looks up the current interface's ifindex in `INTERFACE_GROUPS`, ANDs the result with the rule's `group_mask`, and skips the rule if the result is zero. Bit 31 is the inversion flag - when set, the match logic is inverted (rule applies to all interfaces *except* those in the specified groups).

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
| IPS blacklist | Userspace → Kernel | Auto-block from IPS engine, written into the firewall LPM tries under the `ips` tag |
| DNS blocklist | Userspace → Kernel | Addresses of blocked domains, written into the threat intel IOC maps |
| Scrub config array | Userspace → Kernel | Config reload (14-byte `ScrubFlags` struct) |
| `INTERFACE_GROUPS` (HashMap, ×6 programs) | Userspace → Kernel | Config reload, interface group changes |
| LB service/backend maps | Userspace → Kernel | Service add/delete |
| LB metrics (PerCpuArray) | Kernel → Userspace | Per-CPU forwarding counters |
| NAT NPTv6 rules (×2) | Userspace → Kernel | NPTv6 prefix translation rules |
| NAT NPTv6 rule count (×2) | Userspace → Kernel | NPTv6 rule count for `bpf_loop` |
| NAT hairpin config | Userspace → Kernel | Hairpin NAT enabled/subnet/SNAT IP |
| NAT hairpin CT (LRU) | Kernel ↔ Kernel | Hairpin reverse mapping (forward/return) |
| NAT reverse tables (LRU) | Kernel ↔ Kernel | Reply tuple of each DNAT and SNAT flow, written on the way out and read on the way back |
| QoS pipe configs (Array) | Userspace → Kernel | Pipe add/delete |
| QoS queue configs (Array) | Userspace → Kernel | Queue add/delete |
| QoS classifiers (HashMap) | Userspace → Kernel | Classifier add/delete |
| QoS metrics (PerCpuArray) | Kernel → Userspace | Per-CPU shaping counters |

Maps are updated per-entry via `bpf_map_update_elem`. Bulk updates (for example a threat intel feed refresh) iterate and batch-update entries while the old values remain visible to the eBPF program until overwritten.

### Pinned Maps (BPF Filesystem)

Every map is pinned by its name under `/sys/fs/bpf/ebpfsentinel/`. When a program is loaded, the loader opens the pin of each map it declares and reuses it if it exists (`BPF_OBJ_GET`), otherwise it creates the map and pins it (`BPF_OBJ_PIN`). A map declared under the same name by several programs is therefore one map in the kernel:

| Map | Size | Programs | Purpose |
|-----|------|----------|---------|
| `INTERFACE_GROUPS` | 64 entries × 8 B | 6 programs | Interface-to-group bitmask |
| `CT_CONFIG` | 1 entry × 72 B | tc-conntrack, xdp-firewall | Conntrack config + thresholds |
| `CT_NF_CONN_OFFSETS` | 1 entry × 16 B | tc-conntrack, xdp-firewall | Runtime BTF offsets for `nf_conn` |
| `PKT_CTX` | per-CPU, 1 entry | xdp-firewall, xdp-firewall-reject | Parsed packet handed to the reject tail call |
| `SYNCOOKIE_CTX`, `DDOS_METRICS` | per-CPU, 1 entry / counters | xdp-ratelimit, xdp-ratelimit-syncookie | SYN cookie context and shared DDoS counters |
| Tenant maps | see [Limits](limits.md) | every program resolving a tenant | VLAN, ifindex and subnet to tenant |

Ring buffers and the `DEVMAP` are never shared: each program object gets its own. uprobe-dlp pins under a directory of its own, `/sys/fs/bpf/ebpfsentinel-dlp/`. Both directories are wiped at startup, because a pin left by a previous run cannot be inspected, and removed again when the agent shuts down or an HA node deactivates.

Connection tracking uses **kernel netfilter** directly via `bpf_skb_ct_lookup` / `bpf_xdp_ct_lookup` kfuncs - no userspace shadow tables. The `CT_NF_CONN_OFFSETS` map holds runtime-resolved `nf_conn` field offsets for `status` and `mark`, which the agent reads at startup from `/sys/kernel/btf/vmlinux` with its own BTF parser, so BPF programs can read `nf_conn->status` via `bpf_probe_read_kernel`.

### NAT Maps

#### NPTv6 Maps

| Map | Type | Max Entries | Value Size | Used By |
|-----|------|-------------|------------|---------|
| `NPTV6_RULES` (ingress) | Array | 64 | NPTv6 rule entry | tc-nat-ingress |
| `NPTV6_RULE_COUNT` (ingress) | Array | 1 | `u32` | tc-nat-ingress |
| `NPTV6_RULES` (egress) | Array | 64 | NPTv6 rule entry | tc-nat-egress |
| `NPTV6_RULE_COUNT` (egress) | Array | 1 | `u32` | tc-nat-egress |

Each NPTv6 rule entry contains: `internal_prefix: [u32; 4]`, `external_prefix: [u32; 4]`, `prefix_len: u8`, and a pre-computed `adjustment: u16` for checksum-neutral translation. The rule count map drives the `bpf_loop` iteration bound.

#### Reverse NAT Maps

| Map | Type | Max Entries | Used By |
|-----|------|-------------|---------|
| `NAT_DNAT_REVERSE`, `NAT_DNAT_REVERSE_V6` | LruHashMap | 65,536 each when `nat.enabled`, 1,024 otherwise | tc-nat-ingress (writes), tc-nat-egress (reads) |
| `NAT_SNAT_REVERSE`, `NAT_SNAT_REVERSE_V6` | LruHashMap | 65,536 each when `nat.enabled`, 1,024 otherwise | tc-nat-egress (writes), tc-nat-ingress (reads) |

Each map is keyed by the reply tuple exactly as it arrives on the wire and holds the address and port to restore: the original destination for a DNAT reply's source, the original source for an SNAT reply's destination. Both programs declare the maps under the same name, so the pin makes them one map in the kernel. A hairpin flow records no DNAT reverse entry; its reply is undone through `NAT_HAIRPIN_CT`.

#### Hairpin NAT Maps

| Map | Type | Max Entries | Value Size | Used By |
|-----|------|-------------|------------|---------|
| `NAT_HAIRPIN_CONFIG` | Array | 1 | 16 bytes | tc-nat-ingress |
| `NAT_HAIRPIN_CT` | LruHashMap | 16,384 when `nat.hairpin.enabled`, 1,024 otherwise | Hairpin CT value | tc-nat-ingress |

`NAT_HAIRPIN_CONFIG` holds: `enabled: u32`, `internal_subnet: u32`, `internal_mask: u32`, `hairpin_snat_ip: u32`. The `NAT_HAIRPIN_CT` LRU map stores reverse mappings keyed by the rewritten 5-tuple, enabling the return path to undo both DNAT and hairpin SNAT translations.
