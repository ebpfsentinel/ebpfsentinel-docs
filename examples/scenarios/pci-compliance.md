# PCI Compliance Scenario

Full PCI-DSS deployment combining firewall segmentation, DLP, IDS/IPS, threat intelligence, and audit trail.

## Scenario

- Cardholder Data Environment (CDE) on `10.1.0.0/16`
- Payment processor on `10.2.0.0/16`
- Corporate network on `10.3.0.0/16`
- Strict isolation between CDE and corporate

## Configuration

```yaml
agent:
  interfaces: [eth0]

firewall:
  default_policy: drop
  rules:
    - id: pci-cde-to-processor
      priority: 10
      action: allow
      protocol: tcp
      src_ip: "10.1.0.0/16"
      dst_ip: "10.2.0.0/16"
      dst_port: 443
    - id: pci-mgmt-to-cde
      priority: 20
      action: allow
      protocol: tcp
      src_ip: "192.168.0.0/16"
      dst_ip: "10.1.0.0/16"
      dst_port: 22
    - id: pci-deny-cde-to-corporate
      priority: 5
      action: deny
      src_ip: "10.1.0.0/16"
      dst_ip: "10.3.0.0/16"
    - id: pci-deny-corporate-to-cde
      priority: 6
      action: deny
      src_ip: "10.3.0.0/16"
      dst_ip: "10.1.0.0/16"

ids:
  mode: alert
  rules:
    - id: pci-sqli
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: critical
    - id: pci-xss
      pattern: "(?i)(<script|javascript:)"
      severity: high
    - id: pci-cmd-injection
      pattern: "(?i)(;\\s*(cat|ls|wget)\\s|\\|\\s*(cat|ls))"
      severity: critical

ips:
  mode: block
  blacklist_ttl: 86400
  whitelist:
    - "192.168.0.0/16"
  rules:
    - id: pci-block-sqli
      pattern: "(?i)(union\\s+select|drop\\s+table)"
      severity: critical
      mode: block
      threshold:
        type: both
        count: 3
        window_secs: 60
        track_by: src_ip

dlp:
  enabled: true    # OSS built-in patterns detect Visa, Mastercard, Amex automatically

threatintel:
  feeds:
    - id: abuse-ch-feodo
      name: "Abuse.ch Feodo Tracker"
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval_secs: 3600
      default_action: block

audit:
  enabled: true
  retention_days: 90

alerting:
  smtp:
    host: smtp.example.com
    port: 587
    from_address: "ebpfsentinel@example.com"
    tls: true
  routes:
    - name: pci-webhook
      destination: webhook
      min_severity: critical
      event_types: [dlp, ids, ips, threatintel]
      webhook_url: "https://hooks.example.com/pci-alerts"
    - name: pci-email
      destination: email
      min_severity: critical
      event_types: [dlp, ids, ips, threatintel]
      email_to: "pci-compliance@example.com"

tls:
  enabled: true
  cert_path: /etc/ebpfsentinel/server.crt
  key_path: /etc/ebpfsentinel/server.key

auth:
  enabled: true
  api_keys:
    - name: pci-admin
      key: "sk-pci-admin-change-me"
      role: admin
    - name: pci-audit
      key: "sk-pci-audit-change-me"
      role: viewer
```

## PCI Evidence Collection

```bash
# Requirement 1: Network segmentation
ebpfsentinel-agent firewall list

# Requirement 3: Data protection
ebpfsentinel-agent alerts list --component dlp

# Requirement 6: Secure systems
ebpfsentinel-agent ips list
ebpfsentinel-agent ips blacklist

# Requirement 10: Audit trail
ebpfsentinel-agent audit logs --limit 100

# Requirement 11: Threat detection
ebpfsentinel-agent threatintel status
ebpfsentinel-agent alerts list --severity critical
```
