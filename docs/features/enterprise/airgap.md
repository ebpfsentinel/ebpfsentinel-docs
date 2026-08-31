# Air-Gap Mode

> **Edition: Enterprise**

## Overview

Offline operation for environments without internet access. Threat intelligence feeds are packaged into signed bundles with per-file SHA-256 checksums, transferred via USB or file copy, and imported into air-gapped agents with Ed25519 signature verification, integrity validation, and path traversal protection.

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
8. Record bundle as imported, update `last_import_ms`
9. Check feed freshness (optional warnings)
10. Invoke feed loader callback to load verified feeds into threat intel engine

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

After successful import, verified feeds are passed to the threat intel engine via a callback:

```rust
pub struct VerifiedFeed {
    pub id: String,          // feed identifier
    pub format: String,      // csv, json, stix
    pub data: Vec<u8>,       // raw feed data (checksum-verified)
    pub ioc_count: usize,
}
```

The `FeedLoadCallback` is set at initialization to wire feeds into the OSS threat intel engine.

## Configuration

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
| `POST` | `/api/v1/airgap/import` | operator | air-gap | Import a bundle (200 with `status: ok/skipped/error`). |
| `GET` | `/api/v1/airgap/bundles` | viewer | air-gap | List imported bundles (version + created_at_ms). |
| `POST` | `/api/v1/airgap/check-freshness` | operator | air-gap | Validate bundle freshness. |
| `GET` | `/api/v1/airgap/status` | viewer | air-gap | Air-gap mode status (enabled, features_disabled, bundle_dir, last_import, count). |

### Status Response

| Field | Description |
|-------|-------------|
| `enabled` | Whether air-gap mode is active |
| `features_disabled` | Features disabled in air-gap mode (e.g., `"remote-feeds"`, `"oidc-jwks-fetch"`) |
| `bundle_dir` | Bundle storage directory |
| `last_bundle_import_ms` | Timestamp of last successful import |
| `bundles_imported` | Count of imported bundles |

## Feature Gating

Air-Gap Mode requires a valid license with the `air-gap` feature. Without a license, threat intelligence feeds must be fetched from remote URLs.
