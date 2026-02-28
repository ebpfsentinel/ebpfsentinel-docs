# Alerting

> **Edition: OSS** | **Status: Shipped** | **Enforcement: Userspace**

## Overview

The alert pipeline processes security events from all domain engines through deduplication, throttling, severity-based routing, and delivery to configurable senders (email, webhook, log file). A circuit breaker protects against cascading failures when downstream senders are unavailable.

## How It Works

```
Domain Engine → AlertRouter → Dedup → Throttle → Route → Sender
                                                          ├── Email (SMTP)
                                                          ├── Webhook (HTTP POST)
                                                          └── Log (file)
```

### Alert Processing

1. **Deduplication** — identical alerts (same rule, source, destination) within a time window are suppressed
2. **Throttling** — per-source rate limiting prevents alert storms from a single attacker
3. **Routing** — alerts are matched to routes by severity and/or component
4. **Circuit breaker** — if a sender fails repeatedly, it is temporarily disabled to avoid blocking the pipeline

### Alert Fields

Each alert includes:

- `id` — unique alert identifier
- `timestamp` — event time (`bpf_ktime_get_boot_ns`-based, suspend-aware)
- `component` — source domain (firewall, ids, ips, dlp, threatintel, dns, l7)
- `severity` — critical, high, medium, low, info
- `rule_id` — the rule that triggered the alert
- `src_addr`, `dst_addr` — source and destination addresses
- `description` — human-readable alert message
- `metadata` — additional context (matched pattern, domain reputation, etc.)

## Configuration

```yaml
alerting:
  dedup_window: 300          # Seconds to suppress duplicate alerts
  throttle_rate: 100         # Max alerts per source per minute
  routes:
    - name: critical-ops
      severity: [critical, high]
      senders: [webhook-slack, email-oncall]
    - name: all-alerts
      severity: [critical, high, medium, low]
      component: [ids, ips, dlp]
      senders: [log-file]
  senders:
    - name: webhook-slack
      type: webhook
      url: "https://hooks.slack.com/services/T00/B00/xxx"
      timeout: 10
    - name: email-oncall
      type: email
      smtp_host: "smtp.example.com"
      smtp_port: 587
      from: "ebpfsentinel@example.com"
      to: ["oncall@example.com"]
    - name: log-file
      type: log
      path: "/var/log/ebpfsentinel/alerts.json"
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
| `domain` | `crates/domain/src/alerting/` | Alert router, dedup, throttle logic |
| `ports` | `crates/ports/src/secondary/alerting.rs` | Sender port trait |
| `application` | `crates/application/src/alerting_service_impl.rs` | App service |
| `adapters` | `crates/adapters/src/grpc/` | gRPC alert stream |

## Metrics

- `ebpfsentinel_alerts_total{component, severity}` — total alerts generated
- `ebpfsentinel_processing_duration_seconds{domain="alerting"}` — alert routing latency
