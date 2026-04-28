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

## Worked examples

See `config/examples/` in the dashboard repo:

- `dashboard.yaml` — default single-tenant, no ClickHouse.
- `dashboard-airgap.yaml` — local OIDC, bundled assets, no history
  store.
- `dashboard-mssp.yaml` — multi-tenant MSSP with rotating EdDSA keys
  and ClickHouse history (90-day retention).
