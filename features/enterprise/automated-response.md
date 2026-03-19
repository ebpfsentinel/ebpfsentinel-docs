# Automated Response Orchestration

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Automated response orchestration evaluates every security alert against configurable policies and executes response actions in real-time. Supports IP blocking, rate limiting, flow isolation, and SOAR webhook integration with cooldown protection and a full audit trail.

## Architecture

```
OSS Alert Pipeline
  └── SIEM Broadcast Channel
        └── Response Bridge (tokio task)
              └── ResponseOrchestrationService.ingest_siem_event()
                    ├── to_snapshot() → AlertSnapshot
                    ├── engine.evaluate_alert() → Vec<PendingAction>
                    │     ├── Match policies by component + severity + MITRE tactic
                    │     └── Check cooldown per (policy_id, src_addr)
                    ├── execute_action() → ResponseActionResult
                    │     ├── BlockIp / RateLimitIp / IsolateFlow → OssEnforcementAdapter → eBPF maps
                    │     └── WebhookNotify → HTTP POST with retry + backoff
                    ├── engine.record_cooldown()
                    ├── engine.record_action_result() → audit trail
                    └── Metrics (actions, evaluations, webhooks, cooldowns, audit depth)
```

## Response Actions

Four types of automated response actions can be configured per policy:

| Action | Description |
|--------|-------------|
| **BlockIp** | Block source/destination/both IP addresses for a bounded duration |
| **RateLimitIp** | Apply rate limiting to the offending IP |
| **IsolateFlow** | Block the specific 5-tuple flow via firewall deny rule |
| **WebhookNotify** | Send alert details to a SOAR/webhook endpoint with retry |

`BlockIp`, `RateLimitIp`, and `IsolateFlow` are enforced at the eBPF kernel level via the `OssEnforcementAdapter`, which calls into the OSS IPS blacklist and firewall services to inject actual blocking rules into eBPF maps. `WebhookNotify` executes an HTTP POST to the configured SOAR endpoint. All actions are recorded in the audit trail.

## Response Policies

Policies map alert conditions to response actions. Multiple actions can be configured per policy. Policies are evaluated in priority order (lower number = higher priority).

### Policy Conditions

| Field | Description |
|-------|-------------|
| `components` | Alert components that trigger this policy (empty = all) |
| `min_severity` | Minimum severity: `Low`, `Medium`, `High`, `Critical` |
| `mitre_tactics` | Optional MITRE ATT&CK tactic filter (empty = all) |

### Cooldown

Each policy has a `cooldown_secs` setting (default: 300 seconds) that prevents action storms. After an action is executed for a `(policy_id, src_addr)` pair, no further actions for the same pair are triggered until the cooldown expires. Expired cooldowns are cleaned up every 60 seconds.

### Example Policy

```json
{
  "id": "block-c2-traffic",
  "name": "Block C2 callback sources",
  "enabled": true,
  "priority": 1,
  "conditions": {
    "components": ["ids", "threatintel"],
    "min_severity": "High",
    "mitre_tactics": ["command-and-control"]
  },
  "actions": [
    {"type": "block_ip", "direction": "src", "duration_secs": 3600},
    {"type": "webhook_notify", "endpoint_id": "soar-splunk"}
  ],
  "cooldown_secs": 300
}
```

## SOAR Webhook Integration

Webhook endpoints are configured independently from policies. Multiple policies can reference the same endpoint. Each endpoint supports:

| Field | Default | Description |
|-------|---------|-------------|
| `url` | — | HTTP POST endpoint URL |
| `headers` | `[]` | Custom headers (e.g., `Authorization: Bearer <token>`) |
| `max_retries` | 3 | Retries with exponential backoff (500ms x attempt) |
| `timeout_ms` | 5000 | Per-request timeout |
| `enabled` | true | Enable/disable without deleting |

### Webhook Payload

```json
{
  "alert_id": "1742000000000-ids-rule-42",
  "component": "ids",
  "severity": "Critical",
  "message": "SSH brute force detected",
  "src_port": 54321,
  "dst_port": 22,
  "protocol": 6,
  "timestamp_ns": 1742000000000
}
```

### Example Setup

```bash
# Create webhook endpoint
curl -X POST http://agent:8080/api/v1/enterprise/response/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "soar-splunk",
    "name": "Splunk SOAR",
    "url": "https://soar.internal/api/v1/incidents",
    "headers": [["Authorization", "Bearer eyJ..."]],
    "max_retries": 3,
    "timeout_ms": 5000,
    "enabled": true
  }'

# Create policy referencing the webhook
curl -X POST http://agent:8080/api/v1/enterprise/response/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "notify-critical",
    "name": "Notify SOAR on critical alerts",
    "conditions": {"components": [], "min_severity": "Critical"},
    "actions": [{"type": "webhook_notify", "endpoint_id": "soar-splunk"}],
    "cooldown_secs": 60
  }'
```

## Audit Trail

Every executed response action is recorded in a bounded audit trail (default: 10,000 entries). Each record includes:

| Field | Description |
|-------|-------------|
| `id` | Action identifier |
| `action_type` | `block_ip`, `rate_limit_ip`, `isolate_flow`, `webhook_notify` |
| `outcome` | `success`, `failed` (with reason), or `skipped` (with reason) |
| `executed_at_ns` | Execution timestamp |
| `trigger_alert_id` | The alert that triggered this action |
| `trigger_component` | Source component |
| `trigger_severity` | Alert severity |
| `policy_id` | Policy that matched |
| `detail` | Human-readable action description |

### Querying the Audit Trail

```bash
# All recent actions
curl http://agent:8080/api/v1/enterprise/response/audit

# Filter by policy
curl "http://agent:8080/api/v1/enterprise/response/audit?policy_id=block-c2-traffic"

# Filter by action type
curl "http://agent:8080/api/v1/enterprise/response/audit?action_type=webhook_notify"

# Filter by outcome
curl "http://agent:8080/api/v1/enterprise/response/audit?outcome=failed&limit=50"
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/response/status` | Service status (active policies, webhooks, cooldowns, audit depth) |
| `GET` | `/api/v1/enterprise/response/policies` | List all response policies |
| `POST` | `/api/v1/enterprise/response/policies` | Create a response policy |
| `DELETE` | `/api/v1/enterprise/response/policies/{id}` | Delete a response policy |
| `GET` | `/api/v1/enterprise/response/webhooks` | List all webhook endpoints |
| `POST` | `/api/v1/enterprise/response/webhooks` | Create a webhook endpoint |
| `DELETE` | `/api/v1/enterprise/response/webhooks/{id}` | Delete a webhook endpoint |
| `GET` | `/api/v1/enterprise/response/audit` | Query the audit trail |

## Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `response_actions_total` | Counter | `action_type`, `outcome` | Response actions executed |
| `response_policies_evaluated_total` | Counter | — | Alerts evaluated against policies |
| `response_webhooks_sent_total` | Counter | `success` | Webhook delivery attempts |
| `response_policies_active` | Gauge | — | Active (enabled) policies |
| `response_cooldowns_active` | Gauge | — | Currently active cooldowns |
| `response_audit_trail_depth` | Gauge | — | Audit trail entry count |

## State Persistence

Response policies, webhook endpoints, and the audit trail are persisted to a **redb** key-value store. This ensures:

- **Policies survive restarts** — API-created policies and webhooks are restored on startup
- **Audit trail durability** — action records are not lost on agent restart
- **Consistent enforcement** — active block/rate-limit actions remain effective across restarts

The state store path is configured via `enterprise.state_store_path` (default: `/var/lib/ebpfsentinel/state.redb`).

## eBPF Enforcement

When `BlockIp`, `RateLimitIp`, or `IsolateFlow` actions fire, the `OssEnforcementAdapter` translates them into real eBPF program calls:

| Action | eBPF Enforcement |
|--------|-----------------|
| `BlockIp` | Adds source/destination IP to the IPS blacklist eBPF map |
| `RateLimitIp` | Adds a rate-limit entry for the IP in the XDP rate limiter |
| `IsolateFlow` | Injects a deny rule into the XDP firewall for the specific 5-tuple |

All enforcement actions include a TTL (duration) and auto-expire. The enforcement adapter works in both standalone and fleet/HA modes.

## Configuration

```yaml
enterprise:
  response:
    enabled: true
    audit_max_entries: 10000
```

Policies and webhook endpoints are managed via the REST API at runtime, not in static YAML configuration.

## Feature Gating

Automated Response requires a valid license with the `automated-response` feature. Without a license, the response orchestration subsystem is disabled.
