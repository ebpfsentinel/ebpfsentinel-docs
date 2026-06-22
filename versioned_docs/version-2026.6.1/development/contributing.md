# Contributing

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes following the patterns below
3. Ensure all checks pass locally:
   ```bash
   cargo fmt --check
   cargo clippy -- -D warnings
   cargo test
   cargo deny check
   ```
4. Write or update tests for your changes
5. Open a PR targeting `main`
6. CI must pass (format, lint, test, audit)

## Code Style

### Formatting

```bash
cargo fmt --check    # Verify
cargo fmt            # Fix
```

Standard Rust formatting (no custom `rustfmt.toml` overrides).

### Linting

Zero-warning policy with pedantic clippy:

```bash
cargo clippy -- -D warnings
```

Lint configuration is in `Cargo.toml` under `[workspace.lints.clippy]`:
- `all = deny` (baseline)
- `pedantic = warn` (stricter checks)
- A few targeted allows (`module_name_repetitions`, `must_use_candidate`, etc.)

**Note:** The `doc_markdown` lint catches unbackticked identifiers in doc comments (e.g., `HashMap`, `THREAT_TYPE_*`). Always backtick code identifiers in doc comments.

### Dependency Audit

```bash
cargo deny check
```

Policy (`deny.toml`):
- 13 approved licenses
- Yanked crates denied
- Unknown registries and git sources denied
- Vulnerability advisories denied

## Error Handling

- `thiserror` for library/domain errors (typed, matchable)
- `anyhow` for application-level errors (agent binary)
- Zero `.unwrap()` in production code
- `Result<T, DomainError>` for all domain engine methods

## Security

- Never commit credentials, keys, or secrets
- Config files containing secrets should be `chmod 640` or stricter
- All regex patterns are compiled with size and nesting limits (DoS prevention)
- Rule count limits are enforced at config load time

### Security Checklist for PRs

Before submitting a PR that touches security-sensitive code, verify:

- **SSRF prevention:** Validate URLs against private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), loopback (`127.0.0.0/8`, `::1`), link-local (`169.254.0.0/16`, `fe80::/10`), and multicast (`224.0.0.0/4`, `ff00::/8`) ranges before making outbound requests
- **CRLF injection:** Validate HTTP header values contain no `\r` or `\n` characters before setting them on outbound requests
- **Constant-time comparison:** Use constant-time comparison (`subtle::ConstantTimeEq` or equivalent) for all secret comparisons (API keys, tokens, HMACs) -- never use `==`
- **Regex safety:** Pre-compile all regex patterns with explicit `size_limit` and `nest_limit` to prevent ReDoS
- **Deserialization limits:** Enforce depth and size limits on all untrusted input (config files, API payloads, feed data) to prevent resource exhaustion
