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
| xdp-ratelimit | Rate limit configs | 10,240 |
| xdp-ratelimit | Tracked source IPs (bucket state) | 262,144 |
| xdp-ratelimit | Country CIDRs (per family) | 131,072 |
| xdp-ratelimit | Country tiers | 16 |
| xdp-ratelimit | SYN rate tracked IPs | 65,536 |
| xdp-ratelimit | DDoS connection table | 131,072 |
| xdp-ratelimit | Amplification protection ports | 64 |
| xdp-loadbalancer | Services | 4,096 |
| xdp-loadbalancer | Backends per service | 256 |
| xdp-loadbalancer | Backends total | 65,536 |
| tc-conntrack | IPv4 connections | 262,144 |
| tc-conntrack | IPv6 connections | 65,536 |
| tc-conntrack | Per-source counters | 65,536 |
| tc-nat-ingress | DNAT rules (IPv4) | 256 |
| tc-nat-ingress | DNAT rules (IPv6) | 128 |
| tc-nat-ingress | Exact-match NAT hash | 16,384 |
| tc-nat-ingress | NPTv6 rules | 64 |
| tc-nat-ingress | Hairpin CT entries | 16,384 |
| tc-nat-egress | SNAT rules (IPv4) | 256 |
| tc-nat-egress | SNAT rules (IPv6) | 128 |
| tc-nat-egress | NAT port allocations | 65,536 |
| tc-ids | IDS patterns | 10,240 |
| tc-ids | L7 inspection ports | 64 |
| tc-threatintel | IOCs per family | 1,048,576 |
| tc-threatintel | Bloom filter per family | 1,048,576 |
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
| IP set aliases | 255 | Index 0–254 (index 255 = overload blacklist) |
| Per-source state counters | 65,536 | `CT_SRC_COUNTERS` (HashMap, `CT_SRC_COUNTER_MAX`) |
| Per-rule state counters | 4,096 | `FW_RULE_STATE_COUNT` (Array, `MAX_FIREWALL_RULES`) |
| Interface groups | 31 | Bits 0–30 in `INTERFACE_GROUPS` bitmask (bit 31 = inversion) |
| IPv4 conntrack entries (shared) | 262,144 | `CT_TABLE_V4` (LRU Hash, pinned, `CT_MAX_ENTRIES_V4`) |
| IPv6 conntrack entries (shared) | 65,536 | `CT_TABLE_V6` (LRU Hash, pinned, `CT_MAX_ENTRIES_V6`) |
| DEVMAP redirect targets | 64 | `DEVMAP` |
| CPUMAP CPU targets | 64 | `CPUMAP` |
| Tail-call programs | 4 | `XDP_PROG_ARRAY` (ProgramArray) |
| Config command payload | 128 bytes | `CONFIG_RINGBUF` (`MAX_CONFIG_CMD_PAYLOAD`) |
| User RingBuf (config push) | 64 KB | `CONFIG_RINGBUF` (`CONFIG_RINGBUF_SIZE`) |
| RingBuf size | 1 MB | `EVENTS` |

### xdp-ratelimit

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Rate limit configs | 10,240 | `RATELIMIT_CONFIG` (HashMap) |
| Tracked source IPs (all algorithms) | 262,144 | `RL_BUCKETS` (LruPerCpuHash, `MAX_RL_BUCKET_ENTRIES`) |
| Country tiers | 16 | `RL_TIER_CONFIG` (Array, `MAX_RL_TIERS`) |
| Country CIDRs (IPv4) | 131,072 | `RL_LPM_SRC_V4` (LPM Trie, `MAX_RL_LPM_ENTRIES`) |
| Country CIDRs (IPv6) | 131,072 | `RL_LPM_SRC_V6` (LPM Trie, `MAX_RL_LPM_ENTRIES`) |
| SYN rate tracked IPs | 65,536 | `SYN_RATE_TRACKER` (LruPerCpuHash) |
| ICMP rate tracked IPs | 65,536 | `ICMP_RATE_BUCKETS` (LruPerCpuHash) |
| Amplification protection ports | 64 | `AMP_PROTECT_CONFIG` (HashMap) |
| Amplification rate tracked sources | 65,536 | `AMP_RATE_BUCKETS` (LruPerCpuHash) |
| DDoS connection table | 131,072 | `CONN_TABLE` (LruPerCpuHash) |
| Half-open connection counters | 65,536 | `HALF_OPEN_COUNTERS` (LruPerCpuHash) |
| Flood counters | 65,536 | `FLOOD_COUNTERS` (LruPerCpuHash) |
| SYN cookie secrets | 1 | `SYNCOOKIE_SECRET` (Array, 32 bytes) |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |
| RingBuf size | 1 MB | `EVENTS` |

**Memory footprint** (`RL_BUCKETS`, 64 bytes/entry, per-CPU):

| CPUs | `RL_BUCKETS` only | All DDoS LruPerCpuHash maps combined |
|------|-------------------|--------------------------------------|
| 4 | ~64 MB | ~96 MB |
| 8 | ~128 MB | ~192 MB |
| 16 | ~256 MB | ~384 MB |

### xdp-loadbalancer

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Services | 4,096 | `LB_SERVICES` (HashMap, `MAX_LB_SERVICES`) |
| Backends per service | 256 | `LB_MAX_BACKENDS_V2` (slot: `service_id × 256 + [0..255]`) |
| Backends total | 65,536 | `LB_BACKENDS` (HashMap, `MAX_LB_BACKENDS_TOTAL`) |
| Round-robin state entries | 4,096 | `LB_RR_STATE` (PerCpuArray, `MAX_LB_SERVICES`) |
| RingBuf size | 1 MB | `EVENTS` |

### tc-conntrack

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| IPv4 connections | 262,144 | `CT_TABLE_V4` (LRU Hash, pinned, `CT_MAX_ENTRIES_V4`) |
| IPv6 connections | 65,536 | `CT_TABLE_V6` (LRU Hash, pinned, `CT_MAX_ENTRIES_V6`) |
| Per-source connection counters | 65,536 | `CT_SRC_COUNTER` (`CT_SRC_COUNTER_MAX`) |
| TCP states | 9 | `SYN_SENT` through `TIME_WAIT` |
| UDP states | 2 | `NEW`, `ESTABLISHED` |
| ICMP states | 2 | `REQUEST`, `REPLY` |

LRU eviction handles overflow — oldest connections are evicted automatically. No RingBuf.

### tc-scrub

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Config entries | 1 | `SCRUB_CONFIG` (PerCpuArray, index 0) |
| Max MSS clamp | 65,535 | `u16` field |
| Min TTL / hop limit | 255 | `u8` field |

No RingBuf, no rule maps. Single global config.

### tc-nat-ingress

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| DNAT rules (IPv4) | 256 | `NAT_DNAT_RULES` (Array, `MAX_NAT_RULES`) |
| DNAT rules (IPv6) | 128 | `NAT_DNAT_RULES_V6` (Array, `MAX_NAT_RULES_V6`) |
| Exact-match NAT entries | 16,384 | `NAT_HASH_DNAT` (HashMap, `MAX_NAT_HASH_EXACT`) |
| NPTv6 rules | 64 | `NPTV6_RULES` (Array, `MAX_NPTV6_RULES`) |
| Hairpin CT entries | 16,384 | `NAT_HAIRPIN_CT` (LRU Hash, `MAX_HAIRPIN_CT`) |
| IPv4 conntrack entries (shared) | 262,144 | `CT_TABLE_V4` (LRU Hash, pinned) |
| IPv6 conntrack entries (shared) | 65,536 | `CT_TABLE_V6` (LRU Hash, pinned) |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |

No RingBuf.

### tc-nat-egress

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| SNAT rules (IPv4) | 256 | `NAT_SNAT_RULES` (Array, `MAX_NAT_RULES`) |
| SNAT rules (IPv6) | 128 | `NAT_SNAT_RULES_V6` (Array, `MAX_NAT_RULES_V6`) |
| Exact-match NAT entries | 16,384 | `NAT_HASH_SNAT` (HashMap, `MAX_NAT_HASH_EXACT`) |
| NPTv6 rules | 64 | `NPTV6_RULES` (Array, `MAX_NPTV6_RULES`) |
| Port allocations | 65,536 | `NAT_PORT_ALLOC` (LRU Hash, `MAX_NAT_PORT_ALLOC`) |
| IPv4 conntrack entries (shared) | 262,144 | `CT_TABLE_V4` (LRU Hash, pinned) |
| IPv6 conntrack entries (shared) | 65,536 | `CT_TABLE_V6` (LRU Hash, pinned) |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |

No RingBuf.

### tc-ids

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| IDS patterns | 10,240 | `IDS_PATTERNS` (HashMap, port+protocol key) |
| L7 inspection ports | 64 | `L7_PORTS` (HashMap) |
| L7 payload capture | 2,048 bytes | `MAX_L7_PAYLOAD` (compact: 512 bytes `SMALL_L7_PAYLOAD`) |
| Sampling rate | 0–100% | `IDS_SAMPLING_CONFIG` (Array) |
| L7 signatures detected | 4 | HTTP GET, HTTP POST, TLS, SSH |
| Interface groups | 31 | Shared `INTERFACE_GROUPS` |
| RingBuf size | 4 MB | `EVENTS` (variable-size via `bpf_dynptr`) |
| Backpressure threshold | 75% | Events dropped when buffer >75% full |

**Rationale for the 2 KiB payload budget**: full HTTP/1.1 request
headers, TLS ClientHello with SNI + ALPN + supported_groups +
signature_algorithms, gRPC HEADERS frames, and most database query
statements all fit below 2 KiB. The small-tier (512 B) still covers
HTTP request lines, TLS record headers, and protocol signatures —
it is selected when the TCP payload is ≤ 512 bytes, saving 1 536 B
per RingBuf entry. The 4 MiB ring buffer absorbs the larger events
without backpressure drops at typical enterprise rates.

### tc-threatintel

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| IOCs (IPv4) | 1,048,576 | `THREATINTEL_IOCS` (LRU Hash, `THREATINTEL_MAX_ENTRIES`) |
| IOCs (IPv6) | 1,048,576 | `THREATINTEL_IOCS_V6` (LRU Hash, `THREATINTEL_MAX_ENTRIES`) |
| Bloom filter (IPv4) | 1,048,576 | `THREATINTEL_BLOOM_V4` (BloomFilter) |
| Bloom filter (IPv6) | 1,048,576 | `THREATINTEL_BLOOM_V6` (BloomFilter) |
| RingBuf size | 1 MB | `EVENTS` |
| Backpressure threshold | 75% | Events dropped when buffer >75% full |

Supports 1M+ IOCs per address family. LRU eviction handles overflow.

### tc-dns

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| DNS payload capture | 512 bytes | `DNS_MAX_PAYLOAD` |
| RingBuf size | 256 KB | `DNS_EVENTS` |
| Captured protocols | 1 | UDP port 53 only |

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

### uprobe-dlp

| Resource | Limit | Map / Constant |
|----------|-------|----------------|
| Concurrent SSL reads tracked | 10,240 | `SSL_READ_ARGS` (HashMap, per-task) |
| DLP excerpt size | 4,096 bytes | `DLP_MAX_EXCERPT` (compact: 256 bytes `DLP_SMALL_EXCERPT`) |
| Hooked functions | 2 | `SSL_write`, `SSL_read` |
| Supported libraries | 2 | OpenSSL, BoringSSL |
| RingBuf size | 4 MB | `EVENTS` (variable-size via `bpf_dynptr`) |

Larger RingBuf because DLP events carry L7 payload content.

## Global Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Interface groups | 31 | Bits 0–30 in bitmask, shared across 6 programs |
| Interfaces tracked | 64 | `INTERFACE_GROUPS` max entries |
| Zones | 256 | `MAX_ZONE_ENTRIES` |
| Zone policies | 64 | `MAX_ZONE_POLICIES` |
| Total RingBuf memory | 10.25 MB | Sum of all program RingBuf allocations |
| Pinned CT table memory | ~17 MB | `CT_TABLE_V4` (262K × 48 B) + `CT_TABLE_V6` (65K × 72 B) |
| Tail-call chain depth | 2 | xdp-firewall → xdp-ratelimit → xdp-ratelimit-syncookie (or xdp-loadbalancer) |
| TC programs per hook | 6 ingress, 2 egress | Ordered by priority in TC classifier chain |
| eBPF programs total | 14 | 5 XDP + 8 TC + 1 uprobe |
