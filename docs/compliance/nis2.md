# NIS2 Compliance

eBPFsentinel carries part of the technical measures the NIS2 Directive (EU 2022/2555) asks of
essential and important entities: the cybersecurity risk-management measures of Article 21(2)
and the evidence behind the incident notifications of Article 23(4).

The [compliance report](../features/enterprise/compliance-reports.md) (Enterprise) judges each
point below on what the running agent reports about itself when the report is generated. A point
whose facts the agent cannot read is reported as not evaluated, never as passed. Most of NIS2 is
governance, procedure and notification to the CSIRT, which no network agent can carry, so most
controls are capped at `Partial`: the report says which part is met by the agent and which part
the entity evidences elsewhere.

## Article Mapping

### Article 21(2) - Cybersecurity Risk-Management Measures

| Point | Requirement | What the agent is judged on | Outside the agent |
|-------|-------------|-----------------------------|-------------------|
| 21(2)(a) | Risk analysis and information system security policies | Threat intelligence feeds loaded, IDS signatures loaded | The risk analysis and the policies themselves |
| 21(2)(b) | Incident handling | Datapath loaded, IDS signatures, alert pipeline, SIEM export | The handling procedure |
| 21(2)(c) | Business continuity | HA peers with an active datapath | Backup, disaster recovery, crisis management |
| 21(2)(d) | Supply chain security | Threat intelligence feeds loaded | Assessing suppliers and their development practices |
| 21(2)(e) | Security in acquisition, development and maintenance, including vulnerability handling | IDS signatures, IPS in block mode | Disclosure and patching |
| 21(2)(f) | Assessing the effectiveness of measures | Scheduled compliance reports, persistent audit trail | The rest of the programme |
| 21(2)(g) | Basic cyber hygiene and training | Firewall default deny, API authentication | Training |
| 21(2)(h) | Cryptography and encryption | TLS floor at TLS 1.2 or above, post-quantum tracking | The agent watches TLS on the wire and does not terminate it |
| 21(2)(i) | Human resources security, access control, asset management | API authentication, RBAC roles, firewall in block mode | Human resources security and asset management |
| 21(2)(j) | Multi-factor authentication and secured communications | API authentication, TLS floor | Multi-factor authentication is the identity provider's |

### Article 23(4) - Reporting Obligations

| Point | Requirement | What the agent is judged on | Outside the agent |
|-------|-------------|-----------------------------|-------------------|
| 23(4)(a) | Early warning within 24 hours | Alert pipeline, incident webhook registered | Sending the warning to the CSIRT |
| 23(4)(b) | Incident notification within 72 hours | SIEM export, persistent audit trail | The notification |
| 23(4)(c) | Intermediate report on request | SIEM export | Status updates to the CSIRT |
| 23(4)(d) | Final report within one month | Persistent audit trail, forensic capture | Assembling the report |

## Configuration

The facts above are met by an agent running the engines they name, in block mode where the
control asks for enforcement:

```yaml
firewall:
  enabled: true
  mode: block
  default_policy: drop

ids:
  enabled: true

ips:
  enabled: true
  mode: block

alerting:
  enabled: true

audit:
  enabled: true
  retention_days: 365
  storage_path: "/var/lib/ebpfsentinel/audit.redb"

auth:
  enabled: true
```

```yaml
enterprise:
  tls_intelligence:
    enabled: true
    crypto_policy:
      min_tls_version: 771     # TLS 1.2
    pqc:
      enabled: true
  forensics:
    enabled: true
  compliance:
    enabled: true
    frameworks: [nis2]
    schedule:
      frequency: monthly
      frameworks: [nis2]
```

A SIEM connector (`enterprise.siem`), at least one RBAC role (`enterprise.advanced_rbac`), an
incident webhook under automated response (`enterprise.response`) and an HA peer
(`enterprise.ha`) complete the set. See the
[enterprise configuration](../configuration/enterprise.md) for each block.

## Early Warning Within 24 Hours

The 24-hour clock of Article 23(4)(a) starts when the entity becomes aware of a significant
incident. Route high-severity alerts to the people who decide whether it is one:

```yaml
alerting:
  enabled: true
  routes:
    - name: nis2-early-warning
      destination: webhook
      min_severity: high
      event_types: [ids, ips, dlp, threatintel]
      webhook_url: "https://hooks.example.com/nis2-early-warning"
```

## Evidence Collection

- The compliance report itself: `POST /api/v1/compliance/reports` with `"framework": "nis2"`,
  exported as JSON, CSV, text or PDF
- Each control's `runtime` evidence names the fact read and what was observed; its `scope`
  evidence names what the entity evidences elsewhere
- Audit trail: `ebpfsentinel-agent audit logs`
- Alerts by component: `ebpfsentinel-agent alerts list --component ids`
