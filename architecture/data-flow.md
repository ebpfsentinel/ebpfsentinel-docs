# Data Flow

## Packet Processing Pipeline

### 1. Ingress (Kernel)

```
Network Interface
    │
    ▼
XDP Hook (earliest possible)
    │
    ├── xdp-firewall
    │   ├── LPM trie lookup (CIDR rules)
    │   ├── Linear scan (port/protocol/VLAN rules)
    │   ├── XDP_DROP (denied) ──→ [end]
    │   ├── XDP_PASS + emit RingBuf event
    │   └── tail_call → xdp-ratelimit
    │       ├── Country LPM tier lookup (RL_LPM_SRC_V4/V6)
    │       ├── DDoS protections (SYN/ICMP/UDP amp/conntrack)
    │       ├── Per-IP rate check (PerCPU hash)
    │       ├── XDP_DROP (rate exceeded or DDoS detected) ──→ [end]
    │       └── XDP_PASS + emit RingBuf event
    │
    ▼
Kernel Network Stack (SKB allocation)
    │
    ▼
TC Hook (classifier)
    │
    ├── tc-ids
    │   ├── Sampling (bpf_get_prandom_u32)
    │   ├── L7 detection (bpf_strncmp)
    │   ├── Backpressure check (bpf_ringbuf_query)
    │   └── Emit PacketEvent to RingBuf
    │
    ├── tc-threatintel
    │   ├── Bloom filter pre-check
    │   ├── VLAN quarantine (bpf_skb_vlan_push)
    │   └── Emit PacketEvent to RingBuf
    │
    └── tc-dns
        ├── UDP:53 identification
        └── Emit DNS packet to RingBuf
```

### 1b. Egress (Kernel)

```
Application
    │
    ▼
TC Hook (egress)
    │
    ├── tc-nat-egress
    │   ├── SNAT / masquerade rule scan
    │   └── Source IP/port rewrite + checksum update
    │
    └── tc-qos
        ├── 4-level progressive wildcard classifier lookup
        ├── Token bucket bandwidth check (per-flow state)
        ├── Random loss emulation (bpf_get_prandom_u32)
        ├── Delay annotation
        ├── TC_ACT_SHOT (token bucket exhausted or loss hit) ──→ [dropped]
        └── TC_ACT_OK + emit QosEvent to RingBuf
    │
    ▼
Wire
```

### 2. Event Dispatch (Userspace)

```
RingBuf consumers (async tasks)
    │
    ▼
EventDispatcher
    │
    ├── Route by program source
    │
    ▼
Domain Engines (parallel evaluation, GeoIP-aware)
    ├── Firewall Engine    → rule audit
    ├── IDS Engine         → country-aware sampling → regex evaluation → per-country thresholds
    ├── IPS Engine         → blacklist update → /24 subnet LPM injection → eBPF map sync
    ├── DDoS Engine        → EWMA rate analysis → per-country thresholds → country CIDR auto-block
    ├── DLP Engine         → pattern matching
    ├── Threat Intel Engine → full IOC correlation → country confidence boost
    ├── L7 Firewall Engine → protocol parsing → src/dst country matching → rule evaluation
    ├── DNS Engine         → cache update → blocklist check → high-risk country reputation
    ├── LB Engine          → forward/no-backend metrics
    ├── QoS Engine         → shaping metrics → pipe/queue stats
    └── Domain Reputation  → scoring → auto-block decision
```

### 3. Alert Pipeline

```
Domain Engine alerts
    │
    ▼
Alert Enrichment
    ├── DNS reverse lookup (src_ip → domain, dst_ip → domain)
    ├── Domain reputation scoring
    └── GeoIP enrichment (country, city, ASN)
    │
    ▼
AlertRouter
    ├── Deduplication (time-window suppression)
    ├── Throttling (per-source rate limit)
    ├── Routing (severity × component → sender list)
    │
    ▼
Senders (with circuit breaker)
    ├── Email (SMTP)
    ├── Webhook (HTTP POST)
    └── Log (file)
```

### 4. External Interfaces

```
REST API (Axum)
    ├── Rule CRUD (23 endpoints)
    ├── Status / health
    ├── Config reload
    └── OpenAPI / Swagger UI

gRPC (tonic)
    ├── AlertStreamService (server-streaming)
    └── Health check + reflection

Prometheus
    └── /metrics endpoint (counters, histograms, gauges)
```

## Hairpin NAT Data Flow

When an internal client accesses a DNAT service via the external IP, and both client and server are on the same internal subnet:

```
Internal Client (192.168.1.100)
    │
    │  dst = External IP (203.0.113.1:443)
    ▼
tc-nat-ingress (forward path)
    │
    ├── DNAT lookup: 203.0.113.1:443 → 192.168.1.50:443
    ├── Hairpin detection: src (192.168.1.100) and dst (192.168.1.50)
    │   are both in internal_subnet (192.168.1.0/24)
    ├── Apply DNAT: dst → 192.168.1.50:443
    ├── Apply hairpin SNAT: src → 192.168.1.1 (hairpin_snat_ip)
    ├── Store reverse mapping in NAT_HAIRPIN_CT
    │
    ▼
Internal Server (192.168.1.50)
    │
    │  reply: src = 192.168.1.50:443, dst = 192.168.1.1
    ▼
tc-nat-ingress (return path)
    │
    ├── NAT_HAIRPIN_CT lookup by 5-tuple
    ├── Reverse hairpin SNAT: dst → 192.168.1.100 (original client)
    ├── Reverse DNAT: src → 203.0.113.1:443 (external IP)
    │
    ▼
Internal Client (192.168.1.100)
    receives reply from 203.0.113.1:443 ✓
```

## XDP→TC Metadata Flow

When XDP passes a packet, it writes metadata using `bpf_xdp_adjust_meta`:

```
XDP program writes:
  ┌──────────┬──────────┬────────┐
  │ rule_id  │ flags    │ status │
  └──────────┴──────────┴────────┘

TC program reads metadata without re-parsing packet headers.
```

This avoids duplicate header parsing across hook points.

## eBPF↔Userspace Map Synchronization

Some eBPF maps are updated from userspace:

| Map | Direction | Purpose |
|-----|-----------|---------|
| Firewall LPM tries | Userspace → Kernel | Rule updates |
| Rate limit configs | Userspace → Kernel | Policy changes |
| Rate limit country LPM (×2) | Userspace → Kernel | GeoIP country tier reload |
| Rate limit tier configs | Userspace → Kernel | Country tier config reload |
| DDoS protection configs | Userspace → Kernel | SYN/ICMP/amp thresholds, conntrack settings |
| Threat intel Bloom filter | Userspace → Kernel | IOC feed refresh |
| Threat intel LRU hash maps | Userspace → Kernel | IOC exact-match confirmation |
| IPS blacklist | Userspace → Kernel | Auto-block IPs |
| DNS blocklist | Userspace → Kernel | Domain blocks |
| LB service/backend maps | Userspace → Kernel | Load balancer service definitions |
| LB metrics (PerCpuArray) | Kernel → Userspace | Per-CPU forwarding counters |
| QoS pipe/queue/classifier configs | Userspace → Kernel | QoS policy changes |
| QoS metrics (PerCpuArray) | Kernel → Userspace | Per-CPU shaping counters |
