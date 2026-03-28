# Auto-Response Configuration

The `auto_response` section configures automatic blocking or throttling of source IPs when alerts match severity-based policies. This is the OSS auto-response feature -- Enterprise adds unlimited policies, MITRE tactic matching, SOAR webhooks, cooldowns, and full audit trail.

## Reference

```yaml
auto_response:
  enabled: true
  policies:
    - name: block-critical
      min_severity: critical
      action: block
      ttl_secs: 3600
    - name: block-ids-ddos-high
      min_severity: high
      components: [ids, ddos]
      action: block
      ttl_secs: 1800
    - name: throttle-medium
      min_severity: medium
      action: throttle
      rate_pps: 1000
      ttl_secs: 600
```

## Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable auto-response |
| `policies` | list | `[]` | Response policies (max 3 in OSS) |

## Policy Fields

Each policy defines a severity trigger and the response action to take.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `name` | string | required | Policy name (used in logging) |
| `min_severity` | string | `"high"` | Minimum alert severity to trigger: `low`, `medium`, `high`, `critical` |
| `components` | list | `[]` | Component filter (e.g., `[ids, ddos, threatintel]`). Empty matches all components |
| `action` | string | `"block"` | Response action: `block` or `throttle` |
| `ttl_secs` | u64 | `3600` | Duration of the response action in seconds |
| `rate_pps` | u64 | `null` | Rate limit in packets per second (only used with `throttle` action) |

## OSS Limits

The OSS edition is limited to a maximum of 3 auto-response policies. Enterprise removes this limit and adds advanced features such as MITRE tactic-based matching, SOAR webhook integration, cooldown periods, and a complete audit trail.

## Example

```yaml
auto_response:
  enabled: true
  policies:
    - name: block-critical
      min_severity: critical
      action: block
      ttl_secs: 3600
    - name: block-ids-ddos-high
      min_severity: high
      components: [ids, ddos]
      action: block
      ttl_secs: 1800
```
