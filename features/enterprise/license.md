# Enterprise License System

> **Edition: Enterprise** | **Status: Shipped**

## Overview

The enterprise license system gates feature activation at runtime using Ed25519-signed license keys bound to specific machines. It includes anti-tamper protections, air-gapped activation workflow, and cryptographic feature isolation.

## License Key Format

License keys are two-line files:
- **Line 1:** Base64-encoded JSON payload (`LicenseInfo`)
- **Line 2:** Base64-encoded Ed25519 signature

```json
{
  "org": "Acme Corp",
  "features": ["advanced-dlp", "ml-detection"],
  "issued_at": "2026-03-14T00:00:00Z",
  "expires_at": "2027-01-01T23:59:59Z",
  "max_agents": 50,
  "machine_fingerprint": "ca9240c0e28de960...",
  "version": 1
}
```

## Available Features

| Feature Flag | Description |
|-------------|-------------|
| `advanced-dlp` | Hyperscan DLP, custom patterns, block mode |
| `ml-detection` | ML-based anomaly detection |
| `multi-tenancy` | Namespace-scoped policy isolation |
| `siem-integration` | SIEM export connectors |
| `compliance-reports` | Automated compliance reporting |
| `high-availability` | Active-passive clustering |
| `multi-cluster` | Federated policy management |
| `advanced-rbac` | Per-domain/resource permissions |
| `air-gap` | Offline operation mode |
| `advanced-analytics` | Historical traffic analytics |
| `service-mesh` | Mesh-aware security policies |

## Machine Fingerprint Binding

Licenses are bound to specific machines via a SHA-256 fingerprint computed from:

- `/etc/machine-id` (or `/var/lib/dbus/machine-id`)
- CPU brand string (`/proc/cpuinfo`)
- Primary network interface MAC address

```bash
# Display fingerprint
ebpfsentinel-enterprise-agent fingerprint

# Export fingerprint to JSON
ebpfsentinel-enterprise-agent fingerprint --output request.json
```

Wildcard fingerprint (`*`) is supported for development/testing licenses.

## License Management CLI

### Generate Keypair

```bash
ebpfsentinel-license keygen \
  --private-key license-signing.key \
  --public-key license-signing.pub
```

### Generate License

```bash
ebpfsentinel-license generate \
  --signing-key license-signing.key \
  --org "Acme Corp" \
  --features advanced-dlp,ml-detection \
  --expires 2027-01-01 \
  --max-agents 50 \
  --fingerprint ca9240c0e28de960... \
  --output license.key
```

### Inspect License

```bash
ebpfsentinel-license inspect license.key --public-key license-signing.pub
```

## Air-Gap Activation Workflow

For environments without internet access:

```
[Air-gapped agent]                    [Connected workstation]

1. generate-request --features LIST \
     --output request.json
   (exports fingerprint + features)
                    ──── transfer ────►
                                       2. ebpfsentinel-license activate \
                                            --signing-key KEY \
                                            --request request.json \
                                            --org "Acme" \
                                            --expires 2027-01-01 \
                                            --output activation.key
                    ◄──── transfer ────
3. import-activation activation.key
   (validates + installs to /etc/ebpfsentinel/license.key)
```

## Anti-Tamper Protections

### Binary Integrity Self-Check

Release builds verify their own `.text` section hash against a signed manifest at startup:

```bash
# Generate integrity manifest during CI build
ebpfsentinel-license integrity-hash \
  --binary target/release/ebpfsentinel-enterprise-agent \
  --signing-key license-signing.key \
  --output integrity.manifest
```

Integrity failure exits with code 2 (no fallback to OSS mode).

### Distributed License Checks

License validation occurs at three independent points per feature:
1. **Init** — feature engine constructor verifies license
2. **First use** — first data processing call re-verifies
3. **Periodic** — re-check every 60 minutes

### License-as-Computation-Parameter

Enterprise assets (pattern databases, ML models, config blobs) are encrypted with AES-256-GCM using keys derived from the license signature via HKDF:

```
license_signature → HKDF(SHA-256, salt="ebpfsentinel-enterprise", info=feature_name) → AES-256-GCM key
```

Invalid license → decryption failure → feature unavailable.

## Configuration

```yaml
enterprise:
  license_path: /etc/ebpfsentinel/license.key
```

Or via CLI flag:

```bash
ebpfsentinel-enterprise-agent --license /path/to/license.key
```

Or via environment variable:

```bash
export EBPFSENTINEL_LICENSE=/path/to/license.key
```

## Graceful Degradation

- Expired license: falls back to OSS mode with WARN log
- Missing license: runs in OSS mode (all enterprise features disabled)
- Invalid signature: rejects license, falls back to OSS mode
- Fingerprint mismatch: rejects license with clear error

## REST API

```
GET /api/v1/license
```

Returns license status (200 OK or 402 Payment Required):

```json
{
  "valid": true,
  "org": "Acme Corp",
  "features": ["advanced-dlp", "ml-detection"],
  "issued_at": "2026-03-14T00:00:00Z",
  "expires_at": "2027-01-01T23:59:59Z",
  "max_agents": 50,
  "machine_fingerprint": "ca9240c0..."
}
```
