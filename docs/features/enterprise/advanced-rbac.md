# Advanced RBAC

> **Edition: Enterprise**

## Overview

Fine-grained per-domain, per-resource permissions with custom roles, inheritance, and subject-to-role assignments. Extends the OSS three-tier model (admin/operator/viewer) with 17 security domains, resource prefix constraints with wildcard support, and automatic HTTP middleware enforcement.

## Security Domains

Permissions are scoped to 17 individual security domains:

| Domain | Description |
|--------|-------------|
| `firewall` | Firewall rules |
| `ids` | Intrusion detection |
| `ips` | Intrusion prevention |
| `l7` | Layer 7 filtering |
| `dlp` | Data loss prevention |
| `dns` | DNS intelligence |
| `ddos` | Anti-DDoS protection |
| `nat` | Network address translation |
| `qos` | Quality of service |
| `conntrack` | Connection tracking |
| `routing` | Routing rules |
| `alerts` | Alert management |
| `audit` | Audit logs |
| `config` | Configuration |
| `ratelimit` | Rate limiting |
| `threatintel` | Threat intelligence |
| `loadbalancer` | Load balancer |

## Permission Hierarchy

Three permission levels with automatic inheritance:

| Permission | Satisfies |
|------------|-----------|
| `Admin` | Admin, Write, Read |
| `Write` | Write, Read |
| `Read` | Read only |

`Admin` satisfies all checks. `Write` satisfies `Read` checks. This is enforced by `DomainPermission::satisfies(required)`.

## Permission Grants

Grants follow the format `domain:permission` or `domain:permission:resource_prefix`:

```
firewall:read                # Read all firewall rules
firewall:write               # Create/update all firewall rules
firewall:write:team-a-*      # Write only rules with IDs starting with "team-a-"
ids:admin                    # Full admin access to IDS
dlp:read                     # Read DLP patterns
```

### Resource Prefix Constraints

Grants can optionally restrict access to resources matching a prefix:

- No prefix → unrestricted access to all resources in the domain
- Exact match → `"team-a-rule1"` matches only `"team-a-rule1"`
- Wildcard → `"team-a-*"` matches any resource ID starting with `"team-a-"`
- `"*"` → matches everything (equivalent to no prefix)

## Built-in Roles

Three non-deletable built-in roles:

| Role | Grants | Description |
|------|--------|-------------|
| `admin` | All domains, admin permission | Full access |
| `operator` | All domains, write permission | Read/write all |
| `viewer` | All domains, read permission | Read-only all |

## Custom Roles

Define organization-specific roles with explicit grants and optional inheritance:

```yaml
enterprise:
  advanced_rbac:
    enabled: true
    custom_roles:
      - id: firewall-operator
        name: "Firewall Operator"
        grants:
          - "firewall:admin"
          - "ids:read"
          - "dlp:read"
        parent: viewer

      - id: team-a-operator
        name: "Team A Operator"
        grants:
          - "firewall:write:team-a-*"
          - "ids:write:team-a-*"
        parent: viewer

      - id: soc-analyst
        name: "SOC Analyst"
        grants:
          - "alerts:read"
          - "audit:read"
          - "ids:read"
          - "threatintel:read"
```

## Role Inheritance

Roles can inherit grants from a parent role:

- `parent` field references another role (builtin or custom)
- Inherited grants are **merged** with explicit grants (deduplicated)
- Maximum inheritance depth: **10** (prevents pathological chains)
- Circular inheritance is detected and rejected
- Built-in roles cannot have parents
- `GET /api/v1/rbac/roles/{id}/effective-grants` resolves the full grant set

### Validation

`validate_role()` enforces:

- Parent role must exist
- No circular references
- Inheritance depth within limit
- Built-in roles cannot have parents

### Hot-Reload

`PUT /api/v1/rbac/roles` performs atomic two-pass reload:

1. Insert all roles (check for duplicates)
2. Validate inheritance (parent refs, cycles, depth)
3. On success: replace all custom roles, keep built-in
4. On failure: no changes applied (atomic rollback)

## Subject-to-Role Assignments

Map user identities (JWT `sub` claim or API key name) to roles:

```json
POST /api/v1/rbac/assignments
{ "subject": "user-123", "role_id": "firewall-operator" }
```

A subject can have multiple roles. Access is granted if **any** assigned role provides the required permission.

## HTTP Middleware

`rbac_enforcement_middleware` automatically enforces RBAC on all API requests:

### Path-to-Domain Mapping

| API Path | Security Domain |
|----------|----------------|
| `/api/v1/firewall/*` | `Firewall` |
| `/api/v1/ids/*` | `Ids` |
| `/api/v1/dlp/*`, `/api/v1/enterprise/dlp/*` | `Dlp` |
| `/api/v1/alerts/*`, `/api/v1/enterprise/alerts/*` | `Alerts` |
| `/api/v1/l7/*`, `/api/v1/enterprise/l7/*` | `L7` |
| `/api/v1/rbac/*`, `/api/v1/config/*`, `/api/v1/license/*` | `Config` |
| `/api/v1/enterprise/tenants/*`, `/api/v1/ebpf/*` | `Config` |
| `/swagger-ui`, `/api-docs/*` | `Config` |
| ... | (all 17 domains mapped) |

### An unrecognised path is refused

The table above is matched by prefix and is written by hand, so it is one edit
behind every route somebody mounts. A path it does not recognise is **refused
with 403**, whoever asks, including an admin:

```json
{
  "error": "access denied: this path maps to no security domain",
  "code": "RBAC_PATH_UNMAPPED"
}
```

Failing closed is the only safe direction here. A path with no domain has no
permission anybody could hold, so there is nothing to check an admin against
either, and passing it through would make every newly mounted route reachable
by any authenticated principal regardless of role until somebody noticed the
missing entry. Refusing instead makes the cost of a missing entry the route
itself, which the person who mounted it discovers immediately.

The mapping is not left to a review. A test enumerates every path the agent
mounts, reading them off the binary's own source, and fails when any of them
maps to no domain, so a route added without a table entry breaks the build
rather than being reachable by a viewer.

### The only path served without authorization

| Path | Why |
|------|-----|
| `GET /metrics` | The Prometheus scrape probe, which must answer before any principal exists |

That is the whole list. It lives in one constant, `RBAC_EXEMPT_PATHS`, whose
exact contents are pinned by a test, so adding a second exemption is a
deliberate edit to both the constant and the test rather than something that
can happen by accident. The enterprise API port mounts no liveness or readiness
path of its own; container probes use the OSS agent's HTTP port.

### Method-to-Permission Mapping

| HTTP Method | Permission |
|-------------|------------|
| GET, HEAD, OPTIONS | `Read` |
| POST, PUT, PATCH, DELETE | `Write` |

`DELETE` maps to `Write` because the permission model has three levels -
`Read`, `Write`, `Admin` - and no `Delete` of its own. This is a deliberate
limit rather than an oversight: a role that may modify a resource may also
remove it, so a role granted `Write` on a domain can delete within that domain.
Where deletion must be held apart from modification, grant `Write` to nobody
and put the mutating routes behind `Admin`, which is what the RBAC management
routes themselves do. Separating the two would mean a fourth permission level
in every role definition, every stored grant and every inheritance resolution,
which is a change to the grant model rather than to this table.

### Admin-Only Routes

RBAC management routes (create, delete, update, reload, assignments) require admin role. Read-only RBAC routes (check, filter, list, get, effective-grants) require read permission on `Config`.

### Error Response

```json
{
  "error": "access denied: role 'viewer' lacks write permission for firewall",
  "code": "RBAC_ACCESS_DENIED"
}
```

## REST API

### Role Management

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/rbac/roles` | viewer | advanced-rbac | List all roles. |
| `POST` | `/api/v1/rbac/roles` | operator | advanced-rbac | Create custom role (201). |
| `GET` | `/api/v1/rbac/roles/{id}` | viewer | advanced-rbac | Role details (404 if not found). |
| `PUT` | `/api/v1/rbac/roles/{id}` | operator | advanced-rbac | Update custom role (403 for built-in). |
| `DELETE` | `/api/v1/rbac/roles/{id}` | operator | advanced-rbac | Delete custom role (403 for built-in, 204 on success). |
| `GET` | `/api/v1/rbac/roles/{id}/effective-grants` | viewer | advanced-rbac | Resolved grants with inheritance. |
| `PUT` | `/api/v1/rbac/roles` | operator | advanced-rbac | Bulk reload all custom roles (atomic). |

### Permission Checking

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `POST` | `/api/v1/rbac/check` | operator | advanced-rbac | Check permission (`{ role_id, domain, permission, resource_id? }`). |
| `POST` | `/api/v1/rbac/filter` | operator | advanced-rbac | Filter accessible resources (`{ role_id, domain, resource_ids }`). |

### Subject Assignments

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `POST` | `/api/v1/rbac/assignments` | operator | advanced-rbac | Assign role to subject (201). |
| `DELETE` | `/api/v1/rbac/assignments` | operator | advanced-rbac | Remove role from subject (204). |
| `GET` | `/api/v1/rbac/assignments/{subject}` | viewer | advanced-rbac | List roles for subject. |

## Feature Gating

Advanced RBAC requires a valid license with the `advanced-rbac` feature. Without a license, the OSS three-tier model (admin/operator/viewer) is used without per-domain granularity.
