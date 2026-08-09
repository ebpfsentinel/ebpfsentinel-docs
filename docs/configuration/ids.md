# IDS Configuration

The `ids` section configures intrusion detection rules, sampling, and threshold detection.

## Reference

```yaml
ids:
  enabled: true                       # enable/disable IDS (default: true)
  mode: alert                         # alert or block
  inspect_egress: false               # also classify on the egress hook
  sampling:                           # optional packet sampling
    mode: none                        # none, random, hash, or country_based
    rate: 1.0                         # sample rate 0.0–1.0 (random/hash modes)
  rules:
    - id: "rule-id"
      severity: high                  # critical, high, medium, low, info
      protocol: any                   # any, tcp, udp, icmp (default: any)
      dst_port: 22                    # destination port (or src_port; 0 for ICMP)
      pattern: "regex-pattern"        # optional payload regex
      description: "Rule description"
      threshold:                      # Optional threshold detection
        type: threshold               # limit, threshold, or both
        count: 5
        window_secs: 60               # Seconds
        track_by: src_ip              # src_ip, dst_ip, or both
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the IDS module |
| `mode` | `string` | `alert` | `alert` (detect only) or `block` (requires IPS) |
| `sampling` | `Sampling` | — | Sampling configuration (see below) |
| `inspect_egress` | `bool` | `false` | Also run the classifier on the egress hook. Enables cgroup/container attribution of locally-originated (e.g. container outbound) traffic, since on egress the originating socket is bound to the packet |
| `rules` | `[Rule]` | `[]` | Detection rules |

### Sampling

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `none` | `none`, `random`, `hash`, or `country_based` |
| `rate` | `float` | `1.0` | Sample rate 0.0–1.0 (for `random`/`hash` modes) |
| `high_risk_countries` | `[string]` | `[]` | ISO 3166-1 alpha-2 codes for full inspection (`country_based` mode). Max 250 codes |
| `high_risk_rate` | `float` | `1.0` | Sample rate for high-risk countries (default: 100%) |
| `default_rate` | `float` | `0.1` | Sample rate for all other countries |

### Rule

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier |
| `severity` | `string` | Yes | `critical`, `high`, `medium`, `low`, `info` |
| `protocol` | `string` | No | `any` (default), `tcp`, `udp`, `icmp`. `any` covers TCP, UDP and ICMP |
| `dst_port` | `integer` | One of the two | Destination port to match. Use `0` for a protocol that carries no port, such as ICMP |
| `src_port` | `integer` | One of the two | Source port to match, for rules that fire on the reply leg |
| `pattern` | `string` | No | Regex matched against the captured TCP payload (see [Content patterns](#content-patterns)). TCP only |
| `mode` | `string` | No | Per-rule mode override (`alert` or `block`). The section `mode` is a master switch: while it is `alert`, a rule asking to block only raises an alert |
| `description` | `string` | No | Human-readable description |
| `enabled` | `bool` | No | Enable/disable this rule (default: `true`) |
| `threshold` | `Threshold` | No | Threshold detection settings |
| `domain_pattern` | `string` | No | Match against the SNI/DNS domain (requires `domain_match_mode`) |
| `domain_match_mode` | `string` | No | `exact`, `wildcard`, or `regex` (required when `domain_pattern` is set) |
| `country_thresholds` | `map<string, Threshold>` | No | Per-country threshold overrides (ISO 3166-1 alpha-2 → Threshold). Overrides the rule's `threshold` for traffic from listed countries |
| `interfaces` | `[string]` | No | Restrict the rule to specific interfaces or interface groups |

The classifier keys its lookup on a port, and it is the only thing that
raises an IDS event: a rule naming neither `dst_port` nor `src_port` could
never fire, so the agent refuses to start on one.

### Content patterns

A rule without a `pattern` fires on the port alone: the kernel classifier
keys on `(protocol, port)` and every matching packet is a detection. A rule
carrying a `pattern` is decided on the payload instead, in userspace, against
the bytes the classifier copies out of the packet. What that changes:

- **TCP only.** Only TCP payloads are captured, so a content rule must set
  `protocol` to `tcp` or `any`. The agent refuses to start on a content rule
  declared `udp` or `icmp`.
- **The port is captured automatically.** The ports a content rule names are
  added to the payload capture set on top of `l7.ports`; nothing has to be
  listed twice. The combined set is still bound by the 256-port limit.
- **Up to 2048 bytes per segment** are captured, from the start of the TCP
  payload. A pattern spanning a segment boundary, or landing past that
  offset, does not match.
- **The pattern matches raw bytes.** Unicode mode is on by default, so
  `\x90` means the code point U+0090 and not the byte `0x90`. Prefix the
  pattern with `(?-u)` to match bytes literally, as in `(?-u)\xffSMB`.
- **Encrypted traffic carries no plaintext.** A pattern on port 443 matches
  the TLS record bytes, not the request inside them.

Both `dst_port` and `src_port` are honoured, so a rule can fire on the reply
leg of a conversation.

### Threshold

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | `limit`, `threshold`, or `both` |
| `count` | `integer` | Yes | Match count for the mode |
| `window_secs` | `integer` | Yes | Time window in seconds |
| `track_by` | `string` | No | Tracking key: `src_ip` (default), `dst_ip`, or `both` |

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
      protocol: tcp
      dst_port: 80
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: high
      description: "SQL injection attempt"
    - id: xss
      protocol: tcp
      dst_port: 80
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
    rate: 1.0
    high_risk_countries: [RU, CN, KP, IR]
    high_risk_rate: 1.0                   # 100% inspection for high-risk countries
    default_rate: 0.1                     # 10% for all others
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
          count: 2                        # Only 2 attempts from Russia
          window_secs: 60
          track_by: src_ip
```
