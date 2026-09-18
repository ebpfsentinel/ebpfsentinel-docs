# Audit Trail

> **Edition: OSS** | **Enforcement: Userspace**

## Overview

The audit trail records two different things, in two stores, read through two routes.

The **log** records every security decision an engine takes - a packet passed, dropped, alerted on or rate-limited - alongside configuration reloads and response actions. The **rule history** records every change to a rule, with the acting user and before/after snapshots. Both are stored locally, queryable via the REST API and the CLI, and bounded by the same retention policy.

## How It Works

Each decision an engine takes becomes one log entry:

```json
{
  "timestamp_ns": 1771495200000000000,
  "component": "firewall",
  "action": "drop",
  "src_addr": [3232235521, 0, 0, 0],
  "dst_addr": [167772161, 0, 0, 0],
  "is_ipv6": false,
  "src_port": 44321,
  "dst_port": 80,
  "protocol": 6,
  "rule_id": "fw-001",
  "detail": "firewall drop rule_id=1"
}
```

An address is four big-endian 32-bit words: an IPv4 address occupies the first word and the rest are zero, an IPv6 address fills all four, and `is_ipv6` says which. Entries that are not about a packet - a configuration reload, a response action against a host - carry zeroes in the ports and the protocol. `component` is one of `firewall`, `ids`, `ips`, `l7`, `ratelimit`, `threatintel`, `dlp`, `ddos`, `loadbalancer`, `responses`, `config`; `action` is one of `pass`, `drop`, `alert`, `rate_exceeded`, `config_changed`, `rule_added`, `rule_removed`, `rule_updated`, `policy_violation`, `false_positive`.

Each change to a rule becomes one version in that rule's history:

```json
{
  "version": 3,
  "timestamp_ns": 1771495200000000000,
  "component": "firewall",
  "action": "rule_updated",
  "actor": "admin",
  "before": "{\"id\":\"allow-web\",\"priority\":10,\"action\":\"allow\",\"dst_port\":\"80\"}",
  "after": "{\"id\":\"allow-web\",\"priority\":10,\"action\":\"allow\",\"dst_port\":\"80-443\"}"
}
```

The snapshots are strings: the audit store keeps the rule exactly as it was serialised rather than re-parsing a shape that may since have changed.

Audit data supports compliance requirements for PCI-DSS (Requirement 10), HIPAA (§164.312(b)), and SOC 2 (CC6.8).

## Configuration

```yaml
audit:
  enabled: true
  retention_days: 90           # How long to keep audit entries
  buffer_size: 100000          # In-memory buffer before flush
  storage_path: "/var/lib/ebpfsentinel/audit.redb"
```

See [Configuration: Audit Trail](../configuration/audit.md) for the full reference.

## CLI Usage

```bash
# View audit logs
ebpfsentinel-agent audit logs --component firewall --limit 20

# View rule change history
ebpfsentinel-agent audit history fw-001
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/audit/logs` | List audit log entries (filterable) |
| GET | `/api/v1/audit/rules/{id}/history` | Rule change history for a specific rule |

`/api/v1/audit/logs` filters on `from`, `to` (nanoseconds since epoch, inclusive), `component`, `action` and `rule_id`, and pages on `limit` (default 100, capped at 1000) and `offset`. The answer carries `entries`, `total`, `limit` and `offset`. `/api/v1/audit/rules/{id}/history` takes `limit` alone (default 50, capped at 500) and answers `rule_id` plus `entries`. Both answer `503` when the store they read is not configured, so an empty page never stands for a store that was never opened.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/audit/` | Audit engine (entity, engine, error) |
| `ports` | `crates/ports/src/secondary/audit_store.rs` | Storage port trait |
| `ports` | `crates/ports/src/secondary/audit_sink.rs` | Write port every domain service records through |
| `application` | `crates/application/src/audit_service_impl.rs` | App service |

## Metrics

- `ebpfsentinel_audit_events_total` - audit events recorded
- `ebpfsentinel_audit_failures_total` - audit write failures
- `ebpfsentinel_rules_reloads_total{component, result}` - config reload count, by component and `result` (`success` or `failure`)
