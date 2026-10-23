# Compliance Reports

> **Edition: Enterprise**

## Overview

Automated compliance report generation for 8 regulatory frameworks including EU/French regulations. Reports map eBPFsentinel controls to framework requirements, judge each control on what the running agent reports about itself at the moment the report is generated, and produce exportable documents with a pass/fail/partial/not-applicable/not-evaluated status per control. Nothing in a report is passed on the strength of a template: a control whose evidence the agent cannot read is reported as not evaluated, and counts against the score. Enterprise infrastructure state (HA, multi-tenancy, federation, air-gap) and network segmentation validation are automatically evaluated and appended.

## Supported Frameworks

| Framework | Sections | Controls | Description |
|-----------|----------|----------|-------------|
| **PCI-DSS 4** | 5 | 24 | Payment Card Industry Data Security Standard v4.0 |
| **HIPAA** | 3 | 13 | Health Insurance Portability and Accountability Act Security Rule |
| **GDPR Art 32** | 3 | 8 | General Data Protection Regulation Article 32 technical measures |
| **SOC 2** | 4 | 12 | Service Organization Control 2 Trust Service Categories |
| **NIS2** | 2 | 14 | EU Network and Information Security Directive 2 (Articles 21, 23) |
| **DORA** | 3 | 12 | EU Digital Operational Resilience Act (Chapters II, III, IV) |
| **SecNumCloud** | 5 | 12 | ANSSI cloud security qualification (Ch.8-14) |
| **HDS** | 6 | 9 | French health data hosting certification (ISO 27001/27018 + Art. R.1111) |

Each framework has a page mapping its articles to what the agent reads:
[PCI DSS](../../compliance/pci-dss.md), [HIPAA](../../compliance/hipaa.md),
[GDPR](../../compliance/gdpr.md), [SOC 2](../../compliance/soc2.md),
[NIS2](../../compliance/nis2.md), [DORA](../../compliance/dora.md),
[SecNumCloud](../../compliance/secnumcloud.md) and [HDS](../../compliance/hds.md).

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
| `status` | `Pass`, `Fail`, `Partial`, `NotApplicable` or `NotEvaluated` |
| `evidence` | Supporting evidence items |
| `recommendations` | Remediation guidance (for Partial, Fail and NotEvaluated controls) |

### Evidence Item

| Field | Description |
|-------|-------------|
| `source` | `"runtime"` for a fact read from the agent, `"scope"` for the part of the control the agent does not carry |
| `description` | Human-readable summary |
| `data` | Arbitrary JSON evidence payload |
| `timestamp_ms` | Collection timestamp |

### Compliance Score

Score formula: `(passed + partial * 0.5) / (total - not_applicable) * 100`

- `Partial` controls count as 0.5 pass
- `NotApplicable` controls are excluded from the denominator
- `NotEvaluated` controls stay in the denominator: an agent that reads nothing scores 0, not 100
- Returns 100.0 if all controls are `NotApplicable`

The summary carries a `not_evaluated` count beside `passed`, `failed`, `partial` and
`not_applicable`. A report written before that field existed reads it as zero.

## Framework Controls

### PCI-DSS 4 (5 sections, 24 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Requirement 1 - Network Security | 4 | Firewall rules, segmentation, traffic restrictions, trusted/untrusted connections |
| Requirement 3 - Data Protection | 4 | Retention policies, unnecessary storage, data masking, transit encryption |
| Requirement 6 - Secure Systems | 7 | Vulnerability management, patching, secure development, change management |
| Requirement 10 - Logging/Monitoring | 5 | Audit trail, automated alerting, log integrity, time sync, log retention |
| Requirement 11 - Security Testing | 4 | IDS/IPS, vulnerability scanning, pen testing, change detection |

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

### NIS2 (2 sections, 14 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Article 21(2) - Risk Management Measures | 10 | Points (a) to (j): risk analysis, incident handling, business continuity, supply chain, vulnerability handling, effectiveness assessment, cyber hygiene, cryptography, access control, MFA and secured communications |
| Article 23(4) - Incident Reporting | 4 | 24h early warning, 72h incident notification, intermediate report, final report |

### DORA (3 sections, 12 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Chapter II - ICT Risk Management | 7 | Art. 6 framework, Art. 7 systems and tools, Art. 8 identification, Art. 9 protection and prevention, Art. 10 detection, Art. 11 response and recovery, Art. 13 learning and evolving |
| Chapter III - Incident Management | 3 | Art. 17 management process, Art. 18 classification, Art. 19 reporting of major incidents |
| Chapter IV - Resilience Testing | 2 | Art. 24 general testing requirements, Art. 25 testing of ICT tools and systems |

### SecNumCloud (5 sections, 12 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| Ch.8 - Access Control | 2 | Authentication (JWT/OIDC/API key), authorization (RBAC) |
| Ch.9 - Network Security | 3 | Segmentation, flow filtering, flow monitoring |
| Ch.10 - Operations and Monitoring | 3 | Logging, monitoring/detection, event correlation |
| Ch.12 - Cryptography | 2 | TLS configuration, post-quantum readiness |
| Ch.14 - Incident Management | 2 | Incident detection, forensics |

### HDS (6 sections, 9 controls)

| Section | Controls | Topics |
|---------|----------|--------|
| ISO 27001 A.13 - Communications Security | 2 | Network security management, information transfer |
| ISO 27001 A.10 - Cryptography | 1 | Cryptographic controls |
| ISO 27001 A.12.4 - Logging/Monitoring | 2 | Event logging, log protection |
| ISO 27001 A.16 - Incident Management | 2 | Incident response, ARS notification (Art. R.1111-9) |
| ISO 27018 - PII Protection | 1 | Health data DLP (NIR, RPPS, IPP, FINESS patterns recommended) |
| Art. R.1111-10 - Traceability | 1 | Access audit trail |

### Enterprise Infrastructure Sections

Five optional sections appended based on runtime status. The estate is read once per report, at
the moment the report is generated, so a report asserts what was running when it was asked for
rather than what was running when the agent started. A section is absent when there is nothing
to read it from, which is a different statement from a section reporting zero.

| Section | Controls | Condition |
|---------|----------|-----------|
| High Availability & Resilience | 2 (cluster config, automatic failover) | HA status provided |
| Multi-Tenant Isolation | 3 (isolation, RBAC, quotas) | Tenant status provided |
| Multi-Cluster Federation | 2 (cluster health, policy consistency) | Federation status provided |
| Air-Gap Network Isolation | 1 (enforcement) | Air-gap status provided |
| Network Segmentation Validation | 1 (zone topology compliance) | Segmentation policy configured |

## How a Control Is Judged

Every framework control names the facts it rests on, and each fact is read from the running
agent when the report is generated:

| Fact | Read from |
|------|-----------|
| Datapath | Whether this node drives the eBPF programs, or stands by for an HA leader that does |
| Firewall rules, enforcing, default deny | The firewall service: enabled, rule count, block or alert mode, catch-all policy (a deny-all posture in force counts as default deny) |
| IDS, IPS, DLP, threat intelligence | Each engine: enabled, rules, patterns or feeds loaded, block or alert mode |
| L7, rate limiting, DDoS, zones | Each engine: enabled and rules, policies or zones loaded |
| Audit trail and its retention | The audit service (enabled, backed by a persistent store) and `audit.retention_days` |
| Alerting | `alerting.enabled` |
| API authentication | The authentication stack the API listener was built with (JWT, OIDC, API keys) |
| SIEM export | The SIEM connector, its exported events and its export errors |
| RBAC | The roles defined in advanced RBAC |
| TLS floor, post-quantum tracking | The TLS intelligence crypto policy (minimum version, blocked ciphers) and whether PQC tracking is on |
| Anomaly detection, forensics | Whether the ML and forensics services run |
| Automated response, incident webhook | The response policies and webhooks loaded |
| High availability | HA peers and whether the datapath is active |
| Report schedule | Whether compliance reports run on a schedule |

Each fact is met, unmet or unread, and the control's status follows:

| Facts | Status |
|-------|--------|
| All met | `Pass` |
| All met, but part of the control is outside the agent | `Partial` |
| Some met, some unmet | `Partial` |
| None met, at least one unmet | `Fail` |
| None unmet, at least one unread | `NotEvaluated` |
| The control is outside the agent altogether | `NotApplicable` |

A fact is unread when the service it comes from is not running in this agent: not licensed,
switched off, or the datapath never came up. That is a different statement from a fact read and
found wanting, which is why it ends in `NotEvaluated` rather than `Fail`, and why it is never a
pass. Every control carries one `runtime` evidence item per fact, naming the fact, whether it was
met, and what was observed. Where part of a control is the organisation's (a procedure, a
notification to an authority, training), a `scope` evidence item says so and the control is
capped at `Partial`, with a recommendation to evidence the rest outside the agent.

## Scheduling

Reports can be generated automatically on a recurring schedule:

| Frequency | Interval |
|-----------|----------|
| `Daily` | 24 hours |
| `Weekly` | 7 days |
| `Monthly` | 30 days |

The scheduler runs as a background tokio task, generating one report per framework in
`schedule.frameworks` at each interval. That list is the schedule's own: left empty it falls back
to all eight frameworks rather than to the top-level `frameworks`, so a schedule narrower than the
agent's evaluation set has to name its frameworks.

### Delivery

Each scheduled report can be delivered over two optional channels, configured under `schedule`:

- **Email (SMTP)** - when `schedule.smtp` is set, the report is emailed to every address in `email_recipients` with the JSON report attached. Submission uses STARTTLS (port 587) by default, or implicit TLS when `starttls: false` (port 465); TLS runs over the agent's rustls stack. Optional SMTP AUTH via `username`/`password`.
- **Webhook** - when `schedule.webhook_url` is set, a JSON summary (`framework`, `report_id`, `format`, `summary`) is POSTed to the URL on each run, for SOAR/automation pipelines.

Both channels are best-effort: a delivery failure is logged and never aborts report generation or the scheduler loop.

## Storage

- **In-memory**: up to 100 reports (oldest dropped on overflow)
- **Disk persistence**: optional, saves each report as `{id}.json` in `output_dir` (pretty-printed JSON)
- **Retention**: reports older than `retention_days` are removed at each scheduler tick, from memory
  and from `output_dir`. The disk half scans the directory rather than walking the in-memory list, so
  a report already evicted by the 100-report cap is still deleted at its retention date. A file that
  cannot be read or parsed is left alone, because a corrupt file must not be mistaken for an expired one
- **Startup recovery**: loads existing reports from disk if `output_dir` configured

## Posture Over Time

An agent keeps at most 100 reports and drops them at `retention_days`, so the
agent alone cannot say how the score moved across a year. The dashboard keeps
that history itself, in its history store:

- **Sampling**: every hour, for every tenant, the dashboard reads the newest
  completed report of each framework the agents hold and keeps one point per
  tenant, framework and day: the score and each control's status. A later
  sample on the same day replaces the earlier one.
- **Retention**: 456 days, which covers a year-on-year comparison plus a
  quarter of margin, enforced by the table's own TTL.
- **Scope**: the point is tenant-wide. The cluster and host the compliance
  screen narrows its reports to do not narrow the trend, and the panel says so.
- **Missing days stay missing**: a day on which no report was read (no agent
  answered, or none had a completed report) is returned with no score, and the
  line on the compliance screen breaks there instead of being drawn across it.
- **Changes and causes**: between two consecutive read days whose scores or
  control statuses differ, the trend lists the controls that improved and
  regressed, and the configuration rollouts recorded between the two readings
  (identifier, sections touched, whether it was rolled back). A change with no
  recorded rollout says so. Rollouts come from the dashboard's in-memory
  rollout book, so they are not kept across a dashboard restart: a change
  older than the last restart carries no cause even if one existed.
- **Without a history store** nothing is retained: the trend endpoint answers
  503 with `{"reason":"history_store_disabled"}` and the compliance screen shows
  only the latest report per framework.

The trend is served by the dashboard, not by the agent, at
`/api/v1/{tenant}/posture/trend?days=N`, where `N` is between 7 and 456
(default 90); see [Dashboard configuration](../../configuration/dashboard.md#route-surface).

## Export Formats

| Format | Endpoint Suffix | Content-Type | Description |
|--------|----------------|--------------|-------------|
| JSON | - | `application/json` | Full structured report with all sections and evidence |
| CSV | `/csv` | `text/csv` | Columns: section_id, section_title, control_id, control_name, status, evidence_count, recommendations |
| Text | `/text` | `text/plain` | Structured text with title, metadata, summary table, section details |
| PDF | `/pdf` | `application/pdf` | A4 document carrying the framework, the generation time, the score and one line per control (attachment: `compliance-report.pdf`) |

### PDF Export

PDF reports are generated using the [krilla](https://github.com/LaurenzV/krilla) library. An A4
page carries:

- **Header** - `Compliance Report: {framework}`, the generation time in UTC and the compliance score
- **Control counts** - total, pass, partial, fail, not-applicable and not-evaluated on one line
- **Section details** - per section, one line per control: the control id, a `[PASS]` / `[PART]` /
  `[FAIL]` / `[N/A]` / `[NOT EVAL]` marker, the control name and how many evidence items back it. The evidence
  payloads and the remediation guidance are in the JSON and text exports rather than in the PDF
- **Font** - Liberation Sans, embedded in the binary and again in every document it writes. The
  published image is distroless and carries no font, so nothing is read from the host and no mount
  is needed; a document opens the same way on any machine

If the renderer fails, the route answers `500` and the body is not a PDF. It never answers `200`
with something that is not a document under the `application/pdf` content type, because nothing
downstream can tell the two apart.

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  compliance:
    enabled: true
    frameworks: [pci_dss4, hipaa, gdpr_art32, soc2, nis2, dora, secnumcloud, hds]
    schedule:
      frequency: weekly
      frameworks: [pci_dss4, soc2]
      email_recipients: [compliance@example.com]
      smtp:
        host: smtp.example.com
        port: 587
        from: ebpfsentinel@example.com
        username: smtp-user        # optional
        password: smtp-secret      # optional
        starttls: true             # default; set false for implicit TLS (465)
      webhook_url: https://soar.example.com/hooks/compliance   # optional
    retention_days: 90
    output_dir: /var/lib/ebpfsentinel/reports
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable compliance reporting |
| `frameworks` | list | all 8 | Frameworks to evaluate (accepts `pci_dss4`, `hipaa`, `gdpr_art32`, `soc2`, `nis2`, `dora`, `secnumcloud`, `hds`) |
| `retention_days` | u32 | `90` | Days to retain generated reports |
| `output_dir` | string | - | Optional directory for disk persistence |
| `schedule` | object | - | Optional automated generation config |
| `schedule.frequency` | string | `daily` | `daily`, `weekly` or `monthly` |
| `schedule.frameworks` | list | all 8 | Frameworks generated on each tick (empty means all eight) |
| `schedule.email_recipients` | list | - | Addresses emailed each scheduled report (requires `schedule.smtp`) |
| `schedule.smtp` | object | - | SMTP server for email delivery (`host`, `port`, `from`, `username?`, `password?`, `starttls`) |
| `schedule.webhook_url` | string | - | URL POSTed a JSON report summary on each scheduled run |

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `POST` | `/api/v1/compliance/reports` | operator | compliance-reports | Generate a new report (`{ framework, period_start_ms, period_end_ms, format }`). |
| `GET` | `/api/v1/compliance/reports` | viewer | compliance-reports | List reports (summary views, newest first). |
| `GET` | `/api/v1/compliance/reports/{id}` | viewer | compliance-reports | Fetch full report (JSON). |
| `GET` | `/api/v1/compliance/reports/{id}/csv` | viewer | compliance-reports | Export as CSV (attachment: `report.csv`). |
| `GET` | `/api/v1/compliance/reports/{id}/text` | viewer | compliance-reports | Export as structured text. |
| `GET` | `/api/v1/compliance/reports/{id}/pdf` | viewer | compliance-reports | Export as PDF (attachment: `compliance-report.pdf`). |
| `POST` | `/api/v1/compliance/segmentation/validate` | operator | compliance-reports | Validate a network segmentation policy (zones, allowed flows). |

### Error Responses

| Code | Condition |
|------|-----------|
| 201 | Report generated successfully |
| 400 | Invalid time range (start ≥ end) or invalid UUID |
| 404 | Report not found |
| 500 | Generation failure, or a PDF the renderer could not produce |

## Feature Gating

Compliance Reports requires a valid license with the `compliance-reports`
feature. Gating is by route merge rather than by a check inside the handler:
without the feature the reporting routes are never mounted, so every path answers
`404 Not Found` rather than `402 Payment Required`.
