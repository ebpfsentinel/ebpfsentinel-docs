# L7 Alert Enrichment & MITRE Mapping

> **Edition: Enterprise** | **Status: Shipped — enrichment engine**
> (SIEM export + compliance-report wiring ship in a follow-up release) | **License Feature: `advanced-dlp`**

## Overview

The enterprise `L7Enricher` turns raw L7 detection signals — a
Vectorscan inspect match from the deep content inspection engine or a
per-protocol policy violation — into a fully-formed alert payload carrying the framework
references SOC analysts, SIEM pipelines, and compliance engines need:

- **OWASP Top 10 (2021)** category
- **MITRE ATT&CK** technique (id + name + tactic)
- **PCI-DSS 6.5** control references
- Protocol-specific context (HTTP request fingerprint, database
  command + target, trimmed query fragment)

The enricher is stateless and deterministic, so it sits happily on the
hot path of the enterprise L7 dispatcher — no locks, no allocations
beyond the returned `L7EnrichedAlert`.

## Mapping tables

### Vectorscan → OWASP / MITRE / PCI

| Inspect category | OWASP | MITRE | PCI-DSS |
|------------------|-------|-------|---------|
| `sql_injection` | A03:2021 Injection | T1190 Exploit Public-Facing Application | 6.5.1 |
| `xss` | A03:2021 Injection | T1190 | 6.5.1 |
| `path_traversal` | A03:2021 Injection | T1190 | 6.5.1 |
| `command_injection` | A03:2021 Injection | T1059 Command and Scripting Interpreter | 6.5.1 |
| `data_exfil` | A01:2021 Broken Access Control | T1048 Exfiltration Over Alternative Protocol | 6.5.8, 10.2 |

### Per-protocol policy → MITRE

| Policy code | MITRE |
|-------------|-------|
| `redis.dangerous_command`, `mongo.admin_command`, `sql.ddl_blocked`, `sql.dcl_blocked` | T1059 |
| `redis.namespace_violation`, `mongo.collection_denied`, `kafka.topic_denied`, `kafka.client_not_allowlisted`, `sql.schema_denied`, `ldap.bind_dn_restricted` | T1078 |
| `mongo.query_injection`, `sql.complexity_exceeded`, `redis.rate_limited` | T1190 |
| `kafka.message_too_large` | T1048 |
| `ldap.scope_too_broad`, `ssh.banner_scanner` | T1069 |
| `ldap.sensitive_attribute` | T1555 |
| `ssh.version_too_old`, `ssh.weak_algorithm` | T1040 |

## Enricher helpers

`L7Enricher::http_fingerprint(method, path)` returns a stable 16-char
hex string suitable for SIEM de-duplication and alert clustering. It
is deterministic across a process run but not cryptographic — avoid
using it for security decisions.

`L7Enricher::trim_query_fragment(query)` clips any `SQL` / `NoSQL`
query to 256 bytes on a UTF-8 char boundary and appends `"…"`, so the
enriched alert remains friendly to every SIEM back-end.

## Example

```rust
use enterprise_domain::l7_enrichment::{HttpContext, L7Enricher};
use enterprise_domain::l7_inspect::{InspectCategory, InspectMatch, InspectSeverity, PatternOrigin};

let enricher = L7Enricher::new();

let hit = InspectMatch {
    pattern_id: "sqli-union-select".into(),
    category: InspectCategory::SqlInjection,
    name: "Union Select".into(),
    severity: InspectSeverity::High,
    origin: PatternOrigin::BuiltIn,
    byte_offset: 48,
    byte_length: 12,
};

let http = HttpContext {
    method: "GET".into(),
    path: "/api/users".into(),
    host: Some("example.com".into()),
    user_agent: None,
    request_fingerprint: L7Enricher::http_fingerprint("GET", "/api/users"),
};

let alert = enricher.enrich_inspect_match(&hit, Some(http));
assert_eq!(alert.mitre.as_ref().unwrap().id, "T1190");
```

## Status & Roadmap

### Shipped

- `L7Enricher` stateless engine with inspect + policy enrichers.
- OWASP / MITRE / PCI mapping tables.
- HTTP fingerprint + query fragment helpers.
- 23 unit tests.

### Shipping in a follow-up release

- SIEM connector wiring: add `threat.technique.id`, `threat.framework`,
  `url.path`, `http.request.fingerprint`, `sql.statement` fields to
  the 14 existing enterprise SIEM exporters using ECS field names.
- Compliance reports: surface `L7EnrichedAlert::pci_dss` in the PDF
  compliance engine so PCI-DSS 6.5 findings show up alongside existing
  framework controls.
- Hot-path wiring inside the enterprise L7 dispatcher (blocked on the
  upstream deep-inspection and per-protocol-policy dispatcher
  integration milestones).
- Per-tenant MITRE override tables.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/entity.rs` | `L7EnrichedAlert`, `OwaspCategory`, `MitreTechnique`, `PciDssControl`, `HttpContext`, `DatabaseContext` |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/mitre.rs` | `technique_for_inspect_category` / `technique_for_policy_code` |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/pci.rs` | `controls_for_inspect_category` / `controls_for_policy_code` |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/engine.rs` | `L7Enricher` |

## Feature Gating

The enrichment layer requires the same `advanced-dlp` license feature
as the Vectorscan DLP engine, the L7 deep content inspection engine,
and the per-protocol policy engines — all four E18 enterprise
capabilities light up together. Without a license the enricher stays
idle and the OSS L7 firewall operates unchanged.
