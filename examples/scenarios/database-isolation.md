# Database Isolation

Isolate database servers with strict firewall rules, IDS monitoring, and DLP for data exfiltration detection.

## Scenario

- Database servers on `10.10.0.0/24` (PostgreSQL port 5432)
- Application servers on `10.20.0.0/24` (only allowed to connect)
- DBA workstations on `192.168.100.0/24`
- No other access to database subnet

## Configuration

```yaml
agent:
  interfaces: [eth0]

firewall:
  default_policy: drop
  rules:
    - id: allow-app-to-db
      priority: 10
      action: allow
      protocol: tcp
      src_ip: "10.20.0.0/24"
      dst_ip: "10.10.0.0/24"
      dst_port: 5432
    - id: allow-dba-ssh
      priority: 20
      action: allow
      protocol: tcp
      src_ip: "192.168.100.0/24"
      dst_ip: "10.10.0.0/24"
      dst_port: 22
    - id: allow-dba-db
      priority: 30
      action: allow
      protocol: tcp
      src_ip: "192.168.100.0/24"
      dst_ip: "10.10.0.0/24"
      dst_port: 5432
    - id: allow-dns
      priority: 40
      action: allow
      protocol: udp
      dst_port: 53

ids:
  mode: alert
  rules:
    - id: db-sqli
      pattern: "(?i)(union\\s+select|drop\\s+table|truncate\\s+table)"
      severity: critical
      description: "SQL injection targeting database"
    - id: db-dump
      pattern: "(?i)(pg_dump|mysqldump|COPY.*TO\\s+STDOUT)"
      severity: critical
      description: "Database dump attempt"

dlp:
  mode: alert
  patterns:
    - id: db-credit-card
      pattern: "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\\b"
      severity: critical
      description: "Credit card in database traffic"
    - id: db-ssn
      pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
      severity: critical
      description: "SSN in database traffic"

audit:
  enabled: true
  retention_days: 365

alerting:
  routes:
    - name: db-critical
      severity: [critical]
      senders: [webhook-dba]
  senders:
    - name: webhook-dba
      type: webhook
      url: "https://hooks.example.com/db-alerts"
```

## Verification

```bash
# Verify only app servers can reach the database
ebpfsentinel-agent firewall list

# Attempt access from unauthorized IP (should be dropped)
# From 10.30.0.1: telnet 10.10.0.1 5432 → dropped

# Check for DLP alerts
ebpfsentinel-agent alerts list --component dlp
```
