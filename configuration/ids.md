# IDS Configuration

The `ids` section configures intrusion detection rules, sampling, and threshold detection.

## Reference

```yaml
ids:
  mode: alert                  # alert or block
  sample_rate: 0               # 1-in-N packet sampling (0 = disabled)
  sample_mode: random          # random or hash
  rules:
    - id: "rule-id"
      pattern: "regex-pattern"
      severity: high           # critical, high, medium, low, info
      description: "Rule description"
      threshold:               # Optional threshold detection
        mode: threshold        # limit, threshold, or both
        count: 5
        window: 60             # Seconds
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `alert` | `alert` (detect only) or `block` (requires IPS) |
| `sample_rate` | `integer` | `0` | Kernel-side sampling: 1-in-N (0 = inspect all) |
| `sample_mode` | `string` | `random` | `random` (per-packet) or `hash` (per-flow) |
| `rules` | `[Rule]` | `[]` | Detection rules |

### Rule

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier |
| `pattern` | `string` | Yes | Regex pattern to match against packet payload |
| `severity` | `string` | Yes | `critical`, `high`, `medium`, `low`, `info` |
| `description` | `string` | No | Human-readable description |
| `threshold` | `Threshold` | No | Threshold detection settings |

### Threshold

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `mode` | `string` | Yes | `limit`, `threshold`, or `both` |
| `count` | `integer` | Yes | Match count for the mode |
| `window` | `integer` | Yes | Time window in seconds |

## Threshold Modes

| Mode | Behavior |
|------|----------|
| `limit` | Alert on first N matches, then suppress until window resets |
| `threshold` | Alert only after N matches within the window |
| `both` | Alert after N matches, then suppress until window resets |

## Examples

### SQL injection and XSS detection

```yaml
ids:
  mode: alert
  rules:
    - id: sql-injection
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: high
      description: "SQL injection attempt"
    - id: xss
      pattern: "(?i)(<script|javascript:|on\\w+\\s*=)"
      severity: high
      description: "Cross-site scripting attempt"
```

### High-traffic with sampling and thresholds

```yaml
ids:
  mode: alert
  sample_rate: 100
  sample_mode: random
  rules:
    - id: shellshock
      pattern: "\\(\\)\\s*\\{"
      severity: critical
      description: "Shellshock exploit"
      threshold:
        mode: threshold
        count: 3
        window: 60
```
