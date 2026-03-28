# Alerting Configuration

The `alerting` section configures alert deduplication, throttling, routing, and delivery destinations.

## Reference

```yaml
alerting:
  enabled: true
  dedup_window_secs: 60                    # Seconds to suppress duplicate alerts
  throttle_window_secs: 300                # Throttle window per source
  throttle_max: 100                        # Max alerts per source per window
  smtp:                                    # Required for email destinations
    host: "smtp.example.com"
    port: 587
    from_address: "alerts@example.com"
    tls: true
  routes:
    - name: "route-name"
      destination: webhook                 # log, email, or webhook
      min_severity: high                   # Minimum severity to route
      event_types: [ids, ips]              # Optional — omit to match all components
      webhook_url: "https://..."           # Required for webhook destination
      email_to: "ops@example.com"          # Required for email destination
  otlp:                                    # OpenTelemetry export (optional)
    endpoint: "http://otel-collector:4317"
    protocol: "grpc"                       # grpc or http. Default: grpc
    timeout_ms: 5000                       # Export timeout in milliseconds. Default: 5000
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable/disable alerting |
| `dedup_window_secs` | `integer` | `60` | Seconds to suppress duplicate alerts |
| `throttle_window_secs` | `integer` | `300` | Throttle window duration per source |
| `throttle_max` | `integer` | `100` | Max alerts per source per throttle window |
| `smtp` | `SmtpConfig` | — | SMTP configuration (required for email destinations) |
| `otlp` | `OtlpConfig` | — | OpenTelemetry export configuration |
| `routes` | `[Route]` | `[]` | Alert routing rules |

### Route

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique route name |
| `destination` | `string` | Yes | Delivery type: `log`, `email`, or `webhook` |
| `min_severity` | `string` | Yes | Minimum severity: `low`, `medium`, `high`, `critical` |
| `event_types` | `[string]` | No | Components to match (omit = all) |
| `webhook_url` | `string` | Webhook only | Webhook URL (required when `destination: webhook`) |
| `webhook_headers` | `map` | No | Custom HTTP headers for webhook |
| `email_to` | `string` | Email only | Recipient address (required when `destination: email`) |

### SmtpConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `host` | `string` | Required | SMTP server hostname |
| `port` | `integer` | `587` | SMTP port |
| `username` | `string` | — | SMTP username (optional) |
| `password` | `string` | — | SMTP password (optional) |
| `from_address` | `string` | Required | Sender email address |
| `tls` | `bool` | `true` | Enable TLS |

### OtlpConfig

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `endpoint` | `string` | Required | OpenTelemetry collector endpoint (e.g. `http://otel-collector:4317`) |
| `protocol` | `string` | `grpc` | Export protocol: `grpc` or `http` |
| `timeout_ms` | `u64` | `5000` | Export timeout in milliseconds |

## Examples

### Multi-channel alerting

```yaml
alerting:
  enabled: true
  dedup_window_secs: 60
  throttle_window_secs: 300
  throttle_max: 100
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
    - name: ids-log
      destination: log
      min_severity: medium
      event_types: [ids, ips]
    - name: all-log
      destination: log
      min_severity: low
```

## Security Notes

- **Webhook URL validation (SSRF prevention)**: webhook URLs must use `http://` or `https://` schemes. URLs resolving to private (RFC 1918), loopback, link-local, or multicast IP addresses are rejected. HTTP redirects are not followed. The same rules apply as for [threat intel feed URLs](threatintel.md#security-validation).
- **SMTP TLS warning**: the agent logs a warning at startup when SMTP is configured with `tls: false`. Unencrypted SMTP exposes alert content and credentials in transit.
