# Enterprise License System

> **Edition: Enterprise**

## Overview

The enterprise license system gates feature activation at runtime using Ed25519 + ML-DSA-65 dual-signed license keys bound to specific machines. It includes anti-tamper protections, air-gapped activation workflow, and cryptographic feature isolation.

## License Key Format

License keys are post-quantum dual-signed (v2) three-line files. Both the
Ed25519 and ML-DSA-65 signatures must verify — legacy Ed25519-only keys are
not accepted.

**v2 format (Ed25519 + ML-DSA-65):**
- **Line 1:** Base64-encoded JSON payload (`LicenseInfo`)
- **Line 2:** Base64-encoded Ed25519 signature
- **Line 3:** Base64-encoded ML-DSA-65 signature

```json
{
  "org": "Acme Corp",
  "features": ["advanced-dlp", "ml-detection"],
  "issued_at": "2026-03-14T00:00:00Z",
  "expires_at": "2027-01-01T23:59:59Z",
  "max_agents": 50,
  "max_cores_per_agent": 32,
  "machine_fingerprint": "ca9240c0e28de960...",
  "version": 2
}
```

`max_cores_per_agent` is optional. A license issued without it is read as
unlimited, so keys generated before the field existed keep working unchanged.

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
| `fleet-management` | Fleet agent management |
| `ai-llm-security` | AI/LLM traffic security |
| `tls-intelligence` | TLS threat intelligence & PQC compliance |
| `network-forensics` | Ring buffer capture & flow timeline |
| `automated-response` | Policy engine & SOAR webhook integration |

## Host Size Band

A subscription is priced by the size of the node it covers, so a license can
carry a per-node CPU ceiling in `max_cores_per_agent` (0 or absent = no
ceiling). At load time the agent counts the CPUs the host is provisioned with
and refuses a license whose ceiling the machine exceeds:

```
host has 48 CPUs, license covers nodes up to 32 - move the agent to a smaller
node or upgrade the size band
```

The count is read from `/sys/devices/system/cpu/present`, falling back to
`online` and then to the process CPU budget. `present` is preferred because it
reports what the machine was provisioned with: CPUs taken offline at runtime
through hotplug do not shrink the node the agent is licensed for.

Refusal behaves like any other license failure - the agent keeps running and
keeps enforcing the open source datapath, with enterprise features disabled.
The ceiling lives inside the signed payload, so raising it invalidates both
signatures.

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
  --public-key license-signing.pub \
  --pq-private-key license-signing-pq.key \
  --pq-public-key license-signing-pq.pub
```

This generates both an Ed25519 keypair and an ML-DSA-65 keypair. Both are required: licenses are post-quantum dual-signed and verified against both public keys.

### Generate License

```bash
# v2 dual-signed license (Ed25519 + ML-DSA-65)
ebpfsentinel-license generate \
  --signing-key license-signing.key \
  --pq-signing-key license-signing-pq.key \
  --org "Acme Corp" \
  --features advanced-dlp,ml-detection \
  --expires 2027-01-01 \
  --max-agents 50 \
  --max-cores-per-agent 32 \
  --fingerprint ca9240c0e28de960... \
  --output license.key
```

Both `--signing-key` and `--pq-signing-key` are required — every license is post-quantum dual-signed.

### Inspect License

```bash
ebpfsentinel-license inspect license.key \
  --public-key license-signing.pub \
  --pq-public-key license-signing-pq.pub
```

Output includes both signature verification results:

```
Ed25519 signature:  VALID
ML-DSA-65 signature: VALID
License version:    2
```

Each key flag is optional on its own, and a signature with no key given is reported as `not verified` rather than checked. Pass both — a check that names only the classical key accepts a file carrying one valid signature and one forged, which is the case the second algorithm exists for.

**Exit code:** `inspect` exits non-zero if a signature was checked and did not verify, so it can gate a deployment script. A signature that was not checked at all does not fail the command; it is reported as unchecked.

### Where the public keys come from

The two `.pub` files are published, not served alongside the license. They are attached to every `measurements/v*` release and ship inside every enterprise release tarball, beside the `ebpfsentinel-license` binary itself.

Obtain them once, out of band, and keep them. A license delivered over a web session and a key delivered down that same session prove nothing together: whoever could tamper with one could tamper with the other. That is the whole reason the key does not travel with the document.

### Check an Offline Bundle

An estate with no route to the vendor receives its licenses as a single offline bundle: every key currently in force with its signed document, plus every revocation that can still change what the fleet runs.

```bash
ebpfsentinel-license bundle offline-bundle.json \
  --public-key license-signing.pub \
  --pq-public-key license-signing-pq.pub \
  --against /etc/ebpfsentinel/licences \
  --output-dir /etc/ebpfsentinel/licences.new
```

Both key flags are required here. A bundle crosses an air gap with no session behind it, so there is nothing else that could vouch for it.

For every key in the bundle the tool recomputes the SHA-256 of the signed document, checks it against the fingerprint the entry declares, verifies both signatures, and reads the terms out of the signed payload rather than out of the entry — a relabelled entry with a good signature is refused. The container itself is deliberately unsigned; each key inside is self-verifying.

| Flag | Effect |
|---|---|
| `--against <dir>` | Digests every readable file in the directory and reports any that the bundle lists as revoked |
| `--output-dir <dir>` | Writes each accepted key as `<fingerprint>.lic`, byte-identical to the signed source |

Every failure in the bundle is reported before the command aborts — an operator across an air gap gets one run. The exit code is non-zero if any key was refused or if a revoked file is still present on disk.

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

## Post-Quantum License Signing

ML-DSA-65 (FIPS 204) dual signing provides post-quantum resistance for license keys. Both an Ed25519 signature and an ML-DSA-65 signature are computed over the same JSON payload.

**Verification behavior:**

- Both the Ed25519 and ML-DSA-65 signatures must be valid for the license to be accepted. Failure of either signature — or a missing ML-DSA-65 signature — rejects the license.
- Legacy Ed25519-only (v1) keys are no longer accepted.

**Key storage:**

ML-DSA-65 keys are stored as 32-byte seed files. The full keypair is deterministically expanded from the seed at signing/verification time, keeping key material compact and consistent with the Ed25519 key file size.

**HKDF key derivation:**

The License-as-Computation-Parameter mechanism (AES-256-GCM encryption of enterprise assets) derives keys from the Ed25519 signature bytes via HKDF. The ML-DSA-65 signature is not used for key derivation.

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
- Host larger than the licensed size band: rejects license, falls back to OSS mode

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/license` | viewer | none | Enterprise license status (200, or 402 when the license is absent or invalid). |

Returns license status (200 OK or 402 Payment Required):

```json
{
  "valid": true,
  "org": "Acme Corp",
  "features": ["advanced-dlp", "ml-detection"],
  "issued_at": "2026-03-14T00:00:00Z",
  "expires_at": "2027-01-01T23:59:59Z",
  "max_agents": 50,
  "max_cores_per_agent": 32,
  "host_cores": 30,
  "machine_fingerprint": "ca9240c0..."
}
```

`host_cores` is what this machine measured, reported next to the ceiling so a
fleet audit can see the headroom left before a resize takes a node out of band.
