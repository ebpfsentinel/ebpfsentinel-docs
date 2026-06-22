# IPS Configuration

The `ips` section configures intrusion prevention — automatic IP blacklisting when block-mode rules match.

## Reference

```yaml
ips:
  enabled: true                     # Enable/disable the IPS module (default: true)
  mode: block                       # alert or block (default: alert)
  max_blacklist_duration_secs: 3600 # Auto-removal after N seconds (0 = permanent)
  auto_blacklist_threshold: 3       # Detections before an IP is auto-blacklisted
  max_blacklist_size: 10000         # Max entries in the blacklist
  whitelist:                        # IPs/CIDRs that are never blacklisted
    - "10.0.0.0/8"
    - "192.168.1.1"
  whitelist_aliases:                # Named IP-set aliases that are never blacklisted
    - "corp-ranges"
  rules:
    - id: "rule-id"
      pattern: "regex-pattern"
      severity: critical
      mode: block              # Per-rule mode override
      description: "Rule description"
      threshold:
        type: both
        count: 3
        window_secs: 60
        track_by: src_ip
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the IPS module |
| `mode` | `string` | `alert` | Default mode for rules without per-rule override (`alert` or `block`) |
| `max_blacklist_duration_secs` | `integer` | `3600` | Seconds before auto-removal (0 = permanent) |
| `auto_blacklist_threshold` | `integer` | `3` | Detections from an IP before it is auto-blacklisted |
| `max_blacklist_size` | `integer` | `10000` | Maximum number of entries in the blacklist |
| `whitelist` | `[string]` | `[]` | IPs/CIDRs that are never blacklisted |
| `whitelist_aliases` | `[string]` | `[]` | Named IP-set aliases that are never blacklisted |
| `sampling` | `Sampling` | — | Optional sampling configuration (same schema as IDS) |
| `country_thresholds` | `map<string, integer>` | `{}` | Per-country auto-blacklist thresholds (ISO 3166-1 alpha-2 → count). IPs from listed countries are blacklisted after fewer detections. When blacklisted, the source /24 (v4) or /48 (v6) subnet is also injected into the firewall LPM maps |
| `rules` | `[Rule]` | `[]` | IPS rules (`id`, `severity`, `protocol`, `dst_port`, `pattern`, `mode`, `threshold`, `enabled`) |

## Examples

### Auto-block with whitelist and country thresholds

```yaml
ips:
  mode: block
  max_blacklist_duration_secs: 7200
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
        type: both
        count: 3
        window_secs: 60
        track_by: src_ip
```
