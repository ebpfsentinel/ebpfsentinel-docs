# IPS Configuration

The `ips` section configures intrusion prevention — automatic IP blacklisting when block-mode rules match.

## Reference

```yaml
ips:
  mode: block                  # alert or block
  blacklist_ttl: 3600          # Auto-removal after N seconds (0 = permanent)
  whitelist:                   # IPs/CIDRs that are never blacklisted
    - "10.0.0.0/8"
    - "192.168.1.1"
  rules:
    - id: "rule-id"
      pattern: "regex-pattern"
      severity: critical
      mode: block              # Per-rule mode override
      description: "Rule description"
      threshold:
        mode: both
        count: 3
        window: 60
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `block` | Default mode for rules without per-rule override |
| `blacklist_ttl` | `integer` | `3600` | Seconds before auto-removal (0 = permanent) |
| `whitelist` | `[string]` | `[]` | IPs/CIDRs that are never blacklisted |
| `country_thresholds` | `map<string, integer>` | `{}` | Per-country auto-blacklist thresholds (ISO 3166-1 alpha-2 → count). IPs from listed countries are blacklisted after fewer detections. When blacklisted, the source /24 (v4) or /48 (v6) subnet is also injected into the firewall LPM maps |
| `rules` | `[Rule]` | `[]` | IPS rules (same schema as IDS rules + `mode` field) |

## Examples

### Auto-block with whitelist and country thresholds

```yaml
ips:
  mode: block
  blacklist_ttl: 7200
  whitelist:
    - "10.0.0.0/8"
    - "172.16.0.0/12"
  country_thresholds:
    RU: 2
    CN: 3
    KP: 1
  rules:
    - id: block-sqli
      pattern: "(?i)(union\\s+select|drop\\s+table)"
      severity: critical
      mode: block
      description: "SQL injection — auto-block"
      threshold:
        mode: both
        count: 3
        window: 60
```
