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

Additional access-control hardening:

- **Constant-time API key comparison** prevents timing side-channel attacks on key validation
- **Auth rate limiting** protects against brute-force authentication attempts
- **Token revocation** allows immediate invalidation of compromised JWT tokens
- **RSA 2048-bit minimum** enforced for JWT signing keys (RS256)
- **CA private key zeroization** ensures signing material is scrubbed from memory after use

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
    - id: abuse-ch-feodo
      name: "Abuse.ch Feodo Tracker"
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval_secs: 3600
      default_action: block
```

## CC6.7 — Incident Response

```yaml
ips:
  mode: block
  blacklist_ttl: 3600

alerting:
  routes:
    - name: soc2-incidents
      destination: webhook
      min_severity: high
      webhook_url: "https://hooks.pagerduty.com/your-endpoint"
```

## CC6.8 — Audit

```yaml
audit:
  enabled: true
  retention_days: 365
```

## Cryptographic Controls

| Control | Implementation |
|---------|---------------|
| TLS version | TLS 1.3 by default; TLS 1.2 available as opt-in for legacy clients |
| JWT signing | RS256 with RSA 2048-bit minimum key size |
| API key storage | SHA-256 hashed; constant-time comparison at validation |
| CA private keys | Zeroized from memory after use |
| Token lifecycle | Revocation support for immediate invalidation |
| Auth protection | Rate limiting on authentication endpoints |

## Evidence Collection for Auditors

| SOC 2 Control | Evidence Source |
|---------------|---------------|
| CC6.1 | `ebpfsentinel-agent firewall list`, auth config |
| CC6.6 | `ebpfsentinel-agent alerts list`, threat intel feeds |
| CC6.7 | IPS blacklist, alert webhook delivery logs |
| CC6.8 | `ebpfsentinel-agent audit logs` |
| A1.3 | Prometheus metrics, health check responses |
| C1.1 | DLP alert history |
