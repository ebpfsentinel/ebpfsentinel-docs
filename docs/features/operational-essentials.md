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

### OTLP Resource

The resource says which agent a record came from, so one collector can hold a
fleet and still attribute a record.

| Attribute | Source |
|-----------|--------|
| `service.name` | `ebpfsentinel` |
| `service.version` | Agent version |
| `service.instance.id` | `EBPFSENTINEL_NODE_NAME`, `HOSTNAME`, then `/proc/sys/kernel/hostname`; omitted when none of them answers |

`OTEL_RESOURCE_ATTRIBUTES` replaces or adds any of these, and
`OTEL_SERVICE_NAME` then wins over the `service.name` that string may itself
carry, which is the precedence the OpenTelemetry specification states.

Delivery is **best-effort** (fire-and-forget). Enterprise adds durable buffer, at-least-once delivery, and OTLP Metrics export.

---

## Manual Response Actions

Time-bounded block or throttle actions with automatic TTL expiry. No permanent stale rules.

### API

```bash
# Block an IP for 1 hour
POST /api/v1/responses/manual
{"action": "block_ip", "target": "1.2.3.4", "ttl": "1h"}

# Throttle an IP for 30 minutes
POST /api/v1/responses/manual
{"action": "throttle_ip", "target": "1.2.3.4", "ttl": "30m", "rate_pps": 10}

# List active actions
GET /api/v1/responses

# Revoke early
DELETE /api/v1/responses/{id}
```

### CLI

```bash
ebpfsentinel responses create --action block_ip --target 1.2.3.4 --ttl 1h
ebpfsentinel responses create --action throttle_ip --target 1.2.3.4 --ttl 30m --rate-pps 10
ebpfsentinel responses list
ebpfsentinel responses revoke resp-1234
```

### What is installed

| Action | Enforcement |
|--------|-------------|
| `block_ip` | The target is added to the IPS blacklist, which drops all of its traffic. Both IP families. |
| `throttle_ip` | The target gets a token bucket in the XDP rate limiter at `rate_pps` packets per second, with one second of burst. IPv4 targets only, since the rate limiter's per-source map is keyed by a 32-bit address. |

The target is a single host address: both maps are keyed by one address, so a
prefix is refused rather than silently narrowed. Revoking early, or letting the
TTL elapse, lifts the entry from the data plane.

### TTL Formats

`30s`, `5m`, `1h`, `1d`, or bare seconds (`3600`). Maximum TTL: 24 hours (configurable).

---

## Auto-Response

Automatic block or throttle of source IPs when alerts match severity-based policies. Up to 3 policies in OSS. Evaluated on every alert that names a source address: IDS, threat intelligence, DDoS, and the packet-level components (firewall, ratelimit, L7, IPS).

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
    - name: throttle-l7-medium
      min_severity: medium
      components: [l7]
      action: throttle
      ttl_secs: 600
      rate_pps: 100
```

### How It Works

1. An alert is created (IDS pattern match, DDoS detection, firewall deny, threat-intel hit, etc.)
2. An alert that names no source address is skipped: nothing can be contained for it
3. Each policy is evaluated in order - first match wins (no stacking)
4. If `min_severity` matches and `components` matches (or is empty = all), the source is blacklisted by the IPS, or given a token bucket in the XDP rate limiter for a `throttle`
5. The block/throttle has a bounded TTL and auto-expires
6. Every action is logged via `tracing::info` with policy name, alert ID, source IP, and TTL
7. Every enforcement that succeeded increments
   `ebpfsentinel_auto_responses_total{policy}`. A policy that matched and
   failed to apply is logged as a warning and left out of the counter

### Policy Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | Yes | - | Policy name, non-empty and unique (used in logs, metrics and the throttle's rule ID) |
| `min_severity` | `string` | No | `high` | Minimum alert severity to trigger |
| `components` | `[string]` | No | `[]` (all) | Component filter, one or more of `ai-security`, `ddos`, `firewall`, `ids`, `ips`, `l7`, `ratelimit`, `threatintel` |
| `action` | `string` | No | `block` | `block` (deny, both IP families) or `throttle` (rate limit, IPv4 sources only) |
| `ttl_secs` | `integer` | No | `3600` | Duration of the block/throttle in seconds |
| `rate_pps` | `integer` | No | - | Packets per second, required above zero on a `throttle` |

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

---

## Auto-Capture

Automatically start a packet capture when a high-severity alert fires. The BPF filter is auto-generated from the alert's source IP (`host {src_ip}`). One capture at a time, max 60 seconds.

### Configuration

```yaml
auto_capture:
  enabled: true
  min_severity: high             # low, medium, high, critical
  components: []                 # empty = all components
  duration_secs: 30              # max 60s in OSS
  snap_length: 1500
  interface: eth0                # default: first agent interface
```

### How It Works

1. An alert fires (IDS, DLP, DDoS, DNS, packet security)
2. If severity >= `min_severity` and component matches, a capture is triggered
3. If another capture is already running, the trigger is skipped (no stacking)
4. A BPF filter `host {source_ip}` is auto-generated from the alert
5. A `.pcap` file is written to `/var/lib/ebpfsentinel/captures/auto-{timestamp}.pcap`
6. The capture auto-stops after `duration_secs`

### Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `enabled` | `bool` | No | `false` | Enable auto-capture |
| `min_severity` | `string` | No | `high` | Minimum alert severity to trigger |
| `components` | `[string]` | No | `[]` (all) | Component filter |
| `duration_secs` | `integer` | No | `30` | Capture duration (max 60s in OSS) |
| `snap_length` | `integer` | No | `1500` | Max bytes per packet |
| `interface` | `string` | No | First agent interface | Network interface |

### Limits (OSS vs Enterprise)

| | OSS | Enterprise |
|---|---|---|
| Concurrent captures | 1 | Multiple + ring buffer |
| Max duration | 60s | Unlimited |
| BPF filter | Auto-generated from alert | Customizable per policy |
| Trigger | Severity + components | + MITRE tactic, custom conditions |
| Output | `.pcap` file | + flow timeline, forensics API |

See [Enterprise Network Forensics](enterprise/network-forensics.md) for the full forensics engine.

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

Detection is **passive** (alert-only in OSS). Detected events are logged and
counted on `ebpfsentinel_encrypted_dns_detections_total{protocol,resolver}`. A
DoT detection reads the resolver name out of the TLS SNI, which the client
writes, so the label is capped at 64 distinct values per process and everything
past the cap is counted under `resolver="other"`.

Enterprise adds policy enforcement: block unauthorized DoH/DoT, allow-list for approved resolvers.
