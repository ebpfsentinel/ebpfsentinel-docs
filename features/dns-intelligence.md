# DNS Intelligence

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: tc-dns**

## Overview

DNS Intelligence provides passive DNS capture, domain-to-IP caching, and domain blocklists with feed integration. The `tc-dns` eBPF program captures DNS query/response packets at the TC classifier level and forwards them to the userspace engine for analysis, caching, and blocklist evaluation.

## How It Works

### Kernel Side (tc-dns)

The TC classifier identifies DNS traffic (UDP port 53) and emits DNS query/response pairs to userspace via RingBuf.

### Userspace Side

1. **DNS parsing** — wire-format DNS packets are parsed to extract query names, response addresses, TTLs
2. **Domain-to-IP cache** — maintains a mapping of domains to resolved IPs (used for alert enrichment across all domains)
3. **Blocklist evaluation** — queries are checked against inline patterns and external feed-sourced blocklists
4. **Threat intel injection** — when a blocked domain resolves to an IP, that IP is automatically injected into the threat intel kernel map (`THREATINTEL_IOCS`). The IP is removed when the DNS TTL expires (+grace period). This bridges domain-level blocklists with IP-level kernel enforcement
5. **Domain reputation integration** — DNS data feeds into the domain reputation scoring engine. CTI matches contribute a `CtiMatch` factor (weight 0.8) to the score; domains exceeding the `auto_block_threshold` are auto-blocked
6. **GeoIP reputation scoring** — domains resolving to IPs in `high_risk_countries` receive a `HighRiskCountry` reputation factor (weight 0.4), accelerating their path toward the auto-block threshold

### High-Risk Country Reputation

When `high_risk_countries` is configured in the reputation section, DNS responses are checked against GeoIP data. Domains resolving to IPs geolocated in listed countries accumulate negative reputation faster:

```yaml
dns:
  reputation:
    enabled: true
    auto_block_threshold: 0.8
    high_risk_countries: [RU, CN, KP, IR]
```

### Blocklist Matching

- **Exact match** — `malware.example.com`
- **Wildcard** — `*.ad-network.com`
- **Regex** — custom patterns for DGA (Domain Generation Algorithm) detection
- **Feed-sourced** — external blocklist feeds refreshed on a schedule

## Configuration

```yaml
dns:
  cache_size: 100000         # Maximum cache entries
  cache_ttl: 3600            # Default TTL in seconds
  blocklist:
    - domain: "malware.example.com"
      action: block
    - domain: "*.ad-network.com"
      action: block
    - domain: "*.tracking.com"
      action: log
  feeds:
    - name: abuse-ch-domains
      url: "https://urlhaus.abuse.ch/downloads/hostfile/"
      format: plaintext
      refresh_interval_secs: 3600
  reputation:
    enabled: true
    auto_block_threshold: 0.8    # Block domains scoring above this
    decay_rate: 0.01             # Score decay per hour
```

See [Configuration: DNS Intelligence](../configuration/dns.md) for the full reference.

## CLI Usage

```bash
# View DNS cache
ebpfsentinel-agent dns cache

# Lookup a specific domain
ebpfsentinel-agent dns cache --domain example.com

# DNS statistics
ebpfsentinel-agent dns stats

# View blocklist
ebpfsentinel-agent dns blocklist

# Flush DNS cache
ebpfsentinel-agent dns flush

# Domain reputation
ebpfsentinel-agent domains reputation
ebpfsentinel-agent domains reputation --domain suspicious.com --min-score 0.5

# Block/unblock domains
ebpfsentinel-agent domains block malware.example.com
ebpfsentinel-agent domains unblock example.com
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/dns/cache` | List DNS cache entries (filterable) |
| DELETE | `/api/v1/dns/cache` | Flush DNS cache |
| GET | `/api/v1/dns/stats` | DNS cache and blocklist statistics |
| GET | `/api/v1/dns/blocklist` | List loaded blocklist rules |
| GET | `/api/v1/domains/reputation` | Query domain reputations |
| POST | `/api/v1/domains/blocklist` | Add domain to runtime blocklist |
| DELETE | `/api/v1/domains/blocklist/{domain}` | Remove domain from blocklist |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/tc-dns/` | TC classifier kernel program |
| `domain` | `crates/domain/src/dns/` | DNS engine (parser, cache, blocklist) |
| `domain` | `crates/domain/src/domain_reputation/` | Domain reputation engine |
| `ports` | `crates/ports/src/primary/dns.rs` | Port trait |
| `application` | `crates/application/src/dns_service_impl.rs` | App service |

## Encrypted DNS Detection (DoH/DoT)

eBPFsentinel detects DNS traffic that bypasses traditional UDP/53 monitoring via encryption:

| Protocol | Detection Method | Criteria |
|----------|-----------------|----------|
| **DoT** | Port-based | Destination port 853 (TCP/TLS) |
| **DoH** | SNI-based | TLS ClientHello SNI matches known DoH resolvers |

Built-in DoH resolver domains are checked (dns.google, cloudflare-dns.com, dns.quad9.net, etc.). Custom resolvers can be added via config:

```yaml
dns:
  doh_resolvers:
    - internal-doh.corp.local
```

Detection is **passive** (informational logging + Prometheus metric). Enterprise adds policy enforcement (block/allow-list).

See [Operational Essentials: Encrypted DNS Detection](operational-essentials.md#encrypted-dns-detection-dohdot) for details.

## DNS Coverage Summary

| Transport | Capture Method | Analysis |
|-----------|---------------|----------|
| **UDP port 53** | tc-dns eBPF (kernel) | Full: parsing, caching, blocklist, reputation |
| **DoH (HTTPS/443)** | L7 TLS SNI match (userspace) | Detection only: resolver identified, logged, metric emitted |
| **DoT (TLS/853)** | L7 port match (userspace) | Detection only: resolver identified, logged, metric emitted |
| **TCP port 53** | Not captured | See limitation below |

## Known Limitations

### TCP DNS (port 53) is not captured

The `tc-dns` eBPF program only captures DNS traffic over **UDP port 53**. DNS queries and responses over **TCP port 53** (plaintext) are not intercepted. This affects:

1. **DNS tunneling** — Tools like `iodine` or `dnscat2` that use TCP DNS will not be captured by the DNS engine.

2. **Large DNS responses** — When a UDP DNS response is truncated (`TC` flag set), resolvers retry over TCP. These retried responses (large record sets, DNSSEC signatures, zone transfers AXFR/IXFR) will not appear in the DNS cache.

EDNS(0) responses up to the negotiated UDP buffer size (commonly 1232-4096 bytes) are captured normally since they remain on UDP.

> **Note:** Encrypted DNS (DoH/DoT) is detected separately via the L7 pipeline and is not affected by this limitation. See the coverage table above.

### DNS enforcement actions are not alerted

Blocklist hits and reputation-based auto-blocks currently operate silently: IPs are injected into eBPF maps and metrics are emitted, but **no security alert** is sent to the alert pipeline (webhook, email, OTLP, gRPC stream). Operators must monitor logs or Prometheus metrics to observe DNS enforcement actions. This is a known gap planned for a future epic.

## Metrics

- `ebpfsentinel_dns_cache_size` — current DNS cache entry count
- `ebpfsentinel_dns_queries_total` — DNS queries observed
- `ebpfsentinel_dns_blocked_total` — domains blocked by blocklist
- `ebpfsentinel_domain_reputation_tracked` — domains with reputation scores
