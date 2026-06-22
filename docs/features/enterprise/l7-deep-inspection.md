# L7 Deep Content Inspection

> **Edition: Enterprise** | **License Feature: `advanced-dlp`**

## Overview

The enterprise L7 deep content inspection engine runs compiled
Vectorscan pattern databases against HTTP, gRPC, database, and
messaging payloads to catch **SQL injection**, **XSS**, **path
traversal**, **command injection**, and **data exfiltration** attempts
— the five OWASP top-tier web attack categories plus credential
leakage.

Unlike the existing DLP engine (which focuses on SSL/TLS plaintext),
the L7 inspector targets structured L7 traffic: URIs, headers, request
bodies, SQL statements, JSON payloads, and Redis/MySQL/PostgreSQL wire
protocols. The two engines run on independent Vectorscan databases so
neither workload starves the other of scratch space.

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
