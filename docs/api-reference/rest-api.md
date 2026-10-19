# REST API Reference

This page describes the **open-source agent**. The enterprise agent is a
separate binary listening on a port of its own, and its surface is
documented in [Enterprise REST API](rest-api-enterprise.md).

Base URL: `http://localhost:8080` (or `https://` with TLS enabled)

## Rate limiting

Requests are charged to a per-IP token bucket, and which bucket depends on
what is being called rather than on who is calling.

| Group | Sustained | Burst | Configurable |
|-------|-----------|-------|--------------|
| `/healthz`, `/readyz` | not limited | - | No |
| `/metrics` | 30 requests/minute per IP | 10 | No |
| Read routes under `/api/v1/` | 200 requests/minute per IP | 200 | No |
| Write routes under `/api/v1/` | `write_per_second`, default 1/second per IP | `write_burst`, default 60 | Yes, in [`agent.api_rate_limit`](../configuration/agent.md#write-api-rate-limit) |
| Every `/api/v1/` route, when `auth.enabled` | 600 requests/minute per IP | 30 | No |

The probes are unlimited on purpose: a kubelet that cannot get a readiness
answer restarts a healthy agent.

A route counts as a write when it changes state **or reaches out to the
network**, whatever it costs the agent to serve. `POST /api/v1/threatintel/feeds/refresh`
is the case that matters: it starts an outbound download of every enabled
feed, so it is throttled as a write and additionally runs single-flight,
answering `409 Conflict` with the code `REFRESH_IN_PROGRESS` to a caller
arriving while a cycle is already fetching.

Over the burst, the request answers `429 Too Many Requests` with a
`Retry-After` header in seconds. **Loopback is exempt from the write limit
by default** through `exempt_loopback`, so local CLI tooling is never
throttled; the read, metrics and auth-enabled limits have no exemption. A
peer whose address the server cannot determine is keyed under one shared
bucket rather than waved through.

The enterprise agent listens on a port of its own and limits it its own
way, reading the same `write_per_second` and `write_burst` so both ports
are tuned once. See
[Rate limiting](rest-api-enterprise.md#rate-limiting) for what differs.

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
- `datapath_stalled_secs` - the programs are loaded and attached, and the task
  that drains their ring buffers has stopped: this many seconds since its last
  pass, where a pass happens every 10 ms whether or not traffic arrived. It is a
  wedged agent rather than a quiet network, so a restart is the fix, and on a
  systemd host the same reading withholds the watchdog keep-alive and the
  restart happens by itself.

Neither list present, and `ebpf_loaded: false`, means the agent simply has not
finished loading yet.

## Protected Endpoints

Authentication is on unless the configuration turns it off, so these routes
answer `401` without a credential. Present it as `Authorization: Bearer <key>`
or `X-API-Key: <key>`; either header takes an API key, a JWT or an OIDC token,
since the value is handed to whichever providers are configured rather than
sorted by its shape.

With no method named under `auth:`, the key is the one the agent drew for
itself at first start and kept at `auth.bootstrap_key_path`, `0600` inside a
`0700` directory. The examples below read it from the environment:

```bash
export EBPFSENTINEL_TOKEN=$(sudo cat /var/lib/ebpfsentinel/auth/api-key)
```

`ebpfsentinel-agent` reads the same variable, and takes `--token` instead. See
[Authentication](../configuration/auth.md).

### Agent

#### GET /api/v1/agent/status

Agent status including version, uptime, loaded features, and what the agent
sees of the containers on this node.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/agent/status
```

```json
{
  "status": "running",
  "version": "0.1.0",
  "uptime_seconds": 1234,
  "ebpf_loaded": true,
  "rule_count": 12,
  "firewall_enabled": true,
  "firewall_mode": "block",
  "container_coverage": {
    "proc_root": "/host/proc",
    "host_proc": true,
    "resolver": true,
    "docker": "on",
    "kubernetes": "off_not_in_cluster"
  }
}
```

`container_coverage` is a verdict rather than a copy of the configuration: it
reports the procfs the agent actually reads, whether that procfs is the node's
(`host_proc`, which is what covers a neighbouring container without sharing the
pid namespace), whether the cgroup resolver is running, and where each metadata
enricher ended up.

| Enricher value | Meaning |
|----------------|---------|
| `on` | Running: alerts carry the workload's name, image and labels |
| `off_no_socket` | Enabled, but the runtime socket is not there; alerts keep the container id and lose the names |
| `off_not_in_cluster` | Enabled, but no Kubernetes API is reachable from this process |
| `off_unavailable` | Enabled and reachable, and the client could not be built |
| `off_by_configuration` | Turned off in the configuration |
| `off_not_built` | This build does not carry the enricher |
| `starting` | The agent has not finished building its enrichers yet |

The same values back the container rows of the
[deployment matrix](../features/deployment-matrix.md#what-the-node-itself-reports),
so the page and the node can be compared.

#### GET /api/v1/agent/identity

Agent identity metadata. Surfaces the operator-managed flag and the
optional operator UI deep-link URL configured under the top-level
`management:` block. Hot-reloadable: a config reload that toggles either
field is reflected on the next call without restart.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/agent/identity
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/config
```

#### POST /api/v1/config/reload

Trigger configuration reload. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/config/reload
```

#### PUT /api/v1/config/{section}

Write one section of the agent's configuration file and reload. Requires
`admin` role, and is refused unless `agent.config_writes` is `allowed`.

The body carries the section as a YAML document rooted at its own key, which
is how the dashboard's configuration screens render a section, so a section
read, edited and sent back needs no reshaping:

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X PUT http://localhost:8080/api/v1/config/ids \
  -H 'Content-Type: application/json' \
  -d '{"yaml": "ids:\n  enabled: true\n"}'
```

The merged document is validated in full before it replaces anything, and it
lands by rename, so a rejected edit leaves the file exactly as it was and an
accepted one is never half-written. The answer is the reload answer: `ok`
when the agent confirmed the reload, `pending` when it was triggered and had
not finished in time.

Secrets are the one thing that does not round-trip. `GET /api/v1/config`
masks every secret as `***`, so wherever the submitted document still holds
that string, the value already on disk is kept; a masked value the file
cannot answer is refused by name rather than guessed at, and the way to
change a secret is to write it out.

#### GET /api/v1/ebpf/status

Per-program eBPF load status, plus any attach the kernel refused.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ebpf/status
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ebpf/kernel-features
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

Three blocks beside the probe say what actually attached on this host rather
than what the kernel claims to support: `attribution`, `process_tracing` and
`workload_firewall`, each carrying `attached`, the hooks that took and the
reason where nothing did. They are read from the attach itself, because a
kernel offering a program type can still refuse the attach.

#### GET /api/v1/ebpf/uprobes

The DLP uprobe set the agent currently holds links for. An empty `probes` list is a real answer, and always the same one: no TLS payload is being read. It covers a DLP module that is not loaded, a library scan that resolved nothing, and a datapath that has been detached.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ebpf/uprobes
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/firewall/rules
```

#### POST /api/v1/firewall/rules

Create a firewall rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/firewall/rules \
  -H "Content-Type: application/json" \
  -d '{"id":"block-telnet","priority":5,"action":"deny","protocol":"tcp","dst_port":23}'
```

#### DELETE /api/v1/firewall/rules/{id}

Delete a firewall rule by ID. Returns 403 for system rules (e.g., anti-lockout rules).

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/firewall/rules/block-telnet
```

#### GET /api/v1/firewall/workload/rules

The workload rules in force, in the
order the kernel walks them, each with what it has refused since the policy
was published. A disabled rule is absent rather than listed at zero: it
occupies no slot, so the kernel keeps no counter for it. `503` when the
workload firewall is not loaded, which is not the same answer as a policy
with no rules in it.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/firewall/workload/rules
```

```json
{
  "enforcing": true,
  "rules": [
    {
      "rule": "allow-curl-registry",
      "allows": true,
      "mode": "enforce",
      "selector": "executable /usr/bin/curl",
      "destination": "to 10.0.0.7 port 443 over tcp",
      "denials": 0
    },
    {
      "rule": "default-deny",
      "allows": false,
      "mode": "enforce",
      "selector": "executable /usr/bin/curl",
      "destination": "to anywhere",
      "denials": 14
    }
  ]
}
```

#### GET /api/v1/firewall/workload/reach

What the workload policy lets one workload reach. Name the workload with
`pid`, or with any of `exe`, `unit`, `container_id` and `container_name`.
A `pid` is resolved through the agent's process table, so the answer is about
the task actually running rather than about the facts the caller typed;
naming no workload at all is a `400`, not an answer about every rule.

Every rule naming the workload comes back, in the order the kernel walks
them, because the rule an operator is looking for is usually the one above
the one they wrote: the first rule admitting a destination decides, so a rule
low in the list is one something above it may never reach.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" \
  "http://localhost:8080/api/v1/firewall/workload/reach?pid=4312"
```

```json
{
  "exe": "/usr/bin/curl",
  "unit": "backup.service",
  "cgroup": "/system.slice/backup.service",
  "container_id": null,
  "container_name": null,
  "enforcing": true,
  "rules": [
    {
      "rule": "allow-curl-registry",
      "allows": true,
      "mode": "enforce",
      "selector": "executable /usr/bin/curl",
      "destination": "to 10.0.0.7 port 443 over tcp",
      "denials": 0
    }
  ]
}
```

### Connection Tracking

#### GET /api/v1/conntrack/status

Conntrack status: enabled flag, active connection count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/conntrack/status
```

```json
{"enabled": true, "connection_count": 1842}
```

#### GET /api/v1/conntrack/events

Server-Sent Events stream of conntrack lifecycle events (new/update/destroy). Diffs `/proc/net/nf_conntrack` snapshots.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -N http://localhost:8080/api/v1/conntrack/events
```

```
data: {"event_type":"new","protocol":"tcp","src":"10.0.0.1:54321","dst":"10.0.0.2:443"}

data: {"event_type":"destroy","protocol":"tcp","src":"10.0.0.1:54321","dst":"10.0.0.2:443"}
```

#### GET /api/v1/conntrack/connections

List active connections in the conntrack table. A connection the node could
attribute carries [the workload block](#the-workload-block); one it only
forwarded carries none.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/conntrack/connections
```

#### POST /api/v1/conntrack/flush

Flush the connection tracking table. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/conntrack/flush
```

### L7 Firewall

#### GET /api/v1/firewall/l7-rules

List all L7 firewall rules.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/firewall/l7-rules
```

#### POST /api/v1/firewall/l7-rules

Create an L7 rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/firewall/l7-rules \
  -H "Content-Type: application/json" \
  -d '{"id":"block-admin","priority":10,"action":"deny","protocol":"http","path":"/admin"}'
```

#### DELETE /api/v1/firewall/l7-rules/{id}

Delete an L7 rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/firewall/l7-rules/block-admin
```

### IDS

#### GET /api/v1/ids/status

IDS status: enabled flag, mode, and rule count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ids/status
```

#### GET /api/v1/ids/rules

List all IDS detection rules.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ids/rules
```

### IPS

#### GET /api/v1/ips/rules

List IDS/IPS rules.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ips/rules
```

#### PATCH /api/v1/ips/rules/{id}

Update IPS rule mode.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X PATCH http://localhost:8080/api/v1/ips/rules/detect-sqli \
  -H "Content-Type: application/json" \
  -d '{"mode":"block"}'
```

#### GET /api/v1/ips/blacklist

List blacklisted IPs.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ips/blacklist
```

#### POST /api/v1/ips/blacklist

Manually add an IP to the IPS blacklist. Drives the same path the DNS-blocklist and reputation auto-block features already use, so the entry is visible through `GET /api/v1/ips/blacklist` and is subject to the policy's TTL cap and expiry sweeper. Returns `201` on success and `400` for an unparseable address or a full blacklist.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/ips/blacklist \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/ips/blacklist/198.51.100.7
```

#### GET /api/v1/ips/domain-blocks

List domain-based IP blocks (IPs blocked due to DNS-driven IPS).

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ips/domain-blocks
```

### Rate Limiting

#### GET /api/v1/ratelimit/rules

List rate limit rules.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ratelimit/rules
```

#### POST /api/v1/ratelimit/rules

Create a rate limit rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/ratelimit/rules \
  -H "Content-Type: application/json" \
  -d '{"id":"rl-global","rate":1000,"burst":2000,"algorithm":"token_bucket","scope":"per_ip"}'
```

#### DELETE /api/v1/ratelimit/rules/{id}

Delete a rate limit rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/ratelimit/rules/rl-global
```

### Threat Intelligence

#### GET /api/v1/threatintel/status

Feed status (last refresh, IOC count).

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/threatintel/status
```

#### GET /api/v1/threatintel/iocs

List loaded IOCs.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/threatintel/iocs
```

#### GET /api/v1/threatintel/feeds

List configured feeds.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/threatintel/feeds
```

#### GET /api/v1/threatintel/urls

List malicious URL indicators ingested from CTI feeds. The threat-intel engine is IP-only, so URL indicators are surfaced from the service's retained snapshot rather than from a kernel map.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/threatintel/urls
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/threatintel/feeds/refresh \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/geoip/status
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether GeoIP enrichment is enabled in the agent configuration |
| `ready` | boolean | Whether an mmdb-backed lookup database is loaded and ready |

#### GET /api/v1/geoip/lookup

Resolve one IP address to its GeoIP record. Returns `400` for an unparseable address and `404` when GeoIP is not available.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://localhost:8080/api/v1/geoip/lookup?ip=203.0.113.9"
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://localhost:8080/api/v1/alerts?component=ids&severity=high&limit=50"
```

#### The workload block

An alert and a connection each carry an optional `workload` object naming the
process that opened the flow. It is written only where the node resolved one,
and it is absent rather than zeroed everywhere else, so a reader never has to
tell a real pid 0 from a failed lookup.

| Field | Type | When it is there |
|-------|------|------------------|
| `pid` | integer | Always, in a block that exists. A block is never written for pid 0 |
| `source` | string | Always: `socket`, `flow` or `process`, how the process was reached |
| `exe` | string | The executable path, where the process table read one |
| `uid` | integer | The real uid of the task when the socket was opened |
| `cgroup` | integer | cgroup v2 id, as the kernel numbers it |
| `container` | string | Container id, for a process in one |
| `image` | string | Container image, where a runtime enricher could read it |
| `pod` | string | Pod name, on a Kubernetes node |
| `namespace` | string | Namespace, on a Kubernetes node |
| `service_account` | string | Service account of the pod, where the enricher read one |
| `unit` | string | systemd unit, for a host process placed in one |

`source` is the strength of the join and not a detail:

| `source` | What it means |
|---|---|
| `socket` | The socket cookie on the event was found in the kernel's socket table. The task named is the task that owns that socket |
| `flow` | No cookie was available, so the five-tuple was matched against the index the socket hooks keep. A tuple can be reused after a socket closes, so this is a correlation |
| `process` | The event already named a process and the rest was filled in from the process table, which is how a DLP write arrives |

The whole block is absent for a flow the node only forwarded, for a socket
opened before the hooks attached, for a socket opened outside the agent's
cgroup, and on a host where the attach was refused. There is deliberately no
hash of the executable: the agent records the path `/proc/<pid>/exe` answered
and says so, and a key that is always absent would be a promise it does not
keep. Whether the hooks attached on this host is in
[`ebpf kernel-features`](../cli-reference/index.md), and the table they fill is
sized in [the attribution configuration](../configuration/attribution.md).

```json
{
  "pid": 8831,
  "source": "socket",
  "exe": "/usr/local/bin/exporter",
  "uid": 1000,
  "container": "ac19f0",
  "image": "ghcr.io/acme/exporter:1.4",
  "pod": "exporter-7f9c",
  "namespace": "payments"
}
```

#### GET /api/v1/alerts/{id}

Read one stored alert by identifier. Returns `404` when no alert carries that
identifier and `503` when no alert store is configured. The body is the same
alert shape `GET /api/v1/alerts` returns for a row.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/alerts/alert-001
```

#### PATCH /api/v1/alerts/{id}/triage

Change one alert's status or assignee, or append a note to it. A field left out
of the body stays as it was, and `"assignee": null` takes the alert off whoever
held it, so the two are different requests rather than one.

| Field | Type | Notes |
|-------|------|-------|
| `status` | string | `open`, `acknowledged`, `investigating` or `resolved` |
| `assignee` | string or `null` | At most 128 characters. `null` unassigns |
| `note` | string | Appended, never replacing. At most 4096 characters, and an alert holds at most 200 |
| `author` | string | Who is writing, when a console writes on a person's behalf. Defaults to the authenticated identity |

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X PATCH http://localhost:8080/api/v1/alerts/alert-001/triage \
  -H "Content-Type: application/json" \
  -d '{"status":"investigating","assignee":"soc-l2","note":"matches last week's scan"}'
```

Returns the alert's whole triage after the change: `alert_id`, `status`,
`assignee`, `updated_ns`, and `notes`, each note carrying `author`, `via` (the
identity the agent authenticated the write under, which is why a forged
`author` is still attributable), `at_ns` and `text`. `400` on an unknown
status, an empty change, or a value past one of the ceilings above; `404` when
no alert carries that identifier; `503` when no alert store is configured.

#### POST /api/v1/alerts/triage

Apply one change to many alerts. The body is the same as above plus `ids`, at
most 1000 of them.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/alerts/triage \
  -H "Content-Type: application/json" \
  -d '{"ids":["alert-001","alert-002"],"status":"resolved"}'
```

Returns `updated`, the identifiers the change was applied to, and `missing`,
the ones the store no longer holds. A missing alert is reported rather than
failing the call, so a console triaging a list it read a moment ago gets the
rest of the work done.

#### POST /api/v1/alerts/{id}/false-positive

Mark an alert as false positive.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/alerts/alert-001/false-positive
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -N -H 'Accept: text/event-stream' \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -N -H 'Accept: text/event-stream' \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://localhost:8080/api/v1/audit/logs?component=firewall&limit=20"
```

#### GET /api/v1/audit/rules/{id}/history

Rule change history for a specific rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/audit/rules/fw-001/history
```

### DDoS Protection

#### GET /api/v1/ddos/status

DDoS protection status: enabled flag, active attack count, total mitigated, policy count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ddos/status
```

```json
{"enabled": true, "active_attacks": 0, "total_mitigated": 42, "policy_count": 3}
```

#### GET /api/v1/ddos/attacks

List active DDoS attacks currently being tracked.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ddos/attacks
```

#### GET /api/v1/ddos/attacks/history

List historical (mitigated/expired) DDoS attacks. Supports `?limit=` query parameter.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://localhost:8080/api/v1/ddos/attacks/history?limit=50"
```

#### GET /api/v1/ddos/policies

List all DDoS detection/mitigation policies.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/ddos/policies
```

#### POST /api/v1/ddos/policies

Create a DDoS policy. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/ddos/policies \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/ddos/policies/syn-flood-block
```

### Load Balancer

#### GET /api/v1/lb/status

Load balancer status: enabled flag, service count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/lb/status
```

```json
{"enabled": true, "service_count": 3}
```

#### GET /api/v1/lb/services

List all load balancer services.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/lb/services
```

#### GET /api/v1/lb/services/{id}

Get service detail including backends, health status, and active connections.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/lb/services/lb-https
```

#### POST /api/v1/lb/services

Create a load balancer service. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/lb/services \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/lb/services/lb-api
```

#### GET /api/v1/lb/vips

Return the L2 VIP announcer status (active role, bound interface, configured VIPs, and per-VIP gratuitous-ARP / ARP-reply counters). Returns `404` when the announcer is not enabled in the agent configuration.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/lb/vips
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/lb/vips \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/dns/status
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/dns/cache
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://localhost:8080/api/v1/dns/cache?domain=example.com"
```

#### DELETE /api/v1/dns/cache

Flush DNS cache.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/dns/cache
```

#### GET /api/v1/dns/stats

DNS cache and blocklist statistics.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/dns/stats
```

#### GET /api/v1/dns/blocklist

List loaded blocklist rules.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/dns/blocklist
```

### Domain Reputation

#### GET /api/v1/domains/reputation

Query domain reputations. Supports `?domain=` and `?min_score=` filters.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/domains/reputation
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://localhost:8080/api/v1/domains/reputation?domain=suspicious.com&min_score=0.5"
```

#### POST /api/v1/domains/blocklist

Add domain to runtime blocklist.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/domains/blocklist \
  -H "Content-Type: application/json" \
  -d '{"domain":"malware.example.com"}'
```

#### DELETE /api/v1/domains/blocklist/{domain}

Remove domain from blocklist.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/domains/blocklist/malware.example.com
```

### NAT

#### GET /api/v1/nat/status

NAT status: enabled flag and rule count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/nat/status
```

```json
{"enabled": true, "rule_count": 5}
```

#### GET /api/v1/nat/rules

List all NAT rules (SNAT and DNAT combined, with direction field).

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/nat/rules
```

### Policy Routing

#### GET /api/v1/routing/status

Routing status: enabled flag and gateway count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/routing/status
```

```json
{"enabled": true, "gateway_count": 2}
```

#### GET /api/v1/routing/gateways

List gateways with current health status.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/routing/gateways
```

```json
[
  {"id": 1, "name": "wan1", "interface": "eth0", "gateway_ip": "192.168.1.1", "priority": 10, "enabled": true, "status": "healthy"},
  {"id": 2, "name": "wan2", "interface": "eth1", "gateway_ip": "10.0.0.1", "priority": 20, "enabled": true, "status": "down"}
]
```

#### POST /api/v1/routing/gateways

Add a routing gateway. Requires a write role: admin or operator. Viewers are refused. The agent assigns the identifier itself, taking the lowest free one, so the body carries none and two gateways may share a name or a next hop. Returns `201` on success and `409` only when all 256 identifiers are in use.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/routing/gateways \
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
| `health_check_interval_secs` | integer | No | Health-check probe interval in seconds. When set, an ICMP probe against `8.8.8.8` is configured, with the default 5-second timeout and the default thresholds of 3 failures down and 2 successes up. The configuration file is where a probe target of your own is named |

The gateway joins the probe rotation as soon as it is created, probed on its own interval and out of its own `interface`.

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
| `status` | string | Health-check observed status (`healthy`, `down`) |
| `health_status` | string | Alias of `status` for clients expecting a `health_status` field |

#### DELETE /api/v1/routing/gateways/{id}

Remove a routing gateway. Requires a write role: admin or operator. Viewers are refused. Returns `204` on success, `400` when the identifier is not a number in 0-255, and `404` when no gateway carries it.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/routing/gateways/1
```

#### GET /api/v1/routing/routes

The default route currently in effect. Returns an empty list when no gateway is usable.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/routing/routes
```

```json
[{"destination": "0.0.0.0/0", "gateway_id": "1", "gateway_ip": "192.168.1.1"}]
```

### Zone Segmentation

#### GET /api/v1/zones/status

Zone status: enabled flag, zone count, and policy count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/zones/status
```

```json
{"enabled": true, "zone_count": 3, "policy_count": 6}
```

#### GET /api/v1/zones

List all zones with their interfaces and default policies.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/zones
```

#### GET /api/v1/zones/policies

List all inter-zone traffic policies.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/zones/policies
```

#### POST /api/v1/zones

Create a zone. `interfaces` and `default_policy` are optional; a zone with no
interface carries no traffic, and an absent `default_policy` denies.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/zones \
  -H 'Content-Type: application/json' \
  -d '{"name": "dmz", "interfaces": ["eth3"], "default_policy": "deny"}'
```

#### DELETE /api/v1/zones/{id}

Remove a zone by name. Interfaces of the removed zone become unzoned.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/zones/dmz
```

#### POST /api/v1/zones/policies

Create an inter-zone policy. Policies are directional.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/zones/policies \
  -H 'Content-Type: application/json' \
  -d '{"source_zone": "lan", "dest_zone": "dmz", "action": "allow"}'
```

```json
{"id": "lan__dmz", "from": "lan", "to": "dmz", "policy": "allow", "action": "allow"}
```

#### DELETE /api/v1/zones/policies/{id}

Remove an inter-zone policy. The id is `{from}__{to}`.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/zones/policies/lan__dmz
```

### Aliases

#### GET /api/v1/aliases/status

Alias count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/aliases/status
```

```json
{"alias_count": 12}
```

#### PUT /api/v1/aliases/{id}/content

Set content for an external alias. Only works for aliases with `type: external`. The addresses are loaded into the kernel IPv4 IP set the referencing firewall rules match against; members that are not IPv4 host addresses are reported in the agent log and stay out of the set.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X PUT http://localhost:8080/api/v1/aliases/external_blocklist/content \
  -H "Content-Type: application/json" \
  -d '{"ips": ["192.168.0.0/16", "10.0.0.0/8"]}'
```

### DLP

#### GET /api/v1/dlp/status

DLP status: enabled flag and pattern count.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/dlp/status
```

#### GET /api/v1/dlp/patterns

List loaded DLP detection patterns.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/dlp/patterns
```

### QoS / Traffic Shaping

#### GET /api/v1/qos/status

QoS status: enabled flag, pipe/queue/classifier counts.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/qos/status
```

#### GET /api/v1/qos/pipes

List all QoS pipes.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/qos/pipes
```

#### POST /api/v1/qos/pipes

Create a QoS pipe. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/qos/pipes \
  -H "Content-Type: application/json" \
  -d '{"id":"pipe-1","rate_bps":10000000,"burst_bytes":65536}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique pipe identifier (max 64 chars) |
| `rate_bps` | integer | Yes | Bandwidth limit in bits per second, enforced by a token bucket; `0` leaves the pipe unlimited |
| `burst_bytes` | integer | No | Token bucket depth in bytes (default: `65536`). A rate-limited pipe with `0` is refused with 400, since a bucket that holds no token drops every packet |
| `direction` | string | No | Hook the pipe shapes: `ingress`, `egress` or `both` (default: `egress`) |
| `delay_ms` | integer | No | Added latency, paced on egress through the `fq` qdisc (default: `0`) |
| `loss_pct` | number | No | Random packet loss, `0.0` to `100.0` (default: `0.0`) |

#### DELETE /api/v1/qos/pipes/{id}

Delete a QoS pipe. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/qos/pipes/pipe-1
```

#### GET /api/v1/qos/queues

List all QoS queues.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/qos/queues
```

#### POST /api/v1/qos/queues

Create a QoS queue. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/qos/queues \
  -H "Content-Type: application/json" \
  -d '{"id":"q-web","pipe_id":"p-wan"}'
```

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique queue identifier (max 64 chars) |
| `pipe_id` | string | Yes | Parent pipe identifier |

#### DELETE /api/v1/qos/queues/{id}

Delete a QoS queue. Requires `admin` role.

#### GET /api/v1/qos/classifiers

List all QoS classifiers.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/qos/classifiers
```

#### POST /api/v1/qos/classifiers

Create a QoS classifier. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/qos/classifiers \
  -H "Content-Type: application/json" \
  -d '{
    "id": "cls-https",
    "queue_id": "q-web",
    "priority": 10,
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/nat/nptv6
```

#### POST /api/v1/nat/nptv6

Create an NPTv6 rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/nat/nptv6 \
  -H "Content-Type: application/json" \
  -d '{"id":"site-a","internal_prefix":"fd00:1::","external_prefix":"2001:db8:1::","prefix_len":48}'
```

#### DELETE /api/v1/nat/nptv6/{id}

Delete an NPTv6 rule.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/nat/nptv6/site-a
```

### MITRE ATT&CK

#### GET /api/v1/mitre/coverage

MITRE ATT&CK technique coverage map based on active features.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/mitre/coverage
```

### JA4+ Fingerprints

#### GET /api/v1/fingerprints/summary

JA4 client TLS fingerprint cache summary. Returns the current cached entry count, maximum size, TTL, and whether the cache is backed by a persistent store (see [L7 configuration](../configuration/l7.md#fingerprint-persistence)).

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/fingerprints/summary
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/fingerprints/ja4s
```

Response:

| Field | Type | Description |
|-------|------|-------------|
| `cached_count` | integer | Current number of cached JA4S entries |
| `max_size` | integer | Maximum cache size before LRU eviction |
| `ttl_seconds` | integer | Entry TTL in seconds |
| `persistent` | boolean | `true` when `l7.fingerprints.persistence_path` is set |

### Processes

The process table is attribution and never enforcement: it names a pid, it
blocks nothing. It is filled by two tracepoints, `sched_process_exec` and
`sched_process_exit`, so an entry appears when a program execs and is removed
when it exits rather than aged out. See [process table
configuration](../configuration/process-table.md).

Both routes answer `503` with `the process table is not running on this agent`
when the table is turned off or the kernel refused the tracepoints. An empty
list would be a node running nothing, which is never true.

#### GET /api/v1/processes

The processes the agent currently knows about, newest first.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/processes
```

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `tracing` | object | Whether the tracepoints attached, which ones, and why not |
| `stats` | object | Capacity and what the bound has cost so far |
| `processes` | array | One object per live process, newest first |

`tracing`:

| Field | Type | Description |
|-------|------|-------------|
| `attached` | boolean | Both tracepoints are attached and the table is being filled |
| `tracepoints` | array | The tracepoint names that attached, in attach order |
| `reason` | string? | Why the table is off or empty, in one sentence. Absent when attached |
| `command_line` | boolean | `true` when the agent is configured to read `/proc/<pid>/cmdline` |

`stats`:

| Field | Type | Description |
|-------|------|-------------|
| `capacity` | integer | Maximum number of entries, from `process_table.capacity` |
| `entries` | integer | How many are held right now |
| `recorded` | integer | Execs recorded since start |
| `replaced` | integer | Execs that overwrote an entry for a pid already held |
| `evicted` | integer | Entries dropped because the table was full |
| `purged` | integer | Entries removed by an exit, which is the normal path |
| `missing_exit` | integer | Exits for a pid the table did not hold |

Each entry of `processes`:

| Field | Type | Description |
|-------|------|-------------|
| `pid` | integer | The process id |
| `parent_pid` | integer? | The parent, read from `/proc/<pid>/status`. Absent where the process was gone before it could be read |
| `comm` | string | The kernel's 16-byte command name |
| `identity` | object | `kind` is `path` or `unknown`, and `path` carries the executable path where there is one |
| `command_line` | string? | The full command line, only when `process_table.capture_command_line` is on |
| `uid` | integer | Effective user id at exec |
| `gid` | integer | Effective group id at exec |
| `cgroup_id` | integer | The kernel cgroup id of the task |
| `container` | object? | `id`, `runtime`, and `name` and `image` where the runtime answered. Absent for a host process |
| `started_at_ns` | integer | Kernel monotonic time of the exec, in nanoseconds |

`identity.kind` is what makes the strength of the name explicit. A path is
forgeable: a process can be started from a binary that has since been replaced
or deleted. `unknown` means the path could not be read at all, and the entry
carries only `comm`, which is 16 bytes the task can set itself.

#### GET /api/v1/processes/{pid}

One process by pid. The body is one entry of the array above.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/processes/4242
```

`404` with code `process_not_found` where the table holds no such pid, which is
every pid that exited and every pid that execed before the tracepoints
attached.

### Responses

#### GET /api/v1/responses

List active response actions (blocks and throttles).

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/responses
```

**Response:**

| Field | Type | Description |
|-------|------|-------------|
| `actions` | array | The containments in force, one object each |
| `active_count` | integer | How many of them there are |

Only what is in force is listed: an action that was revoked or whose TTL has
elapsed is absent rather than listed as lifted. Each object carries `id`,
`action_type`, `target`, `ttl_secs`, `remaining_secs`, `rule_id`, `revoked`
and, on a throttle, `rate_pps`. `remaining_secs` is whole seconds, so an
action with under a second left answers `0` and is still in force.

#### POST /api/v1/responses/manual

Create a time-bounded response action. Requires a write role: admin or
operator, since a containment is not namespaced. Viewers are refused.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/responses/manual \
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
bucket immediately instead of waiting for the TTL. Requires a write role:
admin or operator. Viewers are refused.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/responses/resp-001
```

Answers `200` with the action as it stood when it was lifted, `revoked` set,
rather than an empty body. An identifier the agent does not hold answers
`404`, so a lift that reached nothing is never read as one that happened.

### Captures

#### GET /api/v1/captures

List all packet capture sessions.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/captures
```

Sessions this process started, plus the capture files an earlier run left in
`/var/lib/ebpfsentinel/captures/`, which are listed as `interrupted` with the
size of their file and an empty filter.

#### POST /api/v1/captures/manual

Start a time-bounded packet capture. Requires `admin` role.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/captures/manual \
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X DELETE http://localhost:8080/api/v1/captures/cap-001
```

The session answers `stopped` at once, and the reader observes the stop within
50 milliseconds: the capture file is closed, the packet count and file size are
recorded against the session, and the capture slot is free for the next start
rather than held until `duration_secs` would have elapsed. A stop also arrives
when the agent itself is asked to stop, and a session ended that way reads
`interrupted` instead of `stopped`.

### TLS

#### GET /api/v1/tls/status

Report the negotiated TLS key-exchange group for the connection carrying this request, so an operator can confirm a post-quantum hybrid handshake against a live connection rather than against the configuration.

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" https://localhost:8443/api/v1/tls/status
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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/metrics
```

`/metrics` follows `auth.metrics_auth_required`, which is `true` by default:
with authentication on, a scraper needs a credential. Set it to `false` to
leave the counters open, which is what the Helm chart does so a ServiceMonitor
keeps working without holding the agent's key.

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
| GET | `/api/v1/alerts/{id}` | Yes | Read one alert |
| GET | `/api/v1/alerts/stream` | Yes | SSE live alert feed (`Last-Event-ID` resume) |
| POST | `/api/v1/alerts/{id}/false-positive` | Yes | Mark false positive |
| PATCH | `/api/v1/alerts/{id}/triage` | Yes | Set status or assignee, append a note |
| POST | `/api/v1/alerts/triage` | Yes | Apply one triage change to many alerts |
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
| PUT | `/api/v1/config/{section}` | Yes (admin) | Write one config section and reload |
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
| GET | `/api/v1/processes` | Yes | The process table, newest first |
| GET | `/api/v1/processes/{pid}` | Yes | One process by pid |
| GET | `/api/v1/responses` | Yes | List active auto-response actions |
| POST | `/api/v1/responses/manual` | Yes (admin) | Create manual response action (block/throttle) |
| DELETE | `/api/v1/responses/{id}` | Yes (admin) | Revoke a response action |
| GET | `/api/v1/captures` | Yes | List packet capture sessions |
| POST | `/api/v1/captures/manual` | Yes (admin) | Start a manual packet capture |
| DELETE | `/api/v1/captures/{id}` | Yes (admin) | Stop a running capture |
| GET | `/api/v1/tls/status` | Yes | Negotiated TLS key-exchange group for this connection |

## Enterprise Endpoints

The enterprise agent serves a surface of its own on the enterprise API port
(default `8444`), including the fleet management, network forensics and
multi-cluster federation endpoints that used to be listed here. Every one of
them, with the role and the license feature each requires, is documented in
[Enterprise REST API](rest-api-enterprise.md).
