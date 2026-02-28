# Authentication Configuration

The `auth` section configures API authentication and RBAC.

## Reference

```yaml
auth:
  enabled: true
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
| `public_key_path` | `string` | Yes | Path to RS256 public key |

### OidcConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jwks_url` | `string` | Yes | JWKS discovery URL |

## Authentication Methods

API keys can be combined with JWT or OIDC. The `CompositeAuthProvider` tries each configured method:

1. Check `X-API-Key` header against `api_keys`
2. Check `Authorization: Bearer <token>` against JWT or OIDC

## RBAC Roles

| Role | Read | Write | Admin |
|------|------|-------|-------|
| `viewer` | All endpoints | No | No |
| `operator` | All endpoints | Namespace-scoped | No |
| `admin` | All endpoints | All endpoints | Config reload, eBPF status |

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
