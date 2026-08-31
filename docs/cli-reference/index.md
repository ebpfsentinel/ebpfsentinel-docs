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
| `-o, --output <FORMAT>` | Output format: table or json (global) | `table` |

### Connection Options

These flags are per-subcommand (placed after the command name):

| Flag | Description | Default |
|------|-------------|---------|
| `--host <HOST>` | Remote agent host | `localhost` |
| `--port <PORT>` | Remote agent port | `8080` |

## Commands

### version

Display version and build information.

```bash
ebpfsentinel-agent version
```

### watch

Real-time alert stream - like `tail -f` for security events. Consumes the agent's
Server-Sent Events feed, so an alert appears as the agent raises it rather than at
the next poll, and displays it with ANSI severity coloring.

If the connection drops, `watch` reconnects on its own, waiting 1 second and
doubling up to 30 seconds between attempts. It hands the agent the id of the last
alert it printed, so the agent replays what happened while the connection was
down and the reconnect leaves no hole.

Filters are applied by the agent before an alert reaches the wire, so a filtered
watch is quieter on the network as well as on screen.

```bash
# Watch all alerts
ebpfsentinel-agent watch

# Watch only high+ severity IDS alerts
ebpfsentinel-agent watch --severity high --component ids
```

| Flag | Description | Default |
|------|-------------|---------|
| `-i, --interval <SECS>` | Seconds between reads of the alert list, used only by the polling fallback | `2` |
| `--component <NAME>` | Filter by component (ids, ddos, dns, dlp, etc.) | All |
| `--severity <LEVEL>` | Filter by minimum severity (low, medium, high, critical) | All |

Where the agent serves no alert stream it answers 503, and `watch` falls back to
re-reading the alert list every `--interval` seconds. It says so on the first
line, because the difference is visible in latency and you should know which of
the two you are reading:

```
  [polling] this agent serves no alert stream (alert stream not enabled); polling every 2s instead, so an alert can be up to that late.
```

Example output:

```
Watching alerts (severity>=high) - live stream. Press Ctrl+C to stop.

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
| `-s, --sort <FIELD>` | Sort by: `bytes`, `packets`, or `alerts` | `bytes` |

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

### identity

Display the agent's identity metadata: the operator-managed flag, the running
version and the hostname the agent reports itself under.

```bash
ebpfsentinel-agent identity
ebpfsentinel-agent identity -o json
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

# Blacklist an IP, optionally with a reason and a lifetime
ebpfsentinel-agent ips blacklist add 203.0.113.10
ebpfsentinel-agent ips blacklist add 203.0.113.10 --reason "port scanner" --ttl-secs 3600

# Remove an IP from the blacklist
ebpfsentinel-agent ips blacklist delete 203.0.113.10

# Change rule mode
ebpfsentinel-agent ips set-mode rule-001 --mode block
ebpfsentinel-agent ips set-mode rule-001 --mode alert

# List domain-based IPS blocks (from DNS blocklist or reputation)
ebpfsentinel-agent ips domain-blocks
```

### ratelimit

Manage rate limiting rules. A rule overrides the section defaults for one
source host, so `src_ip` is required and must be a single IPv4 address.

```bash
# List rules
ebpfsentinel-agent ratelimit list

# Add a rule
ebpfsentinel-agent ratelimit add --json '{
  "id": "rl-scraper",
  "rate": 1000,
  "burst": 2000,
  "algorithm": "token_bucket",
  "src_ip": "203.0.113.10"
}'

# Delete a rule
ebpfsentinel-agent ratelimit delete rl-scraper
```

### threatintel

Threat intelligence data.

```bash
# Feed status (last refresh, IOC count)
ebpfsentinel-agent threatintel status

# List loaded IOCs
ebpfsentinel-agent threatintel iocs

# List URL indicators
ebpfsentinel-agent threatintel urls

# List configured feeds
ebpfsentinel-agent threatintel feeds

# Refresh every feed now, or just one of them
ebpfsentinel-agent threatintel feeds refresh
ebpfsentinel-agent threatintel feeds refresh --feed-id abuse-ch
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

# Show L2 VIP announcer status (role, interface, per-VIP ARP counters)
ebpfsentinel-agent lb vips

# Apply a VIP announce config (role, interface, VIP list)
ebpfsentinel-agent lb announce --json '{
  "role": "primary",
  "interface": "eth0",
  "vips": [{ "name": "web", "addr": "192.0.2.10" }]
}'
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

### conntrack

Connection tracking - live flow events and status.

`conntrack watch` consumes the agent's Server-Sent Events feed of flow lifecycle
events (`new`, `update`, `destroy`) and reconnects on its own with the same
backoff `watch` uses.

The agent can only serve that feed where it has `/proc/net/nf_conntrack` to read,
so on a kernel built without `CONFIG_NF_CONNTRACK_PROCFS` the route answers 404.
`conntrack watch` then falls back to diffing successive reads of the connection
list every `--interval` seconds and says so, since a flow that opens and closes
between two reads never appears at all:

```
  [polling] this agent serves no conntrack event stream (Conntrack event stream not enabled); polling every 2s instead, so a short flow can open and close between two reads and never appear.
```

```bash
# Watch live conntrack events
ebpfsentinel-agent conntrack watch
ebpfsentinel-agent conntrack watch --interval 5

# List active connections (from /proc/net/nf_conntrack)
ebpfsentinel-agent conntrack list
ebpfsentinel-agent conntrack list --limit 50

# Conntrack status and kfunc hit/miss metrics
ebpfsentinel-agent conntrack status

# Flush the connection tracking table
ebpfsentinel-agent conntrack flush
```

| Flag | Description | Default |
|------|-------------|---------|
| `--interval <SECS>` | Seconds between reads of the connection list, used only by the polling fallback | `2` |
| `--limit <N>` | Max connections to list | `100` |

### dns

DNS intelligence data and cache management.

```bash
# View cache
ebpfsentinel-agent dns cache
ebpfsentinel-agent dns cache --domain example.com

# Interception status
ebpfsentinel-agent dns status

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
ebpfsentinel-agent responses create --action throttle_ip --target 203.0.113.42 --ttl 30m --rate-pps 100

# Revoke an action early
ebpfsentinel-agent responses revoke resp-001
```

| Flag | Description | Default |
|------|-------------|---------|
| `--action <TYPE>` | `block_ip` or `throttle_ip` | Required |
| `--target <IP>` | Target host address; a prefix is not a response target | Required |
| `--ttl <DUR>` | Duration (e.g. `1h`, `30m`, `3600s`) | Required |
| `--rate-pps <N>` | Rate limit in pps, required above zero on `throttle_ip` (IPv4 targets only) | None |

### fingerprints

JA4+ TLS fingerprint cache and analysis.

```bash
# Show client fingerprint cache summary
ebpfsentinel-agent fingerprints summary
ebpfsentinel-agent fingerprints summary -o json

# Show the JA4S server fingerprint cache summary
ebpfsentinel-agent fingerprints ja4s
```

### zones

Security zones and the policies between them. A zone groups interfaces under
one default policy; an inter-zone policy decides what crosses from one zone to
another, and is identified as `from__to`.

```bash
# Zone engine status
ebpfsentinel-agent zones status

# List zones
ebpfsentinel-agent zones list

# Add a zone
ebpfsentinel-agent zones add --json '{
  "id": "lan",
  "interfaces": ["eth1", "eth2"],
  "default_policy": "allow"
}'

# Delete a zone
ebpfsentinel-agent zones delete lan

# List inter-zone policies
ebpfsentinel-agent zones policies

# Add an inter-zone policy
ebpfsentinel-agent zones add-policy --json '{
  "from": "lan",
  "to": "wan",
  "policy": "allow",
  "action": "accept"
}'

# Delete an inter-zone policy
ebpfsentinel-agent zones delete-policy lan__wan
```

### routing

Policy routing: the gateways traffic may leave through, and the routes that
resolve to them.

```bash
# Policy routing status
ebpfsentinel-agent routing status

# List gateways with their priority, weight and health
ebpfsentinel-agent routing gateways

# Add a gateway
ebpfsentinel-agent routing add-gateway --json '{
  "id": "wan1",
  "name": "primary",
  "interface": "eth0",
  "gateway_ip": "192.0.2.1",
  "priority": 10,
  "weight": 100
}'

# Delete a gateway
ebpfsentinel-agent routing delete-gateway wan1

# List routes and the gateway each resolves to
ebpfsentinel-agent routing routes
```

### ids

Intrusion Detection System status and rules. Rules are read-only from the CLI;
`ips set-mode` is what changes how a rule acts.

```bash
# IDS status: enabled, mode, rule count
ebpfsentinel-agent ids status

# List rules with severity, protocol, port and pattern
ebpfsentinel-agent ids rules
ebpfsentinel-agent ids rules -o json
```

The JSON form carries two fields the table leaves out: the rate threshold a
rule fires on, and the kernel slot it occupies when more rules compete for the
map than the map holds.

### geoip

GeoIP database status and address lookup.

```bash
# Database status: enabled, and whether it loaded
ebpfsentinel-agent geoip status

# Look up an address
ebpfsentinel-agent geoip lookup 203.0.113.10
```

A field the database has no answer for is printed as `-` rather than as an
empty column.

### ebpf

The eBPF programs the agent loaded, the uprobes it attached, and what the
kernel supports.

```bash
# Loaded programs, and the attaches the kernel refused
ebpfsentinel-agent ebpf status

# Uprobe inventory: library, path, program, symbol and offset
ebpfsentinel-agent ebpf uprobes

# Kernel feature probe: load mode, program types, helpers
ebpfsentinel-agent ebpf kernel-features
```

`ebpf status` reports loading and attaching apart, because they fail
separately: a program can sit in the kernel and still reach no wire, which the
refused-attach table names along with the interface and the reason. An
interface already carrying somebody else's XDP program is called out as such.

`ebpf kernel-features` ends with the required helpers this kernel does not
provide. An empty list there is the answer you want.

### config

The running configuration, and reloading it from disk.

```bash
# Print the running configuration
ebpfsentinel-agent config show

# Reload the configuration from disk
ebpfsentinel-agent config reload
```

`config show` always prints JSON, since the configuration is a document rather
than a table.

### dlp

Data Loss Prevention status and patterns.

```bash
# DLP status: enabled, mode, pattern count
ebpfsentinel-agent dlp status

# List patterns with severity, data type and regex
ebpfsentinel-agent dlp patterns
```

### tls

The TLS posture of the agent's own API listener: whether TLS is on, the group
that was negotiated, and whether that group is post-quantum.

```bash
ebpfsentinel-agent tls status
```

### aliases

External alias lists: address sets a firewall rule names instead of repeating
the addresses.

```bash
# Alias engine status
ebpfsentinel-agent aliases status

# Replace the content of an external alias
ebpfsentinel-agent aliases set-content bogons --json '{
  "ips": ["192.0.2.0/24", "198.51.100.7"]
}'
```

`set-content` replaces the whole list rather than adding to it.

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
## Enterprise Agent Commands

> **Edition: Enterprise**

The enterprise agent is a binary of its own, and it is not a client of the one
above. Given no subcommand it runs as the daemon; given one of the three below
it reads the machine, writes a file or installs one and exits. All three are
meant to run before the daemon has ever started, which is why none of them
takes a host or a token.

```
ebpfsentinel-enterprise-agent [OPTIONS] [COMMAND]
```

### Enterprise Global Options

These are read when the binary runs as the daemon. A subcommand ignores them.

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <PATH>` | Config file path | `config/ebpfsentinel.yaml` |
| `--license <PATH>` | License key file. Also read from the `EBPFSENTINEL_LICENSE` environment variable. Absent here and in `enterprise.license_path`, the agent starts in open-source mode rather than refusing to start | From `enterprise.license_path` |
| `--bind-address <ADDR>` | Bind address of the enterprise API | `127.0.0.1` |
| `--enterprise-port <PORT>` | Port of the enterprise API | `8444` |

### fingerprint

Print the machine fingerprint a license is bound to, and the three values it is
computed from.

| Flag | Description | Default |
|------|-------------|---------|
| `--output <PATH>` | Also write the fingerprint and its components to a JSON file | Printed only |

```bash
ebpfsentinel-enterprise-agent fingerprint
```

```
Machine Fingerprint
===================
Machine ID:  8f14e45fceea167a5a36dedd4bea2543
CPU Brand:   Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz
MAC Address: 52:54:00:12:34:56
Fingerprint: ca9240c0e28de9601b98e0f04b19f0d2...
```

A component the host does not expose is reported as `unavailable` on stderr and
folded into the hash as that word, so the fingerprint is still stable across
restarts of the same machine.

The file `--output` writes is a report: it carries the fingerprint and its
components and no list of features, so it is **not** the file `ebpfsentinel-license
activate` reads. Use `generate-request` for that.

### generate-request

Write an activation request for a license that will be signed on another
machine. This is the file the air-gapped round trip carries out.

| Flag | Description | Default |
|------|-------------|---------|
| `--features <LIST>` | Features to ask for, comma separated (`advanced-dlp,ml-detection`) | Empty, which asks for a license carrying no feature |
| `-o, --output <PATH>` | Path of the request JSON | Required |

```bash
ebpfsentinel-enterprise-agent generate-request \
  --features advanced-dlp,ml-detection \
  --output request.json
```

The request carries the fingerprint, the agent version and the features asked
for. The vendor signs the terms it sold rather than the ones the file asks for,
so a feature nobody bought does not arrive by editing this file.

### import-activation

Validate a signed activation and install it.

| Flag | Description | Default |
|------|-------------|---------|
| `<ACTIVATION>` | Path of the activation key file received back | Required |
| `--install-path <PATH>` | Where to install the validated license | `/etc/ebpfsentinel/license.key` |

```bash
ebpfsentinel-enterprise-agent import-activation activation.key \
  --install-path /etc/ebpfsentinel/license.key
```

Nothing is installed before the file is validated: the envelope has to carry
three lines, both signatures have to verify against the keys built into the
binary, and the machine fingerprint and the size band have to cover this host.
A refusal names the four causes and exits non-zero, so a provisioning script
can gate on it. The parent directory is created when it is missing.

The whole round trip is walked in [Air-Gap Mode](../features/enterprise/airgap.md#license-activation-across-the-gap),
and the signing half of it, which runs `ebpfsentinel-license` on a connected
workstation, is documented in the [Enterprise License System](../features/enterprise/license.md).
