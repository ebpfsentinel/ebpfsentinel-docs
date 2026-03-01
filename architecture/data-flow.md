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
| IPS blacklist | Userspace → Kernel | Auto-block IPs |
| DNS blocklist | Userspace → Kernel | Domain blocks |
| LB service/backend maps | Userspace → Kernel | Load balancer service definitions |
| LB metrics (PerCpuArray) | Kernel → Userspace | Per-CPU forwarding counters |
