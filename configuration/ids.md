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
| `sampling` | `Sampling` | — | Sampling configuration (see below) |
| `rules` | `[Rule]` | `[]` | Detection rules |

### Sampling

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `none` | `none`, `random`, `hash`, or `country_based` |
| `rate` | `float` | `1.0` | Sample rate 0.0–1.0 (for `random`/`hash` modes) |
| `kernel_sampling` | `bool` | `true` | Push sampling into eBPF (`bpf_get_prandom_u32`) |
| `high_risk_countries` | `[string]` | `[]` | ISO 3166-1 alpha-2 codes for full inspection (`country_based` mode) |
| `high_risk_rate` | `float` | `1.0` | Sample rate for high-risk countries (default: 100%) |
| `default_rate` | `float` | `0.1` | Sample rate for all other countries |

### Rule

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier |
| `pattern` | `string` | Yes | Regex pattern to match against packet payload |
| `severity` | `string` | Yes | `critical`, `high`, `medium`, `low`, `info` |
| `description` | `string` | No | Human-readable description |
| `threshold` | `Threshold` | No | Threshold detection settings |
| `country_thresholds` | `map<string, Threshold>` | No | Per-country threshold overrides (ISO 3166-1 alpha-2 → Threshold). Overrides the rule's `threshold` for traffic from listed countries |

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

### Country-based sampling with per-country thresholds

```yaml
ids:
  mode: alert
  sampling:
    mode: country_based
    high_risk_countries: [RU, CN, KP, IR]
    high_risk_rate: 1.0       # 100% inspection for high-risk countries
    default_rate: 0.1          # 10% for all others
    kernel_sampling: true
  rules:
    - id: ssh-bruteforce
      protocol: tcp
      dst_port: 22
      severity: high
      threshold:
        type: threshold
        count: 5
        window_secs: 60
        track_by: src_ip
      country_thresholds:
        RU:
          type: threshold
          count: 2             # Only 2 attempts from Russia
          window_secs: 60
          track_by: src_ip
```
