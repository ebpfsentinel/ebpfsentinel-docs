# Testing

## Unit Tests

```bash
cargo test                     # All crates (requires protoc)
cargo test -p domain           # Domain crate only (930+ tests, no protoc needed)
cargo test -p infrastructure   # Config + infra tests
cargo test -p adapters         # Adapter tests (requires protoc)
```

The domain crate has zero external dependencies and contains the bulk of the tests. This is the fastest feedback loop during development.

### Test Pattern

Tests are inline `#[cfg(test)]` modules. Domain tests use a `TestMetrics` mock implementing `MetricsPort`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_engine_evaluates_rule() {
        let engine = FirewallEngine::new();
        let result = engine.evaluate(&packet, &rules);
        assert_eq!(result, Verdict::Allow);
    }
}
```

## Integration Tests

67 tests across 10 BATS suites that test the agent as a running binary:

| Suite | Tests | Description |
|-------|-------|-------------|
| 01 | Agent lifecycle | Start, stop, SIGHUP reload, invalid config |
| 02 | REST API health | healthz, readyz, status, metrics, OpenAPI |
| 03 | Firewall CRUD | Create, list, delete rules via REST |
| 04 | Domain APIs | IPS, L7, rate limit, threat intel, alerts, audit |
| 05 | gRPC streaming | Health, reflection, alert subscriptions |
| 06 | eBPF programs | veth pair setup, program attachment (needs root) |
| 07 | Authentication | JWT, OIDC, RBAC roles, token expiry |
| 08 | TLS | HTTPS, gRPC-TLS, certificate validation |
| 09 | Docker | Image build, compose up/down, healthcheck |
| 10 | Kubernetes | Minikube DaemonSet, liveness probes |

```bash
cd tests/integration

# Run all suites
make test

# Run a single suite
make test-suite SUITE=01-agent-lifecycle

# Run in a Vagrant VM
make vagrant-up && make test-vm

# K8s tests (requires minikube)
make test-k8s
```

## Benchmarks

10 criterion benchmark suites covering all domain engines:

```bash
cargo bench -p domain          # Run all benchmarks
cargo bench -p domain -- firewall  # Filter by name
```

Benchmark results generate HTML reports in `target/criterion/`. CI detects regressions on PRs.

## Fuzz Testing

12 libFuzzer targets covering all parsing and engine hot paths:

```bash
cd fuzz
cargo fuzz run fuzz_dns_parser -- -max_total_time=60
```

| Target | Scope |
|--------|-------|
| `fuzz_feed_parser` | Threat intel feeds (plaintext, CSV, JSON) |
| `fuzz_l7_parsers` | L7 protocol detection (HTTP, TLS, gRPC, SMTP, FTP, SMB) |
| `fuzz_dlp_scan` | DLP pattern matching |
| `fuzz_packet_event` | `PacketEvent` ring buffer parsing |
| `fuzz_dns_parser` | DNS wire format, blocklist feeds, DGA entropy |
| `fuzz_ids_ips` | IDS regex loading, IPS whitelist/blacklist |
| `fuzz_firewall` | Firewall rule add/remove/reload, evaluation |
| `fuzz_ratelimit` | Rate limit policy CRUD, eBPF key conversion |
| `fuzz_alert_router` | Alert dedup, throttle, route matching |
| `fuzz_config` | YAML config parsing + validation |
| `fuzz_domain_reputation` | Domain scoring, decay, LRU eviction |
| `fuzz_domain_matcher` | Domain pattern compilation + matching |
