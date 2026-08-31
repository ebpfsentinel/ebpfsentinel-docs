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

A `not_ready` answer says why. Two optional lists appear only when non-empty,
and each one is a different problem:

```json
{
  "status": "not_ready",
  "ebpf_loaded": false,
  "attach_blocked": [
    "xdp-firewall on eth0: interface eth0 already has an XDP program attached (id 42, native). It is held by a BPF link, so only the process owning that link can replace it. The kernel allows one XDP program per interface, so this one cannot attach on top."
  ]
}
```

- `attach_blocked` - the program loaded but could not reach the wire. This is
  the nested-XDP case under Docker and Kubernetes, where the container runtime's
  own program owns the interface. It is a property of the host, not a fault in
  the agent, and no restart will clear it.
- `kernel_helpers_missing` - the kernel does not offer something a program
  needs, so the agent refused to load it. See
  `/api/v1/ebpf/kernel-features`.

Neither list present, and `ebpf_loaded: false`, means the agent simply has not
finished loading yet.

## Protected Endpoints

Require authentication when `auth.enabled: true`. Use `Authorization: Bearer <token>` or `X-API-Key: <key>` headers.

### Agent

#### GET /api/v1/agent/status

Agent status including version, uptime, and loaded features.

```bash
curl http://localhost:8080/api/v1/agent/status
```

#### GET /api/v1/agent/identity

Agent identity metadata. Surfaces the operator-managed flag and the
optional operator UI deep-link URL configured under the top-level
`management:` block. Hot-reloadable: a config reload that toggles either
field is reflected on the next call without restart.

```bash
curl http://localhost:8080/api/v1/agent/identity
```

```json
{
  "version": "0.1.0",
  "hostname": "agent-01",
  "uptime_seconds": 1234,
  "operator_managed": true,
  "operator_endpoint": "https://operator.example.com:9443/ui"
}
```

`operator_endpoint` is omitted from the JSON when unset. Defaults are
`operator_managed = false` and `operator_endpoint = null`.

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

Per-program eBPF load status, plus any attach the kernel refused.

```bash
curl http://localhost:8080/api/v1/ebpf/status
```

```json
{
  "programs": [{"name": "xdp-firewall", "loaded": true}],
  "attach_blocked": [
    {
      "program": "xdp-firewall",
      "interface": "eth0",
      "reason": "interface eth0 already has an XDP program attached (id 42, native). The kernel allows one XDP program per interface, so this one cannot attach on top.",
      "nested_xdp": true
    }
  ]
}
```

`loaded` and attached are different states: a program can be in the kernel and
still not see a packet because its hook was taken. `attach_blocked` is omitted
when empty, and `nested_xdp: true` marks the case where another XDP program owns
the interface.

#### GET /api/v1/ebpf/kernel-features

What the running kernel offers the eBPF programs, measured once at startup and
cached. `missing_required` is the actionable field: any entry there names an
object the agent refuses to load, and it also holds `/readyz` at `not_ready`.

```bash
curl http://localhost:8080/api/v1/ebpf/kernel-features
```

```json
{
  "probed": true,
  "load_mode": "privileged",
  "program_types": [{"program_type": "xdp", "supported": true}],
  "helpers": [{"program_type": "xdp", "helper": "bpf_map_lookup_elem", "supported": true}],
  "missing_required": []
}
```

`probed: false` means nothing was measured, not that a feature is absent - the
probe needs `CAP_BPF`, which the default BPF-token load path deliberately does
not hold. In that case `reason` explains why and `missing_required` is empty.
Only helpers are probed; kfuncs and map types carry no probe and stay covered by
the documented kernel floor.

#### GET /api/v1/ebpf/uprobes

The DLP uprobe set the agent currently holds links for. An empty `probes` list is a real answer, and always the same one: no TLS payload is being read. It covers a DLP module that is not loaded, a library scan that resolved nothing, and a datapath that has been detached.

```bash
curl http://localhost:8080/api/v1/ebpf/uprobes
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `libraries` | integer | Distinct libraries carrying probes |
| `probes` | array | Every probe, ordered by inode then symbol so two runs diff cleanly |

Each entry of `probes`:

| Field | Type | Description |
|-------|------|-------------|
| `lib` | string | Library basename |
| `path` | string | Path the link was created against, as the loader saw it |
| `dev` | integer | Block device of the probed file |
| `ino` | integer | Inode of the probed file. With `dev`, the identity two runs are compared on: the same path can name a different file after a package upgrade |
| `program` | string | Loader name of the eBPF program behind the probe |
| `symbol` | string | Exported symbol the probe sits on |
| `offset` | integer | File offset the link was created at. A changed offset for an unchanged inode is a resolution regression, not a new build |
| `retprobe` | boolean | The probe fires on return rather than on entry |
| `brokered` | boolean | `BPF_LINK_CREATE` was issued by the warden (rootless posture) rather than by the agent itself |
| `sticky` | boolean | The attachment survives a reconcile that finds no process mapping the inode, the cold-start system-library fallback |

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

#### POST /api/v1/ips/blacklist

Manually add an IP to the IPS blacklist. Drives the same path the DNS-blocklist and reputation auto-block features already use, so the entry is visible through `GET /api/v1/ips/blacklist` and is subject to the policy's TTL cap and expiry sweeper. Returns `201` on success and `400` for an unparseable address or a full blacklist.

```bash
curl -X POST http://localhost:8080/api/v1/ips/blacklist \
  -H "Content-Type: application/json" \
  -d '{"ip":"198.51.100.7","reason":"manual-soc","ttl_secs":3600}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ip` | string | Yes | IP address to blacklist (IPv4 or IPv6) |
| `reason` | string | No | Human-readable reason. Defaults to `manual-api` |
| `ttl_secs` | integer | No | TTL in seconds. Defaults to, and is capped at, the policy's maximum blacklist duration |

Response:

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | The address that was blacklisted |
| `reason` | string | Reason recorded against the entry |
| `ttl_remaining_secs` | integer | Seconds left before the sweeper expires the entry |

#### DELETE /api/v1/ips/blacklist/{ip}

Remove an IP from the IPS blacklist. Returns `204` on success, `400` for an unparseable address and `404` when the address is not blacklisted.

```bash
curl -X DELETE http://localhost:8080/api/v1/ips/blacklist/198.51.100.7
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

#### GET /api/v1/threatintel/urls

List malicious URL indicators ingested from CTI feeds. The threat-intel engine is IP-only, so URL indicators are surfaced from the service's retained snapshot rather than from a kernel map.

```bash
curl http://localhost:8080/api/v1/threatintel/urls
```

Response: an array of

| Field | Type | Description |
|-------|------|-------------|
| `url` | string | The indicator |
| `feed_id` | string | Feed the indicator came from |
| `confidence` | integer | Feed-reported confidence |
| `threat_type` | string | Feed-reported classification |

#### POST /api/v1/threatintel/feeds/refresh

Trigger an immediate re-fetch of every enabled threat-intel feed. Returns `409` when a refresh is already running and `503` when feeds are not enabled in the agent configuration.

```bash
curl -X POST http://localhost:8080/api/v1/threatintel/feeds/refresh \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `feed_id` | string | No | Feed to refresh. Accepted for forward compatibility; the fetcher refreshes every enabled feed in a single cycle |

Response:

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | Outcome of the trigger |
| `message` | string | Human-readable detail |

### GeoIP

#### GET /api/v1/geoip/status

GeoIP enrichment status.

```bash
curl http://localhost:8080/api/v1/geoip/status
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether GeoIP enrichment is enabled in the agent configuration |
| `ready` | boolean | Whether an mmdb-backed lookup database is loaded and ready |

#### GET /api/v1/geoip/lookup

Resolve one IP address to its GeoIP record. Returns `400` for an unparseable address and `404` when GeoIP is not available.

```bash
curl "http://localhost:8080/api/v1/geoip/lookup?ip=203.0.113.9"
```

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `ip` | string | Yes | IP address to resolve (IPv4 or IPv6) |

Response:

| Field | Type | Description |
|-------|------|-------------|
| `ip` | string | The address that was resolved |
| `country_code` | string \| null | ISO country code, `null` when the database has no entry |
| `country_name` | string \| null | Country name, `null` when the database has no entry |
| `city` | string \| null | City name, `null` when the database carries no city data |
| `asn` | integer \| null | Autonomous system number, `null` when no ASN database is loaded |
| `as_org` | string \| null | Autonomous system organisation, `null` when no ASN database is loaded |

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

#### GET /api/v1/alerts/stream

Server-Sent Events live alert feed. Each frame carries `id: <alert-id>`,
`event: alert`, and `data: <json>` matching the [`Alert`](#) schema returned
by `GET /api/v1/alerts`. The connection emits a `:keepalive` comment every
15 seconds so HTTP/1.1 intermediaries do not idle-close the stream.

Server-side filters are applied to every alert before it is forwarded.
Clients reconnecting with `Last-Event-ID: <last-id>` receive every alert
emitted after that id from the in-memory replay buffer (≤ 5 000 entries)
without duplication. If `Last-Event-ID` is unknown to the buffer (the
client missed too much), the stream resumes live without backfill - the
client should refetch via `GET /api/v1/alerts`.

| Parameter | Type | Description |
|-----------|------|-------------|
| `severity_min` | string | Minimum severity (`low` \| `medium` \| `high` \| `critical`). |
| `component` | string | Component to receive (case-insensitive exact match). |
| `mitre_tactic` | string | MITRE ATT&CK tactic (case-insensitive). |

Response headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

```bash
curl -N -H 'Accept: text/event-stream' \
    "http://localhost:8080/api/v1/alerts/stream?severity_min=high&component=ids"
```

```text
:keepalive

id: 1700000000000-ids-001
event: alert
data: {"id":"1700000000000-ids-001","component":"ids","severity":"high",...}
```

Reconnect with the last id seen by the client:

```bash
curl -N -H 'Accept: text/event-stream' \
    -H 'Last-Event-ID: 1700000000000-ids-001' \
    "http://localhost:8080/api/v1/alerts/stream"
```

The Prometheus gauge `ebpfsentinel_alerts_sse_subscribers` exposes the
current subscriber count and is incremented / decremented by the handler
on connect / disconnect.

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

#### GET /api/v1/lb/vips

Return the L2 VIP announcer status (active role, bound interface, configured VIPs, and per-VIP gratuitous-ARP / ARP-reply counters). Returns `404` when the announcer is not enabled in the agent configuration.

```bash
curl http://localhost:8080/api/v1/lb/vips
```

Response shape:

```json
{
  "role": "primary",
  "interface": "eth0",
  "is_speaker": true,
  "bindings_count": 2,
  "vips": [
    { "name": "web", "addr": "192.0.2.10", "arp_replies": 42, "self_announced": true }
  ]
}
```

#### POST /api/v1/lb/vips

Apply a VIP announce configuration (role, interface, VIP list). Requires `admin` role. The agent validates the config (interface MTU, VIP uniqueness, role compatibility with `l2dsr` same-segment backends) and reconciles kernel maps + gratuitous ARP under the announcer reload lock.

```bash
curl -X POST http://localhost:8080/api/v1/lb/vips \
  -H 'Content-Type: application/json' \
  -d '{
    "role": "primary",
    "interface": "eth0",
    "vips": [{ "name": "web", "addr": "192.0.2.10" }]
  }'
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `role` | string | No | `disabled`, `primary`, or `standby`. Defaults to `disabled`. |
| `interface` | string | Yes | NIC the announcer binds (must match an enabled XDP iface). |
| `vips` | array | Yes | List of `{ name, addr }`. `addr` must be an IPv4 or IPv6 literal. |

### DNS Intelligence

#### GET /api/v1/dns/status

DNS intelligence subsystem status: whether the cache and blocklist are enabled, and what the blocklist has done since start.

```bash
curl http://localhost:8080/api/v1/dns/status
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether DNS intelligence (cache and blocklist) is enabled |
| `blocklist_pattern_count` | integer | Blocklist patterns currently loaded |
| `blocklist_domains_blocked` | integer | Domains matched against the blocklist since start |
| `blocklist_ips_injected` | integer | IPs pushed into the IPS blacklist by a blocklist match |

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

#### POST /api/v1/routing/gateways

Add a routing gateway. Returns `201` on success and `409` when the name or address conflicts with an existing gateway.

```bash
curl -X POST http://localhost:8080/api/v1/routing/gateways \
  -H "Content-Type: application/json" \
  -d '{"name":"wan3","ip":"192.0.2.1","interface":"eth2","weight":30,"enabled":true,"health_check_interval_secs":10}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Gateway name |
| `ip` | string | Yes | Gateway IPv4 address |
| `interface` | string | No | Egress interface. Defaults to empty, inheriting the agent's primary |
| `weight` | integer | No | Routing weight, mapped to failover priority (lower is preferred) |
| `enabled` | boolean | No | Whether the gateway is eligible for selection |
| `health_check_interval_secs` | integer | No | Health-check probe interval in seconds. When set, an ICMP probe is configured |

Response: the created gateway, in the same shape `GET /api/v1/routing/gateways` returns.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Gateway identifier, rendered as a string for stable API addressing |
| `name` | string | Gateway name |
| `interface` | string | Egress interface |
| `gateway_ip` | string | Gateway IPv4 address |
| `priority` | integer | Failover priority (lower is preferred) |
| `weight` | integer | Alias of `priority`, exposed as a routing weight |
| `enabled` | boolean | Whether the gateway is eligible for selection |
| `status` | string | Health-check observed status (`healthy`, `degraded`, `down`) |
| `health_status` | string | Alias of `status` for clients expecting a `health_status` field |

#### DELETE /api/v1/routing/gateways/{id}

Remove a routing gateway. Returns `204` on success and `404` when no gateway carries that identifier.

```bash
curl -X DELETE http://localhost:8080/api/v1/routing/gateways/1
```

#### GET /api/v1/routing/routes

The default route currently in effect. Returns an empty list when no gateway is usable.

```bash
curl http://localhost:8080/api/v1/routing/routes
```

```json
[{"destination": "0.0.0.0/0", "gateway_id": "1", "gateway_ip": "192.168.1.1"}]
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

#### POST /api/v1/zones

Create a zone. `interfaces` and `default_policy` are optional; a zone with no
interface carries no traffic, and an absent `default_policy` denies.

```bash
curl -X POST http://localhost:8080/api/v1/zones \
  -H 'Content-Type: application/json' \
  -d '{"name": "dmz", "interfaces": ["eth3"], "default_policy": "deny"}'
```

#### DELETE /api/v1/zones/{id}

Remove a zone by name. Interfaces of the removed zone become unzoned.

```bash
curl -X DELETE http://localhost:8080/api/v1/zones/dmz
```

#### POST /api/v1/zones/policies

Create an inter-zone policy. Policies are directional.

```bash
curl -X POST http://localhost:8080/api/v1/zones/policies \
  -H 'Content-Type: application/json' \
  -d '{"source_zone": "lan", "dest_zone": "dmz", "action": "allow"}'
```

```json
{"id": "lan__dmz", "from": "lan", "to": "dmz", "policy": "allow", "action": "allow"}
```

#### DELETE /api/v1/zones/policies/{id}

Remove an inter-zone policy. The id is `{from}__{to}`.

```bash
curl -X DELETE http://localhost:8080/api/v1/zones/policies/lan__dmz
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

Set content for an external alias. Only works for aliases with `type: external`. The addresses are loaded into the kernel IPv4 IP set the referencing firewall rules match against; members that are not IPv4 host addresses are reported in the agent log and stay out of the set.

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
| `vlan_id` | integer | VLAN ID (0--4094). Omit to match any VLAN, `0` matches untagged traffic only |

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

JA4 client TLS fingerprint cache summary. Returns the current cached entry count, maximum size, TTL, and whether the cache is backed by a persistent store (see [L7 configuration](../configuration/l7.md#fingerprint-persistence)).

```bash
curl http://localhost:8080/api/v1/fingerprints/summary
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `cached_count` | integer | Current number of cached JA4 entries |
| `max_size` | integer | Maximum cache size before LRU eviction |
| `ttl_seconds` | integer | Entry TTL in seconds |
| `persistent` | boolean | `true` when `l7.fingerprints.persistence_path` is set |

#### GET /api/v1/fingerprints/ja4s

JA4S server TLS fingerprint cache summary. Populated as the agent observes `ServerHello` bytes on monitored interfaces and computes a per-flow JA4S hash.

```bash
curl http://localhost:8080/api/v1/fingerprints/ja4s
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `cached_count` | integer | Current number of cached JA4S entries |
| `max_size` | integer | Maximum cache size before LRU eviction |
| `ttl_seconds` | integer | Entry TTL in seconds |
| `persistent` | boolean | `true` when `l7.fingerprints.persistence_path` is set |

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
| `target` | string | Yes | Target host address (e.g. `1.2.3.4` or `2001:db8::1`); a prefix is refused |
| `ttl` | string | Yes | Duration string: `30s`, `5m`, `1h`, `1d`, or bare seconds |
| `rate_pps` | integer | No | Rate limit in packets/sec, required above zero for `throttle_ip` |

A `block_ip` adds the target to the IPS blacklist and covers both IP families.
A `throttle_ip` installs a token bucket in the XDP rate limiter and reaches
IPv4 targets only, since its per-source map is keyed by a 32-bit address.

#### DELETE /api/v1/responses/{id}

Revoke a response action early, which lifts the blacklist entry or the token
bucket immediately instead of waiting for the TTL. Requires `admin` role.

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

### TLS

#### GET /api/v1/tls/status

Report the negotiated TLS key-exchange group for the connection carrying this request, so an operator can confirm a post-quantum hybrid handshake against a live connection rather than against the configuration.

```bash
curl https://localhost:8443/api/v1/tls/status
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `tls` | boolean | Whether this request arrived over TLS |
| `negotiated_group` | string \| null | Negotiated TLS 1.3 key-exchange named group (for example `X25519MLKEM768`, `X25519`, `secp256r1`), `null` when the request did not arrive over TLS |
| `post_quantum` | boolean | `true` when the negotiated group is the post-quantum hybrid (`X25519MLKEM768`) |

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
| GET | `/api/v1/agent/identity` | Yes | Operator-managed metadata (hot-reloadable) |
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
| POST | `/api/v1/ips/blacklist` | Yes | Add an IP to the blacklist |
| DELETE | `/api/v1/ips/blacklist/{ip}` | Yes | Remove an IP from the blacklist |
| GET | `/api/v1/ips/domain-blocks` | Yes | List domain-based IP blocks |
| GET | `/api/v1/ratelimit/rules` | Yes | List rate limit rules |
| POST | `/api/v1/ratelimit/rules` | Yes | Create rate limit rule |
| DELETE | `/api/v1/ratelimit/rules/{id}` | Yes | Delete rate limit rule |
| GET | `/api/v1/threatintel/status` | Yes | Feed status |
| GET | `/api/v1/threatintel/iocs` | Yes | List IOCs |
| GET | `/api/v1/threatintel/feeds` | Yes | List feeds |
| GET | `/api/v1/threatintel/urls` | Yes | List malicious URL indicators |
| POST | `/api/v1/threatintel/feeds/refresh` | Yes | Trigger a feed refresh |
| GET | `/api/v1/geoip/status` | Yes | GeoIP enrichment status |
| GET | `/api/v1/geoip/lookup` | Yes | Resolve an IP to its GeoIP record |
| GET | `/api/v1/alerts` | Yes | List alerts |
| GET | `/api/v1/alerts/stream` | Yes | SSE live alert feed (`Last-Event-ID` resume) |
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
| GET | `/api/v1/lb/vips` | Yes | L2 VIP announcer status |
| POST | `/api/v1/lb/vips` | Yes (admin) | Apply VIP announce config |
| GET | `/api/v1/dns/status` | Yes | DNS intelligence status |
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
| GET | `/api/v1/ebpf/kernel-features` | Yes | Probed kernel helper support |
| GET | `/api/v1/ebpf/uprobes` | Yes | Attached DLP uprobes with resolved offsets |
| GET | `/api/v1/nat/status` | Yes | NAT status |
| GET | `/api/v1/nat/rules` | Yes | List NAT rules |
| GET | `/api/v1/routing/status` | Yes | Routing status |
| GET | `/api/v1/routing/gateways` | Yes | List gateways with health status |
| POST | `/api/v1/routing/gateways` | Yes | Add a routing gateway |
| DELETE | `/api/v1/routing/gateways/{id}` | Yes | Remove a routing gateway |
| GET | `/api/v1/routing/routes` | Yes | Default route currently in effect |
| GET | `/api/v1/zones/status` | Yes | Zone status |
| GET | `/api/v1/zones` | Yes | List zones |
| GET | `/api/v1/zones/policies` | Yes | List inter-zone policies |
| POST | `/api/v1/zones` | Yes | Create a zone |
| DELETE | `/api/v1/zones/{id}` | Yes | Remove a zone |
| POST | `/api/v1/zones/policies` | Yes | Create an inter-zone policy |
| DELETE | `/api/v1/zones/policies/{id}` | Yes | Remove an inter-zone policy |
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
| GET | `/api/v1/fingerprints/summary` | Yes | JA4 client fingerprint cache summary |
| GET | `/api/v1/fingerprints/ja4s` | Yes | JA4S server fingerprint cache summary |
| GET | `/api/v1/responses` | Yes | List active auto-response actions |
| POST | `/api/v1/responses/manual` | Yes (admin) | Create manual response action (block/throttle) |
| DELETE | `/api/v1/responses/{id}` | Yes (admin) | Revoke a response action |
| GET | `/api/v1/captures` | Yes | List packet capture sessions |
| POST | `/api/v1/captures/manual` | Yes (admin) | Start a manual packet capture |
| DELETE | `/api/v1/captures/{id}` | Yes (admin) | Stop a running capture |
| GET | `/api/v1/tls/status` | Yes | Negotiated TLS key-exchange group for this connection |

## Enterprise Endpoints

Served on the enterprise API port (default `8444`). Requires `FleetManagement` license feature.

### Authentication

The enterprise port uses the same credentials as the agent API: with
`auth.enabled: true` every endpoint on `8444` requires either
`Authorization: Bearer <token>` or `X-API-Key: <key>`, and an unauthenticated
call gets `401`. That covers `/metrics`, the Swagger UI and the fleet endpoints
below, so a Prometheus scrape or a fleet agent needs a credential of its own.

With `auth.enabled: false` the port is open, but nothing can then prove a role:
every caller is treated as an anonymous viewer, and the role-gated endpoints
(tenant administration in particular) stay unavailable. Role headers are never
trusted - the role comes from the verified credential, not from the request.

### Fleet Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/v1/agent/register` | Yes | Register agent, returns UUIDv7 identity + token |
| POST | `/api/v1/agent/heartbeat` | Yes | Agent heartbeat with live rule counts and config version |
| GET | `/api/v1/agent/identity` | Yes | Full agent identity, capabilities, eBPF status, TLS info |
| GET | `/api/v1/agent/config/version` | Yes | Config SHA-256 hash + reload timestamp |
| GET | `/api/v1/flows/graph` | Yes | Network flow graph from conntrack (query: `max_nodes`, `min_bytes`, `protocol`, `limit`) |

See [Fleet Management](../features/enterprise/fleet-management.md) for request/response details.

### Network Forensics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/forensics/events/stream` | Yes | SSE live forensic event feed (`Last-Event-ID` resume) |

#### GET /api/v1/forensics/events/stream

Server-Sent Events live forensic event feed. Each frame carries
`id: <event-id>`, `event: forensic_event`, and `data: <json>` matching the
forensic event schema captured in the engine ring buffer. The connection
emits a `:keepalive` comment every 15 seconds so HTTP/1.1 intermediaries do
not idle-close the stream.

Server-side filters are applied to every event before it is forwarded.
Clients reconnecting with `Last-Event-ID: <last-id>` receive every event
whose id is lexicographically greater than that value from the in-memory
ring buffer, without duplication (ids are UUIDv7, so lexical order is time
order). If the client missed more than the ring buffer holds, the stream
resumes live without backfill.

| Parameter | Type | Description |
|-----------|------|-------------|
| `severity_min` | string | Minimum severity (`low` \| `medium` \| `high` \| `critical`). |
| `component` | string | Component to receive (case-insensitive exact match). |
| `mitre_technique` | string | MITRE ATT&CK technique id, e.g. `T1190` (case-insensitive). |

Response headers:

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`

```bash
curl -N -H 'Accept: text/event-stream' \
    "https://localhost:8444/api/v1/forensics/events/stream?severity_min=high&component=ids"
```

```text
:keepalive

id: 01934567-89ab-7def-0123-456789abcdef
event: forensic_event
data: {"id":"01934567-89ab-7def-0123-456789abcdef","component":"ids","severity":"High",...}
```

The Prometheus gauge `forensics_sse_subscribers` exposes the current
subscriber count, incremented / decremented by the handler on connect /
disconnect.

### Multi-Cluster Federation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/v1/federation/alerts/stream` | Yes | SSE live federated alert feed, cluster-scoped (`Last-Event-ID` resume) |

#### GET /api/v1/federation/alerts/stream

Server-Sent Events live feed of aggregated alerts from federated clusters.
Available on the management node only. Each frame carries
`id: <event-id>`, `event: federated_alert`, and `data: <json>` matching the
[`FederatedAlert`](#) schema returned by `GET /api/v1/federation/alerts`. The
connection emits a `:keepalive` comment every 15 seconds.

Server-side filters are applied to every alert before it is forwarded.
`cluster_id` scopes the stream to a single federation tenant (cluster); a
missing value streams every cluster's alerts. Clients reconnecting with
`Last-Event-ID: <last-id>` receive every alert whose UUIDv7 `event_id` is
lexicographically greater than that value from the in-memory rolling buffer
(≤ 5 000 entries), without duplication.

| Parameter | Type | Description |
|-----------|------|-------------|
| `cluster_id` | string | Restrict to one cluster UUID (the federation tenant scope). |
| `severity` | string | Severity to receive (case-insensitive exact match). |
| `component` | string | Component to receive (case-insensitive exact match). |

```bash
curl -N -H 'Accept: text/event-stream' \
    -H 'Last-Event-ID: 01934567-89ab-7def-0123-456789abcdef' \
    "https://localhost:8444/api/v1/federation/alerts/stream?cluster_id=01234567-89ab-cdef-0123-456789abcdef"
```

```text
:keepalive

id: 01934567-89ab-7def-0123-456789abcdef
event: federated_alert
data: {"event_id":"01934567-89ab-7def-0123-456789abcdef","cluster_name":"prod-east","severity":"high",...}
```

The Prometheus gauge `federation_alerts_sse_subscribers`, labelled by
`tenant` (the cluster UUID, or `all` when unscoped), exposes the current
subscriber count per scope.

See [Multi-Cluster Federation](../features/enterprise/multicluster.md) for request/response details.
