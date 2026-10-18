# Authentication Configuration

The `auth` section configures API authentication and RBAC.

## The API is shut by default

`auth.enabled` is `true` unless the file says otherwise, and the same routes
reload configuration, write firewall rules and arm the IPS. A file that names
no authentication method is the ordinary case: at first start the agent draws
a key for itself, writes it to `auth.bootstrap_key_path` as `0600` inside a
`0700` directory, and prints it once:

```text
{"level":"INFO","path":"/var/lib/ebpfsentinel/auth/api-key","api_key":"sk-...","message":"no authentication method was configured, so an API key was generated: send it as 'Authorization: Bearer <key>'. It is shown this once and kept at the path above"}
```

Every later start reads the same file back and says so without printing the
key, so tooling written on the first day keeps working. Read it when you need
it again:

```bash
sudo cat /var/lib/ebpfsentinel/auth/api-key
```

Drawing a new one is deleting the file and restarting the agent. Setting
`bootstrap_key_path: ""` refuses the generated key, and then one of `api_keys`,
`jwt` or `oidc` has to be configured or the agent refuses to start.

Turning authentication off is a decision the configuration has to carry:
`auth.enabled: false` with a non-loopback `agent.bind_address` refuses to
start, and `agent.allow_unauthenticated_api: true` is how an estate that
fences the port off by other means says so. The matching fence for the
encryption half is `agent.allow_plaintext_api`, in
[TLS](tls.md#plaintext-on-a-reachable-address-is-refused).

## Reference

```yaml
auth:
  enabled: true
  bootstrap_key_path: /var/lib/ebpfsentinel/auth/api-key   # "" refuses the generated key
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
| `enabled` | `bool` | `true` | Establish a principal before the control API answers. `/healthz` and `/readyz` stay public whatever it says |
| `bootstrap_key_path` | `string` | `/var/lib/ebpfsentinel/auth/api-key` | Where the key the agent draws for itself is kept, `0600` inside a `0700` directory. Read only when no other method is configured. `""` refuses the generated key |
| `metrics_auth_required` | `bool` | `true` | Whether `/metrics` requires authentication when auth is enabled |
| `api_keys` | `[ApiKey]` | `[]` | Static API keys |
| `api_key_salt` | `string` | random | Salt for API key hashing. A random 32-byte value is generated if omitted |
| `jwt` | `JwtConfig` | - | JWT (RS256) settings |
| `oidc` | `OidcConfig` | - | OIDC (JWKS) settings |

### ApiKey

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Key identifier (for audit/logging) |
| `key` | `string` | Yes | Secret key value |
| `role` | `string` | Yes | RBAC role: `admin`, `operator`, `viewer` |
| `namespaces` | `[string]` | No | Namespaces this key may access when `role: operator` (see [Namespace Scoping](#namespace-scoping)). Empty or omitted means **deny-all** for operators - it does not grant unrestricted access. Ignored for `admin`/`viewer` |

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

Either header carries either kind of credential: a bearer value is handed to
the providers whatever its shape, because the generated key is `sk-` and hex
rather than three dot-separated parts and it is what `--token` and
`EBPFSENTINEL_TOKEN` put in that header.

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

When authentication is enabled, an additional rate limit of **10 requests per second per IP** sustained, after a burst of 30, wraps the whole protected surface: every route under `/api/v1/`, read and write alike, not only the ones that present a credential. It is there to bound credential guessing, and it applies on top of the read and write tiers those routes already carry, so the tighter of the two is what a caller meets. The public probes and `/metrics` are outside it.

This is the agent's own API limit and has nothing to do with the `ratelimit` section, which is the datapath rate limiter for traffic passing through the host. The full set of API tiers is in [REST API](../api-reference/rest-api.md#rate-limiting).

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
