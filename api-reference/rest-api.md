# REST API Reference

Base URL: `http://localhost:8080` (or `https://` with TLS enabled)

## Public Endpoints

No authentication required.

### GET /healthz

Liveness probe.

```bash
curl http://localhost:8080/healthz
```

```json
{"status": "ok"}
```

### GET /readyz

Readiness probe. Returns eBPF program load status.

```bash
curl http://localhost:8080/readyz
```

```json
{"status": "ready", "ebpf_loaded": true}
```

## Protected Endpoints

Require authentication when `auth.enabled: true`. Use `Authorization: Bearer <token>` or `X-API-Key: <key>` headers.

### Agent

#### GET /api/v1/agent/status

Agent status including version, uptime, and loaded features.

```bash
curl http://localhost:8080/api/v1/agent/status
```

#### GET /api/v1/config

Current configuration (secrets sanitized).

```bash
curl http://localhost:8080/api/v1/config
```

#### POST /api/v1/config/reload

Trigger configuration reload. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/config/reload
```

#### GET /api/v1/ebpf/status

Per-program eBPF load status.

```bash
curl http://localhost:8080/api/v1/ebpf/status
```

### Firewall

#### GET /api/v1/firewall/rules

List all firewall rules.

```bash
curl http://localhost:8080/api/v1/firewall/rules
```

#### POST /api/v1/firewall/rules

Create a firewall rule.

```bash
curl -X POST http://localhost:8080/api/v1/firewall/rules \
  -H "Content-Type: application/json" \
  -d '{"id":"block-telnet","priority":5,"action":"deny","protocol":"tcp","dst_port":23}'
```

#### DELETE /api/v1/firewall/rules/{id}

Delete a firewall rule by ID. Returns 403 for system rules (e.g., anti-lockout rules).

```bash
curl -X DELETE http://localhost:8080/api/v1/firewall/rules/block-telnet
```

### Connection Tracking

#### GET /api/v1/conntrack/status

Conntrack status: enabled flag, active connection count.

```bash
curl http://localhost:8080/api/v1/conntrack/status
```

```json
{"enabled": true, "connection_count": 1842}
```

#### GET /api/v1/conntrack/events

Server-Sent Events stream of conntrack lifecycle events (new/update/destroy). Diffs `/proc/net/nf_conntrack` snapshots.

```bash
curl -N http://localhost:8080/api/v1/conntrack/events
```

```
data: {"event_type":"new","protocol":"tcp","src":"10.0.0.1:54321","dst":"10.0.0.2:443"}

data: {"event_type":"destroy","protocol":"tcp","src":"10.0.0.1:54321","dst":"10.0.0.2:443"}
```

#### GET /api/v1/conntrack/connections

List active connections in the conntrack table.

```bash
curl http://localhost:8080/api/v1/conntrack/connections
```

#### POST /api/v1/conntrack/flush

Flush the connection tracking table. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/conntrack/flush
```

### L7 Firewall

#### GET /api/v1/firewall/l7-rules

List all L7 firewall rules.

```bash
curl http://localhost:8080/api/v1/firewall/l7-rules
```

#### POST /api/v1/firewall/l7-rules

Create an L7 rule.

```bash
curl -X POST http://localhost:8080/api/v1/firewall/l7-rules \
  -H "Content-Type: application/json" \
  -d '{"id":"block-admin","priority":10,"action":"deny","protocol":"http","path":"/admin"}'
```

#### DELETE /api/v1/firewall/l7-rules/{id}

Delete an L7 rule.

```bash
curl -X DELETE http://localhost:8080/api/v1/firewall/l7-rules/block-admin
```

### IDS

#### GET /api/v1/ids/status

IDS status: enabled flag, mode, and rule count.

```bash
curl http://localhost:8080/api/v1/ids/status
```

#### GET /api/v1/ids/rules

List all IDS detection rules.

```bash
curl http://localhost:8080/api/v1/ids/rules
```

### IPS

#### GET /api/v1/ips/rules

List IDS/IPS rules.

```bash
curl http://localhost:8080/api/v1/ips/rules
```

#### PATCH /api/v1/ips/rules/{id}

Update IPS rule mode.

```bash
curl -X PATCH http://localhost:8080/api/v1/ips/rules/detect-sqli \
  -H "Content-Type: application/json" \
  -d '{"mode":"block"}'
```

#### GET /api/v1/ips/blacklist

List blacklisted IPs.

```bash
curl http://localhost:8080/api/v1/ips/blacklist
```

#### GET /api/v1/ips/domain-blocks

List domain-based IP blocks (IPs blocked due to DNS-driven IPS).

```bash
curl http://localhost:8080/api/v1/ips/domain-blocks
```

### Rate Limiting

#### GET /api/v1/ratelimit/rules

List rate limit rules.

```bash
curl http://localhost:8080/api/v1/ratelimit/rules
```

#### POST /api/v1/ratelimit/rules

Create a rate limit rule.

```bash
curl -X POST http://localhost:8080/api/v1/ratelimit/rules \
  -H "Content-Type: application/json" \
  -d '{"id":"rl-global","rate":1000,"burst":2000,"algorithm":"token_bucket","scope":"per_ip"}'
```

#### DELETE /api/v1/ratelimit/rules/{id}

Delete a rate limit rule.

```bash
curl -X DELETE http://localhost:8080/api/v1/ratelimit/rules/rl-global
```

### Threat Intelligence

#### GET /api/v1/threatintel/status

Feed status (last refresh, IOC count).

```bash
curl http://localhost:8080/api/v1/threatintel/status
```

#### GET /api/v1/threatintel/iocs

List loaded IOCs.

```bash
curl http://localhost:8080/api/v1/threatintel/iocs
```

#### GET /api/v1/threatintel/feeds

List configured feeds.

```bash
curl http://localhost:8080/api/v1/threatintel/feeds
```

### Alerts

#### GET /api/v1/alerts

List alerts. Supports query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `component` | string | Filter by component (ids, ips, dlp, etc.) |
| `severity` | string | Filter by severity (critical, high, medium, low) |
| `limit` | integer | Maximum results to return |

```bash
curl "http://localhost:8080/api/v1/alerts?component=ids&severity=high&limit=50"
```

#### POST /api/v1/alerts/{id}/false-positive

Mark an alert as false positive.

```bash
curl -X POST http://localhost:8080/api/v1/alerts/alert-001/false-positive
```

### Audit

#### GET /api/v1/audit/logs

List audit log entries. Supports query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `component` | string | Filter by component |
| `limit` | integer | Maximum results |

```bash
curl "http://localhost:8080/api/v1/audit/logs?component=firewall&limit=20"
```

#### GET /api/v1/audit/rules/{id}/history

Rule change history for a specific rule.

```bash
curl http://localhost:8080/api/v1/audit/rules/fw-001/history
```

### DDoS Protection

#### GET /api/v1/ddos/status

DDoS protection status: enabled flag, active attack count, total mitigated, policy count.

```bash
curl http://localhost:8080/api/v1/ddos/status
```

```json
{"enabled": true, "active_attacks": 0, "total_mitigated": 42, "policy_count": 3}
```

#### GET /api/v1/ddos/attacks

List active DDoS attacks currently being tracked.

```bash
curl http://localhost:8080/api/v1/ddos/attacks
```

#### GET /api/v1/ddos/attacks/history

List historical (mitigated/expired) DDoS attacks. Supports `?limit=` query parameter.

```bash
curl "http://localhost:8080/api/v1/ddos/attacks/history?limit=50"
```

#### GET /api/v1/ddos/policies

List all DDoS detection/mitigation policies.

```bash
curl http://localhost:8080/api/v1/ddos/policies
```

#### POST /api/v1/ddos/policies

Create a DDoS policy. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/ddos/policies \
  -H "Content-Type: application/json" \
  -d '{
    "id": "syn-flood-block",
    "attack_type": "syn_flood",
    "detection_threshold_pps": 5000,
    "mitigation_action": "block",
    "auto_block_duration_secs": 300,
    "enabled": true
  }'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique policy identifier |
| `attack_type` | string | Yes | `syn_flood`, `udp_amplification`, `icmp_flood`, `rst_flood`, `fin_flood`, `ack_flood`, `volumetric` |
| `detection_threshold_pps` | integer | Yes | Packets per second to trigger detection (must be > 0) |
| `mitigation_action` | string | No | `alert` (default), `throttle`, `block` |
| `auto_block_duration_secs` | integer | No | Seconds to block source (0 = indefinite, default: 0) |
| `enabled` | boolean | No | Enable the policy (default: true) |

#### DELETE /api/v1/ddos/policies/{id}

Delete a DDoS policy by ID. Requires `admin` role.

```bash
curl -X DELETE http://localhost:8080/api/v1/ddos/policies/syn-flood-block
```

### Load Balancer

#### GET /api/v1/lb/status

Load balancer status: enabled flag, service count.

```bash
curl http://localhost:8080/api/v1/lb/status
```

```json
{"enabled": true, "service_count": 3}
```

#### GET /api/v1/lb/services

List all load balancer services.

```bash
curl http://localhost:8080/api/v1/lb/services
```

#### GET /api/v1/lb/services/{id}

Get service detail including backends, health status, and active connections.

```bash
curl http://localhost:8080/api/v1/lb/services/lb-https
```

#### POST /api/v1/lb/services

Create a load balancer service. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/lb/services \
  -H "Content-Type: application/json" \
  -d '{
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
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique service identifier (max 64 chars) |
| `name` | string | Yes | Human-readable name |
| `protocol` | string | Yes | `tcp`, `udp`, `tls_passthrough` |
| `listen_port` | integer | Yes | Frontend port (1-65535) |
| `algorithm` | string | Yes | `round_robin`, `weighted`, `ip_hash`, `least_conn` |
| `backends` | array | Yes | At least one backend (`id`, `addr`, `port`, `weight`) |

#### DELETE /api/v1/lb/services/{id}

Delete a load balancer service by ID. Requires `admin` role.

```bash
curl -X DELETE http://localhost:8080/api/v1/lb/services/lb-api
```

### DNS Intelligence

#### GET /api/v1/dns/cache

List DNS cache entries. Supports `?domain=example.com` filter.

```bash
curl http://localhost:8080/api/v1/dns/cache
curl "http://localhost:8080/api/v1/dns/cache?domain=example.com"
```

#### DELETE /api/v1/dns/cache

Flush DNS cache.

```bash
curl -X DELETE http://localhost:8080/api/v1/dns/cache
```

#### GET /api/v1/dns/stats

DNS cache and blocklist statistics.

```bash
curl http://localhost:8080/api/v1/dns/stats
```

#### GET /api/v1/dns/blocklist

List loaded blocklist rules.

```bash
curl http://localhost:8080/api/v1/dns/blocklist
```

### Domain Reputation

#### GET /api/v1/domains/reputation

Query domain reputations. Supports `?domain=` and `?min_score=` filters.

```bash
curl http://localhost:8080/api/v1/domains/reputation
curl "http://localhost:8080/api/v1/domains/reputation?domain=suspicious.com&min_score=0.5"
```

#### POST /api/v1/domains/blocklist

Add domain to runtime blocklist.

```bash
curl -X POST http://localhost:8080/api/v1/domains/blocklist \
  -H "Content-Type: application/json" \
  -d '{"domain":"malware.example.com"}'
```

#### DELETE /api/v1/domains/blocklist/{domain}

Remove domain from blocklist.

```bash
curl -X DELETE http://localhost:8080/api/v1/domains/blocklist/malware.example.com
```

### NAT

#### GET /api/v1/nat/status

NAT status: enabled flag and rule count.

```bash
curl http://localhost:8080/api/v1/nat/status
```

```json
{"enabled": true, "rule_count": 5}
```

#### GET /api/v1/nat/rules

List all NAT rules (SNAT and DNAT combined, with direction field).

```bash
curl http://localhost:8080/api/v1/nat/rules
```

### Policy Routing

#### GET /api/v1/routing/status

Routing status: enabled flag and gateway count.

```bash
curl http://localhost:8080/api/v1/routing/status
```

```json
{"enabled": true, "gateway_count": 2}
```

#### GET /api/v1/routing/gateways

List gateways with current health status.

```bash
curl http://localhost:8080/api/v1/routing/gateways
```

```json
[
  {"id": 1, "name": "wan1", "interface": "eth0", "gateway_ip": "192.168.1.1", "priority": 10, "enabled": true, "status": "healthy"},
  {"id": 2, "name": "wan2", "interface": "eth1", "gateway_ip": "10.0.0.1", "priority": 20, "enabled": true, "status": "down"}
]
```

### Zone Segmentation

#### GET /api/v1/zones/status

Zone status: enabled flag, zone count, and policy count.

```bash
curl http://localhost:8080/api/v1/zones/status
```

```json
{"enabled": true, "zone_count": 3, "policy_count": 6}
```

#### GET /api/v1/zones

List all zones with their interfaces and default policies.

```bash
curl http://localhost:8080/api/v1/zones
```

#### GET /api/v1/zones/policies

List all inter-zone traffic policies.

```bash
curl http://localhost:8080/api/v1/zones/policies
```

### Aliases

#### GET /api/v1/aliases/status

Alias count.

```bash
curl http://localhost:8080/api/v1/aliases/status
```

```json
{"alias_count": 12}
```

#### PUT /api/v1/aliases/{id}/content

Set content for an external alias. Only works for aliases with `alias_type: external`.

```bash
curl -X PUT http://localhost:8080/api/v1/aliases/external_blocklist/content \
  -H "Content-Type: application/json" \
  -d '{"ips": ["192.168.0.0/16", "10.0.0.0/8"]}'
```

### DLP

#### GET /api/v1/dlp/status

DLP status: enabled flag and pattern count.

```bash
curl http://localhost:8080/api/v1/dlp/status
```

#### GET /api/v1/dlp/patterns

List loaded DLP detection patterns.

```bash
curl http://localhost:8080/api/v1/dlp/patterns
```

### QoS / Traffic Shaping

#### GET /api/v1/qos/status

QoS status: enabled flag, pipe/queue/classifier counts.

```bash
curl http://localhost:8080/api/v1/qos/status
```

#### GET /api/v1/qos/pipes

List all QoS pipes.

```bash
curl http://localhost:8080/api/v1/qos/pipes
```

#### POST /api/v1/qos/pipes

Create a QoS pipe. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/qos/pipes \
  -H "Content-Type: application/json" \
  -d '{"id":"pipe-1","rate_bps":10000000,"burst_bytes":65536}'
```

#### DELETE /api/v1/qos/pipes/{id}

Delete a QoS pipe. Requires `admin` role.

```bash
curl -X DELETE http://localhost:8080/api/v1/qos/pipes/1
```

#### GET /api/v1/qos/queues

List all QoS queues.

```bash
curl http://localhost:8080/api/v1/qos/queues
```

#### POST /api/v1/qos/queues

Create a QoS queue. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/qos/queues \
  -H "Content-Type: application/json" \
  -d '{"id":"q-web","pipe_id":"p-wan","weight":80}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique queue identifier (max 64 chars) |
| `pipe_id` | string | Yes | Parent pipe identifier |
| `weight` | integer | No | Scheduling weight (default: 50) |

#### DELETE /api/v1/qos/queues/{id}

Delete a QoS queue. Requires `admin` role.

#### GET /api/v1/qos/classifiers

List all QoS classifiers.

```bash
curl http://localhost:8080/api/v1/qos/classifiers
```

#### POST /api/v1/qos/classifiers

Create a QoS classifier. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/qos/classifiers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "cls-https",
    "queue_id": "q-web",
    "priority": 10,
    "direction": "egress",
    "match_rule": {
      "dst_port": 443,
      "protocol": 6
    }
  }'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique classifier identifier (max 64 chars) |
| `queue_id` | string | Yes | Target queue identifier |
| `priority` | integer | No | Priority (lower = higher, default: 100) |
| `direction` | string | No | `ingress`, `egress`, or `both` (default: `egress`) |
| `match_rule` | object | No | Traffic match criteria (see below) |

**`match_rule` fields (all optional, defaults to match-all):**

| Field | Type | Description |
|-------|------|-------------|
| `src_ip` | string | Source IP or CIDR |
| `dst_ip` | string | Destination IP or CIDR |
| `src_port` | integer | Source port (0 = any) |
| `dst_port` | integer | Destination port (0 = any) |
| `protocol` | integer | IP protocol number (6=TCP, 17=UDP, 0=any) |
| `dscp` | integer | DSCP value (0 = any) |
| `vlan_id` | integer | VLAN ID (0 = any) |

#### DELETE /api/v1/qos/classifiers/{id}

Delete a QoS classifier. Requires `admin` role.

### NPTv6

#### GET /api/v1/nat/nptv6

List all NPTv6 prefix translation rules.

```bash
curl http://localhost:8080/api/v1/nat/nptv6
```

#### POST /api/v1/nat/nptv6

Create an NPTv6 rule.

```bash
curl -X POST http://localhost:8080/api/v1/nat/nptv6 \
  -H "Content-Type: application/json" \
  -d '{"id":"site-a","internal_prefix":"fd00:1::","external_prefix":"2001:db8:1::","prefix_len":48}'
```

#### DELETE /api/v1/nat/nptv6/{id}

Delete an NPTv6 rule.

```bash
curl -X DELETE http://localhost:8080/api/v1/nat/nptv6/site-a
```

### MITRE ATT&CK

#### GET /api/v1/mitre/coverage

MITRE ATT&CK technique coverage map based on active features.

```bash
curl http://localhost:8080/api/v1/mitre/coverage
```

### JA4+ Fingerprints

#### GET /api/v1/fingerprints/summary

JA4+ TLS fingerprint cache summary.

```bash
curl http://localhost:8080/api/v1/fingerprints/summary
```

### Responses

#### GET /api/v1/responses

List active response actions (blocks and throttles).

```bash
curl http://localhost:8080/api/v1/responses
```

#### POST /api/v1/responses/manual

Create a time-bounded response action. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/responses/manual \
  -H "Content-Type: application/json" \
  -d '{"action":"block_ip","target":"203.0.113.42","ttl":"1h"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | Yes | `block_ip` or `throttle_ip` |
| `target` | string | Yes | Target IP or CIDR (e.g. `1.2.3.4` or `10.0.0.0/24`) |
| `ttl` | string | Yes | Duration string: `30s`, `5m`, `1h`, `1d`, or bare seconds |
| `rate_pps` | integer | No | Rate limit in packets/sec (required for `throttle_ip`) |

#### DELETE /api/v1/responses/{id}

Revoke a response action early. Requires `admin` role.

```bash
curl -X DELETE http://localhost:8080/api/v1/responses/resp-001
```

### Captures

#### GET /api/v1/captures

List all packet capture sessions.

```bash
curl http://localhost:8080/api/v1/captures
```

#### POST /api/v1/captures/manual

Start a time-bounded packet capture. Requires `admin` role.

```bash
curl -X POST http://localhost:8080/api/v1/captures/manual \
  -H "Content-Type: application/json" \
  -d '{
    "filter": "host 1.2.3.4 and port 443",
    "duration_seconds": 60,
    "snap_length": 1500,
    "interface": "eth0"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filter` | string | Yes | BPF filter expression (max 2048 chars) |
| `duration_seconds` | integer | Yes | Capture duration in seconds |
| `snap_length` | integer | No | Max bytes per packet (default: 1500) |
| `interface` | string | No | Network interface (default: first configured, or `any`) |

#### DELETE /api/v1/captures/{id}

Stop a running capture. Requires `admin` role.

```bash
curl -X DELETE http://localhost:8080/api/v1/captures/cap-001
```

### Metrics

#### GET /metrics

Prometheus metrics endpoint. See [Prometheus Metrics](prometheus-metrics.md) for the full catalog.

```bash
curl http://localhost:8080/metrics
```

## Endpoint Summary

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthz` | No | Liveness probe |
| GET | `/readyz` | No | Readiness probe |
| GET | `/metrics` | Yes | Prometheus metrics |
| GET | `/api/v1/agent/status` | Yes | Agent status |
| GET | `/api/v1/firewall/rules` | Yes | List firewall rules |
| POST | `/api/v1/firewall/rules` | Yes | Create firewall rule |
| DELETE | `/api/v1/firewall/rules/{id}` | Yes | Delete firewall rule (403 for system rules) |
| GET | `/api/v1/ids/status` | Yes | IDS status |
| GET | `/api/v1/ids/rules` | Yes | List IDS rules |
| GET | `/api/v1/conntrack/status` | Yes | Conntrack status |
| GET | `/api/v1/conntrack/connections` | Yes | List active connections |
| GET | `/api/v1/conntrack/events` | Yes | SSE stream of conntrack events |
| POST | `/api/v1/conntrack/flush` | Yes (admin) | Flush connection table |
| GET | `/api/v1/firewall/l7-rules` | Yes | List L7 rules |
| POST | `/api/v1/firewall/l7-rules` | Yes | Create L7 rule |
| DELETE | `/api/v1/firewall/l7-rules/{id}` | Yes | Delete L7 rule |
| GET | `/api/v1/ips/rules` | Yes | List IPS rules |
| PATCH | `/api/v1/ips/rules/{id}` | Yes | Update IPS rule mode |
| GET | `/api/v1/ips/blacklist` | Yes | List blacklisted IPs |
| GET | `/api/v1/ips/domain-blocks` | Yes | List domain-based IP blocks |
| GET | `/api/v1/ratelimit/rules` | Yes | List rate limit rules |
| POST | `/api/v1/ratelimit/rules` | Yes | Create rate limit rule |
| DELETE | `/api/v1/ratelimit/rules/{id}` | Yes | Delete rate limit rule |
| GET | `/api/v1/threatintel/status` | Yes | Feed status |
| GET | `/api/v1/threatintel/iocs` | Yes | List IOCs |
| GET | `/api/v1/threatintel/feeds` | Yes | List feeds |
| GET | `/api/v1/alerts` | Yes | List alerts |
| POST | `/api/v1/alerts/{id}/false-positive` | Yes | Mark false positive |
| GET | `/api/v1/audit/logs` | Yes | List audit logs |
| GET | `/api/v1/audit/rules/{id}/history` | Yes | Rule change history |
| GET | `/api/v1/ddos/status` | Yes | DDoS protection status |
| GET | `/api/v1/ddos/attacks` | Yes | Active DDoS attacks |
| GET | `/api/v1/ddos/attacks/history` | Yes | Historical DDoS attacks |
| GET | `/api/v1/ddos/policies` | Yes | List DDoS policies |
| POST | `/api/v1/ddos/policies` | Yes (admin) | Create DDoS policy |
| DELETE | `/api/v1/ddos/policies/{id}` | Yes (admin) | Delete DDoS policy |
| GET | `/api/v1/lb/status` | Yes | Load balancer status |
| GET | `/api/v1/lb/services` | Yes | List LB services |
| GET | `/api/v1/lb/services/{id}` | Yes | LB service detail |
| POST | `/api/v1/lb/services` | Yes (admin) | Create LB service |
| DELETE | `/api/v1/lb/services/{id}` | Yes (admin) | Delete LB service |
| GET | `/api/v1/dns/cache` | Yes | DNS cache entries |
| DELETE | `/api/v1/dns/cache` | Yes | Flush DNS cache |
| GET | `/api/v1/dns/stats` | Yes | DNS statistics |
| GET | `/api/v1/dns/blocklist` | Yes | DNS blocklist rules |
| GET | `/api/v1/domains/reputation` | Yes | Domain reputations |
| POST | `/api/v1/domains/blocklist` | Yes | Add to blocklist |
| DELETE | `/api/v1/domains/blocklist/{domain}` | Yes | Remove from blocklist |
| GET | `/api/v1/config` | Yes | Current config |
| POST | `/api/v1/config/reload` | Yes (admin) | Trigger reload |
| GET | `/api/v1/ebpf/status` | Yes | eBPF program status |
| GET | `/api/v1/nat/status` | Yes | NAT status |
| GET | `/api/v1/nat/rules` | Yes | List NAT rules |
| GET | `/api/v1/routing/status` | Yes | Routing status |
| GET | `/api/v1/routing/gateways` | Yes | List gateways with health status |
| GET | `/api/v1/zones/status` | Yes | Zone status |
| GET | `/api/v1/zones` | Yes | List zones |
| GET | `/api/v1/zones/policies` | Yes | List inter-zone policies |
| GET | `/api/v1/aliases/status` | Yes | Alias count |
| PUT | `/api/v1/aliases/{id}/content` | Yes | Set external alias content |
| GET | `/api/v1/dlp/status` | Yes | DLP status |
| GET | `/api/v1/dlp/patterns` | Yes | List DLP patterns |
| GET | `/api/v1/qos/status` | Yes | QoS status |
| GET | `/api/v1/qos/pipes` | Yes | List QoS pipes |
| POST | `/api/v1/qos/pipes` | Yes (admin) | Create QoS pipe |
| DELETE | `/api/v1/qos/pipes/{id}` | Yes (admin) | Delete QoS pipe |
| GET | `/api/v1/qos/queues` | Yes | List QoS queues |
| POST | `/api/v1/qos/queues` | Yes (admin) | Create QoS queue |
| DELETE | `/api/v1/qos/queues/{id}` | Yes (admin) | Delete QoS queue |
| GET | `/api/v1/qos/classifiers` | Yes | List QoS classifiers |
| POST | `/api/v1/qos/classifiers` | Yes (admin) | Create QoS classifier |
| DELETE | `/api/v1/qos/classifiers/{id}` | Yes (admin) | Delete QoS classifier |
| GET | `/api/v1/nat/nptv6` | Yes | List NPTv6 rules |
| POST | `/api/v1/nat/nptv6` | Yes | Create NPTv6 rule |
| DELETE | `/api/v1/nat/nptv6/{id}` | Yes | Delete NPTv6 rule |
| GET | `/api/v1/mitre/coverage` | Yes | MITRE ATT&CK technique coverage map |
| GET | `/api/v1/fingerprints/summary` | Yes | JA4+ fingerprint cache summary |
| GET | `/api/v1/responses` | Yes | List active auto-response actions |
| POST | `/api/v1/responses/manual` | Yes (admin) | Create manual response action (block/throttle) |
| DELETE | `/api/v1/responses/{id}` | Yes (admin) | Revoke a response action |
| GET | `/api/v1/captures` | Yes | List packet capture sessions |
| POST | `/api/v1/captures/manual` | Yes (admin) | Start a manual packet capture |
| DELETE | `/api/v1/captures/{id}` | Yes (admin) | Stop a running capture |

## Enterprise Endpoints

Served on the enterprise API port (default `8444`). Requires `FleetManagement` license feature.

### Fleet Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/agent/register` | None | Register agent, returns UUIDv7 identity + token |
| POST | `/api/v1/agent/heartbeat` | None | Agent heartbeat with live rule counts and config version |
| GET | `/api/v1/agent/identity` | None | Full agent identity, capabilities, eBPF status, TLS info |
| GET | `/api/v1/agent/config/version` | None | Config SHA-256 hash + reload timestamp |
| GET | `/api/v1/flows/graph` | None | Network flow graph from conntrack (query: `max_nodes`, `min_bytes`, `protocol`, `limit`) |

See [Fleet Management](../features/enterprise/fleet-management.md) for request/response details.
