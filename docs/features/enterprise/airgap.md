# Air-Gap Mode

> **Edition: Enterprise**

## Overview

Offline operation for environments without internet access. Threat intelligence feeds are packaged into signed bundles with per-file SHA-256 checksums, transferred via USB or file copy, and imported into air-gapped agents with Ed25519 signature verification, integrity validation, and path traversal protection.

## What Air-Gap Mode Refuses

Turning air-gap mode on does more than change a status field: the agent decides
once at startup that it is air-gapped and every component that would build an
HTTP client asks that decision before it opens a socket. A refused attempt never
reaches the network layer.

The line the agent draws is between a destination **we** chose and a destination
**you** chose:

| Purpose | Air-gap | Why |
|---------|---------|-----|
| `threat-intel-feed-download` | **Refused** | Reaches a public feed provider. Import a signed bundle instead. |
| `portal-reporting` | **Refused** | Reaches the vendor. Entitlement is measured from the offline licence. |
| `siem-export` | Permitted | The collector is the one named in your configuration. |
| `compliance-delivery` | Permitted | The webhook or SMTP host is the one named in your configuration. |
| `federation-peer` | Permitted | Another cluster in your own federation. |
| `response-webhook` | Permitted | The endpoint an automated response action names. |

A permitted purpose is not a promise that the host is reachable: a SIEM
collector sitting outside the enclave fails the way any unreachable host does.
What air-gap guarantees is that the two refused purposes are not attempted at
all, whatever URL the configuration carries.

On startup the agent states what it enforces rather than what it hopes:

```text
INFO  Air-gap mode ENABLED - threat-intel feed downloads and vendor portal
      reporting are refused; destinations named in this configuration stay
      reachable
WARN  feature="threat-intel-feed-download (import a signed bundle instead)"
      Air-gap: outbound connections for this purpose are refused
WARN  feature="portal-reporting (entitlement is measured from the offline licence)"
      Air-gap: outbound connections for this purpose are refused
```

Every refusal is counted per purpose and reported on
`GET /api/v1/airgap/status`, so an operator can tell a deployment that never
tried to reach out from one that is trying and being stopped.

## License Activation Across the Gap

Air-gap mode is itself gated on a license carrying the `air-gap` feature, and
that license reaches a host with no route to the vendor the same way the feed
bundles do: as a file somebody carries. Four commands do it, two on each side of
the gap. Nothing in this workflow opens a socket.

**1. On the air-gapped agent, write the request.**

```bash
ebpfsentinel-enterprise-agent generate-request \
  --features advanced-dlp,ml-detection \
  --output request.json
```

The file carries the machine fingerprint, the agent version and the features
asked for. `fingerprint --output` writes a different file - the fingerprint and
the three values it is computed from, with no features - which is a report for a
support ticket and is refused by step 3.

**2. Carry `request.json` to a connected workstation.**

**3. On the workstation, sign the activation.**

```bash
ebpfsentinel-license activate \
  --signing-key license-signing.key \
  --pq-signing-key license-signing-pq.key \
  --request request.json \
  --org "Acme Corp" \
  --expires 2027-01-01 \
  --max-agents 50 \
  --max-cores-per-agent 32 \
  --output activation.key
```

The features are read out of the request and the terms out of the flags, so the
sale is what the vendor typed and the machine is what the agent asked for. The
activation is bound to that one fingerprint, and it is dual-signed: both the
Ed25519 and the ML-DSA-65 signing keys are required.

**4. Carry `activation.key` back and install it.**

```bash
ebpfsentinel-enterprise-agent import-activation activation.key \
  --install-path /etc/ebpfsentinel/license.key
```

The agent validates before it installs: three lines in the envelope, both
signatures against the public keys built into the binary, the fingerprint bound
to this machine and the size band covering it. A refusal names the four causes
and exits non-zero; nothing is written. Restart the agent, or point it at the
installed path with `--license` or `enterprise.license_path`.

Every flag of the three agent commands is in the
[CLI reference](../../cli-reference/index.md#enterprise-agent-commands), and the
signing side in [Enterprise License System](license.md).

## Bundle Format

A bundle is a directory containing:

| File | Description |
|------|-------------|
| `manifest.json` | Bundle manifest with feed metadata and checksums |
| `manifest.sig` | Ed25519 signature over manifest bytes (64 raw bytes) |
| `feeds/` | Directory containing feed data files |

### Manifest

```json
{
  "version": "1.0",
  "created_at_ms": 1709913600000,
  "checksum_algorithm": "sha256",
  "feeds": [
    {
      "id": "abuse-ch-urlhaus",
      "filename": "feeds/abuse-ch.csv",
      "checksum": "a1b2c3...",
      "format": "csv",
      "ioc_count": 5000,
      "last_updated_ms": 1709900000000
    }
  ]
}
```

Supported feed formats: `csv`, `json`, `stix`.

### Manifest Validation

`validate_manifest()` enforces:

- Version is `"1.0"`
- Algorithm is `"sha256"`
- At least one feed
- No empty fields (id, filename, checksum)
- No duplicate feed IDs
- **Path traversal protection**: rejects `".."`, `"/"`, `"\\"` in filenames

## Export Workflow

On a connected workstation, download feeds and package into a signed bundle:

```bash
ebpfsentinel-license feed-export \
  --sources sources.txt \
  --output /path/to/bundle \
  --signing-key license-signing.key
```

### Export Steps

1. Create output directory and `feeds/` subdirectory
2. For each feed source: download from URL (120s timeout)
3. Compute SHA-256 checksum per file
4. Write feed data to `feeds/{id}.{format}`
5. Count IOCs (format-aware heuristic):
   - JSON/STIX: parse as JSON array, count elements or lines
   - CSV/text: count non-empty, non-comment lines
6. Build and validate manifest
7. Serialize manifest to JSON
8. Sign manifest with Ed25519 key
9. Write `manifest.sig` (64 raw bytes)

## Import Workflow

On the air-gapped agent, import and verify the bundle. A feed bundle is imported
through the agent's own API or picked up by auto-import; the license half of the
gap is the four commands above, and neither reaches the other's files.

### Import Steps

1. Read `manifest.json` from bundle directory
2. Read `manifest.sig` (64 bytes)
3. **Verify Ed25519 signature** over manifest bytes
4. Parse and validate manifest (version, algorithm, feeds, path traversal)
5. **Idempotency check**: reject if bundle `(version, created_at_ms)` already imported
6. Canonicalize bundle directory path
7. For each feed:
   - Verify resolved path is within bundle directory (path traversal protection)
   - Read feed file
   - **Verify SHA-256 checksum** against manifest
   - Warn if `ioc_count == 0`
8. **Load the verified feeds** into the threat intel engine, which answers how many
   indicators it accepted
9. Record bundle as imported, update `last_import_ms`
10. Check feed freshness (optional warnings)

The load happens before the bundle is recorded as imported. A bundle whose contents
the engine refused is therefore still importable: the operator fixes whatever refused
it and carries the same bundle back in, rather than being told it has already been
imported while nothing was ever enforced on.

### API Import

```bash
curl -X POST http://localhost:8080/api/v1/airgap/import \
  -H 'Content-Type: application/json' \
  -d '{"bundle_dir": "/path/to/bundle"}'
```

Response:

```json
{
  "status": "ok",
  "bundle_version": "1.0",
  "feeds_imported": 3,
  "iocs_loaded": 15000,
  "skipped_feeds": 0,
  "warnings": []
}
```

Duplicate bundles return `{"status": "skipped"}` (200, not an error).

### Auto-Import

When `auto_import: true`, the agent scans `bundle_dir` for bundles on startup and imports them automatically.

## Freshness Checking

Bundles have a maximum age to prevent stale threat intelligence:

- Default: **7 days** from bundle creation timestamp
- Check per-feed `last_updated_ms` against `max_age_days`
- Returns warnings (not errors) for stale feeds

```json
POST /api/v1/airgap/check-freshness
{ "bundle_dir": "/path/to/bundle", "max_age_days": 7 }

// Response
{ "fresh": true, "warnings": [] }
// or
{ "fresh": false, "warnings": ["feed 'abuse-ch' is 12 days old (max: 7)"] }
```

## Verified Feed Loading

The whole point of an import is what the agent enforces on afterwards. Each feed whose
signature and checksum were verified is handed to the threat intel engine, which parses
it through the same code path a downloaded feed goes through, so an offline bundle and
an online feed of the same format are read identically.

```rust
pub struct VerifiedFeed {
    pub id: String,          // feed identifier
    pub format: String,      // csv, json, stix
    pub data: Vec<u8>,       // raw feed data (checksum-verified)
    pub ioc_count: usize,
}
```

The sink is installed once, on the agent's startup path, before either entry point can
run: the auto-import sweep and `POST /api/v1/airgap/import` both go through the one
service, so there is no second place that could forget to install it. When the threat
intel datapath is not available, an import is **refused** with
`503 Service Unavailable` rather than answered with the count the manifest claimed for
itself. The caller should retry once the datapath is up; there is nothing wrong with
the bundle they sent.

### What `iocs_loaded` counts

`iocs_loaded` is what the engine accepted, not what the manifest declared. The two are
different numbers by design: a manifest counts what a feed was built from on the
connected side, and the engine counts what survived parsing, the feed's own confidence
and count limits, and its capacity. When they disagree, the difference is stated as a
warning on the import response rather than left to be discovered as a silence:

```json
{
  "status": "ok",
  "bundle_version": "2026.01.15",
  "feeds_imported": 3,
  "iocs_loaded": 14832,
  "skipped_feeds": 0,
  "warnings": ["manifest declares 15000 IOCs, 14832 were loaded"]
}
```

A bundle carrying domain indicators (which STIX feeds do, and the IP-keyed threat intel
engine has no place for) needs the DNS blocklist enabled. Without it the import is
refused rather than answered with a count that quietly dropped them.

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  air_gap:
    enabled: true
    bundle_dir: /var/lib/ebpfsentinel/bundles
    max_age_days: 7
    auto_import: true
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable air-gap mode |
| `bundle_dir` | string | `/var/lib/ebpfsentinel/bundles` | Directory for bundle storage |
| `max_age_days` | u64 | `7` | Maximum bundle age before stale warning |
| `auto_import` | bool | `true` | Automatically import bundles from `bundle_dir` on startup |

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `POST` | `/api/v1/airgap/import` | operator | air-gap | Import a bundle (200 with `status: ok/skipped`, 400 for a bundle that failed verification, 503 when the threat intel datapath is not available). |
| `GET` | `/api/v1/airgap/bundles` | viewer | air-gap | List imported bundles (version + created_at_ms). |
| `POST` | `/api/v1/airgap/check-freshness` | operator | air-gap | Validate bundle freshness. |
| `GET` | `/api/v1/airgap/status` | viewer | air-gap | Air-gap mode status (enabled, features_disabled, bundle_dir, last_import, count). |

### Status Response

| Field | Description |
|-------|-------------|
| `enabled` | Whether air-gap mode is active |
| `features_disabled` | The purposes air-gap refuses, with what to do instead. Derived from the gate itself rather than from a fixed list. |
| `bundle_dir` | Bundle storage directory |
| `last_bundle_import_ms` | Timestamp of last successful import |
| `bundles_imported` | Count of imported bundles |
| `outbound_refusals` | One entry per purpose that has actually been refused, with a count. Empty when nothing has tried. |

```json
{
  "enabled": true,
  "features_disabled": [
    "threat-intel-feed-download (import a signed bundle instead)",
    "portal-reporting (entitlement is measured from the offline licence)"
  ],
  "bundle_dir": "/var/lib/ebpfsentinel/bundles",
  "last_bundle_import_ms": 1709913600000,
  "bundles_imported": 3,
  "outbound_refusals": [
    { "purpose": "threat-intel-feed-download", "refused": 4 }
  ]
}
```

## Feature Gating

Air-Gap Mode requires a valid license with the `air-gap` feature. Without that
feature, or with `air_gap.enabled` left false, no purpose is refused and threat
intelligence feeds are fetched from remote URLs as usual.
