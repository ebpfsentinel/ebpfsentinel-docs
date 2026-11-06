---
title: Enterprise REST API
sidebar_label: REST API (Enterprise)
---

# Enterprise REST API

> **Edition: Enterprise**

This page is the whole HTTP surface of the enterprise agent. The
open-source agent is a different binary listening on a different port, and
it is documented in [REST API](rest-api.md).

```
http://localhost:8444
```

Every path below is generated from the `openapi.json` the enterprise agent
emits, so a path documented here is a path the binary mounts and a path
missing from here is a path it does not.

## How to read the tables

Two facts decide whether a call is allowed, and both are stated per
endpoint. A third, the cluster's posture, is not a property of the route
and is described below the tables' two columns.

**License feature.** The feature the route belongs to. A feature the
license did not carry when the agent started is never mounted, so the call
answers `404 Not Found` rather than `403 Forbidden`: an unlicensed feature
is indistinguishable from a path that does not exist. `none` means the
route is mounted whatever the license says.

A license that runs out while the agent is running, at the end of its
14-day grace window, or that is revoked, is the one case where a mounted
route refuses instead: it answers `403 Forbidden` with the code
`LICENSE_FEATURE_UNAVAILABLE`, naming the feature. The route was mounted,
so it exists; the license has since stopped covering it. The datapath is
unaffected, and the routes listed with `none` keep answering. A renewed
key installed over the old one reopens those routes within a minute,
without a restart.

**Role.** The least-privileged built-in role whose grants satisfy the
route. `viewer` reads, `operator` reads and writes, `admin` does both and
administers roles. A custom role carrying the same grant works too: the
middleware checks the grant, never the role name. The grant is
`<domain>:<permission>`, where the permission is `read` for `GET`, `HEAD`
and `OPTIONS` and `write` for every other method, with one raise: a route
that rewrites the role model itself is checked for `admin` rather than
`write`, which is why the RBAC rows below carry `config:admin`. `none`
means the route sits outside RBAC. See
[Advanced RBAC](../features/enterprise/advanced-rbac.md) for how roles and
grants are defined.

## Rate limiting

Every request to `8444` is charged to a per-IP token bucket before anything
else happens to it, `/metrics` and the Swagger UI included. There are two
buckets and the method picks between them, using the same split as the
role check: `GET`, `HEAD` and `OPTIONS` pay the read bucket, everything
else pays the write bucket, and a method the agent does not recognise pays
the write bucket rather than the cheaper one.

| Tier | Sustained | Burst | Configurable |
|------|-----------|-------|--------------|
| Read | 4 requests/second per IP | 200 | No |
| Write | `write_per_second`, default 1/second per IP | `write_burst`, default 60 | Yes, in [`agent.api_rate_limit`](../configuration/agent.md#write-api-rate-limit) |

The write tier is the same block the open-source agent reads, so a
deployment running both ports tunes one thing rather than two. The read
tier is fixed for the same reason: the configuration carries no read keys,
and inventing a second pair here would mean an operator tuning this port
separately from the one they have already tuned.

Over the burst, the request answers `429 Too Many Requests` with a
`Retry-After` header in seconds and a plain-text body:

```
HTTP/1.1 429 Too Many Requests
retry-after: 1
content-type: text/plain; charset=utf-8

Too Many Requests
```

Three details a client depends on:

- **Loopback is exempt by default**, through `exempt_loopback`. Same-host
  tooling and bulk reconfiguration are never throttled; every other peer is.
- **The bucket is keyed by peer address**, so one noisy client cannot spend
  another's allowance. A peer whose address the server cannot determine is
  keyed under a single shared bucket rather than waved through.
- **Nothing is exempt by path.** Unlike the degraded posture below, the
  limit has no exempt prefix: the HA control plane, the license endpoint
  and the scrape endpoint are all charged. A Prometheus scrape needs to
  fit inside the read tier like any other caller.

The limit sits outside authentication, so a flood that never proves
anything is refused before it costs a signature verification. That is also
why a `429` says nothing about whether the credential was valid or the
route exists.

## Writes while the cluster is degraded

A node running [high availability](../features/enterprise/high-availability.md)
with `degradation_policy: read-only` or `fail-closed` stops accepting
changes for as long as it cannot see its peers. This is a posture of the
node rather than a property of any endpoint, so it applies to the whole
surface and is not repeated in the tables.

While it is in force, every method other than `GET`, `HEAD` and `OPTIONS`
answers `503 Service Unavailable`:

```json
{
  "error": "cluster in read-only degraded mode",
  "code": "HA_READ_ONLY_DEGRADED"
}
```

Reads are served normally throughout, so an integrator polling status or
an operator diagnosing the partition sees the same data as on a healthy
node. Only the paths under `/api/v1/ha` still accept writes, because the
manual failover command is the one write that exists to end the state
being reported on. There is no way to ask for a second exemption: the list
is one prefix compiled into the agent.

Three things follow for a client:

- The refusal is transient and safe to retry. It says the node could not
  replicate the change, not that the request was wrong, so nothing about
  the payload needs fixing before trying again.
- It is the last refusal a request can meet. Rate limiting, authentication,
  the license check and the role check all answer first, so a `503` here
  means the call would otherwise have been carried out.
- A deployment with no `high_availability` block never returns it. There
  is no cluster to be partitioned from, so there is nothing to degrade,
  and the check is skipped entirely rather than answering healthy.

`fail-closed` refuses writes here in exactly the same way, and additionally
closes the datapath. See
[High availability](../features/enterprise/high-availability.md#graceful-degradation)
for what each policy does to traffic.

## Authentication

The enterprise port uses the same credentials as the open-source agent
API: with `auth.enabled: true` every endpoint on `8444` requires either
`Authorization: Bearer <token>` or `X-API-Key: <key>`, and an
unauthenticated call gets `401`. That covers `/metrics`, the Swagger UI
and every endpoint below, so a Prometheus scrape or a fleet agent needs a
credential of its own.

With `auth.enabled: false` the port is open, but nothing can then prove a
role: every caller is treated as an anonymous viewer, and the role-gated
endpoints (tenant administration in particular) stay unavailable. Role
headers are never trusted - the role comes from the verified credential,
not from the request.

## Index by feature

| Feature | Endpoints | Feature guide |
|---------|-----------|---------------|
| [Always mounted](#always-mounted) | 3 | n/a |
| [Open-source surface](#open-source-surface) | 89 | [Enterprise overview](../features/enterprise/overview.md#the-open-source-surface) |
| [Advanced RBAC](#advanced-rbac) | 12 | [Advanced RBAC](../features/enterprise/advanced-rbac.md) |
| [AI and LLM security](#ai-and-llm-security) | 20 | [AI and LLM security](../features/enterprise/ai-security.md) |
| [Air-gap](#air-gap) | 4 | [Air-gap](../features/enterprise/airgap.md) |
| [Advanced analytics](#advanced-analytics) | 9 | [Advanced analytics](../features/enterprise/analytics.md) |
| [Automated response](#automated-response) | 8 | [Automated response](../features/enterprise/automated-response.md) |
| [Compliance reports](#compliance-reports) | 9 | [Compliance reports](../features/enterprise/compliance-reports.md) |
| [Content channel](#content-channel) | 3 | [Content channel](../features/enterprise/content-channel.md) |
| [Data loss prevention](#data-loss-prevention) | 8 | [Data loss prevention](../features/enterprise/dlp.md) |
| [Fleet management](#fleet-management) | 9 | [Fleet management](../features/enterprise/fleet-management.md) |
| [High availability](#high-availability) | 6 | [High availability](../features/enterprise/high-availability.md) |
| [L7 alert enrichment](#l7-alert-enrichment) | 1 | [L7 alert enrichment](../features/enterprise/l7-alert-enrichment.md) |
| [L7 deep inspection](#l7-deep-inspection) | 12 | [L7 deep inspection](../features/enterprise/l7-deep-inspection.md) |
| [L7 per-protocol policies](#l7-per-protocol-policies) | 13 | [L7 per-protocol policies](../features/enterprise/l7-per-protocol-policies.md) |
| [Licensing](#licensing) | 1 | [Licensing](../features/enterprise/license.md) |
| [ML detection](#ml-detection) | 21 | [ML detection](../features/enterprise/ml-detection.md) |
| [Multi-cluster federation](#multi-cluster-federation) | 17 | [Multi-cluster federation](../features/enterprise/multicluster.md) |
| [Multi-tenancy](#multi-tenancy) | 13 | [Multi-tenancy](../features/enterprise/multitenancy.md) |
| [Network forensics](#network-forensics) | 14 | [Network forensics](../features/enterprise/network-forensics.md) |
| [SIEM integration](#siem-integration) | 2 | [SIEM integration](../features/enterprise/siem-integration.md) |
| [Threat intelligence platforms](#threat-intelligence-platforms) | 2 | [Threat intelligence platforms](../features/enterprise/threat-intel-platforms.md) |
| [TLS intelligence](#tls-intelligence) | 22 | [TLS intelligence](../features/enterprise/tls-intelligence.md) |

## Always mounted

Mounted whatever the license carries, on every enterprise agent.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/alerts` | viewer | `alerts:read` | none | Query the OSS datapath alert store. |
| `GET` | `/api/v1/alerts/{id}` | viewer | `alerts:read` | none | Read one stored alert by identifier. |
| `PATCH` | `/api/v1/alerts/{id}/triage` | operator | `alerts:write` | none | Set one alert's status or assignee, or append a note. |
| `POST` | `/api/v1/alerts/triage` | operator | `alerts:write` | none | Apply one triage change to at most 1000 alerts. |
| `GET` | `/api/v1/ebpf/kernel-features` | viewer | `config:read` | none | Return what the startup helper probe learned about this kernel. |
| `GET` | `/api/v1/ebpf/hidden-ports` | viewer | `config:read` | none | Return the last hidden-port sweep, the same body as the open-source agent; an empty answer means the sweep is off in the configuration. |
| `GET` | `/api/v1/ebpf/hidden-processes` | viewer | `config:read` | none | Return the last hidden-process sweep, the same body as the open-source agent; an empty answer means the sweep is off in the configuration. |
| `GET` | `/metrics` | none | `none` | none | Returns `OpenMetrics` text output for every metric this process keeps: the enterprise registry and the datapath's open-source one, in one exposition. |
| `GET` | `/healthz` | none | `none` | none | Liveness probe. `200` while the process is running. |
| `GET` | `/readyz` | none | `none` | none | Readiness probe. `200` once this node is doing what its role asks of it, `503` otherwise. |

`/readyz` answers what this edition can be asked to do rather than what the
open-source agent can:

```json
{
  "status": "ready",
  "datapath": "active",
  "ebpf_loaded": true
}
```

`datapath` is `active` on a node driving the eBPF programs, `standby` on a node
that lost the HA election, and `absent` where no datapath was built at all. A
standby answers `200`: it drives no datapath on purpose, and reporting it not
ready would pull its peer gRPC out of the service its peers find it through.
An `absent` datapath is a fault and answers `503`. On an active node, a refused
attach or a missing kernel helper also answers `503` and repeats the list in
`attach_blocked` and `kernel_helpers_missing`; both fields are left out when
empty. So does a stalled datapath, reported as `datapath_stalled_secs`: the
programs are loaded and the task draining their ring buffers has stopped
passing over them, which it otherwise does every 10 ms whether or not traffic
arrived. A standby is never judged on that reading - it drains nothing by
design, so the field is left out there whatever the process last recorded.

## Open-source surface

The routes of the open-source agent this edition serves, with the
open-source handlers and the same bodies, so the
[REST API](rest-api.md) reference describes each request and response.
They are mounted whatever the license carries, as long as the open-source
datapath services were built from the configuration; the role and the grant
are this edition's, decided by the same middleware as every other route.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/agent/status` | viewer | `config:read` | none | Returns the current agent status including version, uptime, and eBPF state. |
| `GET` | `/api/v1/aliases/status` | viewer | `firewall:read` | none | Alias service status. |
| `PUT` | `/api/v1/aliases/{id}/content` | operator | `firewall:write` | none | Push content for an External alias. |
| `GET` | `/api/v1/config` | viewer | `config:read` | none | Return the current (sanitized) agent configuration. |
| `POST` | `/api/v1/config/reload` | operator | `config:write` | none | Trigger a configuration reload via the API. |
| `PUT` | `/api/v1/config/{section}` | operator | `config:write` | none | Write one section of the agent configuration file and reload. |
| `GET` | `/api/v1/conntrack/connections` | viewer | `conntrack:read` | none | List tracked connections. |
| `POST` | `/api/v1/conntrack/flush` | operator | `conntrack:write` | none | Flush all tracked connections. |
| `GET` | `/api/v1/conntrack/status` | viewer | `conntrack:read` | none | Connection tracking status. |
| `GET` | `/api/v1/ddos/attacks` | viewer | `ddos:read` | none | List active `DDoS` attacks. |
| `GET` | `/api/v1/ddos/attacks/history` | viewer | `ddos:read` | none | Attack history. |
| `GET` | `/api/v1/ddos/policies` | viewer | `ddos:read` | none | List `DDoS` policies. |
| `POST` | `/api/v1/ddos/policies` | operator | `ddos:write` | none | Create a `DDoS` policy. |
| `DELETE` | `/api/v1/ddos/policies/{id}` | operator | `ddos:write` | none | Delete a `DDoS` policy. |
| `GET` | `/api/v1/ddos/status` | viewer | `ddos:read` | none | `DDoS` protection status. |
| `GET` | `/api/v1/dns/blocklist` | viewer | `dns:read` | none | List loaded blocklist rules. |
| `GET` | `/api/v1/dns/cache` | viewer | `dns:read` | none | List DNS cache entries. |
| `DELETE` | `/api/v1/dns/cache` | operator | `dns:write` | none | Flush the DNS cache. |
| `GET` | `/api/v1/dns/stats` | viewer | `dns:read` | none | DNS cache and blocklist statistics. |
| `GET` | `/api/v1/dns/status` | viewer | `dns:read` | none | DNS intelligence subsystem status. |
| `POST` | `/api/v1/domains/blocklist` | operator | `dns:write` | none | Add a domain to the runtime blocklist. |
| `DELETE` | `/api/v1/domains/blocklist/{domain}` | operator | `dns:write` | none | Remove a domain from the runtime blocklist. |
| `GET` | `/api/v1/ebpf/coverage` | viewer | `config:read` | none | What the agent sees of each pod on this node. |
| `GET` | `/api/v1/ebpf/foreign-programs` | viewer | `config:read` | none | Who else has a program on the network path. |
| `GET` | `/api/v1/ebpf/raw-sockets` | viewer | `config:read` | none | Who else reads the node's traffic. |
| `GET` | `/api/v1/ebpf/status` | viewer | `config:read` | none | Return the load status of each eBPF program. |
| `GET` | `/api/v1/firewall/rules` | viewer | `firewall:read` | none | List all active rules. |
| `POST` | `/api/v1/firewall/rules` | operator | `firewall:write` | none | Create a new rule. |
| `DELETE` | `/api/v1/firewall/rules/{id}` | operator | `firewall:write` | none | Delete a rule by ID. |
| `GET` | `/api/v1/firewall/workload/fqdn` | viewer | `firewall:read` | none | What the rules naming destinations by name have resolved, and what is still open. |
| `GET` | `/api/v1/firewall/workload/labels` | viewer | `firewall:read` | none | The containers whose labels carry policy, the rules each produced and any label refused. |
| `GET` | `/api/v1/firewall/workload/reach` | viewer | `firewall:read` | none | What the workload policy lets a workload reach. |
| `GET` | `/api/v1/firewall/workload/rules` | viewer | `firewall:read` | none | The workload rules in force and what each has refused. |
| `GET` | `/api/v1/geoip/lookup` | viewer | `config:read` | none | Resolve an IP to `GeoIP` info. |
| `GET` | `/api/v1/geoip/status` | viewer | `config:read` | none | `GeoIP` enrichment status. |
| `GET` | `/api/v1/ids/rules` | viewer | `ids:read` | none | List all IDS rules. |
| `GET` | `/api/v1/ids/status` | viewer | `ids:read` | none | IDS service status. |
| `GET` | `/api/v1/ids/suricata/report` | viewer | `ids:read` | none | What the imported Suricata rulesets compiled to. |
| `GET` | `/api/v1/ips/blacklist` | viewer | `ips:read` | none | List current IPS blacklist entries. |
| `POST` | `/api/v1/ips/blacklist` | operator | `ips:write` | none | Manually add an IP to the IPS blacklist. |
| `DELETE` | `/api/v1/ips/blacklist/{ip}` | operator | `ips:write` | none | Remove an IP from the IPS blacklist. |
| `GET` | `/api/v1/ips/domain-blocks` | viewer | `ips:read` | none | List IPS blacklist entries originating from domain mechanisms. |
| `GET` | `/api/v1/ips/rules` | viewer | `ips:read` | none | List all IPS rules. |
| `PATCH` | `/api/v1/ips/rules/{id}` | operator | `ips:write` | none | Toggle a rule's mode. |
| `GET` | `/api/v1/lb/services` | viewer | `loadbalancer:read` | none | List LB services. |
| `POST` | `/api/v1/lb/services` | operator | `loadbalancer:write` | none | Create an LB service. |
| `GET` | `/api/v1/lb/services/{id}` | viewer | `loadbalancer:read` | none | Get LB service detail. |
| `DELETE` | `/api/v1/lb/services/{id}` | operator | `loadbalancer:write` | none | Delete an LB service. |
| `GET` | `/api/v1/lb/status` | viewer | `loadbalancer:read` | none | Load balancer status. |
| `GET` | `/api/v1/mitre/coverage` | viewer | `config:read` | none | MITRE ATT&CK coverage matrix. |
| `GET` | `/api/v1/nat/nptv6` | viewer | `nat:read` | none | List `NPTv6` rules. |
| `POST` | `/api/v1/nat/nptv6` | operator | `nat:write` | none | Create an `NPTv6` rule. |
| `DELETE` | `/api/v1/nat/nptv6/{id}` | operator | `nat:write` | none | Delete an `NPTv6` rule. |
| `GET` | `/api/v1/nat/rules` | viewer | `nat:read` | none | List NAT rules. |
| `GET` | `/api/v1/nat/status` | viewer | `nat:read` | none | NAT status. |
| `GET` | `/api/v1/processes` | viewer | `config:read` | none | The processes alive on this node. |
| `GET` | `/api/v1/processes/{pid}` | viewer | `config:read` | none | One process, by pid. |
| `GET` | `/api/v1/qos/classifiers` | viewer | `qos:read` | none | List all `QoS` classifiers. |
| `POST` | `/api/v1/qos/classifiers` | operator | `qos:write` | none | Create a new `QoS` classifier. |
| `DELETE` | `/api/v1/qos/classifiers/{id}` | operator | `qos:write` | none | Delete a `QoS` classifier. |
| `GET` | `/api/v1/qos/pipes` | viewer | `qos:read` | none | List all `QoS` pipes. |
| `POST` | `/api/v1/qos/pipes` | operator | `qos:write` | none | Create a new `QoS` pipe. |
| `DELETE` | `/api/v1/qos/pipes/{id}` | operator | `qos:write` | none | Delete a `QoS` pipe. |
| `GET` | `/api/v1/qos/queues` | viewer | `qos:read` | none | List all `QoS` queues. |
| `POST` | `/api/v1/qos/queues` | operator | `qos:write` | none | Create a new `QoS` queue. |
| `DELETE` | `/api/v1/qos/queues/{id}` | operator | `qos:write` | none | Delete a `QoS` queue. |
| `GET` | `/api/v1/qos/status` | viewer | `qos:read` | none | `QoS` service status. |
| `GET` | `/api/v1/ratelimit/rules` | viewer | `ratelimit:read` | none | List all rate limit rules. |
| `POST` | `/api/v1/ratelimit/rules` | operator | `ratelimit:write` | none | Create a new rate limit rule. |
| `DELETE` | `/api/v1/ratelimit/rules/{id}` | operator | `ratelimit:write` | none | Delete a rate limit rule. |
| `GET` | `/api/v1/routing/gateways` | viewer | `routing:read` | none | List routing gateways. |
| `POST` | `/api/v1/routing/gateways` | operator | `routing:write` | none | Add a routing gateway. |
| `DELETE` | `/api/v1/routing/gateways/{id}` | operator | `routing:write` | none | Remove a routing gateway. |
| `GET` | `/api/v1/routing/routes` | viewer | `routing:read` | none | Effective default route(s) from gateway selection. |
| `GET` | `/api/v1/routing/status` | viewer | `routing:read` | none | Routing status. |
| `GET` | `/api/v1/surface` | viewer | `config:read` | none | This host's surface: what is installed, what runs, what listens, what is reachable and what the policy blocks. |
| `GET` | `/api/v1/surface/listening` | viewer | `config:read` | none | Every listener with the packages its process maps, the traffic it took and who may reach it. |
| `GET` | `/api/v1/surface/loaded` | viewer | `config:read` | none | Every file live processes map executable, once per root, and the package owning it. |
| `GET` | `/api/v1/surface/packages` | viewer | `config:read` | none | What the package managers say is installed, in the host's root and every container's. |
| `GET` | `/api/v1/threatintel/iocs` | viewer | `threatintel:read` | none | List loaded IOCs. |
| `GET` | `/api/v1/threatintel/status` | viewer | `threatintel:read` | none | Threat intel subsystem status. |
| `GET` | `/api/v1/threatintel/urls` | viewer | `threatintel:read` | none | List malicious URL indicators ingested from CTI feeds. The threat-intel engine is IP-only, so URL indicators are surfaced from the service's retained snapshot. |
| `GET` | `/api/v1/zones` | viewer | `firewall:read` | none | List security zones. |
| `POST` | `/api/v1/zones` | operator | `firewall:write` | none | Create a security zone. |
| `GET` | `/api/v1/zones/policies` | viewer | `firewall:read` | none | List inter-zone policies. |
| `POST` | `/api/v1/zones/policies` | operator | `firewall:write` | none | Create an inter-zone policy. |
| `DELETE` | `/api/v1/zones/policies/{id}` | operator | `firewall:write` | none | Remove an inter-zone policy. |
| `GET` | `/api/v1/zones/status` | viewer | `firewall:read` | none | Zone service status. |
| `DELETE` | `/api/v1/zones/{id}` | operator | `firewall:write` | none | Remove a security zone. |

The open-source routes not listed here answer `404 Not Found`. Some are
replaced by a surface of this edition: alert streaming by the SIEM exporters
and the federation stream, false-positive marking by
`PATCH /api/v1/alerts/{id}/triage`, the audit trail by
`/api/v1/enterprise/audit`, packet capture by `/api/v1/enterprise/forensics`,
DLP by `/api/v1/enterprise/dlp`, TLS probes, fingerprints and TLS posture by
`/api/v1/enterprise/tls-probes` and `/api/v1/enterprise/tls-intelligence`,
L7 rules by `/api/v1/enterprise/l7`, responses by
`/api/v1/enterprise/response`, the service graph by `/api/v1/flows/graph`
and the threat-intel feed cycle by `/api/v1/intel` and the air-gap bundles.
The rest belong to services this edition does not start: the VIP announcer
(`/api/v1/lb/vips`), the connection event poller, domain reputation, the
kernel drop counter outside an investigation, guest attribution, policy
learning, network policy replay, packet tracing and QoS shaping.

## Advanced RBAC

License feature: `advanced-rbac`. See
[Advanced RBAC](../features/enterprise/advanced-rbac.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/rbac/assignments` | admin | `config:admin` | advanced-rbac | Assign role to subject (201). |
| `DELETE` | `/api/v1/rbac/assignments` | admin | `config:admin` | advanced-rbac | Deprecated, kept for one release: remove role from subject (204). The body is optional; `?subject=&role_id=` does the same. |
| `GET` | `/api/v1/rbac/assignments/{subject}` | viewer | `config:read` | advanced-rbac | List roles for subject. |
| `DELETE` | `/api/v1/rbac/assignments/{subject}/{role_id}` | admin | `config:admin` | advanced-rbac | Remove role from subject (204). No request body. |
| `POST` | `/api/v1/rbac/check` | operator | `config:write` | advanced-rbac | Check permission (`{ role_id, domain, permission, resource_id? }`). |
| `POST` | `/api/v1/rbac/filter` | operator | `config:write` | advanced-rbac | Filter accessible resources (`{ role_id, domain, resource_ids }`). |
| `GET` | `/api/v1/rbac/roles` | viewer | `config:read` | advanced-rbac | List all roles. |
| `POST` | `/api/v1/rbac/roles` | admin | `config:admin` | advanced-rbac | Create custom role (201). |
| `PUT` | `/api/v1/rbac/roles` | admin | `config:admin` | advanced-rbac | Deprecated, kept for one release: same as `POST /api/v1/rbac/roles/reload`. |
| `POST` | `/api/v1/rbac/roles/reload` | admin | `config:admin` | advanced-rbac | Bulk reload all custom roles (atomic). |
| `GET` | `/api/v1/rbac/roles/{id}` | viewer | `config:read` | advanced-rbac | Role details (404 if not found). |
| `PUT` | `/api/v1/rbac/roles/{id}` | admin | `config:admin` | advanced-rbac | Update custom role (403 for built-in). |
| `DELETE` | `/api/v1/rbac/roles/{id}` | admin | `config:admin` | advanced-rbac | Delete custom role (403 for built-in, 409 if another role inherits from it, 204 on success). Assignments naming it go with it. |
| `GET` | `/api/v1/rbac/roles/{id}/effective-grants` | viewer | `config:read` | advanced-rbac | Resolved grants with inheritance. |

## AI and LLM security

License feature: `ai-llm-security`. See
[AI and LLM security](../features/enterprise/ai-security.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/ai-security/agent-traffic` | viewer | `config:read` | ai-llm-security | Which workload reached which model provider or MCP server. |
| `GET` | `/api/v1/enterprise/ai-security/agent-traffic/policy` | viewer | `config:read` | ai-llm-security | Current agent traffic rules and thresholds. |
| `PUT` | `/api/v1/enterprise/ai-security/agent-traffic/policy` | operator | `config:write` | ai-llm-security | Replace the agent traffic rules and thresholds. |
| `GET` | `/api/v1/enterprise/ai-security/ai-dlp/patterns` | viewer | `config:read` | ai-llm-security | List the prompt inspection patterns. |
| `POST` | `/api/v1/enterprise/ai-security/ai-dlp/patterns` | operator | `config:write` | ai-llm-security | Add a prompt inspection pattern. |
| `DELETE` | `/api/v1/enterprise/ai-security/ai-dlp/patterns/{id}` | operator | `config:write` | ai-llm-security | Remove a prompt inspection pattern. |
| `GET` | `/api/v1/enterprise/ai-security/alerts` | viewer | `config:read` | ai-llm-security | List AI security alerts. |
| `GET` | `/api/v1/enterprise/ai-security/encrypted-dns/detections` | viewer | `config:read` | ai-llm-security | Encrypted DNS policy decisions taken on submitted events. |
| `GET` | `/api/v1/enterprise/ai-security/encrypted-dns/policy` | viewer | `config:read` | ai-llm-security | Current DoH and DoT handling policy. |
| `PUT` | `/api/v1/enterprise/ai-security/encrypted-dns/policy` | operator | `config:write` | ai-llm-security | Replace the DoH and DoT handling policy. |
| `POST` | `/api/v1/enterprise/ai-security/events` | operator | `config:write` | ai-llm-security | Process a connection event. |
| `GET` | `/api/v1/enterprise/ai-security/exfiltration/sources` | viewer | `config:read` | ai-llm-security | Sources ranked by outbound volume to AI providers. |
| `GET` | `/api/v1/enterprise/ai-security/exfiltration/thresholds` | viewer | `config:read` | ai-llm-security | Current exfiltration volume thresholds. |
| `PUT` | `/api/v1/enterprise/ai-security/exfiltration/thresholds` | operator | `config:write` | ai-llm-security | Replace the exfiltration volume thresholds. |
| `GET` | `/api/v1/enterprise/ai-security/providers` | viewer | `config:read` | ai-llm-security | List the known AI provider destinations. |
| `POST` | `/api/v1/enterprise/ai-security/providers` | operator | `config:write` | ai-llm-security | Add an AI provider destination. |
| `DELETE` | `/api/v1/enterprise/ai-security/providers/{id}` | operator | `config:write` | ai-llm-security | Remove an AI provider destination. |
| `GET` | `/api/v1/enterprise/ai-security/shadow-ai/detections` | viewer | `config:read` | ai-llm-security | Unsanctioned AI service use seen on the estate. |
| `GET` | `/api/v1/enterprise/ai-security/shadow-ai/policy` | viewer | `config:read` | ai-llm-security | Current shadow AI policy. |
| `PUT` | `/api/v1/enterprise/ai-security/shadow-ai/policy` | operator | `config:write` | ai-llm-security | Replace the shadow AI policy. |
| `GET` | `/api/v1/enterprise/ai-security/status` | viewer | `config:read` | ai-llm-security | AI security engine state and counters. |

## Air-gap

License feature: `air-gap`. See
[Air-gap](../features/enterprise/airgap.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/airgap/bundles` | viewer | `config:read` | air-gap | List imported bundles (version + created_at_ms). |
| `POST` | `/api/v1/airgap/check-freshness` | operator | `config:write` | air-gap | Validate bundle freshness. |
| `POST` | `/api/v1/airgap/import` | operator | `config:write` | air-gap | Import a bundle (200 with `status: ok/skipped/error`). |
| `GET` | `/api/v1/airgap/status` | viewer | `config:read` | air-gap | Air-gap mode status (enabled, features_disabled, bundle_dir, last_import, count). |

## Advanced analytics

License feature: `advanced-analytics`. See
[Advanced analytics](../features/enterprise/analytics.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/analytics/alerts` | viewer | `config:read` | advanced-analytics | Alert summary by severity and component. Query: `period` (default 24h) or `start_ms` + `end_ms`. |
| `GET` | `/api/v1/analytics/flows` | viewer | `config:read` | advanced-analytics | Individual flow records held in memory, newest first. Query: `period` (default 24h) or `start_ms` + `end_ms`, `src_ip`, `dst_ip`, `src_port`, `dst_port`, `protocol`, `severity`, `component`, `limit`, `offset`, `sort_order`. |
| `GET` | `/api/v1/analytics/ioc` | viewer | `config:read` | advanced-analytics | IOC hit summary by threat type. Query: `period` (default 24h) or `start_ms` + `end_ms`. |
| `GET` | `/api/v1/analytics/status` | viewer | `config:read` | advanced-analytics | Pipeline status. |
| `GET` | `/api/v1/analytics/top-talkers` | viewer | `config:read` | advanced-analytics | Top talkers with window-over-window deltas. Query: `period` (default 24h) or `start_ms` + `end_ms`, `limit` (default 20). |
| `GET` | `/api/v1/analytics/trends` | viewer | `config:read` | advanced-analytics | Trend report (JSON). Query: `period` (minimum 7d). |
| `GET` | `/api/v1/analytics/trends/csv` | viewer | `config:read` | advanced-analytics | Trend report (CSV). Query: `period` (minimum 7d). |
| `GET` | `/api/v1/analytics/trends/history` | viewer | `config:read` | advanced-analytics | Cached daily trend reports (up to 30). |
| `GET` | `/api/v1/analytics/trends/text` | viewer | `config:read` | advanced-analytics | Trend report (text). Query: `period` (minimum 7d). |

## Automated response

License feature: `automated-response`. See
[Automated response](../features/enterprise/automated-response.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/response/approvals` | viewer | `config:read` | automated-response | Actions waiting for a person, oldest first. |
| `POST` | `/api/v1/enterprise/response/approvals/{id}/approve` | operator | `config:write` | automated-response | Take a waiting action. `403` for a request naming nobody, `404` when nothing waits under the id. |
| `POST` | `/api/v1/enterprise/response/approvals/{id}/refuse` | operator | `config:write` | automated-response | Decline a waiting action. `404` when nothing waits under the id. |
| `GET` | `/api/v1/enterprise/response/audit` | viewer | `config:read` | automated-response | Query the audit trail, newest first. |
| `GET` | `/api/v1/enterprise/response/policies` | viewer | `config:read` | automated-response | List all response policies. |
| `POST` | `/api/v1/enterprise/response/policies` | operator | `config:write` | automated-response | Create a response policy. |
| `DELETE` | `/api/v1/enterprise/response/policies/{id}` | operator | `config:write` | automated-response | Delete a response policy. |
| `GET` | `/api/v1/enterprise/response/status` | viewer | `config:read` | automated-response | Service status (active policies, webhooks, cooldowns, audit depth). |
| `GET` | `/api/v1/enterprise/response/webhooks` | viewer | `config:read` | automated-response | List all webhook endpoints. |
| `POST` | `/api/v1/enterprise/response/webhooks` | operator | `config:write` | automated-response | Create a webhook endpoint. |
| `DELETE` | `/api/v1/enterprise/response/webhooks/{id}` | operator | `config:write` | automated-response | Delete a webhook endpoint. |

## Compliance reports

License feature: `compliance-reports`. See
[Compliance reports](../features/enterprise/compliance-reports.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/compliance/reports` | viewer | `config:read` | compliance-reports | List reports (summary views, newest first). |
| `POST` | `/api/v1/compliance/reports` | operator | `config:write` | compliance-reports | Generate a new report (`{ framework, period_start_ms, period_end_ms, format }`). |
| `GET` | `/api/v1/compliance/reports/{id}` | viewer | `config:read` | compliance-reports | Fetch full report (JSON). |
| `GET` | `/api/v1/compliance/reports/{id}/csv` | viewer | `config:read` | compliance-reports | Export as CSV (attachment: `report.csv`). |
| `GET` | `/api/v1/compliance/reports/{id}/pdf` | viewer | `config:read` | compliance-reports | Export as PDF (attachment: `compliance-report.pdf`). |
| `GET` | `/api/v1/compliance/reports/{id}/text` | viewer | `config:read` | compliance-reports | Export as structured text. |
| `POST` | `/api/v1/compliance/segmentation/validate` | operator | `config:write` | compliance-reports | Validate a network segmentation policy (zones, allowed flows). |
| `GET` | `/api/v1/compliance/crypto/report` | viewer | `config:read` | compliance-reports | The network's cryptography as a migration report: edges most urgent first, every algorithm negotiated. |
| `GET` | `/api/v1/compliance/crypto/cbom` | viewer | `config:read` | compliance-reports | The same reading as a CycloneDX 1.6 cryptography bill of materials. |

## Content channel

License feature: `content-channel`. Mounted only where the configuration carries
an enabled `content` block, so an agent with the feature and no block serves
none of the three. See
[Content channel](../features/enterprise/content-channel.md) for the bundle
format and for what the agent does on an interval.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/content/status` | viewer | `config:read` | content-channel | The content in force: bundle version, each set's version, publication date, entry count, the version a rollback would return to and whether it is pinned, and how many fetches have failed in a row. |
| `POST` | `/api/v1/content/import` | operator | `config:write` | content-channel | Verify a bundle in a local directory and put it in force (`{ bundle_dir, verify_only? }`). `400` refuses the bundle and changes nothing. |
| `POST` | `/api/v1/content/rollback` | operator | `config:write` | content-channel | Put one set back to the version it replaced (`{ set }`). `400` if no earlier version of that set is kept. A pinned set stays pinned at the version it went back to. |
| `POST` | `/api/v1/content/pin` | operator | `config:write` | content-channel | Hold one set at the version in force so no bundle replaces it (`{ set }`). `400` if nothing of that set is applied. |
| `POST` | `/api/v1/content/unpin` | operator | `config:write` | content-channel | Release a pinned set (`{ set }`). `400` if the set is not pinned. |

None of these fetches anything on request: the fetch is on the interval the
configuration sets, and `import` reads a directory this machine already holds.
That is deliberate - it is what an air-gapped estate uses, and it is why no
request body here takes a URL.

`import` answers `200` for a verified bundle and says what became of each set
rather than one verdict for the lot: a set this build is too old to read, or one
that is not newer than what is in force, is reported as left alone beside the
ones that were applied.

## Data loss prevention

License feature: `advanced-dlp`. See
[Data loss prevention](../features/enterprise/dlp.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/dlp/patterns` | viewer | `dlp:read` | advanced-dlp | List all DLP patterns. |
| `POST` | `/api/v1/enterprise/dlp/patterns` | operator | `dlp:write` | advanced-dlp | Add a custom pattern. |
| `DELETE` | `/api/v1/enterprise/dlp/patterns/{id}` | operator | `dlp:write` | advanced-dlp | Remove a custom pattern. |
| `PATCH` | `/api/v1/enterprise/dlp/patterns/{id}/mode` | operator | `dlp:write` | advanced-dlp | Change pattern mode. |
| `GET` | `/api/v1/enterprise/dlp/status` | viewer | `dlp:read` | advanced-dlp | Enterprise DLP engine status. |
| `GET` | `/api/v1/enterprise/tls-probes/plans` | viewer | `config:read` | tls-intelligence | Full latest `ScanResult`: every `(library, binary_path, pids, symbol offsets, build_id, kernel_hook)` tuple plus the raw kTLS counters read from `/proc/net/tls_stat`. A plan with null offsets carries `no_probe_reason`, the sentence saying why nothing is attached for that library; it is null for a library that is probed. |
| `GET` | `/api/v1/enterprise/tls-probes/status` | viewer | `config:read` | tls-intelligence | High-level scanner health: last scan timestamp (ns), last scan duration (seconds), number of processes scanned, total discovered plans, `ktls_active` flag. |
| `GET` | `/api/v1/enterprise/tls-probes/warnings` | viewer | `config:read` | tls-intelligence | Warnings collected during the most recent scan (invalid ELF, missing symbol, `/proc` read failure, …). |
| `GET` | `/api/v1/enterprise/tls-probes/coverage` | viewer | `config:read` | tls-intelligence | What this host's DLP reads and what it does not: one entry per process carrying TLS, uncovered first, with a verdict per surface (`covered` plus the `means`, or the `gap` with the reason, the remedy and the build id to send), the share of surfaces read in thousandths, the build ids behind every uncovered surface, and `catalogue`, the state of the offset catalogue for stripped builds (`absent`, `in_force` with its version and entry count, or `refused` with the reason). Absent fields are absent rather than null. |
| `GET` | `/api/v1/enterprise/tls-probes/redirect` | viewer | `config:read` | tls-intelligence | What the TLS connection redirect selects, served in dry run and in force alike: `mode` (`enforcing` or `dry_run`), `selected_cgroups`, `not_ready`, `anchor` (`sha256`, `pem`) and `processes`, each with `pid`, `exe`, `cgroup`, `trust_anchor` (`installed` with `trust_store`, `missing` with `stores_checked`, or `unknown`), `pinning` (`spki_pin`, `embedded_certificate`) and `verdict` (`ready`, `appears_to_pin`, `anchor_missing`, `unknown`), not ready first. Mounted only when the redirect is configured. |

## Fleet management

License feature: `fleet-management`. See
[Fleet management](../features/enterprise/fleet-management.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/agent/addresses` | viewer | `config:read` | fleet-management | This node's addresses and who holds each, as what changed since `?epoch=&since=`, or the whole list; `503` without a process table. |
| `GET` | `/api/v1/agent/config/version` | viewer | `config:read` | fleet-management | Config SHA-256 hash, when it was applied, whether the file has moved since. |
| `POST` | `/api/v1/agent/heartbeat` | operator | `config:write` | fleet-management | Report status, receive aggregated health. |
| `GET` | `/api/v1/agent/identity` | viewer | `config:read` | fleet-management | Full agent identity with capabilities. |
| `POST` | `/api/v1/agent/register` | operator | `config:write` | fleet-management | Register agent, get UUIDv7 identity + token. |
| `GET` | `/api/v1/agent/remote-identities` | viewer | `config:read` | fleet-management | The peer list the console handed this node: version, age, entry and conflict counts, and the entry for `?address=`. |
| `PUT` | `/api/v1/agent/remote-identities` | operator | `config:write` | fleet-management | Replace the peer list whole; `422` and the previous list kept when any entry is refused. |
| `GET` | `/api/v1/flows/graph` | viewer | `config:read` | fleet-management | Network flow graph from conntrack data. |
| `GET` | `/api/v1/flows/reachability` | viewer | `config:read` | fleet-management | SBOMs held per workload and workloads observed originating flows, with the unattributed flow count. |
| `GET` | `/api/v1/flows/reachability/report` | viewer | `config:read` | fleet-management | One workload's SBOM joined with its outbound flows (`?workload=`); `404` when no SBOM is held. Correlation, with its limits in the answer. |
| `PUT` | `/api/v1/flows/reachability/sbom` | operator | `config:write` | fleet-management | Keep a CycloneDX or SPDX JSON document (at most 32 MiB) as the SBOM of `?workload=`. |
| `DELETE` | `/api/v1/flows/reachability/sbom` | operator | `config:write` | fleet-management | Forget the SBOM of `?workload=`. |
| `GET` | `/api/v1/flows/reachability/scanner-reports` | viewer | `config:read` | fleet-management | The scanner reports held, each with its findings counted against the packages installed now. |
| `GET` | `/api/v1/flows/reachability/scanner-reports/report` | viewer | `config:read` | fleet-management | One scanner report (`?name=`), each finding joined with the installed package it names or the reason it is not, and every record not read; `404` when none is held. |
| `GET` | `/api/v1/flows/reachability/scanner-reports/evidence` | viewer | `config:read` | fleet-management | The evidence pack of one scanner report (`?name=`) for an auditor: what the scanner asserted and what the agent observed as two statements, digested and chained into the forensics custody log when one is kept; `404` when none is held. |
| `PUT` | `/api/v1/flows/reachability/scanner-reports` | operator | `config:write` | fleet-management | Keep a CycloneDX, SPDX, Trivy, Grype or Harbor JSON report (at most 64 MiB) under `?name=`. |
| `DELETE` | `/api/v1/flows/reachability/scanner-reports` | operator | `config:write` | fleet-management | Forget the scanner report held under `?name=`. |
| `GET` | `/api/v1/exposure/listeners` | viewer | `config:read` | fleet-management | Sockets the node accepts traffic on, the workload that bound each, who may reach it and whether anybody did; the same body as the open source agent. |
| `GET` | `/api/v1/firewall/workload/peers` | viewer | `firewall:read` | fleet-management | Rules naming a workload on another node, whether the node a connection arrives at decides each too (`both`) or only the node it leaves (`source`, with the reason), and the version of the remote list the tables were written from. |
| `GET` | `/api/v1/firewall/shadow` | viewer | `firewall:read` | fleet-management | What each firewall rule in shadow mode would have done since its counters started; the same body as the open source agent. |
| `POST` | `/api/v1/firewall/shadow/{id}/promote` | operator | `firewall:write` | fleet-management | Put one shadow rule in force on the reading it was decided on; `409` when that reading is stale or the rule is not in shadow, `404` when no rule carries the id. Recorded in the audit log. |
| `GET` | `/api/v1/file-watch/baselines` | viewer | `config:read` | fleet-management | The fingerprint of every file this node keeps beneath its watched paths (kind, content digest, link target, mode, owner, extended attribute digests, never content), in the shape an expected state is written in, at most 10000 with `truncated`; `409` when the file watch is off. |
| `GET` | `/api/v1/host-rules` | viewer | `config:read` | fleet-management | The loaded host rules, whether this host serves each and, for a rule in shadow, what it would have done; the same body as the open source agent. |
| `GET` | `/api/v1/host-rules/intents` | viewer | `config:read` | fleet-management | Every intention a host rule may name and whether this host serves it; the same body as the open source agent. |
| `GET` | `/api/v1/host-rules/mass-encryption` | viewer | `config:read` | fleet-management | The mass encryption verdict's mode and the verdicts it reached in shadow, by workload; the same body as the open source agent. |
| `GET` | `/api/v1/host-rules/write-refusal` | viewer | `config:read` | fleet-management | The write refusal's mode, when its reading started and the writes it would have refused in shadow, by workload; the same body as the open source agent. |
| `POST` | `/api/v1/host-rules/write-refusal/promote` | operator | `config:write` | fleet-management | Put the write refusal in force on the reading it was decided on, without a restart; `409` when that reading is stale or it already refuses, `404` when no refusal runs. Recorded in the audit log. |
| `POST` | `/api/v1/host-rules/{id}/promote` | operator | `config:write` | fleet-management | Put one host rule in shadow in force on the reading it was decided on; `409` when that reading is stale, the rule is already in force, or it stops a process and this agent cannot, `404` when no rule carries the id. Recorded in the audit log. |
| `GET` | `/api/v1/firewall/tiers` | viewer | `firewall:read` | fleet-management | The firewall tiers in evaluation order, each with its priority band, the ids of its rules and whether it is the provider's, which only the provider's role may change. |

## High availability

License feature: `high-availability`. See
[High availability](../features/enterprise/high-availability.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/ha/failover` | operator | `config:write` | high-availability | Manual failover (leader only, 409 Conflict if not leader or no peers). |
| `GET` | `/api/v1/ha/health` | viewer | `config:read` | high-availability | Cluster health (health, degradation_policy, is_degraded) plus one entry per peer carrying addr, failure_count and reachable. No `ha_mode`: that is on `/api/v1/ha/status`. |
| `GET` | `/api/v1/ha/interfaces` | viewer | `config:read` | high-availability | Interface assignments and ownership status (active_active mode). |
| `GET` | `/api/v1/ha/peers` | viewer | `config:read` | high-availability | Peer list with addresses. |
| `GET` | `/api/v1/ha/replication` | viewer | `config:read` | high-availability | Per-category replication status (leader_seq, synced and initial_sync_complete flags). |
| `GET` | `/api/v1/ha/status` | viewer | `config:read` | high-availability | Cluster status (node_id, role, term, leader_id, peer_count, ebpf_active, ha_mode, cluster_health, degradation_policy, is_degraded). |

## L7 alert enrichment

License feature: `advanced-dlp`. See
[L7 alert enrichment](../features/enterprise/l7-alert-enrichment.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/l7/enriched-alerts` | viewer | `l7:read` | advanced-dlp | Alerts carrying their L7 protocol context. |

## L7 deep inspection

License feature: `advanced-dlp`. See
[L7 deep inspection](../features/enterprise/l7-deep-inspection.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/enterprise/l7/analyze` | operator | `l7:write` | advanced-dlp | Scan a payload and return matches, policy decision and enrichment. |
| `GET` | `/api/v1/enterprise/l7/blocks` | viewer | `l7:read` | advanced-dlp | Sources blocked in the kernel after a match, with the reason and when each lapses. |
| `GET` | `/api/v1/enterprise/l7/blocks/ips` | viewer | `l7:read` | advanced-dlp | The same sources, one address per line, for a proxy's IP list. |
| `GET` | `/api/v1/enterprise/l7/blocks/stix` | viewer | `l7:read` | advanced-dlp | The same sources as a STIX 2.1 bundle of indicators. |
| `GET` | `/api/v1/enterprise/l7/matches` | viewer | `l7:read` | advanced-dlp | Recent match history. |
| `GET` | `/api/v1/enterprise/l7/patterns` | viewer | `l7:read` | advanced-dlp | List loaded patterns. |
| `POST` | `/api/v1/enterprise/l7/patterns` | operator | `l7:write` | advanced-dlp | Add one pattern. |
| `POST` | `/api/v1/enterprise/l7/patterns/bulk` | operator | `l7:write` | advanced-dlp | Replace the whole catalogue. |
| `DELETE` | `/api/v1/enterprise/l7/patterns/{id}` | operator | `l7:write` | advanced-dlp | Remove a pattern. |
| `GET` | `/api/v1/enterprise/l7/rule-toggles` | viewer | `l7:read` | advanced-dlp | Rule ids currently allowed to trigger a scan. |
| `PUT` | `/api/v1/enterprise/l7/rule-toggles` | operator | `l7:write` | advanced-dlp | Replace that set. |
| `PATCH` | `/api/v1/enterprise/l7/rule-toggles/{id}` | operator | `l7:write` | advanced-dlp | Add or remove one rule id. |

## L7 per-protocol policies

License feature: `advanced-dlp`. See
[L7 per-protocol policies](../features/enterprise/l7-per-protocol-policies.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/l7/policy/decisions` | viewer | `l7:read` | advanced-dlp | Recent per-protocol policy decisions. |
| `GET` | `/api/v1/enterprise/l7/policy/kafka` | viewer | `l7:read` | advanced-dlp | Current Kafka policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/kafka` | operator | `l7:write` | advanced-dlp | Replace the Kafka policy. |
| `GET` | `/api/v1/enterprise/l7/policy/ldap` | viewer | `l7:read` | advanced-dlp | Current LDAP policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/ldap` | operator | `l7:write` | advanced-dlp | Replace the LDAP policy. |
| `GET` | `/api/v1/enterprise/l7/policy/mongodb` | viewer | `l7:read` | advanced-dlp | Current MongoDB policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/mongodb` | operator | `l7:write` | advanced-dlp | Replace the MongoDB policy. |
| `GET` | `/api/v1/enterprise/l7/policy/redis` | viewer | `l7:read` | advanced-dlp | Current Redis policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/redis` | operator | `l7:write` | advanced-dlp | Replace the Redis policy. |
| `GET` | `/api/v1/enterprise/l7/policy/sql` | viewer | `l7:read` | advanced-dlp | Current SQL policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/sql` | operator | `l7:write` | advanced-dlp | Replace the SQL policy. |
| `GET` | `/api/v1/enterprise/l7/policy/ssh` | viewer | `l7:read` | advanced-dlp | Current SSH policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/ssh` | operator | `l7:write` | advanced-dlp | Replace the SSH policy. |

## Licensing

License feature: `none`. See
[Licensing](../features/enterprise/license.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/license` | viewer | `config:read` | none | Enterprise license status (200, or 402 when the license is absent or invalid). |

## ML detection

License feature: `ml-detection`. See
[ML detection](../features/enterprise/ml-detection.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/enterprise/dns/allowlist` | operator | `dns:write` | ml-detection | Add allowlist pattern. |
| `DELETE` | `/api/v1/enterprise/dns/allowlist/{pattern}` | operator | `dns:write` | ml-detection | Remove pattern. |
| `GET` | `/api/v1/enterprise/dns/dga-scores` | viewer | `dns:read` | ml-detection | Recent DGA scores. |
| `GET` | `/api/v1/enterprise/dns/dga-scores/{domain}` | viewer | `dns:read` | ml-detection | Score a domain on demand. |
| `GET` | `/api/v1/enterprise/ml/alerts` | viewer | `config:read` | ml-detection | ML alerts with MITRE mapping. |
| `GET` | `/api/v1/enterprise/ml/anomalies` | viewer | `config:read` | ml-detection | Recent anomalies (limit param). |
| `GET` | `/api/v1/enterprise/ml/beaconing` | viewer | `config:read` | ml-detection | Active C2 beaconing suspects. |
| `GET` | `/api/v1/enterprise/ml/mass-encryption` | viewer | `config:read` | ml-detection | The mass encryption threshold learned per executable and signal, and whether it drifted. |
| `POST` | `/api/v1/enterprise/ml/cusum/reset` | operator | `config:write` | ml-detection | Reset CUSUM state. |
| `POST` | `/api/v1/enterprise/ml/ewma/reset` | operator | `config:write` | ml-detection | Reset EWMA state. |
| `GET` | `/api/v1/enterprise/ml/ewma/status` | viewer | `config:read` | ml-detection | EWMA engine status. |
| `POST` | `/api/v1/enterprise/ml/feedback` | operator | `config:write` | ml-detection | Submit FP/TP feedback. |
| `GET` | `/api/v1/enterprise/ml/feedback/stats` | viewer | `config:read` | ml-detection | Feedback statistics. |
| `GET` | `/api/v1/enterprise/ml/heavy-hitters` | viewer | `config:read` | ml-detection | Top-K heavy hitters by byte volume. |
| `POST` | `/api/v1/enterprise/ml/model/reload` | operator | `config:write` | ml-detection | Hot-swap ONNX model. |
| `GET` | `/api/v1/enterprise/ml/rcf/attribution` | viewer | `config:read` | ml-detection | Per-feature attribution of an RCF anomaly score for a queried feature vector. |
| `POST` | `/api/v1/enterprise/ml/rcf/groups/{group_id}/reject` | operator | `config:write` | ml-detection | Say an alert group was wrongly collapsed. Tightens the similarity the next group needs. |
| `GET` | `/api/v1/enterprise/ml/rcf/queue` | viewer | `config:read` | ml-detection | Anomalies ranked by calibrated probability, each with its explanation and group. |
| `GET` | `/api/v1/enterprise/ml/rcf/scores` | viewer | `config:read` | ml-detection | Recent Random Cut Forest anomaly scores. |
| `GET` | `/api/v1/enterprise/ml/rcf/status` | viewer | `config:read` | ml-detection | Pool occupancy and memory cost, threshold state, calibration state, open groups. |
| `GET` | `/api/v1/enterprise/ml/status` | viewer | `config:read` | ml-detection | Pipeline status (all engines). |
| `GET` | `/api/v1/enterprise/ml/suggestions` | viewer | `config:read` | ml-detection | Pending rule suggestions. |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/approve` | operator | `config:write` | ml-detection | Approve suggestion. |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/reject` | operator | `config:write` | ml-detection | Reject suggestion. |
| `GET` | `/api/v1/enterprise/ml/training-data` | viewer | `config:read` | ml-detection | Export labeled dataset. |

## Multi-cluster federation

License feature: `multi-cluster`. See
[Multi-cluster federation](../features/enterprise/multicluster.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/federation/alerts` | viewer | `config:read` | multi-cluster | Query federated alerts (filters: cluster_id, severity, component, limit). |
| `POST` | `/api/v1/federation/alerts` | operator | `config:write` | multi-cluster | Ingest alerts from members; 503 when the store refused, so the batch is resendable. |
| `GET` | `/api/v1/federation/alerts/stream` | viewer | `config:read` | multi-cluster | Server-Sent Events live federated alert feed, scoped to a federation tenant (cluster). |
| `GET` | `/api/v1/federation/clusters` | viewer | `config:read` | multi-cluster | List member clusters (summaries). |
| `POST` | `/api/v1/federation/clusters` | operator | `config:write` | multi-cluster | Register member cluster (201, 409 on duplicate endpoint). |
| `GET` | `/api/v1/federation/clusters/{id}` | viewer | `config:read` | multi-cluster | Cluster details (404 if not found). |
| `DELETE` | `/api/v1/federation/clusters/{id}` | operator | `config:write` | multi-cluster | Unregister cluster (204). |
| `GET` | `/api/v1/federation/estate/response` | viewer | `config:read` | multi-cluster | The estate response's mode (`shadow` or `enforce`), the reading it started at, and the orders it made or would have made. Management cluster only. |
| `POST` | `/api/v1/federation/estate/response/promote` | operator | `config:write` | multi-cluster | Put the estate response in force on the reading named by `seen_since_ms`; 409 when the reading has restarted since. Management cluster only. |
| `POST` | `/api/v1/federation/estate/stop` | operator | `config:write` | multi-cluster | Stop the local processes writing to the named shares, found in this host's own process table. Called by the management cluster on the origin only. |
| `GET` | `/api/v1/federation/estate/verdicts` | viewer | `config:read` | multi-cluster | Writers encrypting other hosts' shares, each with its origin, the shares written to and the bound on each. Management cluster only. |
| `POST` | `/api/v1/federation/heartbeat` | operator | `config:write` | multi-cluster | Send heartbeat to management (204). |
| `GET` | `/api/v1/federation/overview` | viewer | `config:read` | multi-cluster | Federation-wide status. |
| `POST` | `/api/v1/federation/policies/apply` | operator | `config:write` | multi-cluster | Apply a pushed policy locally (atomic, dry-run aware; 422 on failure). |
| `GET` | `/api/v1/federation/policies/history` | viewer | `config:read` | multi-cluster | Distribution history (last 1,000). |
| `POST` | `/api/v1/federation/policies/push` | operator | `config:write` | multi-cluster | Distribute policy (with dry_run, overrides). |
| `GET` | `/api/v1/federation/status` | viewer | `config:read` | multi-cluster | Federation health + applied-policy set (health-probe target). |

### GET /api/v1/federation/alerts/stream

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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -N -H 'Accept: text/event-stream' \
    -H 'Last-Event-ID: 01934567-89ab-7def-0123-456789abcdef' \
    "http://localhost:8444/api/v1/federation/alerts/stream?cluster_id=01234567-89ab-cdef-0123-456789abcdef"
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

## Multi-tenancy

License feature: `multi-tenancy`. See
[Multi-tenancy](../features/enterprise/multitenancy.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/alerts` | viewer | `alerts:read` | multi-tenancy | Tenant-scoped alerts (filtered by effective tenant). |
| `GET` | `/api/v1/enterprise/audit` | viewer | `audit:read` | multi-tenancy | Tenant-scoped audit logs (filtered by effective tenant). |
| `POST` | `/api/v1/enterprise/tenants` | operator | `config:write` | multi-tenancy | Create tenant dynamically (admin). |
| `POST` | `/api/v1/enterprise/tenants/{id}/activate` | operator | `config:write` | multi-tenancy | Reactivate suspended tenant (admin). |
| `GET` | `/api/v1/enterprise/tenants/{id}/self-service` | viewer | `config:read` | multi-tenancy | Get self-service policy. |
| `POST` | `/api/v1/enterprise/tenants/{id}/self-service/check` | operator | `config:write` | multi-tenancy | Check if operation is allowed. |
| `POST` | `/api/v1/enterprise/tenants/{id}/suspend` | operator | `config:write` | multi-tenancy | Suspend tenant (admin). |
| `GET` | `/api/v1/tenants` | viewer | `config:read` | multi-tenancy | List all tenants (admin only). |
| `GET` | `/api/v1/tenants/attribution` | viewer | `config:read` | multi-tenancy | What this node's last attribution pass observed: `static`, `runtime_api` or `unavailable` (admin only). |
| `GET` | `/api/v1/tenants/metrics` | viewer | `config:read` | multi-tenancy | Prometheus quota metrics (admin only). |
| `GET` | `/api/v1/tenants/{id}` | viewer | `config:read` | multi-tenancy | Tenant details (read permission). |
| `GET` | `/api/v1/tenants/{id}/quota` | viewer | `config:read` | multi-tenancy | Current quota limits and usage. |
| `PUT` | `/api/v1/tenants/{id}/quota` | operator | `config:write` | multi-tenancy | Update quota (admin, partial update, 429 on reduction below usage). |
| `POST` | `/api/v1/tenants/{id}/quota/check` | operator | `config:write` | multi-tenancy | Check quota without consuming (read permission). |

## Network forensics

License feature: `network-forensics`. See
[Network forensics](../features/enterprise/network-forensics.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/forensics/captures` | viewer | `config:read` | network-forensics | List every packet capture, newest trigger first. |
| `GET` | `/api/v1/enterprise/forensics/captures/{id}` | viewer | `config:read` | network-forensics | Get one capture's record: trigger, flow, window, file, digest and custody position. |
| `GET` | `/api/v1/enterprise/forensics/captures/{id}/pcapng` | operator | `config:write` | network-forensics | Download a written capture as `application/x-pcapng`, checked against its digest and recorded in custody under the caller's name. A read that needs the write grant and pays the write bucket. |
| `GET` | `/api/v1/enterprise/forensics/campaigns` | viewer | `config:read` | network-forensics | Every encryption joined to the beacons and exfiltrations its actor raised before it inside the retention, newest encryption first: the actor, the stages held and each finding with whether a process was attributed to it. |
| `GET` | `/api/v1/enterprise/forensics/context-freezes` | viewer | `config:read` | network-forensics | List all context freezes. |
| `GET` | `/api/v1/enterprise/forensics/context-freezes/{id}` | viewer | `config:read` | network-forensics | Get a single context freeze: how many events it froze, the window it covers and its outcome. |
| `GET` | `/api/v1/enterprise/forensics/context-freezes/{id}/graph` | viewer | `config:read` | network-forensics | The investigation graph of one freeze, drawn around `focus` (the triggering finding by default) inside `max_nodes` (default 50, at most 300) and `max_depth` (default 6, at most 12), with a statement for each budget reached. |
| `DELETE` | `/api/v1/enterprise/forensics/context-freezes/{id}` | operator | `config:write` | network-forensics | Delete a context freeze. |
| `GET` | `/api/v1/enterprise/forensics/mirror` | viewer | `config:read` | network-forensics | Return the current packet mirror configuration. |
| `POST` | `/api/v1/enterprise/forensics/mirror/start` | operator | `config:write` | network-forensics | Enable eBPF packet mirroring. Suspicious packets matched by `tc-ids` are cloned via `bpf_clone_redirect` to the specified interface for forensic capture by tools such as Wireshark or `tcpdump`. |
| `POST` | `/api/v1/enterprise/forensics/mirror/stop` | operator | `config:write` | network-forensics | Disable eBPF packet mirroring. The `tc-ids` program stops cloning packets. |
| `GET` | `/api/v1/enterprise/forensics/status` | viewer | `config:read` | network-forensics | Ring buffer status, context freeze count, trigger policy. |
| `GET` | `/api/v1/enterprise/forensics/timeline/flow` | viewer | `config:read` | network-forensics | Timeline for a specific flow tuple. |
| `GET` | `/api/v1/enterprise/forensics/timeline/{alert_id}` | viewer | `config:read` | network-forensics | Flow timeline around an alert. |
| `GET` | `/api/v1/forensics/events/stream` | viewer | `config:read` | network-forensics | Server-Sent Events live forensic event feed. |
| `GET` | `/api/v1/investigations` | viewer | `investigation:read` | network-forensics | The investigations this node runs, then the ended ones it keeps. |
| `POST` | `/api/v1/investigations` | operator | `investigation:write` | network-forensics | Start a bounded investigation of one workload, under the caller's name: `sockets`, `top-tcp`, `server-names` or `drops` (403 when nobody can be named, 421 for another node, 503 when this node cannot take the reading). |
| `GET` | `/api/v1/investigations/{id}` | viewer | `investigation:read` | network-forensics | One investigation, its cost and its last sample. |
| `DELETE` | `/api/v1/investigations/{id}` | operator | `investigation:write` | network-forensics | Stop an investigation before its time, under the caller's name. |

### GET /api/v1/forensics/events/stream

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
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -N -H 'Accept: text/event-stream' \
    "http://localhost:8444/api/v1/forensics/events/stream?severity_min=high&component=ids"
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

## SIEM integration

License feature: `siem-integration`. See
[SIEM integration](../features/enterprise/siem-integration.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/siem/retro-ioc-scan` | operator | `config:write` | siem-integration | Retroactive IOC matching against buffered events. |
| `GET` | `/api/v1/siem/status` | viewer | `config:read` | siem-integration | Export pipeline status (connectors, buffer size, pending events, exported/dropped/error counts). |

## Threat intelligence platforms

License feature: `threat-intel-platforms`. See
[Threat intelligence platforms](../features/enterprise/threat-intel-platforms.md) for what
the feature does and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/intel/indicators` | viewer | `threatintel:read` | threat-intel-platforms | Indicators imported by kind and by source, with the matcher each kind reaches and the kinds that reach none. |
| `GET` | `/api/v1/intel/sources` | viewer | `threatintel:read` | threat-intel-platforms | One entry per configured source: its interval, its clocks, its resume markers and what the last poll took and refused. |

Both calls read what the configured sources have already imported. Neither
starts a poll: an interval is configuration, and a route that forced a fetch
would be a way to make this agent reach a third party on a stranger's schedule.

## TLS intelligence

License feature: `tls-intelligence`. See
[TLS intelligence](../features/enterprise/tls-intelligence.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/tls-intelligence/alerts` | viewer | `config:read` | tls-intelligence | List TLS intelligence alerts. |
| `GET` | `/api/v1/enterprise/tls-intelligence/anomalies` | viewer | `config:read` | tls-intelligence | List behavior anomaly alerts. |
| `GET` | `/api/v1/enterprise/tls-intelligence/anomalies/config` | viewer | `config:read` | tls-intelligence | Current anomaly detector thresholds. |
| `PUT` | `/api/v1/enterprise/tls-intelligence/anomalies/config` | operator | `config:write` | tls-intelligence | Replace the anomaly detector thresholds. |
| `GET` | `/api/v1/enterprise/tls-intelligence/cipher-downgrades` | viewer | `config:read` | tls-intelligence | List cipher downgrade detections. |
| `GET` | `/api/v1/enterprise/tls-intelligence/clusters` | viewer | `config:read` | tls-intelligence | Fingerprint clusters with centroids and labels. |
| `GET` | `/api/v1/enterprise/tls-intelligence/crypto/policy` | viewer | `config:read` | tls-intelligence | Current cryptographic policy. |
| `PUT` | `/api/v1/enterprise/tls-intelligence/crypto/policy` | operator | `config:write` | tls-intelligence | Replace the cryptographic policy. |
| `GET` | `/api/v1/enterprise/tls-intelligence/crypto/violations` | viewer | `config:read` | tls-intelligence | Connections that breached the cryptographic policy. |
| `POST` | `/api/v1/enterprise/tls-intelligence/events` | operator | `config:write` | tls-intelligence | Ingest a TLS handshake observation. |
| `GET` | `/api/v1/enterprise/tls-intelligence/ml/status` | viewer | `config:read` | tls-intelligence | TLS ML inference status. |
| `GET` | `/api/v1/enterprise/tls-intelligence/peer-groups/status` | viewer | `config:read` | tls-intelligence | Peer-group rarity status. |
| `GET` | `/api/v1/enterprise/tls-intelligence/pqc/connections` | viewer | `config:read` | tls-intelligence | Connections carrying post-quantum key exchange. |
| `GET` | `/api/v1/enterprise/tls-intelligence/pqc/report` | viewer | `config:read` | tls-intelligence | Post-quantum readiness summary for the estate. |
| `GET` | `/api/v1/enterprise/tls-intelligence/server-fingerprints` | viewer | `config:read` | tls-intelligence | List server fingerprint changes. |
| `GET` | `/api/v1/enterprise/tls-intelligence/session-anomalies` | viewer | `config:read` | tls-intelligence | List session resumption anomalies. |
| `GET` | `/api/v1/enterprise/tls-intelligence/sni-cert-mismatches` | viewer | `config:read` | tls-intelligence | List SNI/cert mismatch detections. |
| `GET` | `/api/v1/enterprise/tls-intelligence/status` | viewer | `config:read` | tls-intelligence | Overall TLS intelligence status. |
| `GET` | `/api/v1/enterprise/tls-intelligence/threats` | viewer | `config:read` | tls-intelligence | List all threat fingerprint entries. |
| `POST` | `/api/v1/enterprise/tls-intelligence/threats` | operator | `config:write` | tls-intelligence | Add custom threat entry. |
| `GET` | `/api/v1/enterprise/tls-intelligence/threats/matches` | viewer | `config:read` | tls-intelligence | List threat match detections. |
| `DELETE` | `/api/v1/enterprise/tls-intelligence/threats/{id}` | operator | `config:write` | tls-intelligence | Remove threat entry. |
