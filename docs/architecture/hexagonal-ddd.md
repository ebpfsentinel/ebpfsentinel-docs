# Hexagonal / DDD Architecture

## Overview

eBPFsentinel follows hexagonal architecture (ports & adapters) with Domain-Driven Design. The core business logic in `domain` has zero external dependencies - it can be tested without any infrastructure, eBPF, or network code.

## Dependency Rules

```
ebpf-common ← domain ← ports ← application ← agent (binary)
              domain ← infrastructure ← adapters ← agent
              domain, ports ← adapters
```

Arrows point toward dependencies. The domain depends on nothing of ours but
`ebpf-common`, the `#[repr(C)]` types the kernel programs share. Adapters read
the parsed configuration from `infrastructure`; `application` never does, and
neither ever imports an adapter. Only `agent` sees every crate, because it is
where they are wired together.

### domain

**Pure business logic.** Engines, entities, errors. No I/O, no async, no side effects.

- `#![forbid(unsafe_code)]`
- Minimal external dependencies: `thiserror`, `serde`, `regex`, `ebpf-common`
- Contains about 1200 unit tests, plus property tests on the parsers and engines
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

- `secondary/` - traits that adapters implement (e.g., storage, metrics, alert senders). This is where every port in the tree lives.
- `primary/` - reserved for traits the application layer would expose to a driving adapter. It holds no trait: HTTP handlers hold the app services as concrete types on `AppState`, so there is nothing to invert yet. Add a trait here only when a caller needs one, not because the layer exists.

### application

**Use cases and orchestration.** Wraps domain engines with port traits for metrics, storage, and side effects.

- Each domain has an `*AppService` (e.g., `IdsAppService`)
- App services compose: engine + metrics port + optional storage port

### infrastructure

**Config, logging, metrics setup.** Parses YAML config into domain-specific structs.

- `config.rs` - domain config structs with `validate()` + `to_domain_*()` methods
- Logging setup (tracing + JSON/text formatters)
- Metrics registry (Prometheus)

### adapters

**Port implementations.** HTTP handlers, gRPC services, eBPF loader, redb storage.

- `http/` - Axum handlers for REST API
- `grpc/` - tonic services for alert streaming
- `ebpf/` - Aya program loader and map management
- `storage/` - redb persistence
- `geoip/` - MaxMind `.mmdb` adapter for GeoIP lookups
- `#![deny(unsafe_code)]` at the crate root, lifted file by file (16 files) where a raw syscall or a ring-buffer record read needs it

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
| `domain` | Unit tests (inline `#[cfg(test)]`) | None - pure functions |
| `application` | Unit tests with `TestMetrics` mock | Mock implementations of ports |
| `adapters` | Integration tests | Real HTTP server, real eBPF (optional) |
| `agent` | BATS integration tests | Full running binary |

The `TestMetrics` struct implements `MetricsPort` and is used across all domain test modules.
