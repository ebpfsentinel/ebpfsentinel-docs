# Multi-Tenancy

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Namespace and interface-scoped security policy isolation for multi-tenant environments. Each tenant is bound to specific namespaces and network interfaces with enforced resource quotas, tenant-aware RBAC, scoped alert/audit streams, and eBPF-level traffic isolation via interface group bitmasks.

## Tenant Model

| Field | Description |
|-------|-------------|
| `id` | Unique tenant identifier (TenantId) |
| `name` | Display name |
| `namespaces` | Linux network namespaces assigned to this tenant |
| `interfaces` | Network interfaces assigned to this tenant |
| `description` | Optional description |
| `group_mask` | eBPF interface group bitmask (computed at config load) |
| `quota` | Per-tenant resource limits |

### Limits

- Maximum tenants: **31** (limited by 31-bit interface group bitmask, + 1 default = 32 total)
- Default tenant ID: `__default__` (catch-all for unassigned traffic, group_mask=0)
- Reserved: the `__default__` ID cannot be used for user-defined tenants

### Registry

`TenantRegistry` provides fast lookups via pre-computed maps:

- By tenant ID (`id_to_index`)
- By namespace (`namespace_to_tenant`)
- By interface (`interface_to_tenant`)
- Fallback to default tenant for unknown namespaces/interfaces

### Validation

`TenantEngine::build_registry()` enforces:

- No empty tenant IDs
- No reserved ID (`__default__`)
- Unique tenant IDs
- Max 31 user tenants
- No namespace overlaps (each namespace owned by exactly one tenant)
- Auto-adds default tenant with `group_mask=0`

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

### Tenant Resolution

Traffic is associated to tenants at the kernel level:

- `resolve_tenant_for_interface(interface)` — by interface name
- `resolve_tenant_for_ifindex(ifindex)` — by kernel interface index (fast path)
- Uses `RegistryResolver` wrapping `Arc<TenantRegistry>` + ifindex map

### Effective Tenant Filtering

`effective_tenant(caller_tenant, caller_role, requested_tenant)`:

- Admin: uses requested tenant (or `None` for all tenants)
- Non-admin: always scoped to own tenant (ignores requested)

## Configuration

```yaml
enterprise:
  tenants:
    enabled: true
    tenants:
      - id: team-alpha
        name: "Team Alpha"
        namespaces: [alpha, alpha-staging]
        interfaces: [eth1]
        description: "Team Alpha production & staging"
        quotas:
          max_rules: 500
          max_alert_rate: 5000
          max_patterns: 50
          max_ratelimit_rules: 25
          max_qos_pipes: 16
      - id: team-beta
        name: "Team Beta"
        namespaces: [beta]
        interfaces: [eth2]
        # quotas: omitted → uses defaults
```

All quota fields are optional — omitted fields use defaults. The `max_alert_rate_per_sec` field is accepted as a backward-compatible alias for `max_alert_rate`.

## Prometheus Metrics

`GET /api/v1/tenants/metrics` (admin only) returns Prometheus text format:

```
# HELP ebpfsentinel_tenant_quota_limit Configured quota limit per tenant and resource.
# TYPE ebpfsentinel_tenant_quota_limit gauge
ebpfsentinel_tenant_quota_limit{tenant="alpha",resource="rules"} 1000
ebpfsentinel_tenant_quota_limit{tenant="alpha",resource="alert_rate"} 10000

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
