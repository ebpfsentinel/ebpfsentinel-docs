# Security Model

## Code Safety

### Unsafe Code Policy

| Crate | Policy | Rationale |
|-------|--------|-----------|
| `domain` | `#![forbid(unsafe_code)]` | Pure business logic - no justification for unsafe |
| `ports` | `#![forbid(unsafe_code)]` | Trait definitions only |
| `application` | `#![forbid(unsafe_code)]` | Orchestration only |
| `infrastructure` | `#![forbid(unsafe_code)]` | Config, logging, metrics |
| `adapters` | `#![deny(unsafe_code)]` | Lifted with a file-level `#[allow]` in 16 files: ring-buffer record reads, raw BPF and netlink syscalls, fd passing |
| `agent` | `#![forbid(unsafe_code)]` | Wiring only |
| `warden-proto` | `#![forbid(unsafe_code)]` | Wire messages only |
| `warden-client` | `#![forbid(unsafe_code)]` unless the `fd-pass` feature is on | `SCM_RIGHTS` fd receipt needs `libc` |
| `warden` | `#![allow(unsafe_code)]` | Raw mount, bpf and user-namespace syscalls; the smallest privileged process in the deployment |
| `ebpf-common` | `#![deny(unsafe_op_in_unsafe_fn)]` | Shared kernel/userspace types - enforces explicit unsafe blocks inside unsafe fns |

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
- 12 approved dependency licenses (MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, AGPL-3.0-only, BSD-2-Clause, BSD-3-Clause, 0BSD, ISC, Zlib, CC0-1.0, CDLA-Permissive-2.0, Unicode-3.0). OpenSSL is not on the list: nothing in the tree carries it, so a dependency that drags it in fails the check
- Yanked crates denied
- Unknown registries and git sources denied
- Vulnerability advisories denied

### SBOM Generation

CycloneDX Software Bill of Materials is generated in CI for supply chain transparency.

## Input Validation

### Regex DoS Prevention

All user-supplied regex patterns (IDS, DLP, L7 domain matching) are compiled
with the `regex` crate, which guarantees linear-time matching (no
backtracking), and with safety limits:

- **10 MiB** maximum compiled regex size
- **200** maximum nesting depth
- **4 KiB** maximum DLP pattern source length; **253** characters for an L7 domain pattern

A pattern over a limit is refused at load with an error naming it.

### DNS Parser Safety

- Pointer hop limit fixed at exactly **10 hops** to prevent infinite-loop or amplification attacks in compressed DNS names
- Checked arithmetic on DNS event payload offsets to prevent integer overflow

### Configuration Limits

- Rule count ceilings, checked at load (prevents OOM from oversized YAML):

| Section | Maximum |
|---|---:|
| Firewall rules | 4 096 |
| IDS rules | 50 000 |
| IPS rules | 50 000 |
| L7 rules | 10 000 |
| Rate-limit rules | 10 000 |
| DLP patterns | 1 000 |
| NAT rules | 256 |
| NPTv6 rules | 64 |

- Feed URL validation
- CIDR subnet validation
- Port range validation

### File Permission Warnings

The agent warns at startup if config or key files are world-readable:

```
WARN: config file /etc/ebpfsentinel/config.yaml has mode 0644 - recommend 0640 or stricter
```

## eBPF Safety

eBPF programs are verified by the kernel verifier before loading:

- **Memory safety** - all memory accesses bounds-checked
- **Termination** - programs must provably terminate (loop bounds, instruction limit)
- **No arbitrary kernel memory access** - only approved helper functions
- **Type safety** - BTF provides type information for CO-RE (Compile Once, Run Everywhere)

eBPF loads **exclusively** through a BPF token (kernel 6.9+) - there is no
capability-based loading path. The agent unshares a user namespace of its own
and asks the privileged **warden** to apply the `delegate_*` options to a bpffs
it prepared, which is the one step that needs `CAP_SYS_ADMIN` in the initial
user namespace. The agent then creates the token and loads its own programs, so
the long-running agent holds **no host capabilities**. See the
[BPF token guide](../operations/deployment/bpf-token.md).

## Container DLP and host PID visibility

TLS data-loss prevention is a uprobe on `SSL_write`/`SSL_read` inside each
workload's own `libssl` - the only place TLS plaintext exists. To inspect every
container on a node (not just the agent's own process), the agent resolves each
workload's library through the host `/proc` and attaches a uprobe per library.

This requires two privilege expansions, both isolated away from the agent:

- **Host PID namespace** (`hostPID: true` / `pid: host`) and a read-only
  `/host/proc` mount. The agent reads `/host/proc/<pid>/maps` to find each
  workload's `libssl`. **Security note:** sharing the host PID namespace lets the
  pod see *every* process on the node - command lines, environment via
  `/proc/<pid>`, and so on. This is the irreducible cost of node-wide DLP. With
  `hostPID` disabled, DLP still works but covers only the libraries the agent
  itself maps (its own container).
- **Tracing capabilities on the warden only.** Reading a neighbouring
  container's `/proc/<pid>/root` (`CAP_SYS_PTRACE`) and creating the uprobe link
  (`CAP_BPF` + `CAP_PERFMON`) are brokered to the privileged **warden**, which
  returns the link descriptor over the control socket. The agent itself stays
  `cap-drop: ALL` - it never holds a tracing capability.

Statically-linked TLS runtimes (Go `crypto/tls`, Rust rustls, Java JSSE) export
no `libssl` symbol to probe and are not covered by the OSS agent.

## Authentication Security

- **JWT validation** - RS256 or EdDSA signature, issuer, audience, expiration checks
- **OIDC** - JWKS key rotation support via discovery URL
- **API keys** - configurable salted SHA-256 hashing with constant-time comparison to prevent timing attacks
- **TLS 1.3** - rustls with aws-lc backend, older protocol versions rejected
- **CA private key zeroized on drop** - enterprise TLS inspection CA key material is securely erased from memory when no longer needed

## Network Security

- REST API listens on `127.0.0.1` by default (not exposed to network)
- Health endpoints (`/healthz`, `/readyz`) are unauthenticated for probe compatibility
- All other endpoints require authentication when `auth.enabled: true`
- Metrics endpoint is rate-limited regardless of authentication state (30 requests per minute per IP sustained, burst 10)
- Mutating control-plane endpoints are rate-limited per client IP (configurable; loopback exempt by default) so a leaked token cannot rapidly rewrite enforcement state - see [agent configuration](../configuration/agent.md#write-api-rate-limit)
- **CORS** - exact `localhost` host matching rejects subdomain bypass attempts (e.g., `localhost.attacker.com` is not treated as localhost)
- gRPC supports TLS when enabled

## Content Security Policy (dashboard)

The dashboard server enforces a strict, nonce-based CSP on every HTTP response:

```text
default-src 'self';
script-src  'self' 'nonce-<per-request>' 'strict-dynamic';
style-src   'self' 'nonce-<per-request>';
img-src     'self' data:;
font-src    'self';
connect-src 'self' <oidc-issuer-origins>;
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

### `connect-src` allowlist

`connect-src` is locked to `'self'` plus the explicit OIDC issuer origin(s). The dashboard derives the origin (`scheme://host[:port]`) from the configured `oidc.issuer_url` at startup, plus every entry in `oidc.additional_issuers` for federated-discovery (multi-IdP) deployments. No wildcard, no `*`. A compromised dependency cannot exfiltrate via `fetch` / `EventSource` / `WebSocket` to an arbitrary host because the browser refuses any `connect-src` target outside that allowlist; CSP violations are reported via `/csp-report` and counted by `ebpfsentinel_dashboard_csp_violations_total{directive="connect-src"}`.

### `'strict-dynamic'`

With `'strict-dynamic'`, scripts loaded by a nonced script inherit trust without needing their own nonce. The Angular bundle's entry scripts carry the nonce in the `index.html` the server returns, and the chunks they load lazily inherit it. No `eval` and no WebAssembly is allowed.

### CSP violation reporting

Browsers send violation reports as `POST /csp-report` (Content-Type `application/csp-report`). The dashboard server logs each violation at `warn` level and increments the Prometheus counter `ebpfsentinel_dashboard_csp_violations_total{directive}`.

### Client error isolation

Each per-route subtree of the dashboard is wrapped in its own error boundary so
a fault in one detail view does not blank the sidebar, top bar, or the rest of
the application; the error fallback is reset on the next navigation. There is
no client panic uplink: the dashboard front sends no crash report to the
server, so no route accepts one and no metric counts one.

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
