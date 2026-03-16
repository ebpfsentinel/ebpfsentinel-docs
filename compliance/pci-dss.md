# PCI-DSS v4.0 Compliance

eBPFsentinel supports PCI-DSS compliance across five key requirements.

## Requirement Mapping

| PCI-DSS Requirement | eBPFsentinel Feature | Configuration |
|---------------------|---------------------|---------------|
| **Req. 1** — Network Security Controls | Firewall (L3/L4 + L7) | `firewall`, `l7` sections |
| **Req. 3** — Protect Cardholder Data | DLP with credit card patterns | `dlp` section |
| **Req. 6** — Secure Systems | IDS/IPS with SQL injection, XSS detection | `ids`, `ips` sections |
| **Req. 10** — Logging and Monitoring | Audit trail with 90-day retention | `audit` section |
| **Req. 11** — Security Testing | IPS auto-blocking, threat intelligence | `ips`, `threatintel` sections |

## Requirement 1: Network Security Controls

Configure the firewall to enforce network segmentation:

```yaml
firewall:
  default_policy: drop
  rules:
    - id: allow-payment-processing
      priority: 10
      action: allow
      protocol: tcp
      src_ip: "10.1.0.0/16"      # Cardholder data environment
      dst_ip: "10.2.0.0/16"      # Payment processor
      dst_port: "443"
    - id: deny-cde-to-internet
      priority: 5
      action: deny
      src_ip: "10.1.0.0/16"
```

## Requirement 3: Protect Cardholder Data

Configure DLP to detect credit card numbers in transit:

```yaml
dlp:
  enabled: true    # OSS built-in patterns detect Visa, Mastercard, Amex automatically
```

## Requirement 6: Secure Systems

Configure IDS to detect common web attacks:

```yaml
ids:
  mode: alert
  rules:
    - id: pci-sql-injection
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: critical
      description: "SQL injection attempt"
    - id: pci-xss
      pattern: "(?i)(<script|javascript:|on\\w+\\s*=)"
      severity: high
      description: "Cross-site scripting attempt"
    - id: pci-command-injection
      pattern: "(?i)(;\\s*(cat|ls|wget|curl)\\s|\\|\\s*(cat|ls))"
      severity: critical
      description: "Command injection attempt"
```

## Requirement 10: Logging and Monitoring

Configure audit trail with PCI-required retention:

```yaml
audit:
  enabled: true
  retention_days: 90            # PCI minimum

alerting:
  routes:
    - name: pci-critical
      destination: webhook
      min_severity: critical
      webhook_url: "https://hooks.example.com/pci-alerts"
```

## Requirement 11: Security Testing

Enable IPS for automatic blocking and threat intelligence:

```yaml
ips:
  mode: block
  blacklist_ttl: 86400
  rules:
    - id: pci-auto-block-sqli
      pattern: "(?i)(union\\s+select|drop\\s+table)"
      severity: critical
      mode: block

threatintel:
  feeds:
    - id: abuse-ch-feodo
      name: "Abuse.ch Feodo Tracker"
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval_secs: 3600
      default_action: block
```

## Evidence Collection

For PCI-DSS audits, collect evidence from:

- **Firewall rules**: `ebpfsentinel-agent firewall list`
- **Alert history**: `ebpfsentinel-agent alerts list --severity critical`
- **Audit trail**: `ebpfsentinel-agent audit logs`
- **Metrics**: Prometheus metrics for continuous monitoring evidence
