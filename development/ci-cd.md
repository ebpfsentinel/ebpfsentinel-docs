# CI/CD

## Workflows

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | Push/PR to main/develop | Format, clippy, tests, cargo-deny, cargo-audit, release build |
| `integration.yml` | Push/PR to main, nightly | BATS suites 01-05, 07-08 (API, auth, TLS) |
| `benchmarks.yml` | Push/PR to main | Compile check + full run, regression detection |
| `security.yml` | Push to main, daily | Audit, deny, unsafe code audit, SBOM generation |

All CI jobs must pass before merging.

## ci.yml

The primary CI pipeline runs on every push and PR:

1. **Format** — `cargo fmt --check`
2. **Clippy** — `cargo clippy -- -D warnings` (zero-warning policy)
3. **Tests** — `cargo test` (all crates)
4. **Deny** — `cargo deny check` (license, advisory, ban, source)
5. **Audit** — `cargo audit` (vulnerability scanning)
6. **Build** — `cargo build --release`

## integration.yml

Integration tests using BATS:

- Suites 01-05: agent lifecycle, REST API, firewall CRUD, domain APIs, gRPC
- Suite 07: authentication (JWT, OIDC, RBAC)
- Suite 08: TLS (HTTPS, gRPC-TLS)

Suites 06 (eBPF attachment), 09 (Docker), and 10 (Kubernetes) run in separate environments that require privileged access or infrastructure.

## benchmarks.yml

Criterion benchmarks for all domain engines:

- Compile check ensures benchmarks build
- Full benchmark run measures performance
- CI detects regressions on PRs (compares against `main` baseline)

## security.yml

Daily security scanning:

- `cargo audit` — dependency vulnerability check
- `cargo deny` — license and policy compliance
- Unsafe code audit — verify `forbid(unsafe_code)` crate policies
- SBOM generation — CycloneDX format for supply chain transparency

## Local CI

Run the same checks locally before pushing:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cargo deny check
```
