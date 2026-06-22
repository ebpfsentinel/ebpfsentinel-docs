# Adding a New Security Domain

This guide walks through adding a new security domain to eBPFsentinel, following the established hexagonal/DDD patterns.

## Step-by-Step

### 1. Domain Engine

Create the engine in `crates/domain/src/<name>/` (replace `<name>` with your domain name):

```
crates/domain/src/<name>/
├── entity.rs     # Types, enums, constants
├── engine.rs     # Core logic (stateless evaluation)
├── error.rs      # Domain-specific errors (thiserror)
└── mod.rs        # Re-exports
```

**entity.rs** — define your domain types:

```rust
#[derive(Debug, Clone)]
pub struct MyRule {
    pub id: String,
    pub priority: u32,
    // domain-specific fields
}
```

**engine.rs** — pure stateless evaluation:

```rust
pub struct MyEngine;

impl MyEngine {
    pub fn new() -> Self { Self }

    pub fn evaluate(&self, event: &PacketEvent, rules: &[MyRule]) -> MyResult {
        // Pure function: input + rules → decision
    }
}
```

**error.rs** — domain errors:

```rust
#[derive(Debug, thiserror::Error)]
pub enum MyError {
    #[error("invalid rule: {0}")]
    InvalidRule(String),
}
```

### 2. Port Traits

Add port traits in `crates/ports/src/`:

**`primary/<name>.rs`** — trait consumed by adapters:

```rust
pub trait MyPort: Send + Sync {
    fn list_rules(&self) -> Vec<MyRule>;
    fn add_rule(&self, rule: MyRule) -> Result<(), MyError>;
    fn delete_rule(&self, id: &str) -> Result<(), MyError>;
}
```

**secondary/** — if you need storage or external integrations, add traits here.

### 3. Application Service

Create the app service at `crates/application/src/<name>_service_impl.rs`:

```rust
pub struct MyAppService<M: MetricsPort> {
    engine: MyEngine,
    metrics: M,
}

impl<M: MetricsPort> MyPort for MyAppService<M> {
    // Implement port trait, wrapping engine calls with metrics
}
```

### 4. HTTP Handlers

Add handlers at `crates/adapters/src/http/<name>_handler.rs`:

```rust
pub async fn list_rules(State(svc): State<Arc<dyn MyPort>>) -> impl IntoResponse {
    Json(svc.list_rules())
}
```

Wire routes in `crates/adapters/src/http/router.rs`.

### 5. Configuration

Add config section in `crates/infrastructure/src/config.rs`:

```rust
#[derive(Debug, Deserialize)]
pub struct MyConfig {
    pub enabled: bool,
    pub rules: Vec<MyRuleConfig>,
}

impl MyConfig {
    pub fn validate(&self) -> Result<(), ConfigError> { /* ... */ }
    pub fn to_domain_rules(&self) -> Vec<MyRule> { /* ... */ }
}
```

### 6. Agent Startup

Initialize in `crates/agent/src/startup.rs`:

- Create engine from config
- Wrap in app service
- Register HTTP routes

### 7. Tests

Add tests at each layer:

- **Domain:** inline `#[cfg(test)]` in `engine.rs` — test pure logic
- **Application:** test with `TestMetrics` mock
- **Integration:** add BATS test cases if needed

### 8. Optional: CLI Subcommand

Add CLI subcommand in the agent crate's clap definition.

### 9. Optional: eBPF Program

If the domain needs kernel-side enforcement, create a new eBPF program crate under `crates/ebpf-programs/`.

## Checklist

- [ ] Domain engine with entity, engine, error, mod
- [ ] Port trait(s) in primary/ (and secondary/ if needed)
- [ ] App service implementing port trait
- [ ] HTTP handler(s) with routes wired in router
- [ ] Config section with validate() + to_domain_*()
- [ ] Agent startup initialization
- [ ] Unit tests in domain engine
- [ ] Integration tests (BATS) if applicable
