# Alerting Configuration

The `alerting` section configures alert deduplication, throttling, routing, and delivery senders.

## Reference

```yaml
alerting:
  dedup_window: 300            # Seconds to suppress duplicate alerts
  throttle_rate: 100           # Max alerts per source per minute
  routes:
    - name: "route-name"
      severity: [critical, high]
      component: [ids, ips]    # Optional — omit to match all components
      senders: [sender-name]
  senders:
    - name: "sender-name"
      type: webhook            # webhook, email, or log
      url: "https://..."       # webhook only
      timeout: 10              # webhook timeout in seconds
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dedup_window` | `integer` | `300` | Seconds to suppress duplicate alerts |
| `throttle_rate` | `integer` | `100` | Max alerts per source per minute |
| `routes` | `[Route]` | `[]` | Alert routing rules |
| `senders` | `[Sender]` | `[]` | Delivery targets |

### Route

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique route name |
| `severity` | `[string]` | Yes | Severity levels to match |
| `component` | `[string]` | No | Components to match (omit = all) |
| `senders` | `[string]` | Yes | Sender names to deliver to |

### Sender Types

**Webhook:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique name |
| `type` | `"webhook"` | Yes | |
| `url` | `string` | Yes | Webhook URL |
| `timeout` | `integer` | No | Timeout in seconds (default: 10) |

**Email:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique name |
| `type` | `"email"` | Yes | |
| `smtp_host` | `string` | Yes | SMTP server |
| `smtp_port` | `integer` | Yes | SMTP port |
| `from` | `string` | Yes | Sender address |
| `to` | `[string]` | Yes | Recipient addresses |

**Log:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Unique name |
| `type` | `"log"` | Yes | |
| `path` | `string` | Yes | Log file path |

## Examples

### Multi-channel alerting

```yaml
alerting:
  dedup_window: 300
  throttle_rate: 100
  routes:
    - name: critical-ops
      severity: [critical, high]
      senders: [webhook-slack, email-oncall]
    - name: ids-alerts
      severity: [critical, high, medium]
      component: [ids, ips]
      senders: [log-ids]
    - name: all-alerts
      severity: [critical, high, medium, low]
      senders: [log-all]
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
    - name: log-ids
      type: log
      path: "/var/log/ebpfsentinel/ids-alerts.json"
    - name: log-all
      type: log
      path: "/var/log/ebpfsentinel/all-alerts.json"
```
