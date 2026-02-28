# Threat Hunting

Proactive threat detection using threat intelligence feeds, DNS intelligence, and domain reputation scoring.

## Scenario

Monitor a corporate network for indicators of compromise (IOCs), suspicious DNS queries, and communication with known-bad infrastructure.

## Configuration

```yaml
agent:
  interfaces: [eth0]

threatintel:
  feeds:
    - name: abuse-ch-feodo
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval: 3600
      action: alert                  # Alert first, block after validation
    - name: abuse-ch-urlhaus
      url: "https://urlhaus.abuse.ch/downloads/csv_recent/"
      format: csv
      field_mapping:
        indicator: 2
        type: 4
        description: 5
      refresh_interval: 1800
      action: alert
    - name: custom-iocs
      url: "https://threat-feeds.internal/iocs.json"
      format: json
      field_mapping:
        indicator: "$.ioc"
        type: "$.type"
        description: "$.info"
      refresh_interval: 900
      action: block                  # Internal feeds are pre-validated

dns:
  cache_size: 200000
  blocklist:
    - domain: "*.tor2web.org"
      action: block
    - domain: "*.onion.to"
      action: block
  feeds:
    - name: abuse-ch-domains
      url: "https://urlhaus.abuse.ch/downloads/hostfile/"
      format: plaintext
      refresh_interval: 3600
  reputation:
    enabled: true
    auto_block_threshold: 0.85       # Auto-block high-score domains
    decay_rate: 0.005                # Slow decay for persistent threats

ids:
  mode: alert
  rules:
    - id: hunt-beacon
      pattern: "(?i)(beacon|callback|c2|command.and.control)"
      severity: high
      description: "Potential C2 beacon"
    - id: hunt-exfil
      pattern: "(?i)(exfil|upload|transfer).*\\.(zip|tar|gz|rar|7z)"
      severity: high
      description: "Potential data exfiltration"

alerting:
  dedup_window: 60
  routes:
    - name: threat-hunt-all
      severity: [critical, high, medium]
      component: [threatintel, dns, ids]
      senders: [log-hunting, webhook-soc]
    - name: auto-block
      severity: [critical]
      component: [threatintel]
      senders: [webhook-soc]
  senders:
    - name: log-hunting
      type: log
      path: "/var/log/ebpfsentinel/threat-hunting.json"
    - name: webhook-soc
      type: webhook
      url: "https://hooks.example.com/soc-alerts"
```

## Hunting Workflow

```bash
# Check threat intel feed status
ebpfsentinel-agent threatintel status

# Review IOC matches
ebpfsentinel-agent alerts list --component threatintel --limit 100

# Check DNS intelligence
ebpfsentinel-agent dns stats
ebpfsentinel-agent dns cache --domain suspicious-domain.com

# Review domain reputation scores
ebpfsentinel-agent domains reputation --min-score 0.5

# Block confirmed threats
ebpfsentinel-agent domains block confirmed-malware.com

# Stream alerts in real-time
grpcurl -plaintext -d '{"min_severity":"medium","component":"threatintel"}' \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

## Analysis

Use the hunting log for offline analysis:

```bash
# Top communicating IPs with threat intel matches
jq -r '.src_addr' /var/log/ebpfsentinel/threat-hunting.json | sort | uniq -c | sort -rn | head

# Timeline of IOC hits
jq -r '[.timestamp, .component, .rule_id, .src_addr, .dst_addr] | @tsv' \
  /var/log/ebpfsentinel/threat-hunting.json

# Domains with high reputation scores
ebpfsentinel-agent --output json domains reputation --min-score 0.7 | jq '.[] | .domain'
```
