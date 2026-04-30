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
| `ebpf-common` | `#![deny(unsafe_op_in_unsafe_fn)]` | Shared kernel/userspace types — enforces explicit unsafe blocks inside unsafe fns |

### UB Detection

| Tool | Scope | What it checks |
|------|-------|----------------|
| **Miri** | `ebpf-common` | Undefined behavior in `Pod` impls, alignment, uninitialized memory, aliasing (Tree Borrows) |
| **cargo-careful** | All userspace crates | Extra stdlib UB checks, integer overflow, out-of-bounds in release mode |

Both run in the daily `security.yml` CI workflow.

### Dependency Auditing

```bash
cargo deny check    # License, advisory, ban, source checks
cargo audit         # Vulnerability scanning
```

`deny.toml` policy:
- 13 approved dependency licenses (MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, AGPL-3.0-only, BSD-2-Clause, BSD-3-Clause, 0BSD, ISC, Zlib, CC0-1.0, CDLA-Permissive-2.0, Unicode-3.0, OpenSSL)
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
- **4 KiB** maximum regex source length
- Compilation timeout prevents hangs

### DNS Parser Safety

- Pointer hop limit fixed at exactly **10 hops** to prevent infinite-loop or amplification attacks in compressed DNS names
- Checked arithmetic on DNS event payload offsets to prevent integer overflow

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
- **API keys** — configurable salted SHA-256 hashing with constant-time comparison to prevent timing attacks
- **TLS 1.3** — rustls with aws-lc backend, older protocol versions rejected
- **CA private key zeroized on drop** — enterprise TLS inspection CA key material is securely erased from memory when no longer needed

## Network Security

- REST API listens on `127.0.0.1` by default (not exposed to network)
- Health endpoints (`/healthz`, `/readyz`) are unauthenticated for probe compatibility
- All other endpoints require authentication when `auth.enabled: true`
- Metrics endpoint is rate-limited regardless of authentication state
- **CORS** — exact `localhost` host matching rejects subdomain bypass attempts (e.g., `localhost.attacker.com` is not treated as localhost)
- gRPC supports TLS when enabled

## Content Security Policy (dashboard)

The dashboard server enforces a strict, nonce-based CSP on every HTTP response:

```text
default-src 'self';
script-src  'self' 'nonce-<per-request>' 'strict-dynamic' 'wasm-unsafe-eval';
style-src   'self' 'nonce-<per-request>';
img-src     'self' data:;
font-src    'self';
connect-src 'self';
object-src  'none';
base-uri    'none';
frame-ancestors 'none';
form-action 'self';
upgrade-insecure-requests;
report-uri  /csp-report
```

### Nonce generation

A cryptographically random 128-bit nonce is generated per request using the OS CSPRNG, base64-encoded, and injected into:

- The `Content-Security-Policy` HTTP header (`'nonce-…'` in `script-src` and `style-src`)
- All `<script>` tags in the SPA `index.html` fallback response (`nonce="…"` attribute)

### `'strict-dynamic'`

With `'strict-dynamic'`, scripts loaded by a nonced script inherit trust without needing their own nonce. The Trunk-generated WASM bootstrap script carries the nonce; all dynamically loaded modules (including the WASM binary) propagate from it.

### WASM and `'wasm-unsafe-eval'`

The Leptos client compiles to WebAssembly. Browsers require an explicit CSP directive to allow WASM execution:

- **`'wasm-eval'`** — the standard directive (CSP Level 3), but not yet shipped in Chrome, Firefox, or Safari as of 2026-04.
- **`'wasm-unsafe-eval'`** — the interim directive supported by all major browsers. Despite the name, it only permits WASM compilation and does not allow arbitrary `eval()`.

The dashboard uses `'wasm-unsafe-eval'` until `'wasm-eval'` reaches baseline support. The `scripts/csp-audit.sh` CI script validates that no CSP violations occur across all dashboard routes.

### CSP violation reporting

Browsers send violation reports as `POST /csp-report` (Content-Type `application/csp-report`). The dashboard server logs each violation at `warn` level and increments the Prometheus counter `ebpfsentinel_dashboard_csp_violations_total{directive}`.

### Additional security headers

Every response also carries:

| Header | Value |
|--------|-------|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `geolocation=(), camera=(), microphone=()` |

## Error Handling

- `thiserror` for typed, matchable domain errors
- `anyhow` for application-level error aggregation
- Zero `.unwrap()` in production code
- Sensitive data (API keys, certificates) is never logged or returned in API responses
