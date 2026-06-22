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

conntrack:
  enabled: true

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

l7:
  ports: [5432]
  rules:
    - id: block-db-dump
      priority: 10
      action: deny
      protocol: postgres
      command: "Q"
      path: "pg_dump"

dlp:
  enabled: true    # OSS built-in patterns detect credit cards, SSN automatically

audit:
  enabled: true
  retention_days: 365

alerting:
  routes:
    - name: db-critical
      destination: webhook
      min_severity: critical
      webhook_url: "https://hooks.example.com/db-alerts"
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
