# Authentication Configuration

The `auth` section configures API authentication and RBAC.

## Reference

```yaml
auth:
  enabled: true
  metrics_auth_required: true             # Set to false to expose /metrics without auth
  api_key_salt: "optional-custom-salt"    # Random 32-byte generated if omitted
  api_keys:
    - name: "key-name"
      key: "secret-key-value"
      role: admin                         # admin, operator, or viewer
  jwt:
    issuer: "https://auth.example.com"
    audience: "ebpfsentinel"
    public_key_path: /etc/ebpfsentinel/jwt.pub
  oidc:
    jwks_url: "https://auth.example.com/.well-known/jwks.json"
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable authentication |
| `metrics_auth_required` | `bool` | `true` | Whether `/metrics` requires authentication when auth is enabled |
| `api_keys` | `[ApiKey]` | `[]` | Static API keys |
| `api_key_salt` | `string` | random | Salt for API key hashing. A random 32-byte value is generated if omitted |
| `jwt` | `JwtConfig` | — | JWT (RS256) settings |
| `oidc` | `OidcConfig` | — | OIDC (JWKS) settings |

### ApiKey

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Key identifier (for audit/logging) |
| `key` | `string` | Yes | Secret key value |
| `role` | `string` | Yes | RBAC role: `admin`, `operator`, `viewer` |

### JwtConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issuer` | `string` | No | Expected token issuer (validated when set) |
| `audience` | `string` | No | Expected token audience (validated when set) |
| `public_key_path` | `string` | Yes | Path to RS256 public key (RSA 2048-bit minimum enforced) |

### OidcConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jwks_url` | `string` | Yes | JWKS discovery URL (must be HTTPS, 10s fetch timeout) |

## Authentication Methods

API keys can be combined with JWT or OIDC. The `CompositeAuthProvider` tries each configured method:

1. Check `X-API-Key` header against `api_keys`
2. Check `Authorization: Bearer <token>` against JWT or OIDC

## RBAC Roles

| Role | Read | Write | Admin |
|------|------|-------|-------|
| `viewer` | All endpoints | No | No |
| `operator` | All endpoints | Namespace-scoped (see below) | No |
| `admin` | All endpoints | All endpoints | Config reload, eBPF status |

## Namespace Scoping

Operators are scoped to namespaces. A namespace value of `None` (or omitted) means **deny-all** -- it does not grant unrestricted access. Operators must list their allowed namespaces explicitly.

## Token Revocation

Token revocation is built-in using a `sub:iat` (subject + issued-at) pair. Revoking a token invalidates all tokens for that subject issued at or before the revocation timestamp.

## Rate Limiting

When authentication is enabled, an additional rate limit of **10 requests per second per IP** is applied to authentication endpoints. This is layered on top of any global rate limiting configured in the `ratelimit` section.

## Examples

### API keys only

```yaml
auth:
  enabled: true
  api_keys:
    - name: admin
      key: "sk-admin-key-change-me"
      role: admin
    - name: monitoring
      key: "sk-monitoring-change-me"
      role: viewer
```

### OIDC with API key fallback

```yaml
auth:
  enabled: true
  api_keys:
    - name: ci-pipeline
      key: "sk-ci-pipeline"
      role: operator
  oidc:
    jwks_url: "https://auth.example.com/.well-known/jwks.json"
```

### EdDSA JWT signed by the dashboard (JWKS)

The agent verifies short-lived per-tenant tokens minted by the dashboard
by fetching the rotating Ed25519 verification key from a JWKS endpoint.

```yaml
auth:
  enabled: true
  jwt:
    algorithm: EdDSA
    jwks_url: https://dashboard.example.com/.well-known/jwks.json
    jwks_cache_ttl_seconds: 3600
    jwks_refresh_on_unknown_kid: true
    issuer: https://dashboard.example.com
    audience: ebpfsentinel-agent
```

| Field | Type | Default | Description |
|---|---|---|---|
| `auth.jwt.algorithm` | `RS256` \| `EdDSA` | `RS256` | Signing algorithm. `EdDSA` requires either an Ed25519 PEM at `public_key_path` or `kty=OKP, crv=Ed25519` keys at `jwks_url`. |
| `auth.jwt.public_key_path` | path | unset | PEM-encoded public key. Mutually exclusive with `jwks_url`. |
| `auth.jwt.jwks_url` | URL | unset | JWKS endpoint (`https://`). Mutually exclusive with `public_key_path`. |
| `auth.jwt.jwks_cache_ttl_seconds` | u64 | `3600` | Cache TTL in seconds. The agent refreshes on TTL expiry. |
| `auth.jwt.jwks_refresh_on_unknown_kid` | bool | `true` | Reserved for the immediate-on-unknown-kid refresh path; the current synchronous middleware caches at startup, the immediate-refresh hook lands with the async middleware in a follow-up story. |
| `auth.jwt.issuer` | string | unset | Expected `iss` claim. |
| `auth.jwt.audience` | string | unset | Expected `aud` claim. |

Setting `algorithm: EdDSA` with `public_key_path` works for static keys;
setting it with `jwks_url` is the recommended path because the dashboard
rotates its signing key on a schedule and a static PEM would have to be
redeployed each time.

## Security Notes

- Config files containing API keys should be `chmod 640` or stricter
- The agent warns on world-readable config/key files at startup
- Use environment variables for sensitive values when possible
