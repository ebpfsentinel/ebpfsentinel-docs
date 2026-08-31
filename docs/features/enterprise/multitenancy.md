# Multi-Tenancy

> **Edition: Enterprise**

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
| `tenant_id` | Numeric tenant identifier — allocated once (`max + 1`) and **stable** for the life of the tenant; adding/suspending/removing other tenants never renumbers it. The default tenant is always `0`. |
| `quota` | Per-tenant resource limits |
| `status` | `Active` or `Suspended`|
| `source` | `Config` (YAML) or `Api` (dynamic creation) |
| `self_service` | Self-service policy with allowed operations |

### Isolation Modes

| Mode | Use Case | eBPF Resolution | Config Field |
|------|----------|----------------|--------------|
| **Interface** | Containers, VMs with dedicated veth/tap | `TENANT_IFINDEX_MAP[ifindex] → tenant_id` | `interfaces` |
| **Subnet** | Bare-metal with shared NIC, per-client IP ranges | `TENANT_SUBNET_V4/V6[src_ip] → tenant_id` (LPM trie) | `subnets` |
| **VLAN** | Bare-metal with 802.1Q VLAN tagging | `TENANT_VLAN_MAP[vlan_id] → tenant_id` | `vlans` |
| **Cgroup** | Containers sharing a bridge, a subnet and no VLAN | `TENANT_CGROUP_MAP[cgroup_id] → tenant_id` | container label (see below) |
| **Hybrid** | Mixed environment | All checked in priority order | Any combination |

### Tenant Resolution Priority (eBPF kernel)

```
Packet arrives → Parse VLAN + IP headers
    │
    ├─ 1. TENANT_VLAN_MAP[vlan_id] → tenant_id    (if VLAN tagged)
    │
    ├─ 2. TENANT_IFINDEX_MAP[ifindex] → tenant_id  (if interface mapped)
    │
    ├─ 3. TENANT_SUBNET_V4[src_ip] → tenant_id    (IPv4 LPM trie)
    │     TENANT_SUBNET_V6[src_ip] → tenant_id    (IPv6 LPM trie)
    │
    ├─ 4. TENANT_CGROUP_MAP[cgroup_id] → tenant_id (egress only)
    │
    └─ 5. Default tenant_id = 0
```

Resolution runs in all 6 eBPF programs that enforce rules: xdp-firewall, xdp-ratelimit, tc-ids, tc-qos, tc-nat-ingress, tc-nat-egress. Step 4 is intrusion detection only: the cgroup id is read from the socket bound to the packet, which exists on egress but not on ingress, where the kernel runs in softirq context with no owning task.

### Cgroup Attribution

Containers on a shared bridge carry no VLAN tag, sit behind no dedicated interface, and usually share one subnet, so the first three modes cannot tell them apart. The remaining signal is the cgroup the traffic originated from.

Unlike VLANs, interfaces and subnets, a cgroup id is not something an operator declares: the kernel mints one per container at creation and recycles it after destruction. The agent therefore discovers the mapping at runtime — it polls the cgroup v2 hierarchy, reads each container's labels from the runtime, resolves a tenant, and writes `TENANT_CGROUP_MAP`. When a container exits its entry is removed in the same pass, so a recycled id can never inherit the previous tenant.

A container is attributed to a tenant by:

1. **Explicit claim** — the label named by `tenant_label` (default `ebpfsentinel.io/tenant`), whose value is matched against the tenant id first, then the tenant name. A claim naming an unknown tenant is logged and leaves the container unattributed rather than falling through.
2. **Kubernetes namespace** — when no claim label is present, `io.kubernetes.pod.namespace` is matched against the tenant's `namespaces` list, so a tenant that already declares namespaces gets container attribution without extra labels.

Labels are read over the Docker Engine API, which also serves Podman's compatible socket. Nodes running a CRI runtime with no Docker-compatible socket keep using VLAN, interface or subnet attribution. Attribution is disabled by default because it requires the runtime socket and the host cgroup hierarchy to be visible to the agent.

### Limits

- Maximum tenants: **65,535** (u32 tenant_id, practically unlimited)
- Default tenant ID: `__default__` (catch-all for unmatched traffic, `tenant_id=0`)
- Reserved: the `__default__` ID cannot be used for user-defined tenants
- Subnet entries: up to 4,096 IPv4 + 2,048 IPv6 per LPM trie
- VLAN entries: up to 1,024
- Cgroup entries: up to 4,096 (one per live container)

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

Every rule-bearing kernel structure carries a `tenant_id: u32`, and in all of
them:

- `tenant_id = 0` → **floating rule** (applies to all tenants)
- `tenant_id > 0` → **tenant-scoped rule** (only applies when packet's resolved tenant matches)

They enforce it differently, because their maps are shaped differently:

| Family | Structure | Behaviour |
|--------|-----------|-----------|
| IDS / IPS | `IdsPatternKey (tenant_id, dst_port, protocol)` | The classifier looks up the packet's tenant first and falls back to the `tenant_id = 0` entry, so a tenant-scoped rule **replaces** the global rule for that port rather than adding to it |
| Rate limit | `RateLimitKey (tenant_id, src_ip)` | Same fallback chain: `(tenant, ip)`, then `(0, ip)`, then the `(0, 0)` global default |
| QoS | `tenant_id` on the pipe and on the classifier value | The scan skips an entry whose non-zero `tenant_id` differs from the packet's, so a per-tenant pipe becomes that tenant's bandwidth share |
| Firewall / NAT | `tenant_id` on `FirewallRuleEntry` and `NatRuleEntry` | Same skip on mismatch, in the linear rule scan of `xdp-firewall`, `tc-nat-ingress` and `tc-nat-egress` |

Skip logic, for the scanned structures:
```
if rule.tenant_id != 0 && rule.tenant_id != packet_tenant_id {
    skip rule  // tenant mismatch
}
```

This check runs **after** the existing `group_mask` interface group check, preserving backward compatibility with OSS interface groups. Tenant attribution by interface has a map of its own, separate from the `INTERFACE_GROUPS` map that carries group bitmasks: the two share a key but not a value, and a bitmask read as a tenant id would attribute an interface in group 2 to tenant 2 while destroying the group scoping every rule set relies on.

Configure it with the `tenant_id` key on an
[IDS rule](../../configuration/ids.md#rule), an
[IPS rule](../../configuration/ips.md), a
[rate-limit rule](../../configuration/ratelimit.md#rule), a
[QoS pipe or classifier](../../configuration/qos.md#pipes), a
[firewall rule](../../configuration/firewall.md#rule), or a
[SNAT or DNAT rule](../../configuration/nat.md#rule-fields). Omitting it keeps
the rule global, which is the only behaviour a standalone agent produces: with
no tenant attribution configured every packet resolves to tenant `0`.

!!! note "A tenant-scoped firewall rule leaves the fast path"

    `xdp-firewall` answers exact-tuple rules from hash maps before it reaches the
    linear scan, and those keys carry the tuple and nothing else. A rule with a
    non-zero `tenant_id` is therefore kept out of the hash maps and evaluated in
    the scan, exactly as a rule restricted to an interface group already is.
    NPTv6 is the one translation that stays global: its prefix rewrite is
    stateless and carries no tenant.

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

Identity is resolved from a **verified principal only**:

1. **JWT claims** — `namespaces[0]` as tenant_id, `role` claim, `sub` as subject.
   The auth layer populates these for both a validated JWT **and** a validated
   API key.

A request without a verified principal is treated as **unauthenticated**: it
resolves to no tenant and the `Viewer` role. The `X-Tenant-Id` / `X-Tenant-Role`
headers are **not** trusted to assert tenant or role — honouring them would let
any client claim any tenant at any privilege. (`X-API-Key` is still read as the
subject for audit only and confers no access.)

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

## Tenant Self-Service

### Dynamic Tenant Lifecycle

Tenants can be created, suspended, and reactivated dynamically via the REST API (in addition to YAML configuration). Dynamic tenants created via the API are automatically persisted to a **redb** state store and restored on agent restart.

The tenant registry uses **ArcSwap** for lock-free reads on the hot path — tenant lookups (which happen on every packet in eBPF userspace fallback) never block, even during concurrent write operations like add/suspend/activate.

Dynamic tenant changes propagate to the kernel **live, without a restart**: after every create/suspend/activate the agent recomputes the VLAN→tenant, interface→tenant and subnet→tenant (IPv4/IPv6) resolution maps from the registry and pushes them into the loaded eBPF programs. Interfaces cross that boundary by name and are resolved to an ifindex on the node that writes the map, since an ifindex means nothing on any other node; a tenant interface absent from a given node is logged and skipped rather than failing the propagation. On an HA pair only the active (datapath-loaded) node writes the maps; a standby node's push is a no-op until it is promoted. Numeric `tenant_id` values are stable across these changes, so the maps and historical alerts stay consistent.

| Status | Description |
|--------|-------------|
| `Active` | Tenant is operational, rules are enforced, self-service allowed |
| `Suspended` | Tenant rules are inactive, API operations blocked, alerts suppressed |

| Source | Description |
|--------|-------------|
| `Config` | Defined in YAML config (default) |
| `Api` | Created dynamically via `POST /api/v1/enterprise/tenants` |

### Self-Service Policy

Each tenant can be granted self-service capabilities, allowing tenant operators to manage their own resources within quota limits. Self-service is a property of the tenant object set through the tenant management API (`POST`/`PUT /api/v1/enterprise/tenants`) — it is **not** part of the static `enterprise.tenants` YAML, which always starts a config-defined tenant with self-service disabled.

```json
{
  "self_service": {
    "enabled": true,
    "allowed_operations": ["manage_firewall_rules", "manage_ids_rules", "manage_dlp_patterns"]
  }
}
```

| Operation | Description |
|-----------|-------------|
| `manage_firewall_rules` | Create/update/delete firewall rules scoped to this tenant |
| `manage_ids_rules` | Create/update/delete IDS rules scoped to this tenant |
| `manage_dlp_patterns` | Create/update/delete DLP patterns scoped to this tenant |

Self-service operations are checked via `POST /api/v1/enterprise/tenants/{id}/self-service/check` before allowing mutations. A `403 Forbidden` is returned if the operation is not in the tenant's allow-list, the tenant is suspended, or the operation would exceed the tenant's resource quota (firewall/IDS rules count against the `rules` budget, DLP patterns against `patterns`).

### Self-Service API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/enterprise/tenants` | Create tenant dynamically (admin) |
| `POST` | `/api/v1/enterprise/tenants/{id}/suspend` | Suspend tenant (admin) |
| `POST` | `/api/v1/enterprise/tenants/{id}/activate` | Reactivate suspended tenant (admin) |
| `GET` | `/api/v1/enterprise/tenants/{id}/self-service` | Get self-service policy |
| `POST` | `/api/v1/enterprise/tenants/{id}/self-service/check` | Check if operation is allowed |

### Self-Service Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `tenant_added` | Counter | tenant, source | Tenant created |
| `tenant_suspended` | Counter | tenant | Tenant suspended |
| `tenant_activated` | Counter | tenant | Tenant reactivated |
| `self_service_check` | Counter | tenant, operation | Self-service authorization check |

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

    # Cgroup mode — attribute containers from their labels
    cgroup_attribution:
      enabled: true
      poll_interval_seconds: 10
      tenant_label: "ebpfsentinel.io/tenant"
```

All fields are optional:
- `name` defaults to `id` if omitted
- `interfaces`, `subnets`, `vlans`, `namespaces` default to empty
- `quotas` fields use defaults when omitted
- `cgroup_attribution` is disabled by default; when enabled it reads the cgroup root and runtime socket from the agent's `container.resolver.cgroup_root` and `container.docker.socket` settings

Run a container under a tenant by labelling it:

```bash
docker run -d --label ebpfsentinel.io/tenant=client-a nginx
```

## Prometheus Metrics

The tenant series are part of the enterprise registry and are scraped from
`/metrics` on the enterprise API port, under the `ebpfsentinel_ent_` prefix.
An OSS agent exposes none of them.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_tenants` | Gauge | - | Configured tenants |
| `ebpfsentinel_ent_tenants_added_total` | Counter | `source` | Tenants added dynamically, by the source they came from |
| `ebpfsentinel_ent_tenants_suspended_total` | Counter | - | Tenants suspended |
| `ebpfsentinel_ent_tenants_activated_total` | Counter | - | Tenants reactivated after suspension |
| `ebpfsentinel_ent_tenant_alerts_total` | Counter | `tenant` | Tenant-scoped alerts dispatched |
| `ebpfsentinel_ent_tenant_audit_total` | Counter | `tenant` | Tenant-scoped audit entries |
| `ebpfsentinel_ent_tenant_quota_usage_ratio` | Gauge | `tenant`, `resource` | Quota usage as a fraction of the limit (0.0 to 1.0) |
| `ebpfsentinel_ent_tenant_quota_exceeded_total` | Counter | `tenant`, `resource` | Requests refused because a quota was already at its limit |
| `ebpfsentinel_ent_tenant_self_service_checks_total` | Counter | `operation` | Self-service operations admitted, by operation |

A scrape sample reads:

```
# HELP ebpfsentinel_ent_tenants Total configured tenants.
# TYPE ebpfsentinel_ent_tenants gauge
ebpfsentinel_ent_tenants 3

# HELP ebpfsentinel_ent_tenant_quota_usage_ratio Quota usage ratio (0.0-1.0) by tenant and resource.
# TYPE ebpfsentinel_ent_tenant_quota_usage_ratio gauge
ebpfsentinel_ent_tenant_quota_usage_ratio{tenant="alpha",resource="rules"} 0.05

# HELP ebpfsentinel_ent_tenant_quota_exceeded Quota exceeded events by tenant and resource.
# TYPE ebpfsentinel_ent_tenant_quota_exceeded counter
ebpfsentinel_ent_tenant_quota_exceeded_total{tenant="alpha",resource="rules"} 0
```

There is no gauge in the registry carrying the configured limit itself. Usage
is published as a ratio so a panel needs no second series to be readable, and
the limit is read from `GET /api/v1/tenants/{id}/quota`.

`GET /api/v1/tenants/metrics` (admin only) is a different thing: a snapshot of
the configured limit and the current usage per tenant and resource, rendered
as Prometheus text by the handler itself. It is written rather than registered,
so it hangs under no prefix, is on no registry, and appears on neither
`/metrics` endpoint. Point a scrape job at `/metrics` and read the limit
through the quota endpoint; the snapshot is there for an operator reading it
by hand.

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
