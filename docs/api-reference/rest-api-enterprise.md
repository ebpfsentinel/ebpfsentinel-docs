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
https://localhost:8444
```

Every path below is generated from the `openapi.json` the enterprise agent
emits, so a path documented here is a path the binary mounts and a path
missing from here is a path it does not.

## How to read the tables

Two facts decide whether a call succeeds, and both are stated per
endpoint.

**License feature.** The feature the route belongs to. A feature the
license does not carry is never mounted, so the call answers `404 Not
Found` rather than `403 Forbidden`: an unlicensed feature is
indistinguishable from a path that does not exist. `none` means the route
is mounted whatever the license says.

**Role.** The least-privileged built-in role whose grants satisfy the
route. `viewer` reads, `operator` reads and writes, `admin` does both and
administers roles. A custom role carrying the same grant works too: the
middleware checks the grant, never the role name. The grant is
`<domain>:<permission>`, where the permission is `read` for `GET`, `HEAD`
and `OPTIONS` and `write` for every other method. `none` means the route
sits outside RBAC. See
[Advanced RBAC](../features/enterprise/advanced-rbac.md) for how roles and
grants are defined.

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
| [Advanced RBAC](#advanced-rbac) | 12 | [Advanced RBAC](../features/enterprise/advanced-rbac.md) |
| [AI and LLM security](#ai-and-llm-security) | 17 | [AI and LLM security](../features/enterprise/ai-security.md) |
| [Air-gap](#air-gap) | 4 | [Air-gap](../features/enterprise/airgap.md) |
| [Advanced analytics](#advanced-analytics) | 9 | [Advanced analytics](../features/enterprise/analytics.md) |
| [Automated response](#automated-response) | 8 | [Automated response](../features/enterprise/automated-response.md) |
| [Compliance reports](#compliance-reports) | 7 | [Compliance reports](../features/enterprise/compliance-reports.md) |
| [Data loss prevention](#data-loss-prevention) | 8 | [Data loss prevention](../features/enterprise/dlp.md) |
| [Fleet management](#fleet-management) | 5 | [Fleet management](../features/enterprise/fleet-management.md) |
| [High availability](#high-availability) | 6 | [High availability](../features/enterprise/high-availability.md) |
| [L7 alert enrichment](#l7-alert-enrichment) | 1 | [L7 alert enrichment](../features/enterprise/l7-alert-enrichment.md) |
| [L7 deep inspection](#l7-deep-inspection) | 9 | [L7 deep inspection](../features/enterprise/l7-deep-inspection.md) |
| [L7 per-protocol policies](#l7-per-protocol-policies) | 13 | [L7 per-protocol policies](../features/enterprise/l7-per-protocol-policies.md) |
| [Licensing](#licensing) | 1 | [Licensing](../features/enterprise/license.md) |
| [ML detection](#ml-detection) | 21 | [ML detection](../features/enterprise/ml-detection.md) |
| [Multi-cluster federation](#multi-cluster-federation) | 13 | [Multi-cluster federation](../features/enterprise/multicluster.md) |
| [Multi-tenancy](#multi-tenancy) | 13 | [Multi-tenancy](../features/enterprise/multitenancy.md) |
| [Network forensics](#network-forensics) | 10 | [Network forensics](../features/enterprise/network-forensics.md) |
| [SIEM integration](#siem-integration) | 2 | [SIEM integration](../features/enterprise/siem-integration.md) |
| [TLS intelligence](#tls-intelligence) | 22 | [TLS intelligence](../features/enterprise/tls-intelligence.md) |

## Always mounted

Mounted whatever the license carries, on every enterprise agent.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/alerts` | viewer | `alerts:read` | none | Query the OSS datapath alert store. |
| `GET` | `/api/v1/ebpf/kernel-features` | viewer | `config:read` | none | Return what the startup helper probe learned about this kernel. |
| `GET` | `/metrics` | none | `none` | none | Returns `OpenMetrics` text output for all enterprise metrics. |

## Advanced RBAC

License feature: `advanced-rbac`. See
[Advanced RBAC](../features/enterprise/advanced-rbac.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/rbac/assignments` | operator | `config:write` | advanced-rbac | Assign role to subject (201). |
| `DELETE` | `/api/v1/rbac/assignments` | operator | `config:write` | advanced-rbac | Deprecated, kept for one release: remove role from subject (204). The body is optional; `?subject=&role_id=` does the same. |
| `GET` | `/api/v1/rbac/assignments/{subject}` | viewer | `config:read` | advanced-rbac | List roles for subject. |
| `DELETE` | `/api/v1/rbac/assignments/{subject}/{role_id}` | operator | `config:write` | advanced-rbac | Remove role from subject (204). No request body. |
| `POST` | `/api/v1/rbac/check` | operator | `config:write` | advanced-rbac | Check permission (`{ role_id, domain, permission, resource_id? }`). |
| `POST` | `/api/v1/rbac/filter` | operator | `config:write` | advanced-rbac | Filter accessible resources (`{ role_id, domain, resource_ids }`). |
| `GET` | `/api/v1/rbac/roles` | viewer | `config:read` | advanced-rbac | List all roles. |
| `POST` | `/api/v1/rbac/roles` | operator | `config:write` | advanced-rbac | Create custom role (201). |
| `PUT` | `/api/v1/rbac/roles` | operator | `config:write` | advanced-rbac | Deprecated, kept for one release: same as `POST /api/v1/rbac/roles/reload`. |
| `POST` | `/api/v1/rbac/roles/reload` | operator | `config:write` | advanced-rbac | Bulk reload all custom roles (atomic). |
| `GET` | `/api/v1/rbac/roles/{id}` | viewer | `config:read` | advanced-rbac | Role details (404 if not found). |
| `PUT` | `/api/v1/rbac/roles/{id}` | operator | `config:write` | advanced-rbac | Update custom role (403 for built-in). |
| `DELETE` | `/api/v1/rbac/roles/{id}` | operator | `config:write` | advanced-rbac | Delete custom role (403 for built-in, 204 on success). |
| `GET` | `/api/v1/rbac/roles/{id}/effective-grants` | viewer | `config:read` | advanced-rbac | Resolved grants with inheritance. |

## AI and LLM security

License feature: `ai-llm-security`. See
[AI and LLM security](../features/enterprise/ai-security.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/ai-security/ai-dlp/patterns` | viewer | `config:read` | ai-llm-security | List the prompt inspection patterns. |
| `POST` | `/api/v1/enterprise/ai-security/ai-dlp/patterns` | operator | `config:write` | ai-llm-security | Add a prompt inspection pattern. |
| `DELETE` | `/api/v1/enterprise/ai-security/ai-dlp/patterns/{id}` | operator | `config:write` | ai-llm-security | Remove a prompt inspection pattern. |
| `GET` | `/api/v1/enterprise/ai-security/alerts` | viewer | `config:read` | ai-llm-security | List AI security alerts. |
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
| `GET` | `/api/v1/analytics/alerts` | viewer | `config:read` | advanced-analytics | Alert summary by severity and component. Query: `period` (default 24h). Query: `period` (default 24h). Query: `period` (default 24h). Query: `period` (default 24h). |
| `GET` | `/api/v1/analytics/flows` | viewer | `config:read` | advanced-analytics | Flow volume aggregates over the requested period. Query: `period` (default 24h). Query: `period` (default 24h). Query: `period` (default 24h). Query: `period` (default 24h). |
| `GET` | `/api/v1/analytics/ioc` | viewer | `config:read` | advanced-analytics | IOC hit summary by threat type. Query: `period` (default 24h). Query: `period` (default 24h). Query: `period` (default 24h). Query: `period` (default 24h). |
| `GET` | `/api/v1/analytics/status` | viewer | `config:read` | advanced-analytics | Pipeline status. |
| `GET` | `/api/v1/analytics/top-talkers` | viewer | `config:read` | advanced-analytics | Top talkers with period-over-period deltas. Query: `period` (default 24h), `limit` (default 20). Query: `period` (default 24h), `limit` (default 20). Query: `period` (default 24h), `limit` (default 20). Query: `period` (default 24h), `limit` (default 20). |
| `GET` | `/api/v1/analytics/trends` | viewer | `config:read` | advanced-analytics | Trend report (JSON). Query: `period` (minimum 7d). Query: `period` (minimum 7d). Query: `period` (minimum 7d). Query: `period` (minimum 7d). |
| `GET` | `/api/v1/analytics/trends/csv` | viewer | `config:read` | advanced-analytics | Trend report (CSV). Query: `period` (minimum 7d). Query: `period` (minimum 7d). Query: `period` (minimum 7d). Query: `period` (minimum 7d). |
| `GET` | `/api/v1/analytics/trends/history` | viewer | `config:read` | advanced-analytics | Cached daily trend reports (up to 30). |
| `GET` | `/api/v1/analytics/trends/text` | viewer | `config:read` | advanced-analytics | Trend report (text). Query: `period` (minimum 7d). Query: `period` (minimum 7d). Query: `period` (minimum 7d). Query: `period` (minimum 7d). |

## Automated response

License feature: `automated-response`. See
[Automated response](../features/enterprise/automated-response.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/response/audit` | viewer | `config:read` | automated-response | Query the audit trail. |
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
| `GET` | `/api/v1/compliance/reports/{id}/pdf` | viewer | `config:read` | compliance-reports | Export as branded PDF (attachment: `report.pdf`). |
| `GET` | `/api/v1/compliance/reports/{id}/text` | viewer | `config:read` | compliance-reports | Export as structured text. |
| `POST` | `/api/v1/compliance/segmentation/validate` | operator | `config:write` | compliance-reports | Validate a network segmentation policy (zones, allowed flows). |

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
| `GET` | `/api/v1/enterprise/tls-probes/plans` | viewer | `config:read` | advanced-dlp | Full latest `ScanResult`: every `(library, binary_path, pids, symbol offsets, build_id, kernel_hook)` tuple plus the raw kTLS counters read from `/proc/net/tls_stat`. |
| `GET` | `/api/v1/enterprise/tls-probes/status` | viewer | `config:read` | advanced-dlp | High-level scanner health: last scan timestamp (ns), last scan duration (seconds), number of processes scanned, total discovered plans, `ktls_active` flag. |
| `GET` | `/api/v1/enterprise/tls-probes/warnings` | viewer | `config:read` | advanced-dlp | Warnings collected during the most recent scan (invalid ELF, missing symbol, `/proc` read failure, …). |

## Fleet management

License feature: `fleet-management`. See
[Fleet management](../features/enterprise/fleet-management.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/agent/config/version` | viewer | `config:read` | fleet-management | Config SHA-256 hash + reload timestamp. |
| `POST` | `/api/v1/agent/heartbeat` | operator | `config:write` | fleet-management | Report status, receive aggregated health. |
| `GET` | `/api/v1/agent/identity` | viewer | `config:read` | fleet-management | Full agent identity with capabilities. |
| `POST` | `/api/v1/agent/register` | operator | `config:write` | fleet-management | Register agent, get UUIDv7 identity + token. |
| `GET` | `/api/v1/flows/graph` | viewer | `config:read` | fleet-management | Network flow graph from conntrack data. |

## High availability

License feature: `high-availability`. See
[High availability](../features/enterprise/high-availability.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/ha/failover` | operator | `config:write` | high-availability | Manual failover (leader only, 409 Conflict if not leader or no peers). |
| `GET` | `/api/v1/ha/health` | viewer | `config:read` | high-availability | Cluster health (ha_mode, cluster_health, degradation_policy, is_degraded). |
| `GET` | `/api/v1/ha/interfaces` | viewer | `config:read` | high-availability | Interface assignments and ownership status (active_active mode). |
| `GET` | `/api/v1/ha/peers` | viewer | `config:read` | high-availability | Peer list with addresses. |
| `GET` | `/api/v1/ha/replication` | viewer | `config:read` | high-availability | Per-category replication status (leader_seq, synced flag). |
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
| `POST` | `/api/v1/enterprise/ml/cusum/reset` | operator | `config:write` | ml-detection | Reset CUSUM state. |
| `POST` | `/api/v1/enterprise/ml/ewma/reset` | operator | `config:write` | ml-detection | Reset EWMA state. |
| `GET` | `/api/v1/enterprise/ml/ewma/status` | viewer | `config:read` | ml-detection | EWMA engine status. |
| `POST` | `/api/v1/enterprise/ml/feedback` | operator | `config:write` | ml-detection | Submit FP/TP feedback. |
| `GET` | `/api/v1/enterprise/ml/feedback/stats` | viewer | `config:read` | ml-detection | Feedback statistics. |
| `GET` | `/api/v1/enterprise/ml/heavy-hitters` | viewer | `config:read` | ml-detection | Top-K heavy hitters by byte volume. |
| `POST` | `/api/v1/enterprise/ml/model/reload` | operator | `config:write` | ml-detection | Hot-swap ONNX model. |
| `GET` | `/api/v1/enterprise/ml/rcf/attribution` | viewer | `config:read` | ml-detection | Per-feature attribution of an RCF anomaly score for a queried feature vector. |
| `GET` | `/api/v1/enterprise/ml/rcf/scores` | viewer | `config:read` | ml-detection | Recent Random Cut Forest anomaly scores. |
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
| `POST` | `/api/v1/federation/alerts` | operator | `config:write` | multi-cluster | Ingest alerts from members. |
| `GET` | `/api/v1/federation/alerts/stream` | viewer | `config:read` | multi-cluster | Server-Sent Events live federated alert feed, scoped to a federation tenant (cluster). |
| `GET` | `/api/v1/federation/clusters` | viewer | `config:read` | multi-cluster | List member clusters (summaries). |
| `POST` | `/api/v1/federation/clusters` | operator | `config:write` | multi-cluster | Register member cluster (201, 409 on duplicate endpoint). |
| `GET` | `/api/v1/federation/clusters/{id}` | viewer | `config:read` | multi-cluster | Cluster details (404 if not found). |
| `DELETE` | `/api/v1/federation/clusters/{id}` | operator | `config:write` | multi-cluster | Unregister cluster (204). |
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
| `GET` | `/api/v1/enterprise/forensics/captures` | viewer | `config:read` | network-forensics | List all forensic captures. |
| `GET` | `/api/v1/enterprise/forensics/captures/{id}` | viewer | `config:read` | network-forensics | Get single capture metadata. |
| `DELETE` | `/api/v1/enterprise/forensics/captures/{id}` | operator | `config:write` | network-forensics | Delete a capture. |
| `GET` | `/api/v1/enterprise/forensics/mirror` | viewer | `config:read` | network-forensics | Return the current packet mirror configuration. |
| `POST` | `/api/v1/enterprise/forensics/mirror/start` | operator | `config:write` | network-forensics | Enable eBPF packet mirroring. Suspicious packets matched by `tc-ids` are cloned via `bpf_clone_redirect` to the specified interface for forensic capture by tools such as Wireshark or `tcpdump`. |
| `POST` | `/api/v1/enterprise/forensics/mirror/stop` | operator | `config:write` | network-forensics | Disable eBPF packet mirroring. The `tc-ids` program stops cloning packets. |
| `GET` | `/api/v1/enterprise/forensics/status` | viewer | `config:read` | network-forensics | Ring buffer status, capture count, trigger policy. |
| `GET` | `/api/v1/enterprise/forensics/timeline/flow` | viewer | `config:read` | network-forensics | Timeline for a specific flow tuple. |
| `GET` | `/api/v1/enterprise/forensics/timeline/{alert_id}` | viewer | `config:read` | network-forensics | Flow timeline around an alert. |
| `GET` | `/api/v1/forensics/events/stream` | viewer | `config:read` | network-forensics | Server-Sent Events live forensic event feed. |

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

## SIEM integration

License feature: `siem-integration`. See
[SIEM integration](../features/enterprise/siem-integration.md) for what the feature does
and for the request and response bodies.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `POST` | `/api/v1/siem/retro-ioc-scan` | operator | `config:write` | siem-integration | Retroactive IOC matching against buffered events. |
| `GET` | `/api/v1/siem/status` | viewer | `config:read` | siem-integration | Export pipeline status (connectors, buffer size, pending events, exported/dropped/error counts). |

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
