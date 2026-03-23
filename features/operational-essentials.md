# Operational Essentials

Core operational features for incident response, observability, and network investigation.

## OTLP Export

Export alerts as OpenTelemetry Logs to any OTLP-compatible backend (Grafana Tempo, Jaeger, Elastic APM, Datadog, etc.).

### Configuration

```yaml
alerting:
  otlp:
    endpoint: "http://otel-collector:4317"
    protocol: grpc   # or "http"
    timeout_ms: 5000
  routes:
    - name: otlp-all
      destination: otlp
      min_severity: low
```

### OTLP Log Attributes

| Attribute | Source |
|-----------|--------|
| `severity_number` | Alert severity (Info/Warn/Error/Fatal) |
| `body` | Full alert JSON payload |
| `mitre.technique.id` | MITRE ATT&CK technique |
| `alert.component` | Source component (ids, dlp, etc.) |
| `alert.rule_id` | Matched rule ID |
| `service.name` | `ebpfsentinel` |
| `service.version` | Agent version |

Delivery is **best-effort** (fire-and-forget). Enterprise adds durable buffer, at-least-once delivery, and OTLP Metrics export.

---

## Manual Response Actions

Time-bounded block or throttle actions with automatic TTL expiry. No permanent stale rules.

### API

```bash
# Block an IP for 1 hour
POST /api/v1/responses/manual
{"action": "block_ip", "target": "1.2.3.4", "ttl": "1h"}

# Throttle a CIDR for 30 minutes
POST /api/v1/responses/manual
{"action": "throttle_ip", "target": "10.0.0.0/24", "ttl": "30m", "rate_pps": 10}

# List active actions
GET /api/v1/responses

# Revoke early
DELETE /api/v1/responses/{id}
```

### CLI

```bash
ebpfsentinel responses create --action block_ip --target 1.2.3.4 --ttl 1h
ebpfsentinel responses create --action throttle_ip --target 10.0.0.0/24 --ttl 30m --rate-pps 10
ebpfsentinel responses list
ebpfsentinel responses revoke resp-1234
```

### TTL Formats

`30s`, `5m`, `1h`, `1d`, or bare seconds (`3600`). Maximum TTL: 24 hours (configurable).

---

## Auto-Response

Automatic block or throttle of source IPs when alerts match severity-based policies. Up to 3 policies in OSS. Evaluated on every alert (IDS, DLP, DDoS, DNS, packet security).

### Configuration

```yaml
auto_response:
  enabled: true
  policies:
    - name: block-critical
      min_severity: critical       # low, medium, high, critical
      action: block                # block or throttle
      ttl_secs: 3600               # 1 hour
    - name: block-ids-ddos-high
      min_severity: high
      components: [ids, ddos]      # optional filter (empty = all components)
      action: block
      ttl_secs: 1800
    - name: throttle-dns-medium
      min_severity: medium
      components: [dns]
      action: throttle
      ttl_secs: 600
      rate_pps: 100
```

### How It Works

1. An alert is created (IDS pattern match, DDoS detection, DNS blocklist hit, DLP violation, etc.)
2. Each policy is evaluated in order — first match wins (no stacking)
3. If `min_severity` matches and `components` matches (or is empty = all), the source IP is blocked or throttled via the IPS blacklist
4. The block/throttle has a bounded TTL and auto-expires
5. Every action is logged via `tracing::info` with policy name, alert ID, source IP, and TTL

### Policy Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | — | Policy name (used in logs) |
| `min_severity` | `string` | No | `high` | Minimum alert severity to trigger |
| `components` | `[string]` | No | `[]` (all) | Component filter: `ids`, `ddos`, `dns`, `dlp`, `firewall`, etc. |
| `action` | `string` | No | `block` | `block` (deny) or `throttle` (rate limit) |
| `ttl_secs` | `integer` | No | `3600` | Duration of the block/throttle in seconds |
| `rate_pps` | `integer` | No | — | Packets per second (only for `throttle`) |

### Limits (OSS vs Enterprise)

| | OSS | Enterprise |
|---|---|---|
| Max policies | 3 | Unlimited |
| Conditions | Severity + components | + MITRE ATT&CK tactic/technique |
| Actions | block, throttle | + flow isolation, SOAR webhooks |
| Cooldown | No (first match per alert) | Per (policy, source IP) with configurable cooldown |
| Audit trail | Log output only | Queryable audit trail via API |

See [Enterprise Automated Response](enterprise/automated-response.md) for the full orchestration engine.

---

## Manual Packet Capture

Capture packets to standard pcap files using libpcap, compatible with Wireshark, tcpdump, and Zeek.

### API

```bash
# Start a 60-second capture
POST /api/v1/captures/manual
{"filter": "host 1.2.3.4 and port 443", "duration_seconds": 60, "snap_length": 1500}

# List captures
GET /api/v1/captures

# Stop early
DELETE /api/v1/captures/{id}
```

### CLI

```bash
ebpfsentinel capture start --filter "host 1.2.3.4" --duration 60s --snap-length 1500
ebpfsentinel capture stop cap-1234
ebpfsentinel capture list
```

### Constraints

- One capture at a time (concurrent requests return HTTP 409)
- Maximum duration: 5 minutes (configurable)
- Output: `/tmp/ebpfsentinel-{id}.pcap`
- Requires `libpcap-dev` at build time (feature `pcap-capture`, enabled by default)

Enterprise adds continuous ring buffer, event-triggered PCAP, and forensics API.

---

## Encrypted DNS Detection (DoH/DoT)

Detects DNS traffic encrypted via DNS-over-HTTPS (DoH) or DNS-over-TLS (DoT) that bypasses traditional DNS monitoring.

### Detection Methods

| Protocol | Detection | Criteria |
|----------|-----------|----------|
| DoT | Port-based | Destination port 853 (TCP/TLS) |
| DoH | SNI-based | SNI matches known DoH resolver domains |

### Built-in Resolvers

`dns.google`, `cloudflare-dns.com`, `one.one.one.one`, `dns.quad9.net`, `doh.opendns.com`, `dns.adguard.com`, `doh.mullvad.net`, `dns.nextdns.io`, `doh.cleanbrowsing.org`, `mozilla.cloudflare-dns.com`, and more.

### Custom Resolvers

```yaml
dns:
  doh_resolvers:
    - internal-doh.corp.local
    - doh.custom-resolver.example.com
```

### Behavior

Detection is **passive** (alert-only in OSS). Detected events are logged and counted via Prometheus metric `record_encrypted_dns(protocol, resolver)`.

Enterprise adds policy enforcement: block unauthorized DoH/DoT, allow-list for approved resolvers.
