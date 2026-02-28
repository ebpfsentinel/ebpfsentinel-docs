# Data Loss Prevention (DLP)

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: uprobe-dlp**

## Overview

DLP scans decrypted network traffic for sensitive data patterns — credit card numbers, Social Security Numbers, API keys, JWTs, and more. The `uprobe-dlp` eBPF program attaches to SSL/TLS library functions to capture plaintext before encryption, forwarding it to the userspace DLP engine for pattern matching.

## How It Works

1. **uprobe attachment** — the `uprobe-dlp` program hooks into `SSL_write` / `SSL_read` functions in OpenSSL or BoringSSL
2. **Plaintext capture** — decrypted payload bytes are emitted via RingBuf to userspace
3. **Pattern matching** — the DLP engine evaluates the payload against configured regex patterns
4. **Alert generation** — matches produce alerts with the pattern ID, severity, and redacted context

DLP is **userspace-only** for pattern matching — there is no eBPF map synchronization needed (unlike IDS/IPS where rules are pushed to kernel maps).

## Configuration

```yaml
dlp:
  mode: alert            # alert or block
  patterns:
    - id: credit-card
      pattern: "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\\b"
      severity: critical
      description: "Credit card number (Visa, Mastercard, Amex)"
    - id: ssn
      pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
      severity: critical
      description: "US Social Security Number"
    - id: api-key
      pattern: "(?i)(api[_-]?key|apikey)\\s*[:=]\\s*['\"]?[a-zA-Z0-9]{20,}"
      severity: high
      description: "API key in cleartext"
    - id: jwt-token
      pattern: "eyJ[a-zA-Z0-9_-]+\\.eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+"
      severity: high
      description: "JWT token in cleartext"
    - id: aws-key
      pattern: "AKIA[0-9A-Z]{16}"
      severity: critical
      description: "AWS access key ID"
    - id: email-address
      pattern: "\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b"
      severity: medium
      description: "Email address"
```

See [Configuration: DLP](../configuration/dlp.md) for the full reference.

## CLI Usage

```bash
# View DLP alerts
ebpfsentinel-agent alerts list --component dlp --severity critical

# Mark a false positive
ebpfsentinel-agent alerts mark-fp alert-dlp-001
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/alerts` | List alerts (filter by `component=dlp`) |
| POST | `/api/v1/alerts/{id}/false-positive` | Mark alert as false positive |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/uprobe-dlp/` | uprobe kernel program |
| `domain` | `crates/domain/src/dlp/` | DLP engine (entity, engine, error) |
| `ports` | `crates/ports/src/primary/dlp.rs` | Port trait |
| `application` | `crates/application/src/dlp_service_impl.rs` | App service |

## Metrics

- `ebpfsentinel_alerts_total{component="dlp", severity}` — DLP alerts generated
- `ebpfsentinel_processing_duration_seconds{domain="dlp"}` — pattern matching latency
