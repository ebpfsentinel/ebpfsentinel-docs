# Quickstart

Get eBPFsentinel running with firewall rules, IDS detection, and rate limiting in 5 minutes.

## 1. Minimal Configuration

Create `config/ebpfsentinel.yaml`:

```yaml
agent:
  interfaces: [eth0]    # Replace with your interface

firewall:
  default_policy: drop
  rules:
    - id: allow-ssh
      priority: 10
      action: allow
      protocol: tcp
      dst_port: 22
    - id: allow-web
      priority: 20
      action: allow
      protocol: tcp
      dst_port: "80-443"
    - id: allow-dns
      priority: 30
      action: allow
      protocol: udp
      dst_port: 53
    - id: allow-icmp
      priority: 100
      action: allow
      protocol: icmp

ids:
  mode: alert
  rules:
    - id: detect-sql-injection
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1)"
      severity: high
      description: "SQL injection attempt"

ratelimit:
  rules:
    - id: global-limit
      rate: 10000
      burst: 20000
      algorithm: token_bucket
      scope: per_ip
```

## 2. Start the Agent

```bash
sudo ./ebpfsentinel-agent --config config/ebpfsentinel.yaml
```

You should see:

```
{"timestamp":"...","level":"INFO","message":"agent started","version":"0.0.0-dev"}
{"timestamp":"...","level":"INFO","message":"eBPF programs loaded","programs":["xdp-firewall","xdp-ratelimit","tc-ids","tc-conntrack"]}
```

## 3. Verify

```bash
# Agent dashboard — programs loaded, conntrack, DDoS, recent alerts
ebpfsentinel-agent status

# Watch alerts in real-time (Ctrl+C to stop)
ebpfsentinel-agent watch

# Top talkers — most active connections by traffic volume
ebpfsentinel-agent top

# Network flows — aggregated connection map
ebpfsentinel-agent flows

# List firewall rules
ebpfsentinel-agent firewall list

# Health check (HTTP)
curl http://localhost:8080/healthz
```

## 4. Add Rules at Runtime

No restart needed — use the REST API or CLI:

```bash
# Add a firewall rule via CLI
ebpfsentinel-agent firewall add --json '{
  "id": "block-telnet",
  "priority": 5,
  "action": "deny",
  "protocol": "tcp",
  "dst_port": 23
}'

# Add a rate limit rule
ebpfsentinel-agent ratelimit add --json '{
  "id": "api-limit",
  "rate": 100,
  "burst": 200,
  "algorithm": "sliding_window",
  "scope": "per_ip"
}'

# Check alerts
ebpfsentinel-agent alerts list --severity high --limit 10
```

## 5. Enable More Features

Add sections to your config file and reload:

```bash
# Edit the config
vim config/ebpfsentinel.yaml

# Reload without restart
kill -HUP $(pidof ebpfsentinel-agent)
# Or via API:
curl -X POST http://localhost:8080/api/v1/config/reload
```

### Add Threat Intelligence

```yaml
threatintel:
  feeds:
    - id: abuse-ch-ipblocklist
      name: "Abuse.ch IP Blocklist"
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval_secs: 3600
      default_action: block
```

### Add DLP

```yaml
dlp:
  mode: alert
  patterns:
    - id: credit-card
      name: "Credit Card Numbers"
      regex: "\\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14})\\b"
      severity: critical
      data_type: pci
      description: "Credit card number detected"
```

### Add Alerting

```yaml
alerting:
  routes:
    - name: critical-alerts
      destination: webhook
      min_severity: high
      webhook_url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

## Next Steps

- [Core Concepts](concepts.md) — understand the architecture
- [Feature Overview](../features/overview.md) — see all available features
- [Configuration Overview](../configuration/overview.md) — full configuration reference
- [CLI Reference](../cli-reference/index.md) — all CLI commands
