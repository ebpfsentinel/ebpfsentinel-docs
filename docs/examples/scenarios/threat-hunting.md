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
    - id: abuse-ch-feodo
      name: "Abuse.ch Feodo Tracker"
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval_secs: 3600
      default_action: alert          # Alert first, block after validation
    - id: abuse-ch-urlhaus
      name: "Abuse.ch URLhaus"
      url: "https://urlhaus.abuse.ch/downloads/csv_recent/"
      format: csv
      ip_field: dst_ip
      category_field: threat
      skip_header: true
      refresh_interval_secs: 1800
      default_action: alert
    - id: custom-iocs
      name: "Internal IOC Feed"
      url: "https://threat-feeds.internal/iocs.json"
      format: json
      ip_field: ioc
      category_field: type
      refresh_interval_secs: 900
      default_action: block          # Internal feeds are pre-validated

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
      refresh_interval_secs: 3600
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
  dedup_window_secs: 60
  routes:
    - name: threat-hunt-log
      destination: log
      min_severity: medium
      event_types: [threatintel, dns, ids]
    - name: threat-hunt-webhook
      destination: webhook
      min_severity: high
      event_types: [threatintel, dns, ids]
      webhook_url: "https://hooks.example.com/soc-alerts"
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
