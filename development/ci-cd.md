# CI/CD

## Workflows

| Workflow | Trigger | Jobs |
|----------|---------|------|
| `ci.yml` | PR to main | Format, clippy, tests, cargo-deny, coverage, release build |
| `integration.yml` | Daily + dispatch | Build agent + eBPF, BATS suites (API, Docker, eBPF) |
| `ebpf.yml` | Dispatch | Build all 14 eBPF kernel programs |
| `docker.yml` | Called by release | Multi-arch Docker image (amd64 + arm64) |
| `release.yml` | Tag push / dispatch | Multi-arch tarballs + Docker + GitHub Release |
| `benchmarks.yml` | PR to main | Criterion benchmarks, regression detection |
| `security.yml` | Daily + dispatch | Audit, deny, unsafe audit, Miri, cargo-careful, SBOM |
| `mutation.yml` | Weekly (Sunday) | cargo-mutants on domain engines |

All CI jobs use **composite actions** (`.github/actions/`) to deduplicate setup steps (Rust toolchain, bpf-linker, BATS, version stamping).

## ci.yml

The primary CI pipeline runs on every PR:

1. **Format** — `cargo fmt --check`
2. **Clippy** — `cargo clippy -- -D warnings` (zero-warning policy)
3. **Tests** — `cargo test` (all crates)
4. **Deny** — `cargo deny check` (license, advisory, ban, source)
5. **Coverage** — `cargo llvm-cov` with per-crate floors (domain >= 90%, application >= 80%, adapters >= 60%)
6. **Build** — `cargo build --release`

## integration.yml

Integration tests using BATS (daily + dispatch):

- **Build job**: agent binary + eBPF programs (nightly + bpf-linker)
- **API tests**: suites 01-05, 07-08 (lifecycle, REST, firewall CRUD, gRPC, auth, TLS)
- **Docker tests**: suite 09 (Docker deployment)
- **eBPF tests**: suite 06 (eBPF attachment, gated to main/dispatch)

## security.yml

Daily security scanning:

| Job | Tool | What it checks |
|-----|------|----------------|
| **Audit** | `cargo audit` | Dependency vulnerabilities |
| **Deny** | `cargo deny` | License and policy compliance |
| **Unsafe Audit** | grep + lint | Verify `forbid(unsafe_code)` / `deny(unsafe_code)` crate policies |
| **Miri** | `cargo +nightly miri test -p ebpf-common` | UB detection on shared kernel/userspace types (Tree Borrows) |
| **Careful** | `cargo +nightly careful test` | Extra UB checks across all userspace crates |
| **SBOM** | `cargo-cyclonedx` | CycloneDX supply chain transparency |

## mutation.yml

Weekly mutation testing on critical domain engines:

- Runs `cargo-mutants` on firewall, IDS, DLP, alert, IPS, rate-limit engines
- Reports mutation score (target: >= 70%)

## Composite Actions

Shared setup sequences extracted into `.github/actions/`:

| Action | Used by | What it does |
|--------|---------|-------------|
| `setup-rust-build` | ci, integration, mutation | Rust toolchain + cache + system deps (protoc, libpcap) |
| `install-bpf-linker` | ebpf, docker, integration, release | LLVM + bpf-linker for eBPF compilation |
| `install-bats` | integration | BATS test framework |
| `stamp-version` | docker, release | Replace `0.0.0-dev` in Cargo.toml files |

## Local CI

Run the same checks locally before pushing:

```bash
cargo fmt --check
cargo clippy -- -D warnings
cargo test
cargo deny check
cargo +nightly miri test -p ebpf-common    # optional: UB detection
cargo +nightly careful test                 # optional: extra UB checks
```
