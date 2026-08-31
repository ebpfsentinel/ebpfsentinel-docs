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

1. **Deduplication** — an alert identical to a recent one (same rule, source IP, destination IP, destination port and protocol; source port ignored) is not delivered again within the window. It is still stored and streamed, and increments `ebpfsentinel_alerts_dropped_total{reason="dedup"}`
2. **Throttling** — per-rule rate limiting prevents alert storms; excess alerts increment `ebpfsentinel_alerts_dropped_total{reason="throttle"}`
3. **Routing** — alerts are matched to routes by severity and/or component
4. **Circuit breaker** — if a sender fails repeatedly, it is temporarily disabled to avoid blocking the pipeline

### Alert Fields

Each alert includes:

- `id` — unique alert identifier
- `timestamp` - event time in nanoseconds since the Unix epoch. Kernel events are stamped with `bpf_ktime_get_boot_ns()`, which is suspend-aware but counts from boot; userspace converts that to an epoch stamp as the record leaves the ring buffer, so a kernel alert and a userspace alert raised a second apart are a second apart.
- `component` — source domain (firewall, ids, ips, dlp, threatintel, dns, l7, loadbalancer)
- `severity` — critical, high, medium, low, info
- `rule_id` — the rule that triggered the alert
- `src_addr`, `dst_addr` — source and destination addresses
- `src_domain`, `dst_domain` — reverse DNS lookups (from passive DNS cache)
- `src_domain_score`, `dst_domain_score` — domain reputation scores (0.0=clean, 1.0=malicious)
- `src_geo`, `dst_geo` — GeoIP location and ASN (e.g. `FR/Paris (ASN: AS3215 Orange S.A.)`)
- `description` — human-readable alert message
- `metadata` — additional context (matched pattern, domain reputation, etc.)

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

GeoIP enrichment is optional — enable it via the [`geoip`](../configuration/geoip.md) configuration section. When disabled, `src_geo` and `dst_geo` fields are `null`.

## Configuration

```yaml
alerting:
  enabled: true
  dedup_window_secs: 300       # Seconds to suppress duplicate deliveries
  throttle_window_secs: 300    # Throttle window per source
  throttle_max: 100            # Max alerts per source per window
  smtp:
    host: "smtp.example.com"
    port: 587
    from_address: "ebpfsentinel@example.com"
    tls: true
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

See [Configuration: Alerting](../configuration/alerting.md) for the full reference.

## CLI Usage

```bash
# List alerts
ebpfsentinel-agent alerts list --severity high --limit 50

# Filter by component
ebpfsentinel-agent alerts list --component ids --severity critical

# Mark as false positive
ebpfsentinel-agent alerts mark-fp alert-001
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/alerts` | List alerts (filterable by component, severity, limit) |
| POST | `/api/v1/alerts/{id}/false-positive` | Mark alert as false positive |

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
| `ports` | `crates/ports/src/secondary/alerting.rs` | Sender port trait |
| `application` | `crates/application/src/alerting_service_impl.rs` | App service |
| `adapters` | `crates/adapters/src/grpc/` | gRPC alert stream |

## Metrics

- `ebpfsentinel_alerts_total{component, severity, technique_id}` - total alerts generated
- `ebpfsentinel_alerts_by_rule_total{component, rule_id}` - total alerts per rule
- `ebpfsentinel_alerts_dropped_total{reason}` - alerts dropped before delivery (`dedup`, `throttle`)
- `ebpfsentinel_alerts_exported_total{destination}` - alerts handed off to an external sender
- `ebpfsentinel_alert_sender_circuit_state{destination}` - sender circuit breaker state (0=closed, 1=half-open, 2=open)
- `ebpfsentinel_alerts_sse_subscribers` - live SSE subscriber count
- `ebpfsentinel_false_positives_total{component, rule_id}` - alerts marked as false positives
