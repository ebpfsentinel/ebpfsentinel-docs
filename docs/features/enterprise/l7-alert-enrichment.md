# L7 Alert Enrichment & MITRE Mapping

> **Edition: Enterprise** | **License Feature: `advanced-dlp`**

## Overview

The enterprise `L7Enricher` turns raw L7 detection signals - a
Vectorscan inspect match from the deep content inspection engine or a
per-protocol policy violation - into a fully-formed alert payload carrying the framework
references SOC analysts, SIEM pipelines, and compliance engines need:

- **OWASP Top 10 (2021)** category
- **MITRE ATT&CK** technique (id + name + tactic)
- **PCI-DSS 6.5** control references
- Protocol-specific context (HTTP request fingerprint, database
  command + target, trimmed query fragment)

The enricher is stateless and deterministic: no locks, no allocations
beyond the returned `L7EnrichedAlert`.

## What gets enriched

The enricher is not attached to the packet path. It runs over the
signals produced by one submission to
`POST /api/v1/enterprise/l7/analyze`, and the enriched alerts come back
in the `enriched_alerts` field of that response.

The consequence is specific to this feature: **an alert nobody
submitted is never enriched.** The framework references below are not
added to alerts the OSS datapath raises on its own, and they are not
retrofitted onto anything already in the alert store. What is enriched
is the inspect matches and the policy violation of the payload that was
just handed over.

Reaching a SIEM is a second, separate condition. An enriched alert is
forwarded to the configured SIEM exporters only when the submission
carried an `alert_meta` object, because that object is where the
addresses, ports, protocol number, tenant and rule id come from and a
SIEM event cannot be built without them. Submit without `alert_meta`
and the enrichment comes back in the HTTP response and goes nowhere
else. The `/api/v1/enterprise/l7/enriched-alerts` route reads back what
the enricher has produced, whether or not it was exported.

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
is deterministic across a process run but not cryptographic - avoid
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

## Example - what is submitted and what comes back

Submitting a payload with `alert_meta`, so the enriched alert is also
forwarded to the SIEM exporters:

```bash
curl -sk -X POST https://agent:8444/api/v1/enterprise/l7/analyze \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{
        "protocol": "http",
        "payload_b64": "aWQ9MScgVU5JT04gU0VMRUNUIHVzZXJuYW1lLHBhc3N3b3JkIEZST00gdXNlcnMtLQ==",
        "http": {"method": "GET", "path": "/api/users", "host": "example.com"},
        "alert_meta": {
          "src_ip": "203.0.113.10",
          "dst_ip": "10.0.0.5",
          "src_port": 54321,
          "dst_port": 443,
          "protocol": 6,
          "rule_id": "l7-http-inbound"
        }
      }'
```

The `payload_b64` above decodes to
`id=1' UNION SELECT username,password FROM users--`.

```json
{
  "protocol": "http",
  "duration_ns": 86400,
  "inspect_matches": [
    {
      "pattern_id": "sqli-union-select",
      "category": "sql_injection",
      "name": "Union Select",
      "severity": "high",
      "confidence": 80,
      "byte_offset": 6,
      "byte_length": 12
    }
  ],
  "policy": null,
  "enriched_alerts": [
    {
      "source": "vectorscan",
      "reason": "Union Select (sql_injection) matched at byte 6",
      "owasp": "A03:2021-Injection",
      "mitre_id": "T1190",
      "mitre_name": "Exploit Public-Facing Application",
      "mitre_tactic": "initial-access",
      "pci_dss": ["PCI-DSS 6.5.1"],
      "vectorscan_category": "sql_injection",
      "http_method": "GET",
      "http_path": "/api/users",
      "http_fingerprint": "3f5c9a12b7e04d68",
      "database_protocol": null,
      "database_command": null,
      "database_target": null,
      "query_fragment": null
    }
  ]
}
```

Drop `alert_meta` from the request and the response is identical, but
nothing is sent to the SIEM.

Payloads are held to 64 KiB once decoded. A larger submission is
refused:

```json
{"error": "payload is 131072 bytes decoded, over the 65536 byte limit"}
```

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/entity.rs` | `L7EnrichedAlert`, `OwaspCategory`, `MitreTechnique`, `PciDssControl`, `HttpContext`, `DatabaseContext` |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/mitre.rs` | `technique_for_inspect_category` / `technique_for_policy_code` |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/pci.rs` | `controls_for_inspect_category` / `controls_for_policy_code` |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_enrichment/engine.rs` | `L7Enricher` |

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/l7/enriched-alerts` | viewer | advanced-dlp | Alerts carrying their L7 protocol context. |

## Feature Gating

The enrichment layer requires the same `advanced-dlp` license feature
as the Vectorscan DLP engine, the L7 deep content inspection engine,
and the per-protocol policy engines: all four enterprise
capabilities light up together. Without a license the enricher stays
idle and the OSS L7 firewall operates unchanged.
