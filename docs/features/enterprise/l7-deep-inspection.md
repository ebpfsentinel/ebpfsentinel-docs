# L7 Deep Content Inspection

> **Edition: Enterprise** | **License Feature: `advanced-dlp`**

## Overview

The enterprise L7 deep content inspection engine runs compiled
Vectorscan pattern databases against HTTP, gRPC, database, and
messaging payloads to catch **SQL injection**, **XSS**, **path
traversal**, **command injection**, and **data exfiltration** attempts.
Those five categories are the whole classification vocabulary: they are
how a match is labelled, not stages that can be switched off
individually.

Unlike the existing DLP engine (which focuses on SSL/TLS plaintext),
the L7 inspector targets structured L7 traffic: URIs, headers, request
bodies, SQL statements, JSON payloads, and Redis/MySQL/PostgreSQL wire
protocols. The two engines run on independent Vectorscan databases so
neither workload starves the other of scratch space.

## What Triggers a Scan

The engine is not attached to the packet path. A scan runs when a
payload is submitted to `POST /api/v1/enterprise/l7/analyze`, optionally
carrying the id of the L7 rule it was matched under. That id is what
`deep_inspect_rule_ids` filters on: leave the list empty and every
submitted payload is scanned, name one id and only payloads submitted
under a listed id are.

## Pattern Categories

| Category | Example signatures | Severity range |
|----------|-------------------|----------------|
| `sql_injection` | `UNION SELECT`, `OR 1=1`, `SLEEP(…)`, `BENCHMARK(…)`, `LOAD_FILE(…)`, `INTO OUTFILE`, `DROP TABLE`, `information_schema`, `pg_sleep`, `WAITFOR DELAY`, `xp_cmdshell` | Medium → Critical |
| `xss` | `<script>`, `<iframe src=…>`, `<img onerror=…>`, `<svg onload=…>`, `javascript:`, `document.cookie`, `eval(`, `alert(` | Low → High |
| `path_traversal` | `../`, `..\\`, `/etc/passwd`, `/etc/shadow`, `/proc/self/`, `C:\\Windows\\System32`, `php://filter` | High → Critical |
| `command_injection` | `; cat`, backtick substitution, `$(...)`, `nc -e`, `wget\|sh`, `bash -i`, Python reverse shell | High → Critical |
| `data_exfil` | AWS access key id, Google API key, Slack token, Stripe secret, private key header, JWT token, Visa PAN | Medium → Critical |

The built-in catalogue ships ~40 curated patterns today and is
extensible: every additional signature is a one-line `InspectPattern`
literal in `enterprise-domain::l7_inspect::builtin`. The catalogue is
on a roadmap to grow to 120+ patterns.

## Architecture

```
L7 payload (up to 2 KiB)
  └── L7InspectEngine
        └── CompiledState
              ├── BlockDatabase (Vectorscan — atomically swapped on reload)
              └── ScratchPool (pre-allocated, acquire/release)
        └── Vec<InspectPattern>  // parallel metadata array
              │
              └── InspectMatch per hit
                    ├── pattern_id      (e.g. "sqli-union-select")
                    ├── category        (SqlInjection / Xss / …)
                    ├── name            (human-readable label)
                    ├── severity        (Low | Medium | High | Critical)
                    ├── origin          (BuiltIn | Custom)
                    ├── byte_offset     (match start in the payload)
                    ├── byte_length     (match length)
                    └── confidence()    (derived from severity: 40..95)
```

All pattern changes (load / add / remove / enable / disable) force a
full recompile of the Vectorscan database. The old `BlockDatabase` and
its scratch pool are kept alive until no scanner still references them
so in-flight scans finish on the old state without locking.

## Matching

Every scan returns zero or more `InspectMatch` records. The engine
maps Vectorscan IDs back to the pattern metadata in a single pass, so
the full-text pattern identifier (`"sqli-union-select"`) travels with
the match for alert enrichment.

The `confidence()` helper turns severity into a 0–100 score ready for
SIEM export:

| Severity | Confidence |
|----------|-----------:|
| `Low` | 40 |
| `Medium` | 60 |
| `High` | 80 |
| `Critical` | 95 |

## Custom Patterns

`L7InspectEngine::add_pattern` lets operators load organisation-specific
signatures at runtime. Patterns use the same `InspectPattern` structure
as the built-ins and are tagged with `origin: Custom` so the audit
trail can distinguish them from the default catalogue.

```rust
use enterprise_domain::l7_inspect::*;

let mut engine = L7InspectEngine::new();
engine.load(builtin_patterns())?;

engine.add_pattern(InspectPattern {
    id: "acme-internal-code".into(),
    regex: r"ACME-[A-Z]{3}-[0-9]{6}".into(),
    category: InspectCategory::DataExfil,
    name: "Acme internal tracking code".into(),
    severity: InspectSeverity::Medium,
    origin: PatternOrigin::Custom,
    enabled: true,
})?;

for m in engine.scan(request_body)? {
    println!("{} hit {} ({})", m.pattern_id, m.name, m.category.as_str());
}
```

## Configuration

Custom patterns can also be declared in the agent YAML, which loads them
on top of the built-in catalogue at startup. The catalogue stays active:
these are additions, not a replacement.

```yaml
enterprise:
  advanced_dlp:
    l7_advanced:
      # Empty = every submitted payload is scanned. Populate to opt in
      # rule by rule; anything not named is then no longer scanned.
      deep_inspect_rule_ids: []
      custom_inspect_patterns:
        - id: acme-internal-code
          name: Acme internal tracking code
          regex: "ACME-[A-Z]{3}-[0-9]{6}"
          category: data_exfil
          severity: medium
          enabled: true
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `deep_inspect_rule_ids` | `[string]` | `[]` | Rule ids allowed to trigger a scan. Empty means every submitted payload is scanned |
| `custom_inspect_patterns` | `[Pattern]` | `[]` | Patterns loaded on top of the built-in catalogue |

### Custom inspect pattern

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier. Must not repeat or match a built-in pattern id |
| `name` | `string` | Yes | Label carried by every match |
| `regex` | `string` | Yes | PCRE-compatible expression compiled by Vectorscan |
| `category` | `string` | Yes | `sql_injection`, `xss`, `path_traversal`, `command_injection`, `data_exfil` |
| `severity` | `string` | Yes | `low`, `medium`, `high`, `critical` |
| `enabled` | `bool` | No | Load the pattern but keep it out of scans when `false` (default: `true`) |

A pattern the agent cannot build is reported by id at startup and
skipped, the rest still load. Duplicate rule ids, an empty rule id, an
id colliding with a built-in pattern, an unparseable regex, and an
unknown category or severity are all reported by name at startup.

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/l7/patterns` | viewer | advanced-dlp | List loaded patterns. |
| `POST` | `/api/v1/enterprise/l7/patterns` | operator | advanced-dlp | Add one pattern. |
| `POST` | `/api/v1/enterprise/l7/patterns/bulk` | operator | advanced-dlp | Replace the whole catalogue. |
| `DELETE` | `/api/v1/enterprise/l7/patterns/{id}` | operator | advanced-dlp | Remove a pattern. |
| `GET` | `/api/v1/enterprise/l7/matches` | viewer | advanced-dlp | Recent match history. |
| `GET` | `/api/v1/enterprise/l7/rule-toggles` | viewer | advanced-dlp | Rule ids currently allowed to trigger a scan. |
| `PUT` | `/api/v1/enterprise/l7/rule-toggles` | operator | advanced-dlp | Replace that set. |
| `PATCH` | `/api/v1/enterprise/l7/rule-toggles/{id}` | operator | advanced-dlp | Add or remove one rule id. |
| `POST` | `/api/v1/enterprise/l7/analyze` | operator | advanced-dlp | Scan a payload and return matches, policy decision and enrichment. |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `enterprise-domain` | `crates/enterprise-domain/src/l7_inspect/entity.rs` | `InspectPattern`, `InspectMatch`, `InspectCategory`, `InspectSeverity`, `PatternOrigin` |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_inspect/error.rs` | `L7InspectError` (`InvalidPattern`, `DuplicateId`, `NotFound`, `CompileFailed`, `ScanFailed`) |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_inspect/builtin.rs` | Built-in pattern catalogue |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_inspect/engine.rs` | `L7InspectEngine` (Vectorscan `BlockDatabase` + `ScratchPool`) |
| `enterprise-vectorscan` | `crates/enterprise-vectorscan/` | Safe Rust wrapper around Vectorscan (shared with DLP) |

## Feature Gating

The L7 inspect engine requires a valid enterprise license with the
`advanced-dlp` feature flag (same gate as the existing Vectorscan DLP
engine, since it shares the underlying wrapper). Without a license the
engine stays idle and the OSS L7 firewall operates unchanged.
