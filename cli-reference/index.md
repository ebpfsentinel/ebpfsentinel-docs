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

### watch

Real-time alert stream — like `tail -f` for security events. Polls the agent API and displays only new alerts with ANSI severity coloring.

```bash
# Watch all alerts (poll every 2s)
ebpfsentinel-agent watch

# Watch only high+ severity IDS alerts, poll every 5s
ebpfsentinel-agent watch --severity high --component ids --interval 5
```

| Flag | Description | Default |
|------|-------------|---------|
| `-i, --interval <SECS>` | Poll interval in seconds | `2` |
| `--component <NAME>` | Filter by component (ids, ddos, dns, dlp, etc.) | All |
| `--severity <LEVEL>` | Filter by minimum severity (low, medium, high, critical) | All |

Example output:

```
Watching alerts (severity>=high) — poll every 2s. Press Ctrl+C to stop.

  ids         critical  203.0.113.42       -> 10.0.1.15          SSH brute force (rule ssh-bf-001)
  threatintel high      203.0.113.42       -> 10.0.1.15          IOC match: abuse.ch feed
  ddos        high      198.51.100.0       -> 10.0.1.15          SYN flood detected (1.2K pps)
```

Severity levels are color-coded: **critical** = red, **high** = yellow, **medium** = orange, **low** = default.

### score

Network risk score — single 0-10 metric summarizing security posture based on alert severity, DDoS activity, blacklisted IPs, threat intel IOCs, and connection count.

```bash
ebpfsentinel-agent score
ebpfsentinel-agent score --alert-limit 500
ebpfsentinel-agent score -o json
```

| Flag | Description | Default |
|------|-------------|---------|
| `--alert-limit <N>` | Max alerts to analyze | `200` |

Example output:

```
  Network Risk Score: 3.2 / 10 (Medium)

  Contributing Factors:
    Alerts          1.2  (0 critical, 12 high, 8 medium, 20 low)
    DDoS            0.0  (0 active, 3 mitigated total)
    Blacklist       1.0  (5 IPs blocked)
    Threat Intel    0.5  (2 IOC matches)
    Connections     0.5  (6120 active)
```

**Scoring formula** (0-10 scale):
- **Alerts (0-3)**: weighted severity (critical=4, high=2, medium=1, low=0.25), normalized at 50 weighted points = 3.0
- **DDoS (0-2)**: 2.0 if active attacks, 0.5 if >10 mitigated
- **Blacklist (0-2)**: 0.5/1.0/2.0 based on count (1-4/5-19/20+)
- **Threat Intel (0-2)**: 0.5/1.0/2.0 based on IOC count (1-9/10-49/50+)
- **Connections (0-1)**: 0.5 if >5k, 1.0 if >10k active connections

### investigate

Correlate all data about an IP address — alerts, connections, DNS, blacklist, and threat intel IOCs. Supports both IPv4 and IPv6.

```bash
# Investigate an IPv4 address
ebpfsentinel-agent investigate 203.0.113.42

# Investigate an IPv6 address
ebpfsentinel-agent investigate 2001:db8::1

# JSON output for scripting
ebpfsentinel-agent investigate 203.0.113.42 -o json

# Fetch more alerts
ebpfsentinel-agent investigate 203.0.113.42 --alert-limit 500
```

| Flag | Description | Default |
|------|-------------|---------|
| `--alert-limit <N>` | Max alerts to fetch | `100` |

Example output:

```
  IP: 203.0.113.42  |  Blacklisted: YES (auto-response:block-critical, 2158s left)  |  IOC: 1 match(es)

  Alerts: 12 matching
  COMPONENT   SEVERITY  ACTION  SOURCE              DESTINATION         MESSAGE
  ids         high      alert   203.0.113.42        10.0.1.15           SSH brute force (rule ssh-bf-001)
  ddos        medium    alert   203.0.113.42        10.0.1.15           SYN rate spike from /24
  threatintel high      alert   203.0.113.42        10.0.1.15           IOC match: abuse.ch feed

  Connections: 3 active
  SOURCE                  PORT  DESTINATION            PORT  PROTO  STATE   BYTES
  203.0.113.42              22  10.0.1.15             38821  TCP    ESTAB    2.1 MB
  203.0.113.42             443  10.0.1.15             52431  TCP    ESTAB  450.0 KB
  203.0.113.42            3306  10.0.1.20             49100  TCP    SYN       0 B

  DNS Reverse Lookups:
    evil.example.com -> 203.0.113.42 (queries: 14) [BLOCKED]

  Threat Intel IOC Matches:
    203.0.113.42 (type: scanner, feed: abuse.ch, confidence: 85)
```

### status

Enhanced agent dashboard — shows version, uptime, eBPF programs, conntrack, DDoS status, and recent alerts in one view.

```bash
ebpfsentinel-agent status
ebpfsentinel-agent status --host 10.0.0.1 --port 8080
```

Example output:

```
eBPFsentinel v0.1.0 -- up 3h 12m 05s -- 24 rules loaded

  Programs  12/12 loaded    xdp-firewall ✓  xdp-ratelimit ✓  tc-ids ✓  tc-dns ✓

  Conntrack  1,247 active connections
  DDoS       no active attacks (3 mitigated total)

  Recent Alerts (42 total)
  COMPONENT   SEVERITY  SOURCE              DESTINATION         MESSAGE
  ids         high      203.0.113.42        10.0.1.15           SSH brute force detected
  dns         medium    192.168.1.50        8.8.8.8             Blocked domain: evil.example.com
```

### top

Top talkers — live view of the most active connections sorted by traffic volume.

```bash
# Default: top 20 by bytes
ebpfsentinel-agent top

# Top 50 sorted by packet count
ebpfsentinel-agent top -n 50 --sort packets

# JSON output for scripting
ebpfsentinel-agent top -o json | jq '.[0]'
```

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --limit <N>` | Number of entries to display | `20` |
| `-s, --sort <FIELD>` | Sort by: `bytes` or `packets` | `bytes` |

Example output:

```
SOURCE                  PORT  DESTINATION            PORT  PROTO  STATE   BYTES     PACKETS
----------------------------------------------------------------------------------------------------
10.0.1.15              443    10.0.2.100             52431  TCP    ESTAB    1.2 GB     890234
192.168.1.50            53    8.8.8.8                41922  UDP    NEW     45.3 MB     120891
203.0.113.42            22    10.0.1.15              38821  TCP    ESTAB    2.1 MB       1243

3 connection(s) shown (sorted by bytes).
```

### flows

Network flows — aggregated connection map from conntrack, grouped by /24 subnet (IPv4) or /48 (IPv6).

```bash
# Default: aggregate up to 1000 connections
ebpfsentinel-agent flows

# Larger sample
ebpfsentinel-agent flows -n 5000

# JSON for pipeline processing
ebpfsentinel-agent flows -o json
```

| Flag | Description | Default |
|------|-------------|---------|
| `-n, --limit <N>` | Max connections to fetch for aggregation | `1000` |

Example output:

```
FLOW                                                          CONNS    BYTES     PACKETS
--------------------------------------------------------------------------------------------
10.0.1.0/24 -> 10.0.2.0/24:443 (TCP)                           32    4.2 GB     3102840
10.0.1.0/24 -> 8.8.8.0/24:53 (UDP)                              8   120.5 MB     320120
10.0.1.0/24 -> 203.0.113.0/24:22 (TCP)                          3    2.1 MB       4320

3 aggregated flow(s) from 43 connection(s).
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

#### stats

Alert statistics: severity distribution, top sources, top rules, component breakdown with bar chart.

```bash
ebpfsentinel-agent alerts stats
ebpfsentinel-agent alerts stats --limit 1000
ebpfsentinel-agent alerts stats -o json
```

Example output:

```
  Alerts: 142 total (12 critical, 34 high, 56 medium, 40 low)

  Top Sources              Alerts
  ----------------------------------------
  203.0.113.42                 12
  198.51.100.15                 8
  192.168.1.50                  5

  Top Rules                Alerts  Severity
  --------------------------------------------------
  ssh-bf-001                   12  high
  dns-blocked                   8  medium
  syn-flood-detect              5  critical

  Components               Alerts
  --------------------------------------------------
  ids              67  ████████████████████
  ddos             34  ██████████
  dns              28  ████████
  dlp              13  ████
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

### qos

QoS / traffic shaping: pipes, queues, and classifiers.

```bash
# QoS status
ebpfsentinel-agent qos status

# List pipes, queues, classifiers
ebpfsentinel-agent qos pipes
ebpfsentinel-agent qos queues
ebpfsentinel-agent qos classifiers

# Add a pipe
ebpfsentinel-agent qos add-pipe --json '{
  "id": 1,
  "bandwidth_bps": 10000000,
  "burst_bytes": 65536,
  "delay_ms": 0,
  "loss_percent": 0,
  "scheduler": "wf2q"
}'

# Add a queue
ebpfsentinel-agent qos add-queue --json '{"id": 1, "pipe_id": 1, "weight": 80}'

# Add a classifier
ebpfsentinel-agent qos add-classifier --json '{
  "id": 1,
  "queue_id": 1,
  "priority": 10,
  "protocol": 6,
  "dst_port": 443
}'

# Delete
ebpfsentinel-agent qos delete-pipe 1
ebpfsentinel-agent qos delete-queue 1
ebpfsentinel-agent qos delete-classifier 1
```

### nat

NAT rules and NPTv6 prefix translation.

```bash
# NAT status
ebpfsentinel-agent nat status

# List NAT rules
ebpfsentinel-agent nat rules

# NPTv6 management
ebpfsentinel-agent nat nptv6 list
ebpfsentinel-agent nat nptv6 create --id site-a --internal-prefix fd00:1:: --external-prefix 2001:db8:1:: --prefix-len 48
ebpfsentinel-agent nat nptv6 delete --id site-a
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

### mitre

MITRE ATT&CK coverage matrix for active features.

```bash
# Show MITRE ATT&CK technique coverage
ebpfsentinel-agent mitre coverage
ebpfsentinel-agent mitre coverage -o json
```

### capture

Manual packet capture (pcap). Requires the `pcap-capture` feature and `libpcap-dev`.

```bash
# List all capture sessions
ebpfsentinel-agent capture list

# Start a time-bounded capture
ebpfsentinel-agent capture start --filter "host 1.2.3.4 and port 443" --duration 60s
ebpfsentinel-agent capture start --filter "tcp port 80" --duration 5m --snap-length 256 --interface eth0

# Stop a running capture
ebpfsentinel-agent capture stop cap-001
```

| Flag | Description | Default |
|------|-------------|---------|
| `--filter <EXPR>` | BPF filter expression | Required |
| `--duration <DUR>` | Capture duration (e.g. `60s`, `5m`) | `60s` |
| `--snap-length <BYTES>` | Max bytes per packet | `1500` |
| `--interface <NAME>` | Network interface | First configured |

### responses

Manual response actions: time-bounded IP blocks and throttles.

```bash
# List active response actions
ebpfsentinel-agent responses list

# Create a block action (1 hour TTL)
ebpfsentinel-agent responses create --action block_ip --target 203.0.113.42 --ttl 1h

# Create a throttle action
ebpfsentinel-agent responses create --action throttle_ip --target 10.0.0.0/24 --ttl 30m --rate-pps 100

# Revoke an action early
ebpfsentinel-agent responses revoke resp-001
```

| Flag | Description | Default |
|------|-------------|---------|
| `--action <TYPE>` | `block_ip` or `throttle_ip` | Required |
| `--target <IP/CIDR>` | Target IP or CIDR | Required |
| `--ttl <DUR>` | Duration (e.g. `1h`, `30m`, `3600s`) | Required |
| `--rate-pps <N>` | Rate limit in pps (for `throttle_ip`) | None |

### fingerprints

JA4+ TLS fingerprint cache and analysis.

```bash
# Show fingerprint cache summary
ebpfsentinel-agent fingerprints summary
ebpfsentinel-agent fingerprints summary -o json
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
