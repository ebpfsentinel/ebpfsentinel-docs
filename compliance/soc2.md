# SOC 2 Compliance

eBPFsentinel supports SOC 2 Trust Service Categories for network security controls.

## Trust Service Category Mapping

| Category | Control | eBPFsentinel Feature |
|----------|---------|---------------------|
| **Security (CC)** | CC6.1 — Access Control | Firewall, Authentication, RBAC |
| | CC6.6 — Incident Detection | IDS, Threat Intelligence, DNS Intelligence |
| | CC6.7 — Incident Response | IPS (auto-block), Alerting |
| | CC6.8 — Audit | Audit Trail |
| **Availability (A)** | A1.2 — Recovery | Hot reload, systemd restart |
| | A1.3 — Monitoring | Prometheus metrics, health checks |
| **Processing Integrity (PI)** | PI1.1 — Data Accuracy | IDS (tampering detection) |
| **Confidentiality (C)** | C1.1 — Secrets Protection | DLP (API key, credential detection) |
| **Privacy (P)** | P4.2 — Personal Information | DLP (PII patterns) |

## CC6.1 — Access Control

```yaml
auth:
  enabled: true
  api_keys:
    - name: admin
      key: "sk-admin-key"
      role: admin
    - name: monitoring
      key: "sk-monitoring-key"
      role: viewer

firewall:
  default_policy: drop
  rules:
    - id: soc2-allow-internal
      priority: 10
      action: allow
      src_ip: "10.0.0.0/8"
      protocol: tcp
```

## CC6.6 — Incident Detection

```yaml
ids:
  mode: alert
  rules:
    - id: soc2-sqli
      pattern: "(?i)(union\\s+select|drop\\s+table)"
      severity: critical

threatintel:
  feeds:
    - name: abuse-ch-feodo
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval: 3600
      action: block
```

## CC6.7 — Incident Response

```yaml
ips:
  mode: block
  blacklist_ttl: 3600

alerting:
  routes:
    - name: soc2-incidents
      severity: [critical, high]
      senders: [webhook-pagerduty]
```

## CC6.8 — Audit

```yaml
audit:
  enabled: true
  retention_days: 365
```

## Evidence Collection for Auditors

| SOC 2 Control | Evidence Source |
|---------------|---------------|
| CC6.1 | `ebpfsentinel-agent firewall list`, auth config |
| CC6.6 | `ebpfsentinel-agent alerts list`, threat intel feeds |
| CC6.7 | IPS blacklist, alert webhook delivery logs |
| CC6.8 | `ebpfsentinel-agent audit logs` |
| A1.3 | Prometheus metrics, health check responses |
| C1.1 | DLP alert history |
