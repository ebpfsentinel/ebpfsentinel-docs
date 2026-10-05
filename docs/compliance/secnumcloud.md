# SecNumCloud Compliance

eBPFsentinel carries part of the technical requirements of the ANSSI SecNumCloud qualification
for cloud service providers: access control (chapter 8), network security (chapter 9),
operations and monitoring (chapter 10), cryptography (chapter 12) and incident management
(chapter 14).

The [compliance report](../features/enterprise/compliance-reports.md) (Enterprise) judges each
requirement below on what the running agent reports about itself when the report is generated. A
requirement whose facts the agent cannot read is reported as not evaluated, never as passed.
The qualification itself covers the provider's whole organisation and is granted by the ANSSI
after an audit; the report evidences the part of it a network agent can carry, and does not
claim the qualification.

## Requirement Mapping

| Requirement | Topic | What the agent is judged on | Capped at Partial |
|-------------|-------|-----------------------------|-------------------|
| Ch.8.1 | Authentication | API authentication (JWT, OIDC or API keys) | No |
| Ch.8.2 | Authorization | RBAC roles defined | No |
| Ch.9.1 | Segmentation | Datapath loaded, network zones defined | No |
| Ch.9.2 | Filtering | Datapath loaded, firewall rules, firewall in block mode | No |
| Ch.9.3 | Flow monitoring | Datapath loaded, alert pipeline | No |
| Ch.10.1 | Logging | Persistent audit trail, retention of at least 180 days | No |
| Ch.10.2 | Monitoring and detection | IDS signatures, ML anomaly detection | No |
| Ch.10.3 | Correlation | SIEM export | No |
| Ch.12.1 | TLS | TLS floor at TLS 1.2 or above | Yes: the agent watches TLS on the wire and does not terminate it |
| Ch.12.2 | Post-quantum readiness tracking | PQC tracking enabled | No |
| Ch.14.1 | Incident detection | Alert pipeline, automated response policies | No |
| Ch.14.2 | Forensics | Forensic capture running | No |

## Configuration

```yaml
firewall:
  enabled: true
  mode: block
  default_policy: drop

ids:
  enabled: true

alerting:
  enabled: true

audit:
  enabled: true
  retention_days: 180          # Ch.10.1 is unmet below 180
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
    frameworks: [secnumcloud]
```

Network zones, RBAC roles (`enterprise.advanced_rbac`), a SIEM connector (`enterprise.siem`),
ML anomaly detection (`enterprise.ml`) and response policies (`enterprise.response`) complete
the set. See the [enterprise configuration](../configuration/enterprise.md) for each block.

An audit trail kept only in memory does not meet Ch.10.1, whatever its retention: the report
reads whether the audit service is backed by a persistent store.

## Evidence Collection

- The compliance report itself: `POST /api/v1/compliance/reports` with
  `"framework": "secnumcloud"`, exported as JSON, CSV, text or PDF
- Each control's `runtime` evidence names the fact read and what was observed
- Post-quantum readiness: `GET /api/v1/enterprise/tls-intelligence/pqc/report`
- Audit trail: `ebpfsentinel-agent audit logs`
