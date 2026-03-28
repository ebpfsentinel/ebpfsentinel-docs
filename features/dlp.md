# Data Loss Prevention (DLP)

> **Edition: OSS (core) + Enterprise (advanced)** | **Status: Shipped** | **eBPF Program: uprobe-dlp**

## Overview

DLP scans decrypted network traffic for sensitive data patterns — credit card numbers, Social Security Numbers, API keys, JWTs, and more. The `uprobe-dlp` eBPF program attaches to SSL/TLS library functions to capture plaintext before encryption, forwarding it to the userspace DLP engine for pattern matching.

## How It Works

1. **uprobe attachment** — the `uprobe-dlp` program hooks into `SSL_write` / `SSL_read` functions in OpenSSL or BoringSSL
2. **Plaintext capture** — decrypted payload bytes are emitted via RingBuf to userspace
3. **Pattern matching** — the DLP engine evaluates the payload against configured regex patterns
4. **Alert generation** — matches produce alerts with the pattern ID, severity, and redacted context

DLP is **userspace-only** for pattern matching — there is no eBPF map synchronization needed (unlike IDS/IPS where rules are pushed to kernel maps).

All regex patterns (built-in and enterprise custom) are **pre-compiled at config load** with safety limits to prevent ReDoS:

- **10 MiB** maximum compiled regex size
- **200** maximum nesting depth
- **4 KiB** maximum regex source length per pattern

## OSS vs Enterprise

The DLP module is available in both editions, with the following differences:

| Capability | OSS | Enterprise |
|------------|:---:|:----------:|
| Built-in patterns (PCI, PII, credentials) | Yes | Yes |
| Custom regex patterns | No | Yes |
| Alert mode (detect & report) | Yes | Yes |
| Block mode (detect & drop) | No | Yes |
| Per-pattern mode override | No | Yes |
| Hot-reload of custom patterns | No | Yes |
| Enable/disable toggle | Yes | Yes |

### Built-in Patterns (OSS)

The OSS edition ships with **9 built-in patterns** across 3 categories, covering the most common data loss scenarios:

| Category | Prefix | Patterns |
|----------|--------|----------|
| **PCI** (Payment Card) | `dlp-pci-*` | Visa, Mastercard, Amex card numbers |
| **PII** (Personal Info) | `dlp-pii-*` | SSN, email addresses, phone numbers |
| **Credentials** | `dlp-cred-*` | AWS keys, API keys, JWT tokens |

These patterns are always loaded at startup and cannot be removed. They operate in **alert mode only**.

### Enterprise Patterns

With the `enterprise` feature, organizations can:

- Define **custom regex patterns** with arbitrary IDs
- Use **block mode** to actively drop connections leaking sensitive data
- Override the global mode on a **per-pattern basis** (e.g., alert for emails, block for credit cards)
- **Hot-reload** pattern changes without restarting the agent

See [Enterprise DLP](enterprise/dlp.md) for details.

## Configuration

### OSS Configuration

In OSS mode, DLP configuration is limited to enabling/disabling the module:

```yaml
dlp:
  enabled: true    # default: true
  mode: alert      # only alert is supported in OSS
```

Built-in patterns are loaded automatically and do not need to be listed in the configuration file. Any attempt to add custom patterns or set `mode: block` in OSS will be rejected at startup with a validation error.

### Enterprise Configuration

```yaml
dlp:
  enabled: true
  mode: alert            # alert or block (global default)
  patterns:
    - id: dlp-pci-custom-visa
      name: Custom Visa
      regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      data_type: pci
      description: "Visa card number"
    - id: internal-project-code
      name: Internal Project Code
      regex: "PRJ-[A-Z]{3}-\\d{6}"
      severity: high
      data_type: custom
      mode: block          # per-pattern override
      description: "Internal project code leak"
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

### Feature Gating

Enterprise DLP capabilities are activated by the separate enterprise repository, which enables the `enterprise` Cargo feature. The OSS codebase enforces limits at every layer:

- **Domain layer** (`DlpEngine`): `add_pattern()` and `reload()` reject non-builtin pattern IDs in OSS
- **Application layer** (`DlpAppService`): `set_mode()` rejects `Block` mode in OSS
- **Infrastructure layer** (config validation): rejects custom IDs, block mode, and per-pattern block overrides in OSS
- **Agent layer** (startup + reload): OSS always loads built-in defaults in alert mode; hot-reload only toggles enabled/disabled

## Metrics

- `ebpfsentinel_alerts_total{component="dlp", severity}` — DLP alerts generated
- `ebpfsentinel_processing_duration_seconds{domain="dlp"}` — pattern matching latency
