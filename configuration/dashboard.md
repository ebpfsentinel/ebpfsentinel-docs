# Dashboard configuration

The dashboard server reads exactly one YAML file at the path passed via
`--config` (or `DASHBOARD_CONFIG` env var, default
`/etc/ebpfsentinel-dashboard/dashboard.yaml`). The file is parsed,
validated, and held in a typed `Config` struct; misconfiguration fails
fast at startup with a structured error pointing at the offending field.

## CLI flags

| Flag | Default | Purpose |
|---|---|---|
| `--config <path>` / `-c` | `/etc/ebpfsentinel-dashboard/dashboard.yaml` | Path to the YAML configuration. Also reads `DASHBOARD_CONFIG`. |
| `--config-check` | off | Parse + validate the config and exit `0` (success) or `1` (any structured error). Useful in CI / pre-deploy gates. |

## Schema

Every section uses `serde(deny_unknown_fields, default)` — typos fail
fast. Every value is validated below.

### `server`

| Field | Type | Default | Validation |
|---|---|---|---|
| `bind` | `host:port` | `0.0.0.0:8080` | Port in `1..=65535`. |
| `public_url` | URL | `https://dashboard.example.com` | Must be `http(s)://`. |
| `tls.cert_path` | path | unset | Must exist when set. Set together with `key_path`. |
| `tls.key_path` | path | unset | Must exist when set. Warn if mode > `0640`. |
| `cors_allow_origins` | string list | `[]` | Empty = same-origin only. |
| `static_dir` | path | `/app/site` | Static asset root served at `/`. |
| `request_timeout_seconds` | u64 | `30` | `1..=600`. |

### `oidc`

| Field | Type | Default | Validation |
|---|---|---|---|
| `issuer_url` | URL | (required) | Must be `https://`. `http://127.0.0.1`, `http://::1`, `http://localhost` accepted for local development only. |
| `client_id` | string | (required) | Non-empty. |
| `client_secret_file` | path | (required) | Path to a file holding the OIDC client secret. Read at startup, body trimmed, stored in `secrecy::SecretString` (zeroised on drop, never `Debug`-printed). Warn if mode > `0640`. |
| `scopes` | string list | `[openid, profile, email, groups]` | |
| `tenant_claim` | string | `tenant` | OIDC claim mapped to the dashboard tenant id. |
| `role_claim` | string | `groups` | OIDC claim mapped to the dashboard role list. |
| `post_logout_redirect_uri` | URL | unset | Optional URL the IdP redirects to after `end_session_endpoint`. Must be `http(s)://` when set. |
| `session_ttl_seconds` | u64 | `43200` | Lifetime of the per-user session JWT (`60..=2592000`). Default 12 h. |
| `cookie_signing_key_file` | path | (required) | Path to a file holding the HMAC seed used to sign the short-lived `pkce_state` cookie. Same on-disk contract as every other secret (mode ≤ `0640`). An empty file falls back to an ephemeral key — sessions do not survive a restart. |

### `jwt`

EdDSA session tokens + per-tenant agent JWTs + the published JWKS
(`/.well-known/jwks.json`) are all driven from this section.
`signing_keys[]` is a multi-key list — the first non-expired entry is
the active mint key, every other non-expired entry stays in JWKS for
the rotation grace window.

| Field | Type | Default | Validation |
|---|---|---|---|
| `algorithm` | string | `EdDSA` | Only `EdDSA` is accepted. |
| `signing_keys[]` | list | (1 entry required) | Non-empty, all `id`s unique. |
| `signing_keys[].id` | string | (required) | Stable kid. Surfaces in JWT `kid` header + JWKS entry. |
| `signing_keys[].private_key_file` | path | one of `private_key_file` / `public_key_path` required | Ed25519 PEM (`PRIVATE KEY`). Mode-warned. |
| `signing_keys[].public_key_path` | path | unset | Verify-only entry — kept for grace-window verification of tokens minted under a now-private-less kid. |
| `signing_keys[].not_after` | RFC 3339 timestamp | unset | Rotation deadline. Past `not_after` → key drops out of JWKS and is no longer eligible as the active mint key. |
| `access_token_ttl_seconds` | u64 | `900` | `1..=86400`. |
| `refresh_token_ttl_seconds` | u64 | `86400` | `60..=2592000` (30 days). |
| `jwks_cache_seconds` | u64 | `300` | `1..=86400`. Stamped into the `Cache-Control: max-age=` header on `/.well-known/jwks.json`. |
| `agent_audience_pattern` | string | `ebpfsentinel-agent-{tenant_id}` | Must contain the `{tenant_id}` placeholder; resolved at agent-JWT mint time. |
| `agent_token_ttl_seconds` | u64 | `600` | `1..=86400`. Per-tenant agent JWT lifetime. |

### `tenants[]`

Static tenant catalogue. At least one entry required, all `id`s unique.

| Field | Type | Default | Validation |
|---|---|---|---|
| `id` | string | (required) | Non-empty, unique across the list. |
| `display_name` | string | (required) | Non-empty. |
| `agent_pool` | string | (required) | Non-empty pool name keyed by fleet discovery. |
| `oidc_groups` | string list | `[]` | OIDC `groups` claim values that grant `analyst` access to this tenant. Any match elects the tenant for that user. |
| `admin_groups` | string list | `[]` | OIDC `groups` claim values that grant `admin` access to this tenant. Membership implies tenant access too. |

### `fleet_discovery`

How the dashboard learns about agents.

| Field | Type | Default | Validation |
|---|---|---|---|
| `mode` | enum | `static` | One of `static`, `kubernetes`, `operator`. |
| `static_agents[]` | list | `[]` | Used when `mode == static`. |
| `static_agents[].tenant` | string | (required) | Non-empty. |
| `static_agents[].name` | string | (required) | Non-empty. |
| `static_agents[].base_url` | URL | (required) | Must be `https://`. |
| `static_agents[].api_token_env` | string | (required) | Env var name holding the agent API token. |
| `static_agents[].tls_pin_sha256` | string | unset | Hex-encoded SHA-256 of the agent's TLS `SubjectPublicKeyInfo` DER. Pin mismatches are fatal — the agent is excluded and `ebpfsentinel_dashboard_tls_pin_mismatch_total{tenant}` increments. |
| `poll_interval_seconds` | u64 | `60` | `5..=3600`. Legacy field — superseded by `refresh_interval_seconds` for the agent pool, kept for downstream consumers that still poll. |
| `refresh_interval_seconds` | u64 | `60` | `5..=3600`. How often the agent pool re-probes every known agent's `/api/v1/license` + `/api/v1/agent/identity`. |
| `management_cluster_url` | URL | unset | When set, the dashboard additionally GETs `<url>/api/v1/fleet/agents` on every refresh tick and merges the response into the static-agent list (deduped by `base_url`) before probing. Must be `https://`. |

### `clickhouse` (optional)

History store. When omitted, the dashboard runs with live data only.

| Field | Type | Default | Validation |
|---|---|---|---|
| `url` | URL | (required) | `http(s)://`. |
| `user` | string | (required) | Non-empty. |
| `password_file` | path | (required) | Same disk-only contract as `oidc.client_secret_file`. |
| `database` | string | (required) | Non-empty. |
| `table_prefix` | string | (required) | Used as a prefix on every table the dashboard creates. |
| `tls_ca_path` | path | unset | Must exist when set. |
| `retention_days` | u32 | `30` | `1..=3650`. |
| `batch_size` | usize | `1000` | `1..=100000`. Number of rows accumulated before a batch insert is flushed. |
| `batch_flush_interval_seconds` | u64 | `5` | `1..=300`. Maximum age of a batch before it is flushed regardless of size. |
| `purge_hour_utc` | u8 | `2` | `0..=23`. Hour (UTC) at which the nightly retention purge runs. |

### `observability`

| Field | Type | Default | Validation |
|---|---|---|---|
| `log_format` | enum | `json` | `json` or `pretty`. |
| `log_level` | enum | `info` | `trace` / `debug` / `info` / `warn` / `error`. |
| `metrics_path` | string | `/metrics` | Must start with `/`. |

### `i18n`

| Field | Type | Default | Validation |
|---|---|---|---|
| `default_locale` | string | `en` | Must appear in `supported_locales`. |
| `supported_locales` | list | `[en, fr, de]` | Non-empty. |

### `proxy`

Tunables for the per-tenant proxy fan-out (`/api/v1/{tenant}/...`).

| Field | Type | Default | Validation |
|---|---|---|---|
| `max_concurrent_fanout` | u32 | `50` | `1..=200`. Hard cap on the number of agents queried in parallel during a single fan-out call. |
| `per_agent_timeout_seconds` | u64 | `10` | `1..=60`. Per-agent timeout applied via `tokio::time::timeout` around each upstream call. |

## Secrets handling

- Every secret-bearing field has a `*_file` suffix and points at a path
  on disk — never an inline string, never an env var name.
- Files are read once at startup, body trimmed, stored in
  `secrecy::SecretString`. Zeroised on drop. Never printed by `Debug`.
- The dashboard emits a `tracing::warn!` line at startup when a secret
  file's mode allows group / world read (mode bits below `0o077`).
  Recommend `chmod 0640` (and `chown root:dashboard`).

## Authentication flow

The dashboard implements OpenID Connect Authorization Code + PKCE
end-to-end on the server. Browsers never see an OIDC access or refresh
token — only the dashboard session JWT (HttpOnly + Secure cookie).

| Endpoint | Method | Purpose |
|---|---|---|
| `/auth/login` | GET | Mints PKCE verifier + CSRF state + nonce, sets the signed `pkce_state` cookie (`Path=/auth`, 10 min, HttpOnly, Secure, SameSite=Lax), redirects to the IdP `authorize_url`. Honours `?next=<relative-path>` for post-login redirects (open-redirect-safe). |
| `/auth/callback` | GET | Validates `state`, exchanges code, verifies `id_token`, fetches userinfo (for the `groups` claim), resolves tenant + role via `tenants[].oidc_groups` / `admin_groups`. On no match → 403 + styled "no tenant assigned" page + `auth.audit` event. On match → mints session JWT, sets `session` cookie (`Path=/`, `oidc.session_ttl_seconds`), redirects to original target. |
| `/auth/logout` | POST | Reads the session sub, drops the server-side refresh token, clears the `session` cookie, redirects to the IdP `end_session_endpoint` (with `post_logout_redirect_uri` when set) — falls back to `/`. |
| `/auth/refresh` | POST | Reads the session JWT to find the held refresh token in-memory, swaps it at the IdP, mints a fresh session JWT, replaces the cookie. Returns 204 on success or 401 on invalid / expired session. |

The session JWT is signed with the active EdDSA key from
the active entry of `jwt.signing_keys[]` (the first non-expired item).
Verification honours every other non-expired entry too, so a rotation
does not log every user out at the swap moment. The same key list backs
the per-tenant agent-JWT minter and the public JWKS endpoint; see the
"JWKS endpoint" and "Key rotation runbook" sections below.

OIDC discovery runs once at startup against `oidc.issuer_url`. A
discovery failure refuses to start the server with a clear error so
configuration mistakes never present a half-functional login screen.

Refresh tokens are held server-side in a per-replica DashMap keyed by
`sub`, wrapped in `secrecy::SecretString` (zeroised on drop). The store
is per-replica: a refresh succeeds only if the user lands on the same
replica that minted their session — acceptable for a 12 h window. A
shared store lands as part of the multi-replica scaling work.

## JWKS endpoint

The dashboard publishes its public signing keys at
`GET /.well-known/jwks.json` — RFC 7517 / 8037 shape, one entry per
non-expired key:

```json
{
  "keys": [
    {
      "kty": "OKP",
      "crv": "Ed25519",
      "use": "sig",
      "alg": "EdDSA",
      "kid": "dash-2026-04",
      "x": "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"
    }
  ]
}
```

The endpoint is unauthenticated, rate-limited to 1 request per second
per peer IP via `tower-governor`, and emits
`Cache-Control: max-age=<jwt.jwks_cache_seconds>` (default 5 min).
Agents fetch it on first contact and re-fetch when a token's `kid`
header is unknown — so a hot-reloaded rotation propagates within the
cache TTL or immediately on first cache miss.

## Key rotation runbook

The rotation procedure is two steps. Both apply via SIGHUP — no
restart required.

### Step 1 — overlap

Append the new key at the **top** of `jwt.signing_keys[]`. Keep the old
entry around with a soon-to-expire `not_after` so existing agent JWTs
keep verifying during the grace window.

```yaml
jwt:
  signing_keys:
    - id: 2026-02
      private_key_file: /run/secrets/jwt-2026-02.pem
      not_after: 2026-12-31T00:00:00Z
    - id: 2026-01
      private_key_file: /run/secrets/jwt-2026-01.pem
      not_after: 2026-02-15T00:00:00Z
```

`kill -HUP <pid>` (or save the YAML — `notify` picks it up) →
`/.well-known/jwks.json` now publishes **both** kids → new tokens are
minted under `2026-02` while in-flight tokens minted under `2026-01`
keep verifying until their `not_after`.

### Step 2 — drop the old key

Once the longest-lived token minted under the old key has expired,
remove the old entry. Same SIGHUP-or-edit reload flow.

```yaml
jwt:
  signing_keys:
    - id: 2026-02
      private_key_file: /run/secrets/jwt-2026-02.pem
      not_after: 2026-12-31T00:00:00Z
```

### Field-level guarantees

- The active mint key is *always* the first non-expired entry. Order
  in YAML matters — top entry is preferred unless its `not_after`
  is in the past.
- Verify-only entries (only `public_key_path` set) are accepted.
  They never mint, but they keep historical tokens verifiable.
- Private bytes are loaded once per reload, never logged, and dropped
  with the previous keyring on the swap. Mode-loose key files emit a
  `tracing::warn!` line at load time.

## Agent pool

The dashboard maintains a license-gated pool of every reachable agent.
The pool ticks every `fleet_discovery.refresh_interval_seconds` (default
60 s) and probes each agent in parallel:

- `GET /api/v1/license` — must answer `200 OK` with a parseable
  license body whose `expired` flag is false. `404` / `401` /
  parse failures → silently skipped (assumed OSS or unhealthy).
- `GET /api/v1/agent/identity` — supplies the `agent_id`,
  `tenant_id`, `operator_managed` flag, and version.

Outcomes per probe:

| Outcome | Action | Metric label |
|---|---|---|
| Healthy | enter the pool | `healthy` |
| License expired | evict (fail-closed) + audit | `license_expired` |
| Skipped (404 / 401 / parse) | exclude from pool | `skipped` |
| Connection error (DNS / TCP / TLS) | exclude from pool | `connect_error` |
| TLS pin mismatch | exclude + bump dedicated counter | `tls_pin_mismatch` |

### TLS pinning

Each `static_agents[].tls_pin_sha256` is the hex-encoded SHA-256 of
the agent's TLS certificate `SubjectPublicKeyInfo` DER. The dashboard
builds a per-agent `reqwest::Client` with a custom rustls
`ServerCertVerifier` that compares the observed leaf cert's SPKI hash
against the pin and rejects on mismatch — defence against MITM even
if the agent's issuing CA is compromised. When no pin is configured,
the client still enforces standard rustls trust-store validation.

To compute the pin from an agent's cert:

```bash
openssl x509 -in agent.crt -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256 -hex \
  | awk '{print $2}'
```

### Fleet discovery merge

When `fleet_discovery.management_cluster_url` is set, the dashboard
additionally GETs `<url>/api/v1/fleet/agents` once per refresh tick
and merges the response into the static-agent list. Entries are
deduplicated by `base_url`; the static-config entry wins. The fleet
endpoint must return JSON with the same shape as
`fleet_discovery.static_agents[]`.

### Metrics

Three Prometheus families track the pool, all surfaced via
`<observability.metrics_path>`:

- `ebpfsentinel_dashboard_agents_total{tenant}` — gauge of healthy
  agents per tenant.
- `ebpfsentinel_dashboard_agent_probe_failed_total{tenant,reason}` —
  counter of probe failures, labelled by the table above.
- `ebpfsentinel_dashboard_tls_pin_mismatch_total{tenant}` — separate
  counter for the security-critical pin-mismatch case so an alert can
  fire without grepping `reason`.

## Proxy fan-out

Every dashboard API call is proxied through `/api/v1/{tenant}/{rest}`.
Three guards run before any agent traffic leaves the box:

1. **Authenticate** — read the `session=…` HttpOnly cookie or the
   `Authorization: Bearer <session-jwt>` header and verify against the
   active session signer.
2. **Tenant scope** — `TenantScope::can_access` rejects any tenant
   not in the user's session-claim `tenants[]` list. Members of the
   `admin` role bypass this check; their access is recorded as an
   `auth.audit` event.
3. **Resolve** — pull `agents_for_tenant(tenant)` out of the agent
   pool. An empty set returns `503 Service Unavailable` rather than a
   silent no-op.

Routing rules:

| Path shape | Behaviour |
|---|---|
| `agents/{uuid}/<rest>` | Single-agent forward to the agent identified by `{uuid}` (returns `404` when the agent is not in the tenant pool). |
| anything else | Fan out across every healthy agent for the tenant. Top-level JSON arrays are concatenated; objects with an `items` array are merged on `items`. Each merged item is tagged with `agent_id` so the UI can colour-code provenance. |

Fan-out semantics:

- Bounded by `proxy.max_concurrent_fanout` (default 50). Excess
  agents queue.
- Each per-agent call wrapped in `tokio::time::timeout` with
  `proxy.per_agent_timeout_seconds` (default 10).
- Partial failures surface in the response body as
  `meta.failed_agents = [{agent_id, agent_name, reason}]` and the
  HTTP response carries `X-Partial-Response: true`.

Every upstream call carries the inbound `X-Request-Id` header (or a
freshly-minted UUID-v4 when missing). The same id is mirrored onto the
outbound response so the WASM client can correlate logs end-to-end.

### Metrics

Two more Prometheus families track the proxy:

- `ebpfsentinel_dashboard_proxy_requests_total{tenant,method,outcome}`
  — counter, with `outcome` ∈ `single_ok / single_error / fanout_ok /
  fanout_partial / forbidden / no_agents / agent_not_found /
  method_not_allowed`.
- `ebpfsentinel_dashboard_proxy_fanout_partials_total{tenant}` —
  separate counter for the partial-response case so dashboards can
  alert on per-tenant degradation without grepping `outcome`.

## Hot-reload

The dashboard reloads its config without dropping connections on either
trigger:

- The YAML file at `--config` is modified (a `notify` watcher rooted at
  the parent directory catches editor saves, kubelet ConfigMap rotations,
  and `cp -f` replacements). Events are debounced 500 ms.
- The process receives `SIGHUP` (`kill -HUP <pid>`).

Both paths run the same pipeline: read → parse → validate → diff → swap.
A failed reload is logged at `error` and the previous snapshot is kept —
the running server never enters a partially-applied state. In-flight
requests keep the snapshot they were dispatched against; new requests
immediately observe the new config.

### Hot-reloadable fields

Every section listed in the schema above is hot-reloadable except the
fields below, which bind to a kernel resource or to the tracing
subscriber initialised once at startup. A change to any of them logs a
warning and is ignored — restart the process to take effect.

| Field | Reason |
|---|---|
| `server.bind` | The listening TCP socket is bound at startup. |
| `observability.log_format` | The tracing subscriber is built once. |
| `observability.metrics_path` | The metrics route is mounted at startup. |

Notable fields that **are** hot-reloadable:

- `tenants[]` — adding, removing, or modifying tenants takes effect on
  the next request. Sessions for removed tenants return `404` plus an
  audit event.
- `oidc.client_secret_file`, every `jwt.signing_keys[].private_key_file`
  / `public_key_path`, and `clickhouse.password_file` are re-read from
  disk on every reload, so secret rotation is just a file replace +
  reload. The signing-key ring rebuilds atomically — old + new entries
  coexist for the rotation grace window.
- `server.tls.cert_path` / `server.tls.key_path` are watched
  independently. A change rebuilds the rustls `ServerConfig` and swaps
  the certificate resolver inside the running acceptor — the listening
  socket stays open.
- `fleet_discovery.*`, `clickhouse.retention_days`, `i18n.*` apply on
  the next reload tick.

A reload emits one structured log line per category that changed
(tenants added / removed / modified, JWT key rotation, OIDC identity
change, ClickHouse retention shift, fleet discovery mode flip) so an
operator can confirm the new config landed.

## ClickHouse history store

When the `clickhouse:` block is present the dashboard connects at startup,
runs an idempotent schema migration (CREATE TABLE IF NOT EXISTS), and
instantiates three `BatchedInserter` instances — one per table (`alerts`,
`forensic_events`, `flow_aggregates_1h`). Inserts are buffered and flushed
either when the batch reaches `batch_size` rows or when `batch_flush_interval_seconds`
elapses, whichever comes first. Shutdown drains the buffer.

A nightly purge job wakes at `purge_hour_utc` and deletes rows older than
`retention_days` per tenant via `ALTER TABLE … DELETE WHERE`.

When the `clickhouse:` block is omitted (or absent), the dashboard runs
with a `NoopStore`: inserts succeed silently and query endpoints return
HTTP 503 with `{"error":"history_disabled","message":"…"}`.

### Prometheus metrics

| Metric | Type | Labels |
|---|---|---|
| `ebpfsentinel_dashboard_clickhouse_inserts_total` | counter | `table` |
| `ebpfsentinel_dashboard_clickhouse_insert_failures_total` | counter | `table` |
| `ebpfsentinel_dashboard_clickhouse_batch_size` | gauge | `table` |
| `ebpfsentinel_dashboard_clickhouse_purge_rows_deleted_total` | counter | `tenant` |

### Schema

The migration creates four tables (prefixed with `table_prefix`):

- `_meta` — migration version bookkeeping (ReplacingMergeTree)
- `alerts` — per-event alert records partitioned by `(tenant_id, toYYYYMM(occurred_at))`
- `forensic_events` — raw forensic captures, same partitioning
- `flow_aggregates_1h` — hourly flow buckets partitioned by `(tenant_id, toYYYYMM(bucket_start))`

DDL source files live in `crates/dashboard-server/migrations/`.

## Worked examples

See `config/examples/` in the dashboard repo:

- `dashboard.yaml` — default single-tenant, no ClickHouse.
- `dashboard-airgap.yaml` — local OIDC, bundled assets, no history
  store.
- `dashboard-mssp.yaml` — multi-tenant MSSP with rotating EdDSA keys
  and ClickHouse history (90-day retention).
