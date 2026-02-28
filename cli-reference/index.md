# CLI Reference

```
ebpfsentinel-agent [OPTIONS] [COMMAND]
```

## Global Options

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <PATH>` | Config file path | `/etc/ebpfsentinel/config.yaml` |
| `-l, --log-level <LEVEL>` | Override log level: error, warn, info, debug, trace | From config |
| `--log-format <FORMAT>` | Log format: json or text | From config |
| `--token <TOKEN>` | Bearer token for authenticated endpoints | `$EBPFSENTINEL_TOKEN` |
| `-o, --output <FORMAT>` | Output format: table or json | `table` |
| `--host <HOST>` | Remote agent host | `localhost` |
| `--port <PORT>` | Remote agent port | `8080` |

## Commands

### version

Display version and build information.

```bash
ebpfsentinel-agent version
```

### status

Query running agent status.

```bash
ebpfsentinel-agent status
ebpfsentinel-agent status --host 10.0.0.1 --port 8080
```

### health

Check agent liveness and readiness.

```bash
ebpfsentinel-agent health
```

### metrics

Display Prometheus metrics.

```bash
ebpfsentinel-agent metrics
```

### firewall

Manage firewall L3/L4 rules.

```bash
# List all rules
ebpfsentinel-agent firewall list

# Add a rule (JSON body)
ebpfsentinel-agent firewall add --json '{
  "id": "block-ssh",
  "priority": 10,
  "action": "deny",
  "protocol": "tcp",
  "dst_port": 22
}'

# Delete a rule
ebpfsentinel-agent firewall delete block-ssh
```

### l7

Manage L7 firewall rules.

```bash
# List all L7 rules
ebpfsentinel-agent l7 list

# Add a rule
ebpfsentinel-agent l7 add --json '{
  "id": "block-admin",
  "priority": 10,
  "action": "deny",
  "protocol": "http",
  "path": "/admin"
}'

# Delete a rule
ebpfsentinel-agent l7 delete block-admin
```

### ips

Manage Intrusion Prevention System.

```bash
# List IPS rules
ebpfsentinel-agent ips list

# View blacklisted IPs
ebpfsentinel-agent ips blacklist

# Change rule mode
ebpfsentinel-agent ips set-mode rule-001 --mode block
ebpfsentinel-agent ips set-mode rule-001 --mode alert
```

### ratelimit

Manage rate limiting rules.

```bash
# List rules
ebpfsentinel-agent ratelimit list

# Add a rule
ebpfsentinel-agent ratelimit add --json '{
  "id": "rl-global",
  "rate": 1000,
  "burst": 2000,
  "algorithm": "token_bucket",
  "scope": "per_ip"
}'

# Delete a rule
ebpfsentinel-agent ratelimit delete rl-global
```

### threatintel

Threat intelligence data.

```bash
# Feed status (last refresh, IOC count)
ebpfsentinel-agent threatintel status

# List loaded IOCs
ebpfsentinel-agent threatintel iocs

# List configured feeds
ebpfsentinel-agent threatintel feeds
```

### alerts

List and manage alerts.

```bash
# List alerts (with filters)
ebpfsentinel-agent alerts list
ebpfsentinel-agent alerts list --component ids --severity high --limit 50

# Mark as false positive
ebpfsentinel-agent alerts mark-fp alert-001
```

### audit

View audit logs and rule history.

```bash
# List audit entries
ebpfsentinel-agent audit logs
ebpfsentinel-agent audit logs --component firewall --limit 20

# Rule change history
ebpfsentinel-agent audit history fw-001
```

### ddos

DDoS protection: status, attacks, and policy management.

```bash
# Protection status
ebpfsentinel-agent ddos status

# Active attacks
ebpfsentinel-agent ddos attacks

# Historical attacks
ebpfsentinel-agent ddos history
ebpfsentinel-agent ddos history --limit 50

# List policies
ebpfsentinel-agent ddos policies

# Add a policy
ebpfsentinel-agent ddos add --json '{
  "id": "syn-block",
  "attack_type": "syn_flood",
  "detection_threshold_pps": 5000,
  "mitigation_action": "block",
  "auto_block_duration_secs": 300,
  "enabled": true
}'

# Delete a policy
ebpfsentinel-agent ddos delete syn-block
```

### lb

L4 load balancer: services, backends, and health status.

```bash
# Load balancer status
ebpfsentinel-agent lb status

# List all services
ebpfsentinel-agent lb services

# View a specific service (backends, health, connections)
ebpfsentinel-agent lb service lb-https

# Add a service
ebpfsentinel-agent lb add --json '{
  "id": "lb-api",
  "name": "api-pool",
  "protocol": "tcp",
  "listen_port": 8080,
  "algorithm": "least_conn",
  "backends": [
    {"id": "api-1", "addr": "10.0.1.20", "port": 8080, "weight": 1},
    {"id": "api-2", "addr": "10.0.1.21", "port": 8080, "weight": 1}
  ]
}'

# Delete a service
ebpfsentinel-agent lb delete lb-api
```

### dns

DNS intelligence data and cache management.

```bash
# View cache
ebpfsentinel-agent dns cache
ebpfsentinel-agent dns cache --domain example.com

# Statistics
ebpfsentinel-agent dns stats

# View blocklist
ebpfsentinel-agent dns blocklist

# Flush cache
ebpfsentinel-agent dns flush
```

### domains

Domain reputation and blocklist management.

```bash
# View reputations
ebpfsentinel-agent domains reputation
ebpfsentinel-agent domains reputation --domain suspicious.com --min-score 0.5

# Block/unblock
ebpfsentinel-agent domains block malware.example.com
ebpfsentinel-agent domains unblock example.com
```

## Output Formats

### Table (default)

Human-readable table format:

```bash
ebpfsentinel-agent firewall list
```

### JSON

Machine-readable JSON for scripting:

```bash
ebpfsentinel-agent --output json firewall list | jq '.[] | .id'
```

## Authentication

Pass a token for authenticated endpoints:

```bash
# Via flag
ebpfsentinel-agent --token sk-my-api-key firewall list

# Via environment variable
export EBPFSENTINEL_TOKEN=sk-my-api-key
ebpfsentinel-agent firewall list
```
