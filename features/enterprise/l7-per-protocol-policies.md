# Per-Protocol L7 Security Policies

> **Edition: Enterprise** | **Status: Shipped — policy engines**
> (HTTP admin API + dispatcher wiring ship in a follow-up release) | **License Feature: `advanced-dlp`**

## Overview

The enterprise per-protocol policy engine layer enforces protocol-specific
access controls and dangerous-operation blocking beyond the OSS L7
firewall's simple allow/deny rules. It covers the six highest-impact
server protocols: **Redis**, **MongoDB**, **Kafka**, **MySQL /
PostgreSQL**, **LDAP**, and **SSH**.

Every evaluator consumes a pre-parsed request object and returns a
`PolicyDecision` — one of `Allow`, `Alert(violation)`, or
`Deny(violation)`. Violations carry a stable machine-readable
`PolicyCode` (e.g. `redis.dangerous_command`, `sql.ddl_blocked`,
`ssh.weak_algorithm`) plus a severity that the SIEM exporters will use
for alert enrichment once a follow-up release wires the policy layer into the
enterprise L7 dispatcher.

The domain layer is decoupled from the wire parsers by design: the
enterprise L7 dispatcher extracts request metadata, calls the relevant
policy, and then decides whether to forward, alert, or drop the flow.
This keeps the policy engines small, deterministic, and easy to unit
test.

## Supported Protocols

| Protocol | What gets enforced | Built-in rules |
|----------|--------------------|----------------|
| **Redis** | Dangerous command blocking, per-tenant key namespace isolation, per-command rate limits | 15 blocked commands (`EVAL`, `CONFIG`, `KEYS`, `FLUSHALL`, `FLUSHDB`, `DEBUG`, `SHUTDOWN`, `SCRIPT`, `MODULE`, `REPLICAOF`, `SLAVEOF`, `MIGRATE`, `SAVE`, `BGSAVE`, `EVALSHA`) |
| **MongoDB** | Admin command blocking, collection allow/deny, JavaScript-injection detection | 12 admin commands (`dropDatabase`, `drop`, `createUser`, `dropUser`, `grantRolesToUser`, `revokeRolesFromUser`, `shutdown`, `eval`, `copydb`, `fsync`, `replSetReconfig`, `replSetInitiate`) + `$where` / `$function` / `$accumulator` / `mapReduce` heuristic |
| **Kafka** | Topic-pattern ACLs (produce / consume / admin), client-ID allowlisting, max message size | Glob matcher with trailing/leading `*`, configurable `max_message_bytes` |
| **SQL (MySQL + PostgreSQL)** | Statement classification (SELECT / INSERT / UPDATE / DELETE / DDL / DCL), schema allowlist, query complexity caps | DDL + DCL default-deny; join-count and paren-depth caps |
| **LDAP** | Bind DN restrictions, scope limiting, sensitive attribute filtering | 7 built-in sensitive attrs (`userPassword`, `unicodePwd`, `pwdHistory`, `krbPrincipalKey`, `supplementalCredentials`, `ntPwdHistory`, `lmPwdHistory`) |
| **SSH** | Minimum protocol version, weak algorithm rejection, scanner banner detection | 3 weak KEX, 9 weak ciphers, 4 weak MACs, 5 scanner substrings |

## Decision model

```rust
pub enum PolicyDecision {
    Allow,
    Alert(PolicyViolation),
    Deny(PolicyViolation),
}

pub struct PolicyViolation {
    pub code: PolicyCode,
    pub severity: PolicySeverity,
    pub reason: String,
}
```

`PolicyCode` is a stable string identifier (namespaced per protocol)
suitable for SIEM indexing and dashboards. `PolicySeverity` maps to
Low / Medium / High / Critical, feeding the standard alert severity
pipeline.

## Example — Redis

```rust
use enterprise_domain::l7_policy::{RedisPolicy, RedisRequest};

let mut policy = RedisPolicy::with_builtin_blocklist();
policy.set_tenant_namespace("tenant-a", "a:");
policy.set_command_budget("INCR", 10_000);

let req = RedisRequest {
    command: "GET",
    key: Some("a:user:42"),
    tenant: Some("tenant-a"),
};

match policy.evaluate(&req) {
    PolicyDecision::Allow => forward_request(),
    PolicyDecision::Alert(v) => emit_alert(v),
    PolicyDecision::Deny(v)  => drop_connection(v),
}
```

## Example — SQL

```rust
use enterprise_domain::l7_policy::{SqlPolicy, SqlRequest};

let mut policy = SqlPolicy::new();
policy.allow_schema("app");
policy.set_max_join_count(5);
policy.set_max_subquery_depth(4);

let req = SqlRequest {
    sql: "SELECT id FROM users WHERE id = 1",
    schema: Some("app"),
};
assert!(policy.evaluate(&req).is_allow());
```

## Status & Roadmap

### Shipped

- Six policy engines under `enterprise_domain::l7_policy`.
- 45 unit tests covering allow / deny / alert paths per protocol.
- Shared `PolicyDecision` / `PolicyViolation` / `PolicyCode` types.

### Shipping in a follow-up release

- REST admin API at `/api/v1/enterprise/l7/{protocol}/policy`.
- Service layer wrapping the engines with tenant isolation, metrics,
  and rate-limit window rollover.
- Prometheus counter `l7_policy_decisions_total{protocol, code}`.
- Enterprise L7 dispatcher wiring so every parsed request is
  evaluated on the hot path.
- SIEM enrichment: policy code + severity on exported alerts.
- PCI-DSS 6.5 + CIS per-protocol compliance mapping.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `enterprise-domain` | `crates/enterprise-domain/src/l7_policy/entity.rs` | Shared decision / violation / code types |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_policy/redis.rs` | Redis evaluator |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_policy/mongodb.rs` | MongoDB evaluator |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_policy/kafka.rs` | Kafka evaluator + glob matcher |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_policy/sql.rs` | SQL classifier + evaluator |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_policy/ldap.rs` | LDAP evaluator |
| `enterprise-domain` | `crates/enterprise-domain/src/l7_policy/ssh.rs` | SSH evaluator + banner parser |

## Feature Gating

The per-protocol policy layer requires a valid enterprise license with
the `advanced-dlp` feature flag — the same gate as the existing
Vectorscan DLP engine and the L7 deep-content-inspection engine — so
that all enterprise L7 security capabilities light up together. Without
a license the engines stay idle and the OSS L7 firewall operates
unchanged.
