# DLP Configuration

The `dlp` section configures data loss prevention pattern scanning on decrypted SSL/TLS traffic.

## OSS vs Enterprise

In **OSS** mode, built-in patterns are loaded automatically. Only `enabled` can be toggled. Custom patterns, block mode, and per-pattern mode overrides are rejected at config validation time.

In **Enterprise** mode, all fields are available including custom patterns and block mode.

## Cross-container coverage

DLP inspects TLS across every container on the host by attaching a uprobe to each
workload's own `libssl` / BoringSSL. This is configured at the **deployment**
level, not in the `dlp` config block:

| Setting | Where | Purpose |
|---------|-------|---------|
| `hostPID: true` / `pid: host` | Helm `daemonset.hostPID`, compose | Lets the agent see every node process to resolve their libraries |
| `/host/proc` (read-only) | Helm + compose volume mount | Host `/proc` the agent reads (the warden reads the same path) |
| `EBPFSENTINEL_HOST_PROC` | Agent env (set to `/host/proc`) | Points DLP discovery at the mounted host proc; defaults to `/proc` |

The bundled Helm chart and `docker-compose.yml` set these for you. On bare metal
(systemd) the agent already shares the host PID namespace, so `EBPFSENTINEL_HOST_PROC`
keeps its `/proc` default and no mount is needed. Coverage is **dynamically-linked
OpenSSL / BoringSSL only**; statically-linked TLS (Go, Rust, Java) is Enterprise
scope. See the [security model](../architecture/security-model.md#container-dlp-and-host-pid-visibility)
for the `hostPID` trust trade-off.

## Reference

```yaml
dlp:
  enabled: true              # enable/disable the DLP module
  mode: alert                # alert or block (enterprise only)
  patterns:                  # custom patterns (enterprise only)
    - id: "pattern-id"
      name: "Pattern Name"
      regex: "regex-pattern"
      severity: critical
      data_type: pci
      mode: block            # per-pattern override (enterprise only)
      description: "Description"
      enabled: true
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the DLP module |
| `mode` | `string` | `alert` | `alert` (detect only) or `block` (enterprise only) |
| `patterns` | `[Pattern]` | `[]` | Custom DLP patterns (enterprise only) |

### Pattern

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Yes | — | Unique identifier. OSS only accepts built-in prefixes (`dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`) |
| `name` | `string` | Yes | — | Human-readable pattern name |
| `regex` | `string` | Yes | — | Regex pattern (validated with ReDoS protection limits) |
| `severity` | `string` | Yes | — | `low`, `medium`, `high`, or `critical` |
| `data_type` | `string` | Yes | — | Category: `pci`, `pii`, `credentials`, or custom |
| `mode` | `string` | No | inherits global | Per-pattern mode override (`alert` or `block`, enterprise only) |
| `description` | `string` | No | `""` | Human-readable description |
| `enabled` | `bool` | No | `true` | Enable or disable this specific pattern |

## Built-in Patterns (OSS)

The OSS edition ships with 9 built-in patterns that are always loaded:

| ID | Name | Category | Severity |
|----|------|----------|----------|
| `dlp-pci-visa` | Visa Card Number | PCI | Critical |
| `dlp-pci-mastercard` | Mastercard Number | PCI | Critical |
| `dlp-pci-amex` | American Express Number | PCI | Critical |
| `dlp-pii-email` | Email Address | PII | Medium |
| `dlp-pii-ssn` | US Social Security Number | PII | Critical |
| `dlp-cred-aws-key` | AWS Access Key | Credentials | Critical |
| `dlp-cred-github-token` | GitHub Personal Access Token | Credentials | Critical |
| `dlp-cred-password` | Generic Password | Credentials | High |
| `dlp-cred-bearer` | Bearer Token | Credentials | High |

## Examples

### Minimal OSS configuration

```yaml
dlp:
  enabled: true
```

Built-in patterns are loaded automatically. No patterns section needed.

### Disable DLP

```yaml
dlp:
  enabled: false
```

### Enterprise: PCI-DSS credit card detection with block mode

```yaml
dlp:
  mode: block
  patterns:
    - id: dlp-pci-visa
      name: Visa Card Number
      regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      data_type: pci
      description: "Visa card number"
    - id: dlp-pci-mastercard
      name: Mastercard Number
      regex: "\\b5[1-5][0-9]{14}\\b"
      severity: critical
      data_type: pci
      description: "Mastercard number"
    - id: dlp-pci-amex
      name: Amex Card Number
      regex: "\\b3[47][0-9]{13}\\b"
      severity: critical
      data_type: pci
      description: "American Express number"
```

### Enterprise: Mixed mode with per-pattern override

```yaml
dlp:
  mode: alert
  patterns:
    - id: dlp-pci-visa
      name: Visa Card Number
      regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      data_type: pci
      mode: block              # block credit cards even though global is alert
    - id: dlp-pii-email
      name: Email Address
      regex: "\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b"
      severity: medium
      data_type: pii
      # inherits global alert mode
    - id: internal-project-code
      name: Internal Project Code
      regex: "PRJ-[A-Z]{3}-\\d{6}"
      severity: high
      data_type: custom
      mode: block
      description: "Internal project identifier leak"
```

## Validation Rules

- Pattern `id` must not be empty
- Pattern `name` must not be empty
- Pattern `regex` must not be empty and must compile (with ReDoS prevention limits: 10 MiB size limit, 200 nesting depth)
- Pattern `data_type` must not be empty
- Pattern `severity` must be one of: `low`, `medium`, `high`, `critical`
- Pattern `mode` (if set) must be `alert` or `block`
- **OSS only**: pattern IDs must start with `dlp-pci-`, `dlp-pii-`, or `dlp-cred-`
- **OSS only**: global `mode` must be `alert`
- **OSS only**: per-pattern `mode` override cannot be `block`
