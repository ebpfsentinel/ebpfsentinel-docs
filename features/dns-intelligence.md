# DNS Intelligence

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: tc-dns**

## Overview

DNS Intelligence provides passive DNS capture, domain-to-IP caching, and domain blocklists with feed integration. The `tc-dns` eBPF program captures DNS query/response packets at the TC classifier level and forwards them to the userspace engine for analysis, caching, and blocklist evaluation.

## How It Works

### Kernel Side (tc-dns)

The TC classifier identifies DNS traffic (UDP and TCP port 53) and emits DNS query/response pairs to userspace via RingBuf. For TCP DNS, the eBPF program parses the variable-length TCP header, skips the 2-byte DNS length prefix, and sets `FLAG_TCP` (0x04) on the event so userspace can distinguish transport.

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

Encrypted DNS detection emits security alerts to the alert pipeline (webhooks, email, OTLP, gRPC stream) with MITRE ATT&CK technique T1071.004 (DNS). Enterprise adds policy enforcement (block/allow-list).

See [Operational Essentials: Encrypted DNS Detection](operational-essentials.md#encrypted-dns-detection-dohdot) for details.

## DNS Coverage Summary

| Transport | Capture Method | Analysis |
|-----------|---------------|----------|
| **UDP port 53** | tc-dns eBPF (kernel) | Full: parsing, caching, blocklist, reputation, alerts |
| **TCP port 53** | tc-dns eBPF (kernel) | Full: parsing, caching, blocklist, reputation, alerts |
| **DoH (HTTPS/443)** | L7 TLS SNI match (userspace) | Detection + alert (T1071.004) |
| **DoT (TLS/853)** | L7 port match (userspace) | Detection + alert (T1071.004) |

## Known Limitations

### TCP DNS reassembly

TCP DNS responses that span multiple TCP segments are only partially captured: the `tc-dns` eBPF program captures the first segment of each packet. This is sufficient for parsing the DNS header and initial answer records, but very large zone transfers (AXFR/IXFR) spanning many segments may be truncated. Standard TCP DNS queries and responses fit within a single segment and are fully captured.

> **Note:** Encrypted DNS (DoH/DoT) is detected separately via the L7 pipeline and is not affected by this limitation. See the coverage table above.

## Alert Pipeline Integration

All DNS enforcement actions emit security alerts through the unified alert pipeline (webhooks, email, OTLP, gRPC stream, SIEM):

| Event | Severity | MITRE ATT&CK | Rule ID Format |
|-------|----------|---------------|----------------|
| Blocklist match (block) | High | T1071.004 — DNS | `dns-blocklist:{pattern}` |
| Blocklist match (alert) | Medium | T1071.004 — DNS | `dns-blocklist:{pattern}` |
| Blocklist match (log) | Low | T1071.004 — DNS | `dns-blocklist:{pattern}` |
| Reputation auto-block | High | T1568 — Dynamic Resolution | `dns-reputation:{score}` |
| Encrypted DNS (DoH/DoT) | Medium | T1071.004 — DNS | `dns-encrypted:{protocol}:{resolver}` |

Alerts include `matched_domain` for correlation and are routed through the same dedup/throttle/route matching as all other alert types.

## Metrics

- `ebpfsentinel_dns_cache_size` — current DNS cache entry count
- `ebpfsentinel_dns_queries_total` — DNS queries observed
- `ebpfsentinel_dns_blocked_total` — domains blocked by blocklist
- `ebpfsentinel_domain_reputation_tracked` — domains with reputation scores
