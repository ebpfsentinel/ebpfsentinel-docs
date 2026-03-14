# Enterprise DLP

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Enterprise DLP extends the OSS DLP module with a high-performance Vectorscan scanning engine, custom pattern definitions, block mode enforcement, per-pattern mode overrides, and TLS deep inspection for encrypted traffic scanning.

## Vectorscan Engine

Enterprise replaces the OSS regex-based scanner with [Vectorscan](https://github.com/VectorCamp/vectorscan) (Hyperscan-compatible), providing 10+ Gbps multi-pattern matching throughput.

Key capabilities:
- **Block mode scanning** — single contiguous buffer, all patterns in one pass
- **Streaming mode** — patterns that span multiple SSL/TLS chunks
- **Vectored mode** — scatter-gather scanning of non-contiguous buffers
- **Per-pattern flags** — CASELESS, UTF8, SINGLEMATCH, SOM_LEFTMOST, etc.
- **Early termination** — stop scanning on first block-mode match
- **Database serialization** — cache compiled pattern databases
- **Scratch pooling** — zero-allocation scanning in steady state

Architecture:
```
HyperscanDlpEngine
  └── VectorscanScanner (DlpScanner trait)
        ├── Arc<ScannerState> (atomic hot-reload)
        │     ├── BlockDatabase (compiled patterns)
        │     └── ScratchPool (pre-allocated, acquire/release)
        └── RegexScanner (fallback if Vectorscan unavailable)
```

A regex-based fallback is always available for platforms without Vectorscan.

## Custom Patterns

Define organization-specific patterns with arbitrary IDs:

```yaml
enterprise:
  advanced_dlp:
    enabled: true
    mode: alert
    custom_patterns:
      - id: PROJ-CODE
        name: Project Code
        regex: "PROJ-[A-Z]{3}-\\d{6}"
        severity: high
        data_type: internal_code
        description: "Internal project tracking codes"
      - id: EMP-ID
        name: Employee ID
        regex: "EMP-\\d{5}"
        severity: critical
        data_type: employee
        mode: block  # per-pattern override
```

OSS is limited to 9 built-in patterns (`dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`). Enterprise allows any pattern ID.

**Validation at config load:**
- Pattern IDs validated for uniqueness (vs built-in + other custom)
- Regex syntax validated via Vectorscan `expression_info` (catch errors before compilation)
- Severity validated (low, medium, high, critical)
- Invalid patterns rejected with clear error messages including pattern ID

## Block Mode

Block mode actively drops connections when sensitive data is detected:

```yaml
enterprise:
  advanced_dlp:
    mode: block  # global: block all matches
```

OSS is limited to `alert` mode (detect and report only).

### Per-Pattern Mode Override

Apply different enforcement per pattern:

```yaml
enterprise:
  advanced_dlp:
    mode: alert                    # default
    custom_patterns:
      - id: dlp-pci-visa
        name: Visa Card
        regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
        severity: critical
        data_type: pci
        mode: block                # override: block this pattern
      - id: dlp-pii-email
        name: Email
        regex: "[a-z]+@[a-z]+\\.[a-z]+"
        severity: medium
        data_type: pii
        # inherits global alert mode
```

### Scan Results

`scan_with_actions()` returns enriched results with per-match action decisions:

| Field | Description |
|-------|-------------|
| `pattern_id` | Pattern that matched |
| `pattern_name` | Display name |
| `severity` | Low, Medium, High, Critical |
| `data_type` | Category (pci, pii, credentials, custom, etc.) |
| `mode` | Alert or Block |
| `source` | BuiltIn or Custom |
| `byte_offset` | Match start position |
| `byte_length` | Match length |

`should_block()` returns true for block-mode matches.

## TLS Deep Inspection

Scan encrypted traffic by intercepting TLS connections with a configured CA certificate:

```yaml
enterprise:
  advanced_dlp:
    tls_inspection:
      enabled: true
      ca_cert: /etc/ebpfsentinel/ca.crt
      ca_key: /etc/ebpfsentinel/ca.key
      bypass_domains:
        - "*.bank.com"
        - "healthcare.example.org"
      bypass_ips:
        - "10.0.0.0/8"
        - "fd00::/16"
```

### Bypass Lists

Domains and IPs can be exempted from inspection:

- **Exact domain match:** `example.com`
- **Wildcard suffix:** `*.example.com` (matches `sub.example.com` but not `example.com`)
- **IPv4/IPv6 CIDR:** `10.0.0.0/8`, `fd00::/16`
- **Individual IP:** `192.168.1.100`

### Certificate Authority

Dynamic per-SNI certificate generation:
- Leaf certificates signed by the configured CA
- Certificate chain: leaf + CA cert
- Thread-safe cache per domain (generate once, reuse)
- Short-lived certificates (24h) for MITM

**Privacy Note:** TLS deep inspection requires explicit opt-in. The CA certificate must be deployed to all monitored endpoints.

## Hot-Reload

Pattern changes take effect without restarting the agent:
- Add, remove, or modify patterns at runtime
- Change global or per-pattern mode
- Toggle individual patterns enabled/disabled
- Atomic database recompilation (old database serves scans until new one is ready)

## Feature Gating

Enterprise DLP requires a valid license with the `advanced-dlp` feature. Without a license:
- Custom pattern IDs are rejected
- Block mode is rejected
- TLS deep inspection is disabled
- Falls back to OSS DLP (9 built-in patterns, alert mode only)

## Build Requirements

Vectorscan requires system dependencies:
```bash
sudo apt-get install cmake ragel libboost-dev g++
git clone https://github.com/VectorCamp/vectorscan.git
cd vectorscan && mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON
make -j$(nproc) && sudo make install && sudo ldconfig
```

## Configuration Reference

See [Configuration: DLP](../../configuration/dlp.md) for the full field reference.
