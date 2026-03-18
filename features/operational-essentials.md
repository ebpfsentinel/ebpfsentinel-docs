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

Enterprise adds automated response policies triggered by alerts.

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
