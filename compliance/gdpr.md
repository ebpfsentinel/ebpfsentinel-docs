# GDPR Compliance

eBPFsentinel supports GDPR Article 32 technical measures for network security.

## Article Mapping

| GDPR Article | Requirement | eBPFsentinel Feature |
|-------------|-------------|---------------------|
| Art. 32(1)(a) | Pseudonymization and encryption | TLS 1.3, DLP |
| Art. 32(1)(b) | Confidentiality and integrity | Firewall, IDS/IPS, L7 Firewall |
| Art. 32(1)(c) | Availability and resilience | Rate limiting, hot reload |
| Art. 32(1)(d) | Regular testing | Audit trail, alerting, metrics |
| Art. 33 | Breach notification | Alerting pipeline |
| Art. 35 | DPIA | Audit trail, monitoring evidence |

## Art. 32(1)(a) — Encryption

```yaml
tls:
  enabled: true
  cert_path: /etc/ebpfsentinel/server.crt
  key_path: /etc/ebpfsentinel/server.key
```

## Art. 32(1)(b) — Confidentiality

```yaml
firewall:
  default_policy: drop
  rules:
    - id: gdpr-block-non-eu
      priority: 10
      action: deny
      src_ip: "0.0.0.0/0"        # Block by default
      description: "Block non-EU data transfers"

dlp:
  mode: alert
  patterns:
    - id: gdpr-email
      pattern: "\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b"
      severity: medium
      description: "Email address (personal data)"
```

## Art. 33 — Breach Notification

Configure alerting for potential data breach detection:

```yaml
alerting:
  routes:
    - name: gdpr-breach-detection
      severity: [critical, high]
      component: [dlp, ids, ips]
      senders: [webhook-dpo]
  senders:
    - name: webhook-dpo
      type: webhook
      url: "https://hooks.example.com/gdpr-breach"
      timeout: 10
```

## Data Minimization

eBPFsentinel supports data minimization principles:

- eBPF programs process packets in-kernel — only events matching rules are forwarded to userspace
- IDS sampling reduces the volume of inspected traffic
- DNS cache TTLs ensure data is not retained indefinitely
- Audit trail retention is configurable

## Evidence Collection

- Network controls: `ebpfsentinel-agent firewall list`
- DLP monitoring: `ebpfsentinel-agent alerts list --component dlp`
- Audit trail: `ebpfsentinel-agent audit logs`
- Encryption status: TLS configuration and certificate validation
