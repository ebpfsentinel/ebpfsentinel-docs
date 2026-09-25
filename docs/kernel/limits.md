# Program Limits

Hard limits for each eBPF program, derived from map capacities defined in `ebpf-common` constants and eBPF program source code.

## Summary

| Program | Key Limit | Value |
|---------|-----------|-------|
| xdp-firewall | Rules per address family (array) | 4,096 |
| xdp-firewall | 5-tuple hash entries | 65,536 |
| xdp-firewall | Port hash entries | 16,384 |
| xdp-firewall | LPM CIDR entries (per direction per family) | 131,072 |
| xdp-firewall | IP set entries (IPv4) | 65,536 |
| xdp-firewall | Interface groups | 31 |
| xdp-firewall | Per-source state counters | 65,536 when a per-source limit is set, 1,024 otherwise |
| xdp-firewall-reject | Throttled reject sources | 65,536 when a rule forges a refusal, 1,024 otherwise |
| xdp-ratelimit | Rate limit configs | 10,240 |
| xdp-ratelimit | Tracked source IPs (bucket state) | `ratelimit.max_buckets`, 65,536 by default |
| xdp-ratelimit | Country CIDRs (per family) | 131,072 |
| xdp-ratelimit | Country tiers | 16 |
| xdp-ratelimit | SYN rate tracked IPs | `ddos.max_tracked_sources`, 16,384 by default |
| xdp-ratelimit | DDoS connection table | `ddos.connection_tracking.max_entries`, 65,536 by default |
| xdp-ratelimit | Amplification protection ports | 64 |
| xdp-loadbalancer | Services | 4,096 |
| xdp-loadbalancer | Backends per service | 256 |
| xdp-loadbalancer | Backends total | 65,536 |
| xdp-loadbalancer | Maglev services | 256 |
| xdp-vip-announcer | Virtual IPs | 256 |
| tc-conntrack | Connections | Kernel netfilter table (`nf_conntrack_max`) |
| tc-nat-ingress | DNAT rules (IPv4) | 256 |
| tc-nat-ingress | DNAT rules (IPv6) | 128 |
| tc-nat-ingress | NPTv6 rules | 64 |
| tc-nat-ingress | Hairpin CT entries | 16,384 with hairpin NAT on, 1,024 otherwise |
| tc-nat-egress | SNAT rules (IPv4) | 256 |
| tc-nat-egress | SNAT rules (IPv6) | 128 |
| tc-ids | IDS patterns (destination-keyed and source-keyed) | 10,240 each |
| tc-ids | L7 inspection ports | 256 |
| tc-threatintel | IOCs per family | `threatintel.max_entries`, derived from the feeds, up to 4,194,304 |
| tc-threatintel | Bloom filter per family | same as the IOC table |
| tc-qos | Pipes | 64 |
| tc-qos | Queues | 256 |
| tc-qos | Classifiers | 1,024 |
| tc-qos | Tracked flows | 65,536 |
| uprobe-dlp | Concurrent SSL reads tracked | 10,240 |

## Per-Program Details

### xdp-firewall

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Rules per address family (IPv4 / IPv6) | 4,096 | `FIREWALL_RULES` / `FIREWALL_RULES_V6` (Array, `MAX_FIREWALL_RULES`) |
| 5-tuple hash entries | 65,536 | `FW_HASH_5TUPLE` (HashMap, `MAX_FW_HASH_5TUPLE`) |
| Port-only hash entries | 16,384 | `FW_HASH_PORT` (HashMap, `MAX_FW_HASH_PORT`) |
| LPM CIDR entries (per direction per family) | 131,072 | `FW_LPM_SRC_V4` / `FW_LPM_DST_V4` / `FW_LPM_SRC_V6` / `FW_LPM_DST_V6` (LPM Trie, `MAX_LPM_RULES`) |
| IP set entries (IPv4) | 65,536 | `FW_IPSET_V4` (HashMap, `MAX_IPSET_ENTRIES_V4`) |
| IP set aliases | 255 | Set ids 1-255 (id 0 means the rule matches no set) |
| Per-source state counters | 65,536 when `conntrack.max_src_states` or `conntrack.max_src_conn_rate` is set, 1,024 otherwise | `CT_SRC_COUNTERS` (HashMap, `CT_SRC_COUNTER_MAX`, sized at load) |
| Per-rule state counters | 4,096 | `FW_RULE_STATE_COUNT` (Array, `MAX_FIREWALL_RULES`) |
| Interface groups | 31 | Bits 0-30 in `INTERFACE_GROUPS` bitmask (bit 31 = inversion) |
| Conntrack entries | Kernel-managed | Kernel netfilter (no BPF shadow tables) |
| Tail-call programs | 4 | `XDP_PROG_ARRAY` (ProgramArray) |
| RingBuf size | 1 MB | `EVENTS` |

### xdp-firewall-reject

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Throttled reject sources | 65,536 when a firewall rule forges a refusal, 1,024 otherwise | `REJECT_RATELIMIT` (LRU Hash, sized at load) |

No RingBuf. Reads the parsed offsets from `PKT_CTX`, shared with `xdp-firewall`.

### xdp-ratelimit

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Rate limit configs | 10,240 | `RATELIMIT_CONFIG` (HashMap) |
| Tracked source IPs (all algorithms) | `ratelimit.max_buckets` (65,536 by default, 1,024 to 4,194,304) | `RL_BUCKETS` (LruPerCpuHash, sized at load) |
| Country tiers | 16 | `RL_TIER_CONFIG` (Array, `MAX_RL_TIERS`) |
| Country CIDRs (IPv4) | 131,072 | `RL_LPM_SRC_V4` (LPM Trie, `MAX_RL_LPM_ENTRIES`) |
| Country CIDRs (IPv6) | 131,072 | `RL_LPM_SRC_V6` (LPM Trie, `MAX_RL_LPM_ENTRIES`) |
| SYN rate tracked IPs | `ddos.max_tracked_sources` (16,384 by default, 1,024 to 1,048,576) | `SYN_RATE_TRACKER` (LruPerCpuHash, sized at load) |
| ICMP rate tracked IPs | `ddos.max_tracked_sources` | `ICMP_RATE_BUCKETS` (LruPerCpuHash, sized at load) |
| Amplification protection ports | 64 | `AMP_PROTECT_CONFIG` (HashMap) |
| Amplification rate tracked sources | `ddos.max_tracked_sources` | `AMP_RATE_BUCKETS` (LruPerCpuHash, sized at load) |
| DDoS connection table | `ddos.connection_tracking.max_entries` (65,536 by default, 1,024 to 4,194,304) | `CONN_TABLE` (LruPerCpuHash, sized at load) |
| Half-open connection counters | `ddos.max_tracked_sources` | `HALF_OPEN_COUNTERS` (LruPerCpuHash, sized at load) |
| Flood counters | `ddos.max_tracked_sources` | `FLOOD_COUNTERS` (LruPerCpuHash, sized at load) |
| Tail-call programs | 2 used of 4 | `RL_PROG_ARRAY` (ProgramArray): slot 0 `xdp-ratelimit-syncookie`, slot 1 `xdp-loadbalancer` |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |
| RingBuf size | 1 MB | `EVENTS` |

**Memory footprint** at the defaults, measured on kernel 7.0.0-28-generic: 84 bytes of locked memory per slot per CPU for `RL_BUCKETS`, 46 for `CONN_TABLE` and 37 for the five per-source tables (`bytes_memlock`, key, value and hash overhead included):

| CPUs | `RL_BUCKETS` only | All seven LruPerCpuHash tables combined |
|------|-------------------|-----------------------------------------|
| 4 | ~21 MB | ~43 MB |
| 8 | ~42 MB | ~87 MB |
| 16 | ~84 MB | ~174 MB |

The per-CPU part is what moves with the machine. With every feature enabled the agent locked 71 MB in total on 4 CPUs, so the rest of the loaded maps is about 28 MB. SYN cookies use the kernel's own secret through the raw SYN cookie helpers; there is no cookie secret map. Every one of these capacities is a configuration key applied at agent start, see [Performance tuning](../operations/performance-tuning.md#ebpf-map-sizes).

### xdp-loadbalancer

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Services | 4,096 | `LB_SERVICES` (HashMap, `MAX_LB_SERVICES`) |
| Backends per service | 256 | `LB_MAX_BACKENDS_V2` (slot: `service_id × 256 + [0..255]`) |
| Backends total | 65,536 | `LB_BACKENDS` (HashMap, `MAX_LB_BACKENDS_TOTAL`) |
| Round-robin state entries | 4,096 | `LB_RR_STATE` (PerCpuArray, `MAX_LB_SERVICES`) |
| Maglev services | 256 | `LB_MAGLEV` (HashMap, `MAX_MAGLEV_SERVICES`) |
| Backend MAC entries | 65,536 | `LB_BACKEND_MAC` (HashMap, `MAX_LB_BACKEND_MAC`) |
| DEVMAP redirect targets | 256 | `LB_DEVMAP` (DevMap) |
| RingBuf size | 1 MB | `EVENTS` |

### tc-conntrack

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Conntrack entries | Kernel-managed | Kernel netfilter via the `bpf_skb_ct_lookup` kfunc, bounded by `nf_conntrack_max` |
| Config entries | 1 | `CT_CONFIG` (Array) |

The program keeps no connection table of its own, so there is no BPF-side eviction: the kernel's conntrack table and its timeouts decide what is tracked. No RingBuf.

### tc-scrub

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Config entries | 1 | `SCRUB_CONFIG` (Array, index 0) |
| Max MSS clamp | 65,535 | `u16` field |
| Min TTL / hop limit | 255 | `u8` field |

No RingBuf, no rule maps. Single global config.

### tc-nat-ingress

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| DNAT rules (IPv4) | 256 | `NAT_DNAT_RULES` (Array, `MAX_NAT_RULES`) |
| DNAT rules (IPv6) | 128 | `NAT_DNAT_RULES_V6` (Array, `MAX_NAT_RULES_V6`) |
| NPTv6 rules | 64 | `NPTV6_RULES` (Array, `MAX_NPTV6_RULES`) |
| Hairpin CT entries | 16,384 with `nat.hairpin.enabled`, 1,024 otherwise | `NAT_HAIRPIN_CT` (LRU Hash, `MAX_HAIRPIN_CT`, sized at load) |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |

No RingBuf.

### tc-nat-egress

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| SNAT rules (IPv4) | 256 | `NAT_SNAT_RULES` (Array, `MAX_NAT_RULES`) |
| SNAT rules (IPv6) | 128 | `NAT_SNAT_RULES_V6` (Array, `MAX_NAT_RULES_V6`) |
| NPTv6 rules | 64 | `NPTV6_RULES` (Array, `MAX_NPTV6_RULES`) |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |

No RingBuf.

### tc-ids

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| IDS patterns | 10,240 | `IDS_PATTERNS` (HashMap, port+protocol key) |
| Source-keyed IDS patterns | 10,240 | `IDS_SRC_PATTERNS` (HashMap) |
| L7 inspection ports | 256 | `L7_PORTS` (HashMap, `MAX_L7_PORTS`) |
| L7 payload capture | 2,048 bytes | `MAX_L7_PAYLOAD` (compact: 512 bytes `SMALL_L7_PAYLOAD`) |
| Sampling rate | 0-100% | `IDS_SAMPLING_CONFIG` (Array, random threshold) |
| Tenant cgroups | 4,096 | `TENANT_CGROUP_MAP` (HashMap) |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |
| RingBuf size | 4 MB | `EVENTS` (two record sizes, 512 B and 2 KiB payload) |
| Backpressure threshold | 75% | Events dropped when buffer >75% full |

**Rationale for the 2 KiB payload budget**: full HTTP/1.1 request
headers, TLS ClientHello with SNI + ALPN + supported_groups +
signature_algorithms, gRPC HEADERS frames, and most database query
statements all fit below 2 KiB. The small-tier (512 B) still covers
HTTP request lines, TLS record headers, and protocol signatures -
it is selected when the TCP payload is ≤ 512 bytes, saving 1 536 B
per RingBuf entry. The 4 MiB ring buffer absorbs the larger events
without backpressure drops at typical enterprise rates.

The program forwards the payload; protocol detection runs in userspace.

### tc-threatintel

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| IOCs (IPv4) | `threatintel.max_entries` (derived, 4,096 to 4,194,304) | `THREATINTEL_IOCS` (LRU Hash, sized at load) |
| IOCs (IPv6) | `threatintel.max_entries` | `THREATINTEL_IOCS_V6` (LRU Hash, sized at load) |
| Bloom filter (IPv4) | `threatintel.max_entries` | `THREATINTEL_BLOOM_V4` (BloomFilter, sized at load) |
| Bloom filter (IPv6) | `threatintel.max_entries` | `THREATINTEL_BLOOM_V6` (BloomFilter, sized at load) |
| RingBuf size | 1 MB | `EVENTS` |
| Backpressure threshold | 75% | Events dropped when buffer >75% full |

The capacity follows the enabled feeds' `max_iocs` unless set by hand, up to four million IOCs per address family; LRU eviction handles overflow. An agent with no feed gets the 4,096-slot floor rather than a million empty slots.

### tc-dns

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| DNS payload capture | 512 bytes | `DNS_MAX_PAYLOAD` |
| RingBuf size | 256 KB | `DNS_EVENTS` |
| Captured protocols | 1 | UDP port 53 only |
| Backpressure threshold | 75% | Events dropped when buffer >75% full |

Raw DNS wire-format forwarded to userspace. No rule maps.

### tc-qos

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Pipes | 64 | `QOS_PIPE_CONFIG` (Array, `MAX_QOS_PIPES`) |
| Queues | 256 | `QOS_QUEUE_CONFIG` (Array, `MAX_QOS_QUEUES`) |
| Classifiers | 1,024 | `QOS_CLASSIFIERS` (HashMap, `MAX_QOS_CLASSIFIERS`) |
| Tracked flows | 65,536 | `QOS_FLOW_STATE` (LruPerCpuHash, `MAX_QOS_FLOW_STATES`) |
| Classifier lookup levels | 4 | 5-tuple → wildcard ports → wildcard src → wildcard all |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |
| RingBuf size | 1 MB | `EVENTS` |

The `tc_qos_ingress` program in the same object shares these maps.

### uprobe-dlp

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Concurrent SSL reads tracked | 10,240 | `SSL_READ_ARGS` (LRU Hash, per task) |
| DLP excerpt size | 4,096 bytes | `DLP_MAX_EXCERPT` (compact: 256 bytes `DLP_SMALL_EXCERPT`) |
| Hooked functions | 2 | `SSL_write`, `SSL_read` |
| Supported libraries | 2 | OpenSSL, BoringSSL |
| RingBuf size | 4 MB | `EVENTS` (two record sizes, 256 B and 4 KiB excerpt) |

Larger RingBuf because DLP events carry L7 payload content. There is no 75% cut here: a record is lost only when the ring is full.

### xdp-vip-announcer

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Virtual IPs | 256 | `VIP_SET` (HashMap, `MAX_VIPS`) |
| Interface MACs | 64 | `IFACE_MAC` (HashMap, `MAX_IFACE_MAC`) |
| Self-owned bindings | 256 | `SELF_OWNED_BINDINGS` (HashMap, `MAX_SELF_BINDINGS`) |

No RingBuf.

## Global Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Interface groups | 31 | Bits 0-30 in bitmask, shared across 6 programs |
| Interfaces tracked | 64 | `INTERFACE_GROUPS` max entries |
| Zones | 256 | `MAX_ZONE_ENTRIES` |
| Zone policies | 64 | `MAX_ZONE_POLICIES` |
| Tenant VLANs / interfaces | 1,024 each | `TENANT_VLAN_MAP` / `TENANT_IFINDEX_MAP` |
| Tenant subnets | 4,096 IPv4, 2,048 IPv6 | `TENANT_SUBNET_V4` / `TENANT_SUBNET_V6` (LPM Trie) |
| Total RingBuf memory | 13.25 MB | 4 MB each for `tc-ids` and `uprobe-dlp`, 1 MB each for the five other packet programs that report, 256 KB for `tc-dns`; each ring is private to its program |
| Tail-call chain depth | 2 | xdp-firewall → xdp-ratelimit → xdp-ratelimit-syncookie (or xdp-loadbalancer) |
| TC programs per hook | 7 ingress, 3 egress | TCX links appended in attach order; `tc-ids` on egress only with `inspect_egress` or the cgroup resolver |
| eBPF programs total | 16 | 7 XDP + 8 TC + 1 uprobe (`xdp-pass` is test-only) |
