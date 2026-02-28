# Authentication

> **Edition: OSS** | **Status: Shipped** | **Enforcement: Userspace**

## Overview

eBPFsentinel supports three authentication methods for API and CLI access: static API keys, JWT (RS256), and OIDC (JWKS discovery). Methods can be combined — API keys work alongside JWT or OIDC via a composite authentication provider. Role-based access control (RBAC) governs what each authenticated identity can do.

## Authentication Methods

### API Keys

Static tokens configured in YAML. Best for automation, CI/CD pipelines, and monitoring agents.

```yaml
auth:
  enabled: true
  api_keys:
    - name: admin
      key: "sk-change-me-admin-key"
      role: admin
    - name: monitoring
      key: "sk-change-me-monitoring"
      role: viewer
```

Use with `X-API-Key` header or `--token` CLI flag:

```bash
curl -H "X-API-Key: sk-change-me-admin-key" http://localhost:8080/api/v1/firewall/rules
ebpfsentinel-agent --token sk-change-me-admin-key firewall list
```

### JWT (RS256)

Service-to-service authentication with an RSA public key. The agent validates JWT tokens against the configured issuer, audience, and public key.

```yaml
auth:
  enabled: true
  jwt:
    issuer: "https://auth.example.com"
    audience: "ebpfsentinel"
    public_key_path: /etc/ebpfsentinel/jwt.pub
```

### OIDC (JWKS Discovery)

SSO integration via OpenID Connect. The agent fetches the JWKS (JSON Web Key Set) from the discovery URL and validates tokens dynamically.

```yaml
auth:
  enabled: true
  oidc:
    jwks_url: "https://auth.example.com/.well-known/jwks.json"
```

### Combined Authentication

API keys can be combined with JWT or OIDC for mixed environments (human users via SSO, automation via API keys):

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
| `operator` | Namespace-scoped writes (create/update/delete rules) |
| `viewer` | Read-only access to all endpoints |

### Public Endpoints (No Auth Required)

| Path | Description |
|------|-------------|
| `/healthz` | Liveness probe |
| `/readyz` | Readiness probe |

All `/api/v1/*` endpoints require authentication when `auth.enabled: true`.

## Configuration

See [Configuration: Authentication](../configuration/auth.md) for the full reference.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/auth/` | Auth engine (token validation, RBAC) |
| `infrastructure` | `crates/infrastructure/src/config.rs` | Auth config parsing |
| `adapters` | `crates/adapters/src/http/` | Axum middleware for auth extraction |
