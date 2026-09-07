# Per-Protocol L7 Security Policies

> **Edition: Enterprise** | **License Feature: `advanced-dlp`**

## Overview

The enterprise per-protocol policy engine layer judges protocol-specific
access controls and dangerous operations beyond the OSS L7 firewall's
simple allow/deny rules. It covers the six highest-impact server
protocols: **Redis**, **MongoDB**, **Kafka**, **MySQL / PostgreSQL**,
**LDAP**, and **SSH**.

Every evaluator consumes a pre-parsed request object and returns a
`PolicyDecision` - one of `Allow`, `Alert(violation)`, or
`Deny(violation)`. Violations carry a stable machine-readable
`PolicyCode` (e.g. `redis.dangerous_command`, `sql.ddl_blocked`,
`ssh.weak_algorithm`) plus a severity carried into the SIEM exporters
when the submission asks for enrichment.

## What a decision is, and what it is not

These policies are not attached to the packet path. A decision is
produced when a caller submits a pre-parsed request to
`POST /api/v1/enterprise/l7/analyze`, and the answer comes back in the
`policy` field of that response.

The consequence is specific to this feature: **nothing here forwards,
drops or resets a connection.** A `Deny` is a verdict, not an
enforcement. Whatever submitted the request - a proxy, a sidecar, a
service mesh filter, a broker plugin - is what holds the connection and
is what must act on the verdict. An operator who reads `Deny` in the
policy decisions log and expects the traffic to have been stopped is
reading it wrongly.

The engines being decoupled from the wire parsers is what makes this
possible: they take a `RedisRequest` or a `SqlRequest`, never bytes off
an interface, which keeps them small, deterministic and easy to unit
test - and leaves the parsing, and the acting, to the submitter.

## Supported Protocols

| Protocol | What gets judged | Built-in rules |
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

## Example - Redis

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

// The evaluator returns a verdict. Acting on it is the caller's job.
match policy.evaluate(&req) {
    PolicyDecision::Allow => println!("allow"),
    PolicyDecision::Alert(v) => println!("alert: {}", v.reason),
    PolicyDecision::Deny(v) => println!("deny: {}", v.reason),
}
```

The same evaluation reached over HTTP, and what comes back:

```bash
curl -sk -X POST https://agent:8444/api/v1/enterprise/l7/analyze \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' \
  -d '{
        "protocol": "redis",
        "payload_b64": "",
        "redis": {"command": "FLUSHALL", "tenant": "tenant-a"}
      }'
```

```json
{
  "protocol": "redis",
  "duration_ns": 41200,
  "inspect_matches": [],
  "policy": {
    "outcome": "deny",
    "code": "redis.dangerous_command",
    "severity": "high",
    "reason": "Redis command FLUSHALL blocked by policy"
  },
  "enriched_alerts": []
}
```

`"outcome": "deny"` says the command would be refused by this policy. The
agent did not see the command on the wire and has stopped nothing.

## Example - SQL

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

## REST API

A `PUT` replaces the policy for one protocol as a whole; there is no partial update.

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/l7/policy/decisions` | viewer | advanced-dlp | Recent per-protocol policy decisions. |
| `GET` | `/api/v1/enterprise/l7/policy/redis` | viewer | advanced-dlp | Current Redis policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/redis` | operator | advanced-dlp | Replace the Redis policy. |
| `GET` | `/api/v1/enterprise/l7/policy/mongodb` | viewer | advanced-dlp | Current MongoDB policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/mongodb` | operator | advanced-dlp | Replace the MongoDB policy. |
| `GET` | `/api/v1/enterprise/l7/policy/kafka` | viewer | advanced-dlp | Current Kafka policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/kafka` | operator | advanced-dlp | Replace the Kafka policy. |
| `GET` | `/api/v1/enterprise/l7/policy/sql` | viewer | advanced-dlp | Current SQL policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/sql` | operator | advanced-dlp | Replace the SQL policy. |
| `GET` | `/api/v1/enterprise/l7/policy/ldap` | viewer | advanced-dlp | Current LDAP policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/ldap` | operator | advanced-dlp | Replace the LDAP policy. |
| `GET` | `/api/v1/enterprise/l7/policy/ssh` | viewer | advanced-dlp | Current SSH policy. |
| `PUT` | `/api/v1/enterprise/l7/policy/ssh` | operator | advanced-dlp | Replace the SSH policy. |

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
the `advanced-dlp` feature flag - the same gate as the existing
Vectorscan DLP engine and the L7 deep-content-inspection engine - so
that all enterprise L7 security capabilities light up together. Without
a license the engines stay idle and the OSS L7 firewall operates
unchanged.
