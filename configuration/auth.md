# Authentication Configuration

The `auth` section configures API authentication and RBAC.

## Reference

```yaml
auth:
  enabled: true
  api_key_salt: "optional-custom-salt"  # Random 32-byte generated if omitted
  api_keys:
    - name: "key-name"
      key: "secret-key-value"
      role: admin              # admin, operator, or viewer
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
| `issuer` | `string` | Yes | Expected token issuer |
| `audience` | `string` | Yes | Expected token audience |
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

## Security Notes

- Config files containing API keys should be `chmod 640` or stricter
- The agent warns on world-readable config/key files at startup
- Use environment variables for sensitive values when possible
