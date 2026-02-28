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
      refresh_interval: 3600
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

## Metrics

- `ebpfsentinel_dns_cache_size` — current DNS cache entry count
- `ebpfsentinel_dns_queries_total` — DNS queries observed
- `ebpfsentinel_dns_blocked_total` — domains blocked by blocklist
- `ebpfsentinel_domain_reputation_tracked` — domains with reputation scores
