# HIPAA Compliance

eBPFsentinel supports HIPAA Security Rule safeguards for network-level controls.

**Note:** eBPFsentinel operates at the network layer and does not access or store Protected Health Information (PHI). No Business Associate Agreement (BAA) is required for the agent itself.

## Safeguard Mapping

| HIPAA Section | Safeguard | eBPFsentinel Feature |
|---------------|-----------|---------------------|
| §164.312(a)(1) | Access Control | Firewall, L7 Firewall, Authentication |
| §164.312(b) | Audit Controls | Audit trail (6-year retention) |
| §164.312(c)(1) | Integrity | IDS/IPS (tampering detection) |
| §164.312(e)(1) | Transmission Security | DLP (PHI patterns), TLS |
| §164.308(a)(1)(ii)(D) | Activity Review | Alerting, Prometheus metrics |

## §164.312(a)(1) — Access Control

```yaml
firewall:
  default_policy: drop
  rules:
    - id: hipaa-ehr-access
      priority: 10
      action: allow
      protocol: tcp
      src_ip: "10.10.0.0/16"     # Clinical workstations
      dst_ip: "10.20.0.0/16"     # EHR servers
      dst_port: "443"
```

## §164.312(b) — Audit Controls

HIPAA requires 6-year retention:

```yaml
audit:
  enabled: true
  retention_days: 2190          # 6 years
```

## §164.312(e)(1) — Transmission Security

Configure DLP to detect PHI patterns:

```yaml
dlp:
  mode: alert
  patterns:
    - id: hipaa-mrn
      pattern: "\\b(MRN|mrn)[:\\s]*\\d{6,10}\\b"
      severity: critical
      description: "Medical Record Number"
    - id: hipaa-ssn
      pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
      severity: critical
      description: "Social Security Number (PHI)"

tls:
  enabled: true
  cert_path: /etc/ebpfsentinel/server.crt
  key_path: /etc/ebpfsentinel/server.key
```

## Evidence Collection

- Audit trail: `ebpfsentinel-agent audit logs --limit 1000`
- Access control rules: `ebpfsentinel-agent firewall list`
- DLP alerts: `ebpfsentinel-agent alerts list --component dlp`
- System integrity: Prometheus metrics for continuous monitoring
