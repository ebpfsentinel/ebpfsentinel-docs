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
| `pq_tokens` | `prefer` \| `require` \| `disable` | `prefer` | What a JWT's ML-DSA-65 cosignature has to be (see [Post-quantum token cosignature](#post-quantum-token-cosignature)) |
| `jwt` | `JwtConfig` | - | JWT (RS256) settings |
| `oidc` | `OidcConfig` | - | OIDC (JWKS) settings |

### ApiKey

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | Key identifier (for audit/logging) |
| `key` | `string` | Yes | Secret key value |
| `role` | `string` | No | RBAC role: `admin`, `operator`, `viewer`. Defaults to `viewer`, so a key written without one can read and change nothing |
| `namespaces` | `[string]` | No | Namespaces this key may access when `role: operator` (see [Namespace Scoping](#namespace-scoping)). Empty or omitted means **deny-all** for operators - it does not grant unrestricted access. Ignored for `admin`/`viewer` |

### JwtConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `issuer` | `string` | No | Expected token issuer (validated when set) |
| `audience` | `string` | No | Expected token audience (validated when set) |
| `public_key_path` | `string` | Yes | Path to RS256 public key (RSA 2048-bit minimum enforced) |
| `ml_dsa_public_key_path` | `string` | No | With `public_key_path`: base64 of the raw ML-DSA-65 public key (1952 bytes) cosignatures are checked against. Under an allowed key directory like `public_key_path` |

### OidcConfig

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `jwks_url` | `string` | Yes | JWKS discovery URL (must be HTTPS, 10s fetch timeout) |
| `issuer` | `string` | No | Expected `iss` claim, refused when it differs. Unset accepts any issuer the key set signs for |
| `audience` | `string` | No | Expected `aud` claim. Unset accepts a token issued to any client of the provider (see below) |

## Authentication Methods

API keys can be combined with JWT or OIDC. The `CompositeAuthProvider` tries each configured method:

1. Check `X-API-Key` header against `api_keys`
2. Check `Authorization: Bearer <token>` against JWT or OIDC

Either header carries either kind of credential: a bearer value is handed to
the providers whatever its shape, because the generated key is `sk-` and hex
rather than three dot-separated parts and it is what `--token` and
`EBPFSENTINEL_TOKEN` put in that header.

## RBAC Roles

| Role | Read | Write |
|------|------|-------|
| `viewer` | All endpoints | None |
| `operator` | All endpoints | Namespaced firewall rules (see below), IPS rule modes, alert triage, learning sessions, packet traces and policy replays, threat-feed refresh, alias content, the DNS cache and the domain blocklist |
| `admin` | All endpoints | Every write, including everything that changes the whole node: configuration reload and section writes, L7 rules, conntrack flush, IPS blacklist, rate limiting, NAT, DDoS, zones, routing, load balancing, QoS, manual responses and captures |

The [endpoint summary](../api-reference/rest-api.md#endpoint-summary) gives
the role of every write. A write the agent has no entry for needs `admin`. The
Kubernetes operator calls configuration reload and the VIP endpoints, so the
key it holds must carry `admin`.

## Namespace Scoping

Operators are scoped to namespaces. A namespace value of `None` (or omitted) means **deny-all** -- it does not grant unrestricted access. Operators must list their allowed namespaces explicitly.

## Withdrawing Access

The agent keeps no revocation list. An API key stops working once it is
removed from `auth.api_keys` and the agent restarts. A token stops working when
it expires, so keep token lifetimes short; to withdraw one before then, rotate
the signing key at the issuer, or for a static key replace the file at
`auth.jwt.public_key_path` and reload the configuration.

When `auth.oidc` names no `audience`, the agent accepts a token the provider
issued for any of its applications, and says so in a warning at startup. Set
`audience` to the client this agent is registered as.

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
| `auth.jwt.jwks_refresh_on_unknown_kid` | bool | `true` | A token signed with a key id the cached set does not hold fetches the set again at once rather than waiting for the next refresh, under a cooldown shared by every request so an unauthenticated client cannot make the agent fetch on demand. `false` refuses such a token until the scheduled refresh picks the key up. |
| `auth.jwt.issuer` | string | unset | Expected `iss` claim. |
| `auth.jwt.audience` | string | unset | Expected `aud` claim. |

Setting `algorithm: EdDSA` with `public_key_path` works for static keys;
setting it with `jwks_url` is the recommended path because the dashboard
rotates its signing key on a schedule and a static PEM would have to be
redeployed each time.

## Post-quantum token cosignature

Every token the dashboard mints is signed twice. The JWT itself carries the
Ed25519 signature; an ML-DSA-65 signature over the whole compact token travels
beside it in the `X-Ebpfsentinel-Token-Cosignature` header (gRPC metadata
`x-ebpfsentinel-token-cosignature`). The ML-DSA-65 public key is published in
the dashboard's JWKS under the same `kid` as the Ed25519 key, as an entry with
`kty: AKP`, `alg: ML-DSA-65` and the raw key in `pub`. A JWKS consumer that does
not know that entry reads past it.

`auth.pq_tokens` says what the agent does with it, on the REST API, on gRPC and
on the enterprise API alike:

| Value | A token with a valid cosignature | A token without one | A token with a wrong one |
|---|---|---|---|
| `prefer` (default) | accepted | accepted | refused |
| `require` | accepted | refused | refused |
| `disable` | accepted, cosignature ignored | accepted | accepted, cosignature ignored |

A cosignature that does not verify is refused under `prefer` too: a token
somebody bothered to cosign and got wrong is not a classical token.

The setting applies to `auth.jwt` tokens. With `jwks_url` the key is read off
the JWKS; with `public_key_path` it is read from `ml_dsa_public_key_path`, and
without that file `require` refuses every token. Tokens issued by your own
identity provider through `auth.oidc` and API keys are never asked for a
cosignature: the identity provider signs what it signs.

```yaml
auth:
  enabled: true
  pq_tokens: require
  jwt:
    algorithm: EdDSA
    jwks_url: https://dashboard.example.com/.well-known/jwks.json
    issuer: https://dashboard.example.com
    audience: ebpfsentinel-agent
```

Outside this setting, and said so rather than left to be assumed: image and
release signatures (cosign keyless through Fulcio), WebPKI certificates on any
listener, and tokens issued by your identity provider. Licences and signed
content bundles were already signed with Ed25519 and ML-DSA-65 and both
signatures are required. The portal's enrolment answer carries no signature of
its own: it is read over TLS from the address you configured, and a signing key
on the host that answers it is what the portal design refuses.

## Security Notes

- Config files containing API keys should be `chmod 640` or stricter
- The agent warns on world-readable config/key files at startup
- Use environment variables for sensitive values when possible
