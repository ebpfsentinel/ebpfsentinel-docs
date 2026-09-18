# Alerting

> **Edition: OSS** | **Enforcement: Userspace**

## Overview

The alert pipeline processes security events from all domain engines through deduplication, throttling, severity-based routing, and delivery to configurable senders (email, webhook, log file). A circuit breaker protects against cascading failures when downstream senders are unavailable.

## How It Works

```
Domain Engine → Enrich → Store + Stream + Count → AlertRouter → Destination
                                                  Dedup         ├── Email (SMTP)
                                                  Throttle      ├── Webhook (HTTP POST)
                                                  Route         ├── OTLP
                                                                └── Log (file)
```

Recording happens before routing: an alert is persisted, published on the
event stream and counted whatever the router later decides. Dedup and throttle
therefore reduce *notification volume*, never the audit trail.

### Alert Processing

1. **Deduplication** - an alert identical to a recent one (same rule, source IP, destination IP, destination port and protocol; source port ignored) is not delivered again within the window. It is still stored and streamed, and increments `ebpfsentinel_alerts_dropped_total{reason="dedup"}`
2. **Throttling** - per-rule rate limiting prevents alert storms; excess alerts increment `ebpfsentinel_alerts_dropped_total{reason="throttle"}`
3. **Routing** - alerts are matched to routes by severity and/or component
4. **Circuit breaker** - if a sender fails repeatedly, it is temporarily disabled to avoid blocking the pipeline

### Alert Fields

Every alert carries these, whatever raised it:

- `id` - unique alert identifier
- `timestamp_ns` - event time in nanoseconds since the Unix epoch. Kernel events are stamped with `bpf_ktime_get_boot_ns()`, which is suspend-aware but counts from boot; userspace converts that to an epoch stamp as the record leaves the ring buffer, so a kernel alert and a userspace alert raised a second apart are a second apart.
- `component` - the engine that raised it: `firewall`, `ratelimit`, `l7`, `ips`, `ids`, `dlp`, `threatintel`, `ddos`, `dns`, `routing`, `ml-anomaly`
- `severity` - `low`, `medium`, `high` or `critical`. There is no `info` level: a route configured with `min_severity: info` is refused at boot
- `rule_id` - the rule that triggered the alert
- `action` - what was done about it (`alert`, `drop`, `reject`, ...)
- `src_addr`, `dst_addr` - four big-endian `u32` words each. IPv4 sits in the first word and the rest are zero; IPv6 fills all four. `is_ipv6` says which
- `is_ipv6` - `true` when the addresses are IPv6
- `src_port`, `dst_port`, `protocol` - the rest of the flow tuple
- `message` - human-readable alert message
- `false_positive` - whether an operator has marked it as one

The rest of the record is flat and optional: a field a given component has
nothing to say about is absent from the JSON rather than present and null.
There is **no metadata envelope** - context is named, typed and served at the
top level.

Enrichment, on every alert when the enrichers are configured:

- `src_domain`, `dst_domain` - reverse DNS lookups (from passive DNS cache)
- `src_domain_score`, `dst_domain_score` - domain reputation scores (0.0=clean, 1.0=malicious)
- `src_geo`, `dst_geo` - GeoIP location and ASN (e.g. `FR/Paris (ASN: AS3215 Orange S.A.)`)

Per-component context:

| Fields | Raised by |
|--------|-----------|
| `confidence`, `threat_type` | threat intelligence, IDS |
| `data_type` | DLP |
| `pid`, `tgid`, `container` | anything with a process or container attribution |
| `direction` | packet engines |
| `matched_domain` | DNS |
| `attack_type`, `peak_pps`, `current_pps`, `mitigation_status`, `total_packets` | DDoS |
| `ja4_fingerprint` | TLS fingerprinting |
| `mitre_technique_id`, `mitre_technique_name`, `mitre_tactic` | any engine with an ATT&CK mapping |

### Alert Enrichment

Before routing, each alert passes through the enrichment pipeline:

```
Raw alert from domain engine
    │
    ▼
DnsAlertEnricher
    ├── DNS reverse lookup (src_ip → src_domain, dst_ip → dst_domain)
    ├── Domain reputation scoring (src_domain_score, dst_domain_score)
    └── GeoIP enrichment (src_geo, dst_geo)
    │
    ▼
Enriched alert → AlertRouter → Senders
```

GeoIP enrichment is optional - enable it via the [`geoip`](../configuration/geoip.md) configuration section. When disabled, `src_geo` and `dst_geo` fields are `null`.

## Configuration

```yaml
alerting:
  enabled: true
  dedup_window_secs: 60        # Seconds to suppress duplicate deliveries (default 60)
  throttle_window_secs: 300    # Throttle window, counted per rule id (default 300)
  throttle_max: 100            # Max alerts per rule id per window (default 100)
  smtp:
    host: "smtp.example.com"
    port: 587
    username: "ebpfsentinel"
    password: "..."
    from_address: "ebpfsentinel@example.com"
    tls: true
  otlp:                        # Required as soon as one route uses destination: otlp
    endpoint: "http://otel-collector:4317"
    protocol: grpc             # grpc (default) or http
    timeout_ms: 10000
  routes:
    - name: critical-slack
      destination: webhook
      min_severity: high
      webhook_url: "https://hooks.slack.com/services/T00/B00/xxx"
    - name: ops-email
      destination: email
      min_severity: critical
      email_to: "oncall@example.com"
    - name: all-to-log
      destination: log
      min_severity: low
      event_types: [ids, ips, dlp]
```

`destination` is one of `log`, `email`, `webhook`, `otlp`, and `min_severity`
one of `low`, `medium`, `high`, `critical`. A route naming anything else, or
an `otlp` route with no `alerting.otlp` block, fails validation at boot rather
than silently delivering nothing.

See [Configuration: Alerting](../configuration/alerting.md) for the full reference.

## CLI Usage

```bash
# List alerts (--severity is a minimum, not an exact match)
ebpfsentinel-agent alerts list --severity high --limit 50

# Filter by component, by ATT&CK tactic or technique, and page
ebpfsentinel-agent alerts list --component ids --severity critical
ebpfsentinel-agent alerts list --tactic exfiltration --technique T1041 --offset 100

# Read one alert
ebpfsentinel-agent alerts show alert-001

# Top sources, top rules and the severity distribution over the last N alerts
ebpfsentinel-agent alerts stats --limit 500

# Mark as false positive
ebpfsentinel-agent alerts mark-fp alert-001
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/alerts` | List alerts |
| GET | `/api/v1/alerts/stream` | Server-Sent Events stream of alerts as they are raised |
| GET | `/api/v1/alerts/{id}` | Read one alert by identifier |
| POST | `/api/v1/alerts/{id}/false-positive` | Mark alert as false positive |

`GET /api/v1/alerts` accepts `component`, `min_severity`, `rule_id`,
`false_positive`, `from`, `to` (both nanoseconds since the epoch, inclusive),
`tactic`, `technique`, `limit` (default 100, max 1000) and `offset`. The
minimum-severity filter is spelled `min_severity` here and `--severity` on the
command line; a query string naming `severity` filters nothing.

`GET /api/v1/alerts/stream` takes a smaller set, and spells the severity
filter differently again: `severity_min`, `component` and `mitre_tactic`. A
severity outside `low|medium|high|critical` is refused with
`INVALID_SEVERITY` rather than accepted and ignored.

## gRPC Streaming

Real-time alert subscriptions via server-streaming RPC:

```bash
# All alerts
grpcurl -plaintext localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts

# Only critical IDS alerts
grpcurl -plaintext -d '{"min_severity":"critical","component":"ids"}' \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/alert/` | Alert router, dedup, throttle logic |
| `ports` | `crates/ports/src/secondary/alert_sender.rs` | Sender port trait |
| `ports` | `crates/ports/src/secondary/alert_store.rs` | Alert history port |
| `application` | `crates/application/src/alert_pipeline.rs` | Routing, dedup, throttle and concurrent sender dispatch |
| `adapters` | `crates/adapters/src/grpc/` | gRPC alert stream |

## Metrics

- `ebpfsentinel_alerts_total{component, severity, technique_id}` - total alerts generated
- `ebpfsentinel_alerts_by_rule_total{component, rule_id}` - total alerts per rule
- `ebpfsentinel_alerts_dropped_total{reason}` - alerts dropped before delivery (`dedup`, `throttle`)
- `ebpfsentinel_alerts_exported_total{destination}` - alerts handed off to an external sender
- `ebpfsentinel_alert_sender_circuit_state{destination}` - sender circuit breaker state (0=closed, 1=half-open, 2=open)
- `ebpfsentinel_alerts_sse_subscribers` - live SSE subscriber count
- `ebpfsentinel_false_positives_total{component, rule_id}` - alerts marked as false positives
