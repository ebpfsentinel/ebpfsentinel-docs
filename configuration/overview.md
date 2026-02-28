# Configuration Overview

eBPFsentinel is configured via a single YAML file. Only `agent.interfaces` is required — everything else is optional and defaults to sensible values.

## Configuration Precedence

**CLI flags > Environment variables > YAML file > Defaults**

## File Location

The default configuration file path is `/etc/ebpfsentinel/config.yaml`. Override with:

```bash
ebpfsentinel-agent --config /path/to/config.yaml
```

## Minimal Configuration

```yaml
agent:
  interfaces: [eth0]
```

This starts the agent with all features disabled except basic packet forwarding. Enable features by adding their configuration sections.

## Configuration Sections

| Section | Required | Description |
|---------|----------|-------------|
| [`agent`](agent.md) | Yes | Interfaces, ports, log level/format |
| [`firewall`](firewall.md) | No | L3/L4 rules, default policy, VLAN |
| [`ids`](ids.md) | No | Intrusion detection rules, sampling |
| [`ips`](ips.md) | No | Intrusion prevention, blacklist, whitelist |
| [`dlp`](dlp.md) | No | Data loss prevention patterns |
| [`l7`](l7.md) | No | L7 protocol-aware firewall rules |
| [`ratelimit`](ratelimit.md) | No | Rate limiting rules and algorithms |
| [`ddos`](ddos.md) | No | DDoS protection and detection policies |
| [`loadbalancer`](loadbalancer.md) | No | L4 load balancing services (TCP/UDP/TLS) |
| [`threatintel`](threatintel.md) | No | Threat intelligence feeds |
| [`dns`](dns.md) | No | DNS cache, blocklists, reputation |
| [`alerting`](alerting.md) | No | Alert routing, senders |
| [`audit`](audit.md) | No | Audit trail retention |
| [`auth`](auth.md) | No | Authentication (JWT, OIDC, API keys) |
| [`tls`](tls.md) | No | TLS certificates for REST/gRPC |

## Per-Feature Examples

The `config/examples/` directory contains standalone configuration files for each feature:

| File | Feature |
|------|---------|
| `firewall.yaml` | L3/L4 rules, LPM trie CIDR, port ranges, VLAN, IPv6 |
| `ids.yaml` | Rules, kernel-side sampling, L7 detection, threshold |
| `ips.yaml` | Blacklist config, whitelist, auto-threshold |
| `dlp.yaml` | Credit card, SSN, API key, JWT, email patterns |
| `l7.yaml` | HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB rules |
| `ratelimit.yaml` | 5 algorithms, per-CPU buckets, SYN cookie |
| `ddos.yaml` | SYN/ICMP/UDP amplification protection, connection tracking, policies |
| `loadbalancer.yaml` | TCP/UDP/TLS passthrough services, backend pools, health checks |
| `threatintel.yaml` | CSV, JSON, STIX feeds, Bloom filter, VLAN quarantine |
| `dns.yaml` | Cache tuning, inline blocklist, external feeds |
| `alerting.yaml` | SMTP email, webhook, log routes, dedup, throttle |
| `audit.yaml` | Retention, buffer size, storage path |
| `auth.yaml` | API keys, JWT (RS256), OIDC (JWKS), roles |
| `tls.yaml` | Certificate and key paths |

Each file is a standalone, valid configuration — copy one and customize it.

## Environment Variables

Override any config value via environment:

```bash
EBPFSENTINEL_HOST=0.0.0.0     # API listen host
EBPFSENTINEL_PORT=8080        # API listen port
RUST_LOG=info                 # Log level
```

Per-module log filtering: `RUST_LOG=domain=debug,adapters::http=trace`

## Hot Reload

The agent watches the config file for changes and reloads rules without restart:

```bash
# Send SIGHUP
kill -HUP $(pidof ebpfsentinel-agent)

# Or via REST API
curl -X POST http://localhost:8080/api/v1/config/reload

# Or let the file watcher detect changes automatically
```

## Validation

Configuration is validated at load time. Invalid configuration produces clear error messages:

- Invalid CIDR subnets → parse error with the offending value
- Invalid regex patterns → compilation error with pattern context
- Missing required fields → field name and section
- Rule count limits → maximum 4096 rules per domain (prevents OOM)
- Regex size limits → 10 MiB size, 200 nesting depth (prevents ReDoS)
