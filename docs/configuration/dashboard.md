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

Every section uses `serde(deny_unknown_fields, default)` - typos fail
fast. Every value is validated below.

### `server`

| Field | Type | Default | Validation |
|---|---|---|---|
| `bind` | `host:port` | `0.0.0.0:8080` | Port in `1..=65535`. |
| `public_url` | URL | `https://dashboard.example.com` | Must be `http(s)://`. |
| `tls.cert_path` | path | unset | Must exist when set. Set together with `key_path`. |
| `tls.key_path` | path | unset | Must exist when set. Warn if mode > `0640`. |
| `tls.pq_mode` | `prefer` \| `require` \| `disable` | `prefer` | Post-quantum key exchange on the listener. See below. |
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
| `session_ttl_seconds` | u64 | `14400` | Lifetime of the per-user session JWT (`60..=2592000`). Default 4 h. The cookie is a signed JWT rather than a server-side record, so nothing can withdraw one that has been copied off a machine and this value is how long a copied one is worth something. Raise it and that window grows with it. |
| `cookie_signing_key_file` | path | (required) | Path to a file holding the HMAC seed used to sign the short-lived `pkce_state` cookie. Same on-disk contract as every other secret (mode ≤ `0640`). An empty file falls back to an ephemeral key - sessions do not survive a restart. |

### `jwt`

EdDSA session tokens + per-tenant agent JWTs + the published JWKS
(`/.well-known/jwks.json`) are all driven from this section.
`signing_keys[]` is a multi-key list - the first non-expired entry is
the active mint key, every other non-expired entry stays in JWKS for
the rotation grace window.

| Field | Type | Default | Validation |
|---|---|---|---|
| `algorithm` | string | `EdDSA` | Only `EdDSA` is accepted. |
| `signing_keys[]` | list | (1 entry required) | Non-empty, all `id`s unique. |
| `signing_keys[].id` | string | (required) | Stable kid. Surfaces in JWT `kid` header + JWKS entry. |
| `signing_keys[].private_key_file` | path | one of `private_key_file` / `public_key_path` required | Ed25519 PEM (`PRIVATE KEY`). Mode-warned. |
| `signing_keys[].public_key_path` | path | unset | Verify-only entry - kept for grace-window verification of tokens minted under a now-private-less kid. |
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
| `static_agents[].tls_pin_sha256` | string | unset | Hex-encoded SHA-256 of the agent's TLS `SubjectPublicKeyInfo` DER. Pin mismatches are fatal - the agent is excluded and `ebpfsentinel_dashboard_tls_pin_mismatch_total{tenant}` increments. |
| `poll_interval_seconds` | u64 | `60` | `5..=3600`. Legacy field - superseded by `refresh_interval_seconds` for the agent pool, kept for downstream consumers that still poll. |
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

### `state_store` (optional)

The PostgreSQL database holding what operators did: their preferences,
rollouts waiting on an approver, sessions and revoked tokens. When omitted,
that state lives in the process's memory. See [State store](#state-store).

| Field | Type | Default | Validation |
|---|---|---|---|
| `host` | string | (required) | Non-empty. A host other than `localhost` or a loopback address is always reached over TLS with the certificate and the host name verified. |
| `port` | u16 | `5432` | Not `0`. |
| `user` | string | (required) | Non-empty. |
| `password_file` | path | (required) | Same disk-only contract as `oidc.client_secret_file`. |
| `database` | string | (required) | Non-empty. |
| `tls_ca_path` | path | unset | Must exist when set. The CA that signed the server's certificate, when it is not in the system store. |
| `max_connections` | u32 | `8` | `1..=64`, per replica. |
| `connect_timeout_seconds` | u64 | `10` | `1..=120`. How long startup waits for the database before refusing. |

### `observability`

| Field | Type | Default | Validation |
|---|---|---|---|
| `log_format` | enum | `json` | `json` or `pretty`. |
| `log_level` | enum | `info` | `trace` / `debug` / `info` / `warn` / `error`. |
| `metrics_path` | string | `/metrics` | Must start with `/`. |
| `prometheus_bind` | `host:port` | `0.0.0.0:9100` | Dedicated Prometheus metrics port, separate from main server. |

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
  on disk - never an inline string, never an env var name.
- Files are read once at startup, body trimmed, stored in
  `secrecy::SecretString`. Zeroised on drop. Never printed by `Debug`.
- The dashboard emits a `tracing::warn!` line at startup when a secret
  file's mode allows group / world read (mode bits below `0o077`).
  Recommend `chmod 0640` (and `chown root:dashboard`).

## Authentication flow

The dashboard implements OpenID Connect Authorization Code + PKCE
end-to-end on the server. Browsers never see an OIDC access or refresh
token - only the dashboard session JWT (HttpOnly + Secure cookie).

| Endpoint | Method | Purpose |
|---|---|---|
| `/auth/login` | GET | Mints PKCE verifier + CSRF state + nonce, sets the signed `pkce_state` cookie (`Path=/auth`, 10 min, HttpOnly, Secure, SameSite=Lax), redirects to the IdP `authorize_url`. Honours `?next=<relative-path>` for post-login redirects (open-redirect-safe). |
| `/auth/callback` | GET | Validates `state`, exchanges code, verifies `id_token`, fetches userinfo (for the `groups` claim), resolves tenant + role via `tenants[].oidc_groups` / `admin_groups`. On no match → 403 + styled "no tenant assigned" page + `auth.audit` event. On match → mints session JWT, sets `session` cookie (`Path=/`, `oidc.session_ttl_seconds`), redirects to original target. |
| `/auth/logout` | POST | Reads the session sub, drops the server-side refresh token, clears the `session` cookie, redirects to the IdP `end_session_endpoint` (with `post_logout_redirect_uri` when set) - falls back to `/`. |
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
is per-replica by design: the dashboard runs on your own infrastructure
and must not oblige you to run a shared cache beside it. A refresh
therefore succeeds only when the request lands on the replica that
minted the session; otherwise the session runs to its expiry and the
browser is redirected through your identity provider, whose own session
is what answers it. That redirect is silent while the provider session
is live, which is why the session lifetime here can be short without
asking anyone to sign in again during their working day. The console
takes that redirect itself: the first request answered 401 sends the
browser to `/auth/login` carrying the page it was on, so a session that
runs out while a tab is open comes back on the same screen rather than
filling it with errors.

## JWKS endpoint

The dashboard publishes its public signing keys at
`GET /.well-known/jwks.json` - RFC 7517 / 8037 shape, one entry per
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
header is unknown - so a hot-reloaded rotation propagates within the
cache TTL or immediately on first cache miss.

## Key rotation runbook

The rotation procedure is two steps. Both apply via SIGHUP - no
restart required.

### Step 1 - overlap

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

`kill -HUP <pid>` (or save the YAML - `notify` picks it up) →
`/.well-known/jwks.json` now publishes **both** kids → new tokens are
minted under `2026-02` while in-flight tokens minted under `2026-01`
keep verifying until their `not_after`.

### Step 2 - drop the old key

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
  in YAML matters - top entry is preferred unless its `not_after`
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

- `GET /api/v1/license` - must answer `200 OK` with a parseable
  license body whose `expired` flag is false. `404` / `401` /
  parse failures → silently skipped (assumed OSS or unhealthy).
- `GET /api/v1/agent/identity` - supplies the `agent_id`,
  `tenant_id`, `operator_managed` flag, and version.

Outcomes per probe:

| Outcome | Action | Metric label |
|---|---|---|
| Healthy | enter the pool | `healthy` |
| License expired | evict (fail-closed) + audit | `license_expired` |
| Skipped (404 / 401 / parse) | exclude from pool | `skipped` |
| Connection error (DNS / TCP / TLS) | exclude from pool | `connect_error` |
| TLS pin mismatch | exclude + bump dedicated counter | `tls_pin_mismatch` |

### Licence and measurement verification

The dashboard does not take an agent's word for its licence. It verifies
the `signed_payload` and both signatures from `GET /api/v1/license`
against the licence public keys it was built with, each pair held under
its key id: a licence naming a key id this build does not carry is
refused with that id, which means the dashboard is older than the key
and needs upgrading, and a licence issued before keys carried an id is
tried against every built-in pair.

Setting `EBPFSENTINEL_MEASUREMENTS` to the path of a signed measurements
manifest adds a second gate: an agent enters the pool only when the
`measurement` it reports is listed in that manifest. The manifest is
signed with the **release** keys, never the licence keys, and those are
compiled in by the release build. A dashboard built without them (a
local `cargo build`) refuses to start when `EBPFSENTINEL_MEASUREMENTS`
is set, rather than gating the pool on a manifest it cannot check. A
manifest that is configured and unreadable or badly signed is fatal for
the same reason. With the variable unset the gate is off and the licence
verification alone admits an agent.

### Post-quantum key exchange

`server.tls.pq_mode` decides whether the dashboard's own listener advertises
the `X25519MLKEM768` hybrid group, exactly as the agent's `tls.pq_mode` does.

| Mode | Listener | Outbound |
|---|---|---|
| `prefer` (default) | hybrid first, classical fallback | hybrid first, classical fallback |
| `require` | hybrid only, TLS 1.3 only, non-PQ clients rejected | hybrid first, classical fallback |
| `disable` | classical only | classical only |

`require` is an admission policy for the clients that reach the dashboard. The
agents it fans out to, the OIDC provider, ClickHouse and the SMTP relay are
servers configured by somebody else, so outbound keeps a classical fallback
under `require` and requiring the hybrid group of browsers never cuts the
control plane off from the fleet. `disable` is a statement about the hybrid
group itself, so it removes it in both directions.

The mode applies only where the dashboard terminates TLS itself. Behind an
ingress or a reverse proxy, the browser's handshake is that proxy's. Full
behaviour, including what a client without hybrid support sees, is in
[Post-Quantum TLS](../features/pq-tls.md).

### TLS pinning

Each `static_agents[].tls_pin_sha256` is the hex-encoded SHA-256 of
the agent's TLS certificate `SubjectPublicKeyInfo` DER. The dashboard
builds a per-agent `reqwest::Client` with a custom rustls
`ServerCertVerifier` that compares the observed leaf cert's SPKI hash
against the pin and rejects on mismatch - defence against MITM even
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

- `ebpfsentinel_dashboard_agents_total{tenant}` - gauge of healthy
  agents per tenant.
- `ebpfsentinel_dashboard_agent_probe_failed_total{tenant,reason}` -
  counter of probe failures, labelled by the table above.
- `ebpfsentinel_dashboard_tls_pin_mismatch_total{tenant}` - separate
  counter for the security-critical pin-mismatch case so an alert can
  fire without grepping `reason`.

## Proxy fan-out

Every dashboard API call is proxied through `/api/v1/{tenant}/{rest}`.
Three guards run before any agent traffic leaves the box:

1. **Authenticate** - read the `session=…` HttpOnly cookie or the
   `Authorization: Bearer <session-jwt>` header and verify against the
   active session signer.
2. **Tenant scope** - `TenantScope::can_access` rejects any tenant
   not in the user's session-claim `tenants[]` list. Members of the
   `admin` role bypass this check; their access is recorded as an
   `auth.audit` event.
3. **Resolve** - pull `agents_for_tenant(tenant)` out of the agent
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
  - counter, with `outcome` ∈ `single_ok / single_error / fanout_ok /
  fanout_partial / forbidden / no_agents / agent_not_found /
  method_not_allowed`.
- `ebpfsentinel_dashboard_proxy_fanout_partials_total{tenant}` -
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
A failed reload is logged at `error` and the previous snapshot is kept -
the running server never enters a partially-applied state. In-flight
requests keep the snapshot they were dispatched against; new requests
immediately observe the new config.

### Hot-reloadable fields

Every section listed in the schema above is hot-reloadable except the
fields below, which bind to a kernel resource or to the tracing
subscriber initialised once at startup. A change to any of them logs a
warning and is ignored - restart the process to take effect.

| Field | Reason |
|---|---|
| `server.bind` | The listening TCP socket is bound at startup. |
| `observability.log_format` | The tracing subscriber is built once. |
| `observability.metrics_path` | The metrics route is mounted at startup. |
| `state_store.*` | The connection pool is opened and migrated once, before anything is served. |

Notable fields that **are** hot-reloadable:

- `tenants[]` - adding, removing, or modifying tenants takes effect on
  the next request. Sessions for removed tenants return `404` plus an
  audit event.
- `oidc.client_secret_file`, every `jwt.signing_keys[].private_key_file`
  / `public_key_path`, and `clickhouse.password_file` are re-read from
  disk on every reload, so secret rotation is just a file replace +
  reload. The signing-key ring rebuilds atomically - old + new entries
  coexist for the rotation grace window.
- `server.tls.cert_path` / `server.tls.key_path` are watched
  independently. A change rebuilds the rustls `ServerConfig` and swaps
  the certificate resolver inside the running acceptor - the listening
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
instantiates three `BatchedInserter` instances - one per table (`alerts`,
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

The migration creates nine tables (prefixed with `table_prefix`):

- `_meta` - migration version bookkeeping (ReplacingMergeTree)
- `alerts` - per-event alert records partitioned by `(tenant_id, toYYYYMM(occurred_at))`
- `forensic_events` - raw forensic events, same partitioning
- `flow_aggregates_1h` - hourly flow buckets partitioned by `(tenant_id, toYYYYMM(bucket_start))`
- `case_events` - the case log, one row per change to a case, append-only. The
  nightly purge does not reach it: a case's timeline is a record, and how long
  it is kept is the operator's decision rather than `retention_days`. See
  [Cases](../features/enterprise/cases.md).
- `suppression_events` - the suppression log, one row when a suppression is
  made and one when it is lifted, append-only and out of the purge's reach
  for the same reason.
- `posture_points` - one compliance reading per tenant, framework and day
  (ReplacingMergeTree, the newest sample of the day wins), kept 456 days by
  the table's own TTL rather than by `retention_days`. See
  [Compliance Reports](../features/enterprise/compliance-reports.md#posture-over-time).
- `summary_schedules` - one executive summary schedule per tenant
  (ReplacingMergeTree, the newest edit wins).
- `summaries` - every executive summary issued, as it was issued, kept 456
  days by the table's own TTL like the posture it reads. See
  [Compliance Reports](../features/enterprise/compliance-reports.md#executive-summaries).

DDL source files live in `crates/dashboard-server/migrations/`.

## State store

The dashboard keeps two kinds of data. What the agents report - alerts,
flows, posture - is rebuilt by asking them again, and its long-term copy is
the optional ClickHouse store above. What operators did is not: a rollout
waiting on its second approver, a preference, a session, a revoked token.
Nothing can reconstruct those after the process that held them is gone, so
they belong in `state_store`.

### Why PostgreSQL

The chart runs three replicas by default. A file embedded in each pod would
give each replica its own copy, so a change proposed on one pod could not be
approved on another and an operator would be signed out whenever the load
balancer picked a different one. One PostgreSQL database shared by every
replica is what makes the second person of a two-person rollout land on the
same record as the first.

What it costs: a PostgreSQL database to run, back up and keep reachable from
every replica. The dashboard needs one database and a role owning it; it
creates nothing outside that database. Any managed PostgreSQL works, or the
CloudNativePG operator in the same cluster.

### Startup

- The store is opened before the listener: a configured database that does
  not answer within `connect_timeout_seconds`, or refuses the credentials,
  stops the process with `refusing to start: state store unavailable: cannot
  reach <host>:<port>/<database>: ...`. The server never starts empty in its
  place, because that would silently drop every rollout in flight.
- Migrations run on every start and are embedded in the binary. They take an
  advisory lock, so replicas starting together apply them once and the
  others wait; a migration that has already run is skipped. A database
  migrated by a newer version is refused rather than written to.
- The block is read once. A change to it needs a restart.

### Without a store

With no `state_store` block the server logs `state store: none configured -
preferences, rollouts and sessions live in this process, a restart loses them
and replicas do not share them` and keeps that state in the process. That is fine for one replica you
are happy to restart; run more than one only with a store. The chart prints
the same warning when `replicaCount` is above one and `stateStore.enabled`
is false.

A store that stops answering after startup is reported on the requests that
need it (`503`), never answered from an empty default.

### A rollout across a restart

A rollout is written to the store when it is proposed and again after every
agent it writes to, so the book the next replica reads is the one the last
replica left, agent by agent. Alongside each rollout the store keeps what
every agent held before it was written, which is what a rollback gives back.
Those documents are the agents' own configuration, so treat the database as
holding it: they are stored apart from the rollout itself and no route ever
serves them.

A replica writing a rollout holds a five-minute lease on it, renewed before
and after each agent. A rollout whose lease lapsed while it was being written
is read as **interrupted**: the process writing it stopped. The screen says
which stage it stopped in and names the agent that was being written at that
moment, because whether that agent took the change is not known. Nothing is
resumed automatically. The one control an interrupted rollout offers is
**Roll back**, which gives every agent it reached what it held before,
including the one in doubt; a rollback that is itself interrupted resumes
where it stopped when pressed again, without writing an agent twice.

When the store does not answer, the rollouts routes return `503` with
`{"code":"unavailable"}` and nothing is changed; the entity page reports its
configuration section as unread rather than as a host with no rollout.

### Backup and restore

The database is ordinary PostgreSQL, so back it up the way you back up any
other:

```bash
pg_dump --format=custom --file=dashboard.dump \
  "host=postgres.example.com dbname=dashboard user=dashboard sslmode=verify-full"
pg_restore --clean --if-exists --dbname=dashboard dashboard.dump
```

What a restore from an older backup costs is what happened since it was
taken: a rollout approved after the dump reads as waiting again, a
preference reverts, and a token revoked after the dump becomes usable again
until its own expiry. Revoke those tokens again after a restore.

### Helm

```yaml
stateStore:
  enabled: true
  host: dashboard-pg-rw.dashboard.svc
  database: dashboard
  user: dashboard
  existingSecret: dashboard-pg-password   # key: password
  tlsCaPath: /etc/ssl/certs/pg-ca.pem
```

The password is mounted at
`/etc/ebpfsentinel-dashboard/secrets/state-store/password`, and the chart's
NetworkPolicy opens egress to `networkPolicy.stateStorePort` (5432).

## SSE pass-through and ingest

The dashboard subscribes to each agent's SSE streams (`/api/v1/alerts/stream`
and `/api/v1/forensics/events/stream`) using per-tenant JWTs minted fresh on
every connect attempt. Events are published to an internal broadcast channel
keyed by `(tenant_id, stream_kind)`.

Browser clients connect to `/api/v1/{tenant}/alerts/stream` or
`/api/v1/{tenant}/forensics/stream`. The endpoint authenticates the
session JWT, enforces tenant scope, then merges the internal broadcast
into a single downstream SSE stream. Each event is wrapped with the
originating `agent_id` so multi-agent tenants can distinguish sources:

```json
{
  "agent_id": "550e8400-e29b-41d4-a716-446655440000",
  "payload": { "severity": "high", "rule_id": "ids-001", "..." : "..." }
}
```

If a slow consumer falls behind the broadcast buffer (4096 events), a
synthetic `lagged` event is emitted with the skipped count so the client
can show a gap banner.

When the `ClickHouse` history store is active, an `IngestActor` taps the
same broadcast and batches events per tenant into `HistoryStore::insert_alerts`
and `HistoryStore::insert_forensic_events`. When the store is `NoopStore`,
the tap is wired but inserts are no-ops - no performance cost beyond the
broadcast subscription.

Upstream reconnection uses exponential backoff (1 s → 2 s → 5 s → 15 s →
60 s cap) with `Last-Event-ID` resume.

### SSE Prometheus metrics

| Metric | Type | Labels |
|---|---|---|
| `ebpfsentinel_dashboard_upstream_sse_connected` | gauge | `tenant`, `agent_id`, `stream` |
| `ebpfsentinel_dashboard_upstream_sse_events_total` | counter | `tenant`, `agent_id`, `stream` |

## Route surface

The server exposes a single Axum router with the following route layout:

| Path | Auth | Handler |
|---|---|---|
| `GET /healthz` | none | Liveness probe - always 200. |
| `GET /readyz` | none | Readiness probe - 200 while running, 503 after SIGTERM (30 s drain). |
| `GET /.well-known/jwks.json` | none | JWKS endpoint (rate-limited 1 req/s/IP). |
| `GET /auth/login` | none | OIDC PKCE redirect to IdP. |
| `GET /auth/callback` | none | OIDC code exchange → session JWT cookie. |
| `POST /auth/logout` | session | Clear session, redirect to IdP end-session. |
| `POST /auth/refresh` | session | Refresh session via IdP refresh token. |
| `GET/POST/PUT/DELETE /api/v1/{tenant}/*` | session | Proxy fan-out to agents for the tenant. |
| `GET /api/v1/{tenant}/alerts/stream` | session | SSE merge from all agents (alerts). |
| `GET /api/v1/{tenant}/forensics/stream` | session | SSE merge from all agents (forensics). |
| `GET /api/v1/{tenant}/enterprise/forensics/captures/{id}/pcapng?agent={id}` | session, analyst or above | Packet capture download, streamed from the one agent that wrote it, never fanned out. 403 below analyst, 400 without `agent`. |
| `GET /api/v1/{tenant}/cases` | session | The tenant's cases, one summary each. 503 without a history store. |
| `POST /api/v1/{tenant}/cases` | session, analyst or above | Open a case over up to 100 alerts. 409 when one of them is already in another case. |
| `GET /api/v1/{tenant}/cases/response-times?from=&to=` | session | Time to acknowledge and time to resolve over the cases first observed in `[from, to)`: mean, median, measured and pending counts, and each case's own two times. 400 when the window does not end after it starts. |
| `GET /api/v1/{tenant}/cases/membership` | session | Which case holds each alert, so the queue can leave them out. |
| `GET /api/v1/{tenant}/cases/{case_id}` | session | One case: its alerts, notes, evidence and timeline. 404 outside the tenant. |
| `GET /api/v1/{tenant}/cases/{case_id}/evidence-pack` | session | The case read against the 24 and 72 hour marks from its first observation: assets, flows, actions, evidence and gaps, each line naming its source record. Deterministic for a given case log. |
| `GET /api/v1/{tenant}/cases/{case_id}/evidence-pack.json` | session | The evidence pack as a JSON file download, the same document the route above answers with. Byte for byte identical across exports of the same case log. |
| `GET /api/v1/{tenant}/cases/{case_id}/evidence-pack.pdf` | session | The evidence pack as an A4 PDF download naming the SHA-256 of the JSON export. No creation date; byte for byte identical across exports of the same case log. |
| `GET /api/v1/{tenant}/cases/{case_id}/response-times` | session | The first observation, acknowledgement and resolution of one case and the two durations between them; a clock still running is absent. 404 outside the tenant. |
| `PATCH /api/v1/{tenant}/cases/{case_id}` | session, analyst or above | Change the title, status, severity or owner; an empty owner unassigns. |
| `POST /api/v1/{tenant}/cases/{case_id}/notes` | session, analyst or above | Append a note of at most 4000 characters. |
| `POST /api/v1/{tenant}/cases/{case_id}/alerts` | session, analyst or above | Add up to 100 alerts, never past 500 in one case. 409 as on open. |
| `DELETE /api/v1/{tenant}/cases/{case_id}/alerts/{agent_id}/{alert_id}` | session, analyst or above | Take one alert out of the case. |
| `POST /api/v1/{tenant}/cases/{case_id}/evidence` | session, analyst or above | Record the context freezes and packet captures the agents hold about the case's alerts. 502 when an agent cannot be read. |
| `GET /api/v1/{tenant}/suppressions` | session | The tenant's suppressions, live, expiring, expired and lifted, each with its scope, expiry, author, note and originating alert. 503 without a history store. |
| `POST /api/v1/{tenant}/suppressions` | session, analyst or above | Suppress alerts matching a scope of rule, source, destination and workload until an expiry at most 90 days away, with an optional note of at most 1000 characters. 201 with the suppression; 400 with the reason when the scope names nothing, the expiry is past or too far, or 500 are already in force. |
| `DELETE /api/v1/{tenant}/suppressions/{suppression_id}` | session, analyst or above | Lift a suppression before its expiry. 404 outside the tenant; 409 with `{"reason":"suppression_ended"}` when it had already been lifted or had expired. |
| `GET /api/v1/{tenant}/entities/{kind}/{value}` | session | Everything that touched one `host` (agent identifier), `address`, `workload` (`namespace/pod`, percent-encoded) or `domain` between `from` (default a day before `to`) and `to` (default now), at most 30 days apart: alerts, flows, DNS, TLS fingerprints, policy decisions and configuration changes, newest first, `limit` events per page (1 to 1000, default 200) and `next_to` for the page after. Each section says whether it was read from the history store or live from the agents, which agents did not answer or held more than one reading walks, or why it could not be read (`history_store_disabled`, `history_store_failed`); without a history store the alerts are still read from the agents. 400 for a value, range or limit refused; 404 for an unknown kind. |
| `GET /api/v1/{tenant}/posture/trend` | session | Every day of the `days` window ending today (7 to 456, default 90), per framework: the score read that day or none where no report was read, then each change between two read days with the controls that improved and regressed and the rollouts written in between. 400 for a window refused; 503 with `{"reason":"history_store_disabled"}` without a history store. |
| `GET /api/v1/{tenant}/summaries/schedule` | session | The tenant's executive summary schedule (enabled, `interval_days`, recipients, sections), when the next one is due, and whether a mail relay is configured. 503 without a history store. |
| `PUT /api/v1/{tenant}/summaries/schedule` | session, tenant admin or above | Write the schedule: an interval of 7, 30 or 90 days, at least one of `posture`, `alerts`, `cases` and `gaps`, at most 20 recipient addresses. 400 with the reason when refused. |
| `GET /api/v1/{tenant}/summaries` | session | The 50 newest summaries issued for the tenant, newest first. |
| `POST /api/v1/{tenant}/summaries` | session, tenant admin or above | Issue a summary now over the window since the last one, deliver it like a scheduled one and keep it. 201 with the summary; 502 when the history store cannot be written. |
| `GET /api/v1/{tenant}/summaries/{summary_id}` | session | One summary as it was issued: its window, each section with its source or the reason it was not read, the comparison with the summary before, and what happened to the mail. 404 outside the tenant. |
| `GET /api/v1/{tenant}/mitre/gaps` | session | Every technique of the ATT&CK catalogue the dashboard ships, classified over the tenant's agents (narrowed by `clusters` and `agent`) as `enabled`, `switched_off`, `uncovered` or `unread`, with the components behind each and `totals` over the distinct catalogue techniques. Agents that did not answer are named in `failed_agents`; `totals` is null when none answered. 404 for a cluster or host outside the tenant, 503 with no agent to ask. |
| `GET /metrics` | none | Prometheus metrics (on `observability.prometheus_bind`, default `:9100`). |
| `GET /*` | none | Static assets from `server.static_dir`. Unknown paths serve `index.html` (SPA fallback). |

### Middleware stack

Applied in order (outermost first):

1. **Tracing** - structured request/response spans.
2. **Compression** - gzip response compression.
3. **CORS** - configurable origin allow-list (`server.cors_allow_origins`). Empty = permissive.
4. **CSP** - strict `Content-Security-Policy` header on every response. Allows `'self'`, `'wasm-unsafe-eval'` for scripts, `'unsafe-inline'` for styles, `data:` for images. `frame-ancestors 'none'`.

### Graceful shutdown

On SIGINT or SIGTERM the server sets the `shutting_down` flag immediately
so `/readyz` returns 503. A 30 s grace period follows before Axum begins
closing connections, giving the load balancer time to drain.

## Worked examples

See `config/examples/` in the dashboard repo:

- `dashboard.yaml` - default single-tenant, no ClickHouse.
- `dashboard-airgap.yaml` - local OIDC, bundled assets, no history
  store.
- `dashboard-mssp.yaml` - multi-tenant MSSP with rotating EdDSA keys
  and ClickHouse history (90-day retention).

## Demo mode

The overview wallboard pulls live numbers from registered agents (and,
for `analytics/alerts-by-country`, from the optional ClickHouse store).
A fresh deployment with zero registered agents - or an air-gapped lab
running before the first agent is enrolled - therefore renders empty
tiles and blank charts. For demo recordings, charter screenshots, and
new-operator onboarding, the dashboard exposes a deterministic
synthetic dataset behind a single environment variable.

| Variable | Default | Effect |
|---|---|---|
| `EBPFSENTINEL_DEMO_DATA` | unset / `false` | Live data only. Empty agent pool returns `503` and empty tiles render zeros. |
| `EBPFSENTINEL_DEMO_DATA=true` | - | When the proxied agent (or history store) yields empty for an overview endpoint, the dashboard returns a deterministic charter-aligned dataset instead. |

Accepted truthy values: `true`, `1`, `yes`, `on` (case-insensitive).
Anything else - including the variable being unset - leaves the flag
off.

### What the fallback covers

The fallback only fires for the six endpoints that back the overview
wallboard:

- `/api/v1/{tenant}/analytics/overview-stats`
- `/api/v1/{tenant}/analytics/top-regions`
- `/api/v1/{tenant}/analytics/compliance-scores`
- `/api/v1/{tenant}/analytics/incidents-per-hour`
- `/api/v1/{tenant}/analytics/detections-vs-resolutions`
- `/api/v1/{tenant}/analytics/alerts-by-country`

Every other route - alerts, fleet, threat-intel, audit export, SOAR,
SSE streams - is unaffected. Demo mode does not fabricate alerts; it
only fills the overview tiles when there is genuinely nothing to show.

### Reproducibility

Synthetic payloads are seeded by the tenant id, so two requests for
`acme` produce byte-identical responses while `globex` produces a
different - but equally stable - curve. The charter baseline is
fixed:

- `hosts_protected = 142`
- `events_per_sec = 2_400_000`
- `open_incidents = 14`
- `mttd_seconds = 48`
- 24-hour spike pattern with a midday peak
- 8 top regions, 4 compliance frameworks (SOC 2, ISO 27001, PCI DSS,
  GDPR)

### Audit trail

Every fallback emission records a structured `auth.audit` event with
`event=synthetic_overview_data_served`, plus an entry in the audit
store consumable through `/api/v1/audit/export`. The action field
encodes the endpoint, e.g. `synthetic_overview_data_served:overview-stats`.

### Disabling demo mode

Unset the variable (or set it to `false` / `0`) and restart the
process. There is no hot-reload knob - the flag is read once at
startup so the audit trail is unambiguous.
