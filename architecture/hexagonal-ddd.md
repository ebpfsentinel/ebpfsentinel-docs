# Hexagonal / DDD Architecture

## Overview

eBPFsentinel follows hexagonal architecture (ports & adapters) with Domain-Driven Design. The core business logic in `domain` has zero external dependencies — it can be tested without any infrastructure, eBPF, or network code.

## Dependency Rules

```
domain ← ports ← application
                ← infrastructure
                ← adapters ← agent (binary)
```

Arrows point toward dependencies. The domain depends on nothing.

### domain

**Pure business logic.** Engines, entities, errors. No I/O, no async, no side effects.

- `#![forbid(unsafe_code)]`
- Zero external dependencies (only `thiserror`, `serde` as dev-dependency)
- Contains 930+ unit tests
- Each domain follows the same structure:

```
crates/domain/src/<domain>/
├── entity.rs     # Types, enums, constants
├── engine.rs     # Core logic (stateless evaluation)
├── error.rs      # Domain-specific errors (thiserror)
└── mod.rs        # Re-exports
```

### ports

**Trait definitions.** Consumed by application code, implemented by adapters.

- `primary/` — traits that the application layer calls (e.g., firewall service interface)
- `secondary/` — traits that adapters implement (e.g., storage, metrics, alert senders)

### application

**Use cases and orchestration.** Wraps domain engines with port traits for metrics, storage, and side effects.

- Each domain has an `*AppService` (e.g., `IdsAppService`)
- App services compose: engine + metrics port + optional storage port

### infrastructure

**Config, logging, metrics setup.** Parses YAML config into domain-specific structs.

- `config.rs` — domain config structs with `validate()` + `to_domain_*()` methods
- Logging setup (tracing + JSON/text formatters)
- Metrics registry (Prometheus)

### adapters

**Port implementations.** HTTP handlers, gRPC services, eBPF loader, redb storage.

- `http/` — Axum handlers for REST API
- `grpc/` — tonic services for alert streaming
- `ebpf/` — Aya program loader and map management
- `storage/` — redb persistence
- `geoip/` — MaxMind `.mmdb` adapter for GeoIP lookups

### agent

**Binary entry point.** Wires everything together at startup.

- Reads config
- Initializes domain engines
- Creates app services with port implementations
- Starts HTTP/gRPC servers
- Loads eBPF programs
- Runs the event loop

## Testing Strategy

The hexagonal architecture enables testing at each layer:

| Layer | Test Type | Dependencies |
|-------|-----------|-------------|
| `domain` | Unit tests (inline `#[cfg(test)]`) | None — pure functions |
| `application` | Unit tests with `TestMetrics` mock | Mock implementations of ports |
| `adapters` | Integration tests | Real HTTP server, real eBPF (optional) |
| `agent` | BATS integration tests | Full running binary |

The `TestMetrics` struct implements `MetricsPort` and is used across all domain test modules.
