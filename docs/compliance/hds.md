# HDS Compliance

eBPFsentinel carries part of the technical requirements of the French health data hosting
certification (Hebergeur de Donnees de Sante): the ISO/IEC 27001 controls on communications,
cryptography, logging and incident management, the ISO/IEC 27018 protection of personal data,
and the access traceability of Art. R.1111-10 of the code de la sante publique.

The [compliance report](../features/enterprise/compliance-reports.md) (Enterprise) judges each
control below on what the running agent reports about itself when the report is generated. A
control whose facts the agent cannot read is reported as not evaluated, never as passed. The
certification is granted by an accredited body after an audit of the host's whole organisation;
the report evidences the part of it a network agent can carry.

## Control Mapping

| Control | Topic | What the agent is judged on | Outside the agent |
|---------|-------|-----------------------------|-------------------|
| A.13.1 | Network security management | Datapath loaded, firewall in block mode, IPS in block mode | - |
| A.13.2 | Information transfer | DLP patterns loaded, TLS floor at TLS 1.2 or above | Transfer agreements; TLS is watched, not terminated |
| A.10.1 | Cryptographic controls | TLS floor at TLS 1.2 or above | Encryption at rest and key management |
| A.12.4.1 | Event logging | Persistent audit trail, SIEM export | - |
| A.12.4.2 | Protection of log information | SIEM export, RBAC roles defined | - |
| A.16.1 | Incident response | Automated response policies, alert pipeline | - |
| A.16.2 | ARS notification (Art. R.1111-9) | Incident webhook registered | Notifying the Agence Regionale de Sante |
| 27018.1 | Health data DLP | DLP patterns loaded, DLP in block mode | The French health identifiers are matched only once their patterns are added |
| R.1111-10 | Access audit trail | Persistent audit trail, RBAC roles defined | - |

## Health Data Patterns

The built-in DLP patterns cover payment cards, generic personal data and credentials. The French
health identifiers are not built in, so 27018.1 stays `Partial` until they are added as custom
patterns (Professional and above):

```yaml
dlp:
  enabled: true
  mode: block
  patterns:
    - id: "hds-nir"
      name: "NIR (numero de securite sociale)"
      regex: "\\b[12][0-9]{2}(0[1-9]|1[0-2])(2[AB]|[0-9]{2})[0-9]{3}[0-9]{3}[0-9]{2}\\b"
      severity: critical
      data_type: health
    - id: "hds-rpps"
      name: "RPPS"
      regex: "\\b10[0-9]{9}\\b"
      severity: high
      data_type: health
    - id: "hds-finess"
      name: "FINESS"
      regex: "\\b[0-9]{2}[0-9AB][0-9]{6}\\b"
      severity: medium
      data_type: health
```

IPP numbers are assigned by each establishment in its own format, so their pattern is the
host's to write.

## Configuration

```yaml
firewall:
  enabled: true
  mode: block

ips:
  enabled: true
  mode: block

alerting:
  enabled: true

audit:
  enabled: true
  retention_days: 365
  storage_path: "/var/lib/ebpfsentinel/audit.redb"
```

```yaml
enterprise:
  tls_intelligence:
    enabled: true
    crypto_policy:
      min_tls_version: 771     # TLS 1.2
  compliance:
    enabled: true
    frameworks: [hds]
```

A SIEM connector (`enterprise.siem`), RBAC roles (`enterprise.advanced_rbac`) and response
policies with an incident webhook (`enterprise.response`) complete the set. See the
[enterprise configuration](../configuration/enterprise.md) for each block.

## Evidence Collection

- The compliance report itself: `POST /api/v1/compliance/reports` with `"framework": "hds"`,
  exported as JSON, CSV, text or PDF
- Each control's `runtime` evidence names the fact read and what was observed; its `scope`
  evidence names what the host evidences elsewhere
- DLP alerts: `ebpfsentinel-agent alerts list --component dlp`
- Audit trail: `ebpfsentinel-agent audit logs`
