# Compliance Reports

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Automated compliance report generation for 8 regulatory frameworks including EU/French regulations. Reports map eBPFsentinel controls to framework requirements, collect evidence from the running system, and produce exportable documents with pass/fail/partial/not-applicable status per control. Enterprise infrastructure state (HA, multi-tenancy, federation, air-gap) and network segmentation validation are automatically evaluated and appended.

## Supported Frameworks

| Framework | Sections | Controls | Description |
|-----------|----------|----------|-------------|
| **PCI-DSS 4** | 5 | 21 | Payment Card Industry Data Security Standard v4.0 |
| **HIPAA** | 3 | 13 | Health Insurance Portability and Accountability Act Security Rule |
| **GDPR Art 32** | 3 | 8 | General Data Protection Regulation Article 32 technical measures |
| **SOC 2** | 4 | 12 | Service Organization Control 2 Trust Service Categories |
| **NIS2** | 2 | 8 | EU Network and Information Security Directive 2 (Articles 21, 23) |
| **DORA** | 3 | 7 | EU Digital Operational Resilience Act (Chapters II, III, IV) |
| **SecNumCloud** | 5 | 14 | ANSSI cloud security qualification (Ch.8-14) |
| **HDS** | 6 | 11 | French health data hosting certification (ISO 27001/27018 + Art. R.1111) |

Plus up to **5 enterprise infrastructure sections** (9 additional controls including segmentation) appended dynamically.

## Report Structure

### ComplianceReport

| Field | Description |
|-------|-------------|
| `id` | UUIDv7 report identifier |
| `framework` | Compliance framework |
| `title` | Auto-generated from framework |
| `status` | `Pending` → `Generating` → `Completed` (or `Failed`) |
| `format` | Preferred output format (JSON, CSV, PDF) |
| `created_at_ms` | Creation timestamp |
| `completed_at_ms` | Completion timestamp |
| `period_start_ms` / `period_end_ms` | Reporting period |
| `sections` | Framework sections with control assessments |
| `summary` | Aggregated compliance statistics |

### Control Assessment

Each `ControlEvidence` contains:

| Field | Description |
|-------|-------------|
| `control_id` | Framework-specific ID (e.g., `"1.1"`, `"164.308(a)(1)"`, `"CC5.1"`) |
| `control_name` | What the control requires |
| `status` | `Pass`, `Fail`, `Partial`, or `NotApplicable` |
| `evidence` | Supporting evidence items |
| `recommendations` | Remediation guidance (for Partial/Fail controls) |

### Evidence Item

| Field | Description |
|-------|-------------|
| `source` | Origin: `"audit_log"`, `"alert_history"`, `"metrics"`, `"config"` |
| `description` | Human-readable summary |
| `data` | Arbitrary JSON evidence payload |
| `timestamp_ms` | Collection timestamp |

### Compliance Score

Score formula: `(passed + partial × 0.5) / (total - not_applicable) × 100`

- `Partial` controls count as 0.5 pass
- `NotApplicable` controls are excluded from the denominator
- Returns 100.0 if all controls are `NotApplicable`

## Framework Controls

### PCI-DSS 4 (5 sections, 21 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Requirement 1 — Network Security | 4 | Firewall rules, segmentation, traffic restrictions, trusted/untrusted connections |
| Requirement 3 — Data Protection | 4 | Retention policies, unnecessary storage, data masking, transit encryption |
| Requirement 6 — Secure Systems | 4 | Vulnerability management, patching, secure development, change management |
| Requirement 10 — Logging/Monitoring | 5 | Audit trail, automated alerting, log integrity, time sync, log retention |
| Requirement 11 — Security Testing | 4 | IDS/IPS, vulnerability scanning, pen testing, change detection |

### HIPAA (3 sections, 13 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Administrative Safeguards | 5 | Security management, workforce security, training, incident procedures, evaluation |
| Physical Safeguards | 2 | Facility access, device/media controls |
| Technical Safeguards | 6 | Access control, encryption, audit controls, integrity, authentication, transmission security |

### GDPR Article 32 (3 sections, 8 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Security of Processing | 4 | Pseudonymisation/encryption, CIA resilience, restore availability, regular testing |
| Risk Assessment | 1 | Risk-appropriate security level |
| Data Protection | 3 | Breach detection (DLP), traffic monitoring, cross-border transfer controls |

### SOC 2 (4 sections, 12 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| CC5 Control Activities | 3 | Control selection, technology controls, policy implementation |
| CC6 Logical/Physical Access | 4 | Logical access, protected assets, system boundaries, unauthorized access prevention |
| CC7 System Operations | 4 | Change detection, monitoring, event evaluation, incident response |
| CC8 Change Management | 1 | Infrastructure/software changes |

### NIS2 (2 sections, 8 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Article 21 — Risk Management Measures | 5 | Network monitoring, incident handling, cryptography, supply chain security, access control |
| Article 23 — Incident Reporting | 3 | 24h early warning detection, 72h incident notification, final report generation |

### DORA (3 sections, 7 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Chapter II — ICT Risk Management | 3 | Risk management tools, ICT systems, protection and prevention |
| Chapter III — Incident Management | 3 | Detection capabilities, incident classification, incident reporting |
| Chapter IV — Resilience Testing | 1 | Testing requirements, MITRE coverage validation |

### SecNumCloud (5 sections, 14 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Ch.8 — Access Control | 2 | Authentication (JWT/OIDC/API key), authorization (RBAC) |
| Ch.9 — Network Security | 3 | Segmentation, flow filtering, flow monitoring |
| Ch.10 — Operations and Monitoring | 3 | Logging, monitoring/detection, event correlation |
| Ch.12 — Cryptography | 2 | TLS configuration, post-quantum readiness |
| Ch.14 — Incident Management | 2 | Incident detection, forensics |

### HDS (6 sections, 11 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| ISO 27001 A.13 — Communications Security | 2 | Network security management, information transfer |
| ISO 27001 A.10 — Cryptography | 1 | Cryptographic controls |
| ISO 27001 A.12.4 — Logging/Monitoring | 2 | Event logging, log protection |
| ISO 27001 A.16 — Incident Management | 2 | Incident response, ARS notification (Art. R.1111-9) |
| ISO 27018 — PII Protection | 1 | Health data DLP (NIR, RPPS, IPP, FINESS patterns recommended) |
| Art. R.1111-10 — Traceability | 1 | Access audit trail |

### Enterprise Infrastructure Sections

Four optional sections appended based on runtime status:

| Section | Controls | Condition |
|---------|----------|-----------|
| High Availability & Resilience | 2 (cluster config, automatic failover) | HA status provided |
| Multi-Tenant Isolation | 3 (isolation, RBAC, quotas) | Tenant status provided |
| Multi-Cluster Federation | 2 (cluster health, policy consistency) | Federation status provided |
| Air-Gap Network Isolation | 1 (enforcement) | Air-gap status provided |
| Network Segmentation Validation | 1 (zone topology compliance) | Segmentation policy configured |

## Runtime Overrides

The application layer applies runtime state to override template-based control statuses:

- **HA override**: if no peers or eBPF inactive, downgrades Pass → Partial/Fail for HA-related controls
- **RBAC override**: if RBAC disabled but tenants present, downgrades Pass → Fail for RBAC-related controls

## Scheduling

Reports can be generated automatically on a recurring schedule:

| Frequency | Interval |
|-----------|----------|
| `Daily` | 24 hours |
| `Weekly` | 7 days |
| `Monthly` | 30 days |

The scheduler runs as a background tokio task, generating reports for all configured frameworks at each interval. Email notification to `email_recipients` is parsed in config but not yet implemented.

## Storage

- **In-memory**: up to 100 reports (oldest dropped on overflow)
- **Disk persistence**: optional, saves each report as `{id}.json` in `output_dir` (pretty-printed JSON)
- **Retention**: reports older than `retention_days` cleaned up during each scheduler tick
- **Startup recovery**: loads existing reports from disk if `output_dir` configured

## Export Formats

| Format | Endpoint Suffix | Content-Type | Description |
|--------|----------------|--------------|-------------|
| JSON | — | `application/json` | Full structured report with all sections and evidence |
| CSV | `/csv` | `text/csv` | Columns: section_id, section_title, control_id, control_name, status, evidence_count, recommendations |
| Text | `/text` | `text/plain` | Structured text with title, metadata, summary table, section details |
| PDF | `/pdf` | `application/pdf` | Branded PDF with company logo, cross-reference matrix, and compliance score summary |

### PDF Export

PDF reports are generated using the [krilla](https://github.com/LaurenzV/krilla) library and include:

- **Company branding** — configurable company name displayed in the header
- **Cross-reference matrix** — maps each control to framework requirements
- **Compliance score** — visual summary with pass/fail/partial counts
- **Section details** — per-control status, evidence, and remediation guidance
- **Embedded fonts** — Liberation Sans family for consistent rendering across systems

## Configuration

```yaml
enterprise:
  compliance:
    enabled: true
    frameworks: [pci_dss4, hipaa, gdpr_art32, soc2, nis2, dora, secnumcloud, hds]
    schedule:
      frequency: weekly
      frameworks: [pci_dss4, soc2]
      email_recipients: [compliance@example.com]
    retention_days: 90
    output_dir: /var/lib/ebpfsentinel/reports
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable compliance reporting |
| `frameworks` | list | all 8 | Frameworks to evaluate (accepts `pci_dss4`, `hipaa`, `gdpr_art32`, `soc2`, `nis2`, `dora`, `secnumcloud`, `hds`) |
| `retention_days` | u32 | `90` | Days to retain generated reports |
| `output_dir` | string | — | Optional directory for disk persistence |
| `schedule` | object | — | Optional automated generation config |

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/compliance/reports` | Generate a new report (`{ framework, period_start_ms, period_end_ms, format }`) |
| `GET` | `/api/v1/compliance/reports` | List reports (summary views, newest first) |
| `GET` | `/api/v1/compliance/reports/{id}` | Fetch full report (JSON) |
| `GET` | `/api/v1/compliance/reports/{id}/csv` | Export as CSV (attachment: `report.csv`) |
| `GET` | `/api/v1/compliance/reports/{id}/text` | Export as structured text |
| `GET` | `/api/v1/compliance/reports/{id}/pdf` | Export as branded PDF (attachment: `report.pdf`) |
| `POST` | `/api/v1/compliance/segmentation/validate` | Validate a network segmentation policy (zones, allowed flows) |

### Error Responses

| Code | Condition |
|------|-----------|
| 201 | Report generated successfully |
| 400 | Invalid time range (start ≥ end) or invalid UUID |
| 404 | Report not found |
| 500 | Generation failure |

## Feature Gating

Compliance Reports requires a valid license with the `compliance-reports` feature. Without a license, report generation endpoints return 402.
