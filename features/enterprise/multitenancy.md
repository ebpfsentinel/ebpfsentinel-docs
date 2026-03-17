# Multi-Tenancy

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Hybrid tenant identification for multi-tenant environments. Supports three isolation modes — interface-based (containers/namespaces), subnet-based (bare-metal shared interfaces), and VLAN-based — all combinable per tenant. Enforcement happens at the eBPF kernel level with per-tenant rule scoping, resource quotas, tenant-aware RBAC, and scoped alert/audit streams.

## Tenant Model

| Field | Description |
|-------|-------------|
| `id` | Unique tenant identifier (TenantId) |
| `name` | Display name (defaults to `id` if omitted) |
| `namespaces` | Linux network namespaces assigned to this tenant |
| `interfaces` | Network interfaces assigned to this tenant (container mode) |
| `subnets` | IP subnets assigned to this tenant (bare-metal mode, IPv4 + IPv6 CIDR) |
| `vlans` | VLAN IDs assigned to this tenant (bare-metal mode) |
| `description` | Optional description |
| `tenant_id` | Numeric tenant identifier (auto-assigned sequentially: 1, 2, 3, ...) |
| `quota` | Per-tenant resource limits |

### Isolation Modes

| Mode | Use Case | eBPF Resolution | Config Field |
|------|----------|----------------|--------------|
| **Interface** | Containers, VMs with dedicated veth/tap | `INTERFACE_GROUPS[ifindex] → tenant_id` | `interfaces` |
| **Subnet** | Bare-metal with shared NIC, per-client IP ranges | `TENANT_SUBNET_V4/V6[src_ip] → tenant_id` (LPM trie) | `subnets` |
| **VLAN** | Bare-metal with 802.1Q VLAN tagging | `TENANT_VLAN_MAP[vlan_id] → tenant_id` | `vlans` |
| **Hybrid** | Mixed environment | All three checked in priority order | Any combination |

### Tenant Resolution Priority (eBPF kernel)

```
Packet arrives → Parse VLAN + IP headers
    │
    ├─ 1. TENANT_VLAN_MAP[vlan_id] → tenant_id    (if VLAN tagged)
    │
    ├─ 2. INTERFACE_GROUPS[ifindex] → tenant_id    (if interface mapped)
    │
    ├─ 3. TENANT_SUBNET_V4[src_ip] → tenant_id    (IPv4 LPM trie)
    │     TENANT_SUBNET_V6[src_ip] → tenant_id    (IPv6 LPM trie)
    │
    └─ 4. Default tenant_id = 0
```

Resolution runs in all 6 eBPF programs that enforce rules: xdp-firewall, xdp-ratelimit, tc-ids, tc-qos, tc-nat-ingress, tc-nat-egress.

### Limits

- Maximum tenants: **65,535** (u32 tenant_id, practically unlimited)
- Default tenant ID: `__default__` (catch-all for unmatched traffic, `tenant_id=0`)
- Reserved: the `__default__` ID cannot be used for user-defined tenants
- Subnet entries: up to 4,096 IPv4 + 2,048 IPv6 per LPM trie
- VLAN entries: up to 1,024

### Registry

`TenantRegistry` provides fast lookups via pre-computed maps:

- By tenant ID (`id_to_index`)
- By namespace (`namespace_to_tenant`)
- By interface (`interface_to_tenant`)
- By IP subnet (`parsed_subnets` — longest prefix match, IPv4 + IPv6)
- By VLAN ID (`vlan_to_tenant`)
- Fallback to default tenant for unmatched traffic

### Validation

`TenantEngine::build_registry()` enforces:

- No empty tenant IDs
- No reserved ID (`__default__`)
- Unique tenant IDs
- No namespace overlaps (each namespace owned by exactly one tenant)
- No subnet overlaps (no two tenants claim overlapping CIDRs)
- No VLAN overlaps (each VLAN ID owned by exactly one tenant)
- Valid CIDR format for subnets
- Auto-assigns sequential `tenant_id` values (1, 2, 3, ...)
- Auto-adds default tenant with `tenant_id=0`

## eBPF Rule Matching

Every eBPF rule (firewall, IDS, rate limit, QoS, NAT) carries a `tenant_id: u32` field:

- `tenant_id = 0` → **floating rule** (applies to all tenants)
- `tenant_id > 0` → **tenant-scoped rule** (only applies when packet's resolved tenant matches)

Matching logic in eBPF:
```
if rule.tenant_id != 0 && rule.tenant_id != packet_tenant_id {
    skip rule  // tenant mismatch
}
```

This check runs **after** the existing `group_mask` interface group check, preserving backward compatibility with OSS interface groups.

## Resource Quotas

Each tenant has configurable resource limits (0 = unlimited):

| Quota | Default | Description |
|-------|---------|-------------|
| `max_rules` | 1,000 | Firewall + IDS + NAT rules combined |
| `max_alert_rate` | 10,000/min | Maximum alert rate |
| `max_patterns` | 100 | DLP patterns |
| `max_ratelimit_rules` | 100 | Rate-limit rules |
| `max_qos_pipes` | 32 | QoS pipes |

### Quota Enforcement

- `check_quota()` uses `saturating_add` to prevent overflow
- `check_and_record()` performs **atomic check+record** under write lock to prevent TOCTOU races
- `release_usage()` decrements usage on resource deletion (saturating)
- Runtime quota updates via `PUT /api/v1/tenants/{id}/quota` with reduction protection — returns HTTP 429 if new limit would be below current usage

## Tenant-Aware RBAC

Access control is scoped per tenant using JWT claims or API key headers.

### Roles

| Role | Capabilities |
|------|-------------|
| `Admin` | Cross-tenant access to all resources |
| `Operator` | Read + write within own tenant only |
| `Viewer` | Read-only within own tenant only |

### Identity Extraction

Identity is resolved in order:

1. **JWT claims** — `namespaces[0]` as tenant_id, `role` claim, `sub` as subject
2. **Header fallback** (API key auth) — `X-Tenant-Id`, `X-Tenant-Role`, `X-API-Key` as subject

### Authorization

`authorize_tenant_access(caller, target_tenant, permission)` enforces:

- Admin always passes (no tenant check)
- Non-admin requires `tenant_id` claim matching `target_tenant`
- Viewer: `Read` only
- Operator: `Read` + `Write`

Error codes: `MISSING_TENANT_CLAIM`, `TENANT_MISMATCH`, `INSUFFICIENT_PERMISSION`

## Tenant Events

### Alert and Audit Streams

`TenantEventService` maintains in-memory ring buffers:

- **Alert buffer**: up to 10,000 entries (FIFO eviction)
- **Audit buffer**: up to 10,000 entries (FIFO eviction)
- **Broadcast channel**: real-time alert subscription for consumers

### Tenant Resolution (Userspace)

Userspace resolution complements the eBPF kernel resolution:

- `resolve_tenant_for_interface(interface)` — by interface name
- `resolve_tenant_for_ifindex(ifindex)` — by kernel interface index
- `resolve_tenant_for_ip(ip)` — by IP address (subnet longest prefix match)
- `resolve_tenant_for_vlan(vlan_id)` — by VLAN ID

### Effective Tenant Filtering

`effective_tenant(caller_tenant, caller_role, requested_tenant)`:

- Admin: uses requested tenant (or `None` for all tenants)
- Non-admin: always scoped to own tenant (ignores requested)

## DDoS Impact on Shared Interfaces

When multiple tenants share a physical interface (bare-metal mode):

| Layer | Impact | Mitigation |
|-------|--------|------------|
| **NIC** | Link saturation affects all tenants | Upstream scrubbing required |
| **XDP** | Per-tenant rate limiting via `tenant_id`-scoped rules | Drops DDoS at kernel level, protects other tenants' CPU |
| **TC** | Per-tenant IDS/IPS rules only match their traffic | Tenant A's attack doesn't trigger tenant B's rules |

The XDP rate limiter resolves the tenant BEFORE applying rate limits, so per-tenant rate limit rules only consume the target tenant's budget.

## Configuration

```yaml
enterprise:
  tenants:
    enabled: true
    tenants:
      # Container mode — dedicated interface per tenant
      - id: team-alpha
        namespaces: [alpha, alpha-staging]
        interfaces: [veth-alpha]
        description: "Team Alpha production & staging"
        quotas:
          max_rules: 500
          max_alert_rate: 5000

      # Bare-metal mode — subnet-based isolation (shared interface)
      - id: client-a
        subnets: ["10.1.0.0/16", "172.16.1.0/24"]

      # Bare-metal mode — VLAN-based isolation
      - id: client-b
        vlans: [100, 200]

      # Hybrid mode — interface + subnet + VLAN
      - id: client-c
        interfaces: [eth2]
        subnets: ["10.3.0.0/16", "fd00:abcd::/48"]
        vlans: [300]
```

All fields are optional:
- `name` defaults to `id` if omitted
- `interfaces`, `subnets`, `vlans`, `namespaces` default to empty
- `quotas` fields use defaults when omitted

## Prometheus Metrics

`GET /api/v1/tenants/metrics` (admin only) returns Prometheus text format:

```
# HELP ebpfsentinel_tenant_quota_limit Configured quota limit per tenant and resource.
# TYPE ebpfsentinel_tenant_quota_limit gauge
ebpfsentinel_tenant_quota_limit{tenant="alpha",resource="rules"} 1000

# HELP ebpfsentinel_tenant_quota_usage Current resource usage per tenant.
# TYPE ebpfsentinel_tenant_quota_usage gauge
ebpfsentinel_tenant_quota_usage{tenant="alpha",resource="rules"} 50
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/tenants` | List all tenants (admin only) |
| `GET` | `/api/v1/tenants/{id}` | Tenant details (read permission) |
| `GET` | `/api/v1/tenants/{id}/quota` | Current quota limits and usage |
| `PUT` | `/api/v1/tenants/{id}/quota` | Update quota (admin, partial update, 429 on reduction below usage) |
| `POST` | `/api/v1/tenants/{id}/quota/check` | Check quota without consuming (read permission) |
| `GET` | `/api/v1/tenants/metrics` | Prometheus quota metrics (admin only) |
| `GET` | `/api/v1/enterprise/alerts` | Tenant-scoped alerts (filtered by effective tenant) |
| `GET` | `/api/v1/enterprise/audit` | Tenant-scoped audit logs (filtered by effective tenant) |

### Tenant Response

```json
{
  "id": "client-c",
  "name": "client-c",
  "tenant_id": 4,
  "interfaces": ["eth2"],
  "subnets": ["10.3.0.0/16", "fd00:abcd::/48"],
  "vlans": [300],
  "namespaces": [],
  "quota": { "max_rules": 1000, "max_alert_rate": 10000, ... }
}
```

### Quota Check Request/Response

```json
// POST /api/v1/tenants/{id}/quota/check
{ "resource": "rules", "count": 10 }

// Response
{
  "allowed": true,
  "tenant_id": "team-alpha",
  "resource": "rules",
  "requested": 10,
  "current_usage": 50,
  "limit": 500
}
```

## Feature Gating

Multi-Tenancy requires a valid license with the `multi-tenancy` feature. Without a license, all traffic is handled under the default tenant with no isolation.
