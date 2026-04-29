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

Short-lived dashboard session tokens, always EdDSA. JWKS rotation is
configured here.

| Field | Type | Default | Validation |
|---|---|---|---|
| `algorithm` | string | `EdDSA` | Only `EdDSA` is accepted. |
| `active.kid` | string | (required) | Stable identifier the agent matches against. |
| `active.private_key_path` | path | (required) | Ed25519 PEM (`PRIVATE KEY`). Warn if mode > `0640`. |
| `active.public_key_path` | path | unset | Optional companion public key for JWKS publishing. |
| `previous_keys[]` | list | `[]` | Same shape as `active`; honoured during rotation. |
| `access_token_ttl_seconds` | u64 | `900` | `1..=86400`. |
| `refresh_token_ttl_seconds` | u64 | `86400` | `60..=2592000` (30 days). |
| `jwks_cache_seconds` | u64 | `300` | `1..=86400`. |

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
| `poll_interval_seconds` | u64 | `60` | `5..=3600`. |

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
`jwt.active.private_key_path`. Verification honours every previous key
listed in `jwt.previous_keys[]` so a key rotation does not log every
user out at the swap moment. JWKS publishing + agent JWT mint land in
the next bootstrap story.

OIDC discovery runs once at startup against `oidc.issuer_url`. A
discovery failure refuses to start the server with a clear error so
configuration mistakes never present a half-functional login screen.

Refresh tokens are held server-side in a per-replica DashMap keyed by
`sub`, wrapped in `secrecy::SecretString` (zeroised on drop). The store
is per-replica: a refresh succeeds only if the user lands on the same
replica that minted their session — acceptable for a 12 h window. A
shared store lands as part of the multi-replica scaling work.

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
- `oidc.client_secret_file`, `jwt.active.private_key_path`,
  `jwt.previous_keys[].*` and `clickhouse.password_file` are re-read
  from disk on every reload, so secret rotation is just a file replace
  + reload.
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

## Worked examples

See `config/examples/` in the dashboard repo:

- `dashboard.yaml` — default single-tenant, no ClickHouse.
- `dashboard-airgap.yaml` — local OIDC, bundled assets, no history
  store.
- `dashboard-mssp.yaml` — multi-tenant MSSP with rotating EdDSA keys
  and ClickHouse history (90-day retention).
