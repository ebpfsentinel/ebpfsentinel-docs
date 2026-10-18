# Authentication

> **Edition: OSS** | **Enforcement: Userspace**

## Overview

eBPFsentinel supports three authentication methods for API and CLI access: static API keys, JWT (RS256 or EdDSA, from a PEM file or a JWKS endpoint), and OIDC (JWKS discovery). Methods can be combined - API keys work alongside JWT or OIDC via a composite authentication provider. Role-based access control (RBAC) governs what each authenticated identity can do.

Authentication is on unless the configuration turns it off, and a file that
names none of the three methods still authenticates: the agent draws a key for
itself at first start.

### The key the agent draws for itself

With `auth.enabled` left at its default and no method configured, the agent
generates a key at first start, writes it to `auth.bootstrap_key_path`
(`/var/lib/ebpfsentinel/auth/api-key`) as `0600` inside a `0700` directory, and
prints it once:

```text
{"level":"INFO","path":"/var/lib/ebpfsentinel/auth/api-key","api_key":"sk-...","message":"no authentication method was configured, so an API key was generated: send it as 'Authorization: Bearer <key>'. It is shown this once and kept at the path above"}
```

The key is `sk-` followed by 64 hexadecimal characters. Later starts read the
file back rather than drawing another, so a script written against the first
start keeps working. Deleting the file and restarting draws a new one; setting
`bootstrap_key_path: ""` refuses the generated key, and a method then has to be
configured or the agent refuses to start. Naming `api_keys`, `jwt` or `oidc`
also replaces it: the generated key is read only when nothing else is there.

```bash
export EBPFSENTINEL_TOKEN=$(sudo cat /var/lib/ebpfsentinel/auth/api-key)
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/firewall/rules
ebpfsentinel-agent firewall list
```

## Authentication Methods

### API Keys

Static tokens configured in YAML. Best for automation, CI/CD pipelines, and monitoring agents. Keys are stored as configurable salted SHA-256 hashes - plaintext keys never persist in memory after initial hashing. Validation uses constant-time comparison to prevent timing side-channels.

```yaml
auth:
  enabled: true
  api_key_salt: "a-stable-secret"   # Optional. A random 32-byte salt is drawn at
                                    # startup when absent, so hashes change on restart
  api_keys:
    - name: admin
      key: "sk-change-me-admin-key"
      role: admin
    - name: monitoring
      key: "sk-change-me-monitoring"
      role: viewer
    - name: prod-operator
      key: "sk-change-me-operator"
      role: operator
      namespaces: [prod, staging]   # Namespaces this key may write to
```

`role` defaults to `viewer` when omitted. `namespaces` is only consulted for
the `operator` role: a key with an empty or absent list grants no namespace at
all, which is a deny rather than a wildcard.

Use with `X-API-Key` header or `--token` CLI flag:

```bash
curl -H "X-API-Key: sk-change-me-admin-key" http://localhost:8080/api/v1/firewall/rules
ebpfsentinel-agent --token sk-change-me-admin-key firewall list
```

### JWT

Service-to-service authentication against a public key the agent holds. The
agent validates tokens against the configured issuer, audience and key. A
bearer value is handed to the configured providers whatever its shape - the
generated key travels in the same header and is not a JWT - so a malformed
token is refused by verification rather than by a shape test, and an empty one
is refused before that. RSA 2048-bit minimum key size is enforced at key load
and on rotation.

Two algorithms are accepted. `RS256` is the default and verifies with an
RSA-2048+ public key. `EdDSA` verifies with an Ed25519 key, which is what the
dashboard's short-lived per-tenant tokens use.

The verification key comes from exactly one of `public_key_path` (a PEM file on
disk) or `jwks_url` (an endpoint the agent fetches at startup and refreshes in
the background). Setting both is refused at boot rather than resolved by
precedence.

Token revocation is supported via `sub:iat` revocation keys - when a token is
revoked, its subject and issued-at timestamp form a composite key that is
checked on every request.

```yaml
auth:
  enabled: true
  jwt:
    algorithm: RS256               # RS256 (default) or EdDSA
    issuer: "https://auth.example.com"
    audience: "ebpfsentinel"
    public_key_path: /etc/ebpfsentinel/jwt.pub
```

```yaml
auth:
  enabled: true
  jwt:
    algorithm: EdDSA
    issuer: "https://dashboard.example.com"
    audience: "ebpfsentinel"
    jwks_url: "https://dashboard.example.com/.well-known/jwks.json"
    jwks_cache_ttl_seconds: 3600       # Default 3600
    jwks_refresh_on_unknown_kid: true  # Default true: refetch once on an unknown kid
```

`issuer` and `audience` are optional and validated only when set.

### OIDC (JWKS Discovery)

SSO integration via OpenID Connect. The agent fetches the JWKS (JSON Web Key Set) from the discovery URL and validates tokens dynamically.

```yaml
auth:
  enabled: true
  oidc:
    jwks_url: "https://auth.example.com/.well-known/jwks.json"
    issuer: "https://auth.example.com"   # Optional, validated when set
    audience: "ebpfsentinel"             # Optional, validated when set
```

### Combined Authentication

API keys can be combined with JWT or OIDC for mixed environments (human users via SSO, automation via API keys). The composite auth provider returns a generic "authentication failed" error on all failures - no information about which provider was tried or why it failed is leaked to the caller.

```yaml
auth:
  enabled: true
  api_keys:
    - name: ci-pipeline
      key: "sk-ci-pipeline-key"
      role: operator
  oidc:
    jwks_url: "https://auth.example.com/.well-known/jwks.json"
```

## RBAC Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access to all endpoints |
| `operator` | Every write the `viewer` role is refused, **except** firewall rules whose scope is `global` or an interface: those are admin-only. A namespace-scoped rule needs that namespace in the identity's `namespaces` claim, and an identity with no `namespaces` claim at all grants no namespace rather than all of them. The rule must also match a source or destination inside that namespace's [`cidrs`](../configuration/namespaces.md), or it is refused with `NAMESPACE_TRAFFIC_FORBIDDEN` |
| `viewer` | Read-only access to all endpoints |

A token carrying no `role` claim is treated as `viewer`.

### Public Endpoints (No Auth Required)

| Path | Description |
|------|-------------|
| `/healthz` | Liveness probe |
| `/readyz` | Readiness probe |

All `/api/v1/*` endpoints require authentication, which is on by default.
`/metrics` does too, unless `auth.metrics_auth_required: false` is set - the
default is `true`, so a Prometheus scraper needs a viewer key. The Helm chart
turns it off (`metrics.authRequired: false`) so a ServiceMonitor scrapes
without holding the agent's key, and the control plane stays shut either way.

### Rate Limiting

When authentication is enabled, auth endpoints are rate-limited to **10 requests per second per source IP** sustained, after a burst of 30. This applies to all authenticated API paths and prevents brute-force attacks against API keys and tokens.

Two further per-IP limits apply whether or not authentication is enabled:

| Surface | Sustained | Burst |
|---|---|---|
| Read endpoints (`GET /api/v1/*`) | 200 requests per minute | 200 |
| `/metrics` | 30 requests per minute | 10 |

A limit refills continuously rather than resetting on a window boundary, so a client staying at or below the sustained rate never spends its burst. Over the limit, the agent answers `429 Too Many Requests` with a `Retry-After` header. Mutating endpoints have their own configurable limit; see [agent configuration](../configuration/agent.md#write-api-rate-limit).

## Configuration

See [Configuration: Authentication](../configuration/auth.md) for the full reference.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/auth/` | Auth engine (token validation, RBAC) |
| `infrastructure` | `crates/infrastructure/src/config/auth.rs` | Auth config parsing |
| `adapters` | `crates/adapters/src/auth/` | JWKS fetch, OIDC discovery, API key store |
| `agent` | `crates/agent/src/http/middleware/auth.rs` | Axum middleware for auth extraction |
| `agent` | `crates/agent/src/http/middleware/rbac.rs` | Role check on the extracted identity |
