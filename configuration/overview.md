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
| `interface_groups` | No | Named interface groups for rule scoping |
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
| [`geoip`](geoip.md) | No | GeoIP enrichment (MaxMind databases) |
| [`audit`](audit.md) | No | Audit trail retention |
| [`auth`](auth.md) | No | Authentication (JWT, OIDC, API keys) |
| [`tls`](tls.md) | No | TLS certificates for REST/gRPC |
| [`conntrack`](conntrack.md) | No | Connection tracking flood detection thresholds |
| `container` | No | Container resolver, Docker enricher, Kubernetes enricher |
| [`nat`](nat.md) | No | SNAT, DNAT, masquerade, NPTv6, hairpin NAT |
| [`routing`](routing.md) | No | Multi-WAN gateways, health checks, GeoIP routing |
| [`zones`](zones.md) | No | Network zone segmentation, inter-zone policies |
| [`qos`](qos.md) | No | QoS pipes, queues, classifiers, traffic shaping |
| `auto_response` | No | Auto block/throttle on alerts (max 3 severity-based policies) |
| `auto_capture` | No | Event-triggered PCAP on high-severity alerts (max 60s) |

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
| `geoip.yaml` | MaxMind account, URL, or local file GeoIP databases |
| `audit.yaml` | Retention, buffer size, storage path |
| `auth.yaml` | API keys, JWT (RS256), OIDC (JWKS), roles |
| `tls.yaml` | Certificate and key paths |
| `conntrack.yaml` | Connection tracking timeouts, limits, flood thresholds |
| `nat.yaml` | SNAT, DNAT, masquerade, port forwarding, NPTv6, hairpin |
| `routing.yaml` | Multi-WAN gateways, health checks, GeoIP routing |
| `zones.yaml` | Network zone definitions, inter-zone policies |
| `qos.yaml` | Pipes, queues, classifiers, traffic shaping profiles |

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

The agent watches the config file for changes and applies them without restart — including dynamically loading and unloading eBPF kernel programs when features are enabled or disabled:

```bash
# Send SIGHUP
kill -HUP $(pidof ebpfsentinel-agent)

# Or via REST API
curl -X POST http://localhost:8080/api/v1/config/reload

# Or let the file watcher detect changes automatically (500ms debounce)
```

All 10 eBPF programs (XDP, TC, uprobe) support dynamic load/unload. The XDP tail-call chain is automatically rewired when programs are added or removed. Pinned maps preserve kernel state (connection tracking, counters) across reloads.

See [Hot Reload](../operations/hot-reload.md) for the full reference.

## Validation

Configuration is validated at load time. Invalid configuration produces clear error messages:

- Invalid CIDR subnets → parse error with the offending value
- Invalid regex patterns → compilation error with pattern context
- Missing required fields → field name and section
- Rule count limits → maximum 4096 rules per domain (prevents OOM)
- Regex size limits → 10 MiB size, 200 nesting depth (prevents ReDoS)

## Security-Related Defaults

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent.grpc_reflection` | `bool` | `false` | gRPC reflection disabled by default for security |
| `auth.api_key_salt` | `string` | random | Salt for API key hashing. Random 32-byte generated if omitted |
| `tls.allow_tls12` | `bool` | `false` | TLS 1.3 only by default. Set `true` to allow TLS 1.2 for legacy clients |
