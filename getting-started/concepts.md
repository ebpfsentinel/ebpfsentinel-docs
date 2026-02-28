# Core Concepts

## Architecture at a Glance

eBPFsentinel is a single binary that runs two layers:

1. **Kernel-space eBPF programs** — attached at XDP, TC, and uprobe hook points for wire-speed packet processing
2. **Userspace Rust agent** — receives events via RingBuf, runs domain engines, serves the REST/gRPC API

```
┌─────────────────────────────────────────────────────┐
│  Kernel                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐ │
│  │ XDP Firewall │→ │ XDP RateLimit│  │ TC IDS    │ │
│  │              │  │              │  │ TC ThreatI│ │
│  │ LPM Trie     │  │ PerCPU Hash  │  │ TC DNS    │ │
│  │ DEVMAP/CPUMAP│  │ SYN Cookie   │  │ Bloom Flt │ │
│  └──────┬───────┘  └──────┬───────┘  └─────┬─────┘ │
│         └──────────────────┴────────────────┘       │
│                     RingBuf                         │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│  Userspace                                          │
│  EventDispatcher → Domain Engines → AlertRouter     │
│                                                     │
│  REST API (Axum)  │  gRPC (tonic)  │  Prometheus   │
└─────────────────────────────────────────────────────┘
```

## eBPF Hook Points

eBPFsentinel uses three types of eBPF hooks:

| Hook | Speed | Use Case | Programs |
|------|-------|----------|----------|
| **XDP** (eXpress Data Path) | Fastest — before the kernel network stack | Firewall, rate limiting | `xdp-firewall`, `xdp-ratelimit` |
| **TC** (Traffic Control) | Fast — after SKB allocation | IDS, threat intel, DNS capture | `tc-ids`, `tc-threatintel`, `tc-dns` |
| **uprobe** | Per-function call | SSL/TLS interception for DLP | `uprobe-dlp` |

XDP programs can **drop, pass, redirect, or tail-call** into other XDP programs. The firewall tail-calls into the rate limiter via `PROG_ARRAY`, meaning only one XDP program needs to be attached per interface.

## Tail-Call Chaining

The firewall and rate limiter are chained via XDP tail calls:

```
Packet → xdp-firewall → (if passed) → xdp-ratelimit → XDP_PASS/XDP_DROP
                       → (if blocked) → XDP_DROP
```

This avoids attaching multiple XDP programs to the same interface and eliminates redundant packet parsing.

## XDP→TC Metadata Passing

When an XDP program passes a packet, it writes metadata (matched rule ID, flags) using `bpf_xdp_adjust_meta`. Downstream TC programs read this metadata without re-parsing the packet headers.

## RingBuf Events

All eBPF programs emit events to userspace via BPF ring buffers. The `PacketEvent` structure is 56 bytes and includes:

- Source/destination addresses (IPv4 or IPv6)
- Source/destination ports
- Protocol, flags (`FLAG_IPV6`, `FLAG_VLAN`)
- VLAN ID, CPU ID, timestamp

The ring buffer implements **adaptive backpressure** — when the buffer exceeds 75% capacity (`bpf_ringbuf_query`), programs skip event emission to prevent userspace from falling behind.

## Domain Engines

Each security domain has a pure Rust engine with no I/O, no async, and no side effects:

| Engine | Input | Output |
|--------|-------|--------|
| Firewall | Packet headers + rules | Allow/Deny/Log decision |
| IDS | Packet payload + signatures | Alert with severity |
| IPS | IDS alert + blacklist | Block decision |
| DLP | Decrypted payload + patterns | Data leak alert |
| Rate Limiter | Source IP + policy | Allow/Throttle decision |
| Threat Intel | IP/domain + IOC database | Match + action |
| L7 Firewall | Parsed L7 fields + rules | Allow/Deny decision |
| DNS Intelligence | DNS query/response + blocklist | Allow/Block + cache update |
| Domain Reputation | Domain + behavioral history | Score + auto-block decision |

Engines are stateless functions: they take input and return a decision. State (blacklists, caches, counters) is managed by the application layer.

## Hexagonal / DDD Architecture

The codebase follows strict dependency rules:

```
domain ← ports ← application
                ← infrastructure
                ← adapters ← agent (binary)
```

- **domain** — pure business logic, depends on nothing, `#![forbid(unsafe_code)]`
- **ports** — trait definitions consumed and implemented by adapters
- **application** — orchestrates domain engines via port traits
- **infrastructure** — config parsing, logging, metrics setup
- **adapters** — HTTP, gRPC, eBPF, redb storage implementations
- **agent** — binary entry point, wires everything together

This means the domain logic is fully testable without any infrastructure, eBPF, or network code.

## Configuration

Single YAML file with optional per-feature sections. Only `agent.interfaces` is required:

```yaml
agent:
  interfaces: [eth0]    # Everything else is optional
```

**Precedence:** CLI flags > environment variables > YAML file > defaults

The agent supports **hot reload** — configuration changes are applied without restart via SIGHUP, file watching, or the REST API.

## Authentication Model

Three authentication methods, combinable:

| Method | Use Case | Configuration |
|--------|----------|---------------|
| **API Keys** | Static tokens for automation | `auth.api_keys` list |
| **JWT (RS256)** | Service-to-service with PKI | `auth.jwt` with public key |
| **OIDC (JWKS)** | SSO integration | `auth.oidc` with discovery URL |

RBAC roles: `admin` (full access), `operator` (namespace-scoped writes), `viewer` (read-only).

## Alert Pipeline

```
Domain Engine → AlertRouter → Dedup → Throttle → Route → Sender
                                                          ├── Email (SMTP)
                                                          ├── Webhook (HTTP)
                                                          └── Log (file)
```

Alerts flow through deduplication (suppress duplicate alerts within a window), throttling (rate-limit per source), severity-based routing, and circuit breakers (back off if a sender is down).

## Next Steps

- [Feature Overview](../features/overview.md) — see what each domain does
- [Architecture Overview](../architecture/overview.md) — deep dive into the codebase
- [Configuration Overview](../configuration/overview.md) — configure the agent
