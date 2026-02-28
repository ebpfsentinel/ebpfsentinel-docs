# DLP Configuration

The `dlp` section configures data loss prevention pattern scanning on decrypted SSL/TLS traffic.

## Reference

```yaml
dlp:
  mode: alert                  # alert or block
  patterns:
    - id: "pattern-id"
      pattern: "regex-pattern"
      severity: critical       # critical, high, medium, low, info
      description: "Pattern description"
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `alert` | `alert` (detect only) or `block` |
| `patterns` | `[Pattern]` | `[]` | DLP patterns list |

### Pattern

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier |
| `pattern` | `string` | Yes | Regex pattern |
| `severity` | `string` | Yes | Alert severity |
| `description` | `string` | No | Human-readable description |

## Examples

### PCI-DSS credit card detection

```yaml
dlp:
  mode: alert
  patterns:
    - id: visa
      pattern: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      description: "Visa card number"
    - id: mastercard
      pattern: "\\b5[1-5][0-9]{14}\\b"
      severity: critical
      description: "Mastercard number"
    - id: amex
      pattern: "\\b3[47][0-9]{13}\\b"
      severity: critical
      description: "American Express number"
```

### Credential leak detection

```yaml
dlp:
  mode: alert
  patterns:
    - id: api-key
      pattern: "(?i)(api[_-]?key|apikey)\\s*[:=]\\s*['\"]?[a-zA-Z0-9]{20,}"
      severity: high
      description: "API key in cleartext"
    - id: aws-access-key
      pattern: "AKIA[0-9A-Z]{16}"
      severity: critical
      description: "AWS access key ID"
    - id: jwt-token
      pattern: "eyJ[a-zA-Z0-9_-]+\\.eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+"
      severity: high
      description: "JWT token in cleartext"
    - id: ssn
      pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
      severity: critical
      description: "US Social Security Number"
```
