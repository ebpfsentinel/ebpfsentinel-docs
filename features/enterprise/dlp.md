# Enterprise DLP

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Enterprise DLP extends the OSS DLP module with custom pattern definitions, block mode enforcement, per-pattern mode overrides, and hot-reload capabilities.

## What Enterprise Adds

### Custom Patterns

Define organization-specific patterns with arbitrary IDs and regex:

```yaml
dlp:
  patterns:
    - id: internal-project-code
      name: Internal Project Code
      regex: "PRJ-[A-Z]{3}-\\d{6}"
      severity: high
      data_type: custom
      description: "Internal project identifier leak"
    - id: internal-employee-id
      name: Employee ID
      regex: "EMP-\\d{8}"
      severity: medium
      data_type: pii
```

OSS is limited to built-in patterns (`dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`). Enterprise allows any pattern ID.

### Block Mode

Block mode actively drops SSL/TLS connections when sensitive data is detected, preventing data exfiltration:

```yaml
dlp:
  mode: block    # global: block all matches
```

OSS is limited to `alert` mode (detect and report only).

### Per-Pattern Mode Override

Apply different enforcement policies per pattern. For example, block credit card leaks but only alert on email addresses:

```yaml
dlp:
  mode: alert                  # default for patterns without override
  patterns:
    - id: dlp-pci-visa
      name: Visa Card
      regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      data_type: pci
      mode: block              # override: block this pattern
    - id: dlp-pii-email
      name: Email
      regex: "\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b"
      severity: medium
      data_type: pii
      # inherits global alert mode
```

### Hot-Reload

Enterprise supports live pattern reload via config file change or API call. Pattern changes take effect without restarting the agent:

- Add, remove, or modify patterns at runtime
- Change global or per-pattern mode
- Toggle individual patterns enabled/disabled

In OSS, hot-reload only supports toggling the DLP module on/off. Built-in patterns and alert mode cannot be changed at runtime.

## Feature Gating

Enterprise DLP is enabled at compile time via the `enterprise` Cargo feature, activated by the separate enterprise repository that extends the OSS codebase. The OSS repository does not expose this feature directly.

The feature propagates through the crate dependency chain:

```
agent/enterprise -> application/enterprise -> domain/enterprise
                 -> infrastructure/enterprise
```

Gating is enforced at four layers:

| Layer | Enforcement |
|-------|-------------|
| Domain (`DlpEngine`) | Rejects non-builtin pattern IDs |
| Application (`DlpAppService`) | Rejects block mode |
| Infrastructure (config validation) | Rejects custom IDs, block mode, per-pattern block |
| Agent (startup + reload) | Forces built-in defaults and alert mode |

## Configuration Reference

See [Configuration: DLP](../../configuration/dlp.md) for the full field reference.
