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
{"status": "ready", "ebpf_programs_loaded": true}
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
{"enabled": true, "connections": 1842}
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

### Gateways

#### GET /api/v1/gateways

List all configured gateways with health status.

```bash
curl http://localhost:8080/api/v1/gateways
```

```json
[
  {"id": 1, "name": "wan1", "interface": "eth1", "status": "healthy", "priority": 10},
  {"id": 2, "name": "wan2", "interface": "eth2", "status": "down", "priority": 20}
]
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
| GET | `/api/v1/conntrack/status` | Yes | Conntrack status |
| GET | `/api/v1/conntrack/connections` | Yes | List active connections |
| POST | `/api/v1/conntrack/flush` | Yes (admin) | Flush connection table |
| GET | `/api/v1/gateways` | Yes | List gateways with health status |
| GET | `/api/v1/firewall/l7-rules` | Yes | List L7 rules |
| POST | `/api/v1/firewall/l7-rules` | Yes | Create L7 rule |
| DELETE | `/api/v1/firewall/l7-rules/{id}` | Yes | Delete L7 rule |
| GET | `/api/v1/ips/rules` | Yes | List IPS rules |
| PATCH | `/api/v1/ips/rules/{id}` | Yes | Update IPS rule mode |
| GET | `/api/v1/ips/blacklist` | Yes | List blacklisted IPs |
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
