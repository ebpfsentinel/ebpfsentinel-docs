# Security Model

## Code Safety

### Unsafe Code Policy

| Crate | Policy | Rationale |
|-------|--------|-----------|
| `domain` | `#![forbid(unsafe_code)]` | Pure business logic — no justification for unsafe |
| `ports` | `#![forbid(unsafe_code)]` | Trait definitions only |
| `application` | `#![forbid(unsafe_code)]` | Orchestration only |
| `infrastructure` | `#![forbid(unsafe_code)]` | Config, logging, metrics |
| `adapters` | `#![deny(unsafe_code)]` | One targeted `#[allow]` for eBPF ring buffer parsing |

### Dependency Auditing

```bash
cargo deny check    # License, advisory, ban, source checks
cargo audit         # Vulnerability scanning
```

`deny.toml` policy:
- 9 approved dependency licenses (MIT, Apache-2.0, AGPL-3.0-only, BSD-2/3-Clause, ISC, Unicode-3.0, Unicode-DFS-2016, OpenSSL)
- Yanked crates denied
- Unknown registries and git sources denied
- Vulnerability advisories denied

### SBOM Generation

CycloneDX Software Bill of Materials is generated in CI for supply chain transparency.

## Input Validation

### Regex DoS Prevention

All user-supplied regex patterns are compiled with safety limits:

- **10 MiB** maximum compiled regex size
- **200** maximum nesting depth
- Compilation timeout prevents hangs

### Configuration Limits

- Maximum **4096 rules** per domain (prevents OOM from oversized YAML)
- Feed URL validation
- CIDR subnet validation
- Port range validation

### File Permission Warnings

The agent warns at startup if config or key files are world-readable:

```
WARN: config file /etc/ebpfsentinel/config.yaml has mode 0644 — recommend 0640 or stricter
```

## eBPF Safety

eBPF programs are verified by the kernel verifier before loading:

- **Memory safety** — all memory accesses bounds-checked
- **Termination** — programs must provably terminate (loop bounds, instruction limit)
- **No arbitrary kernel memory access** — only approved helper functions
- **Type safety** — BTF provides type information for CO-RE (Compile Once, Run Everywhere)

The agent requires `CAP_BPF` + `CAP_NET_ADMIN` capabilities (or root).

## Authentication Security

- **JWT validation** — RS256 signature, issuer, audience, expiration checks
- **OIDC** — JWKS key rotation support via discovery URL
- **API keys** — constant-time comparison to prevent timing attacks
- **TLS 1.3** — rustls with aws-lc backend, older protocol versions rejected

## Network Security

- REST API listens on `127.0.0.1` by default (not exposed to network)
- Health endpoints (`/healthz`, `/readyz`) are unauthenticated for probe compatibility
- All other endpoints require authentication when `auth.enabled: true`
- gRPC supports TLS when enabled

## Error Handling

- `thiserror` for typed, matchable domain errors
- `anyhow` for application-level error aggregation
- Zero `.unwrap()` in production code
- Sensitive data (API keys, certificates) is never logged or returned in API responses
