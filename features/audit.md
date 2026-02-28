# Audit Trail

> **Edition: OSS** | **Status: Shipped** | **Enforcement: Userspace**

## Overview

The audit trail records all rule changes (create, update, delete) with timestamps, the acting user, and before/after state. Audit entries are stored locally and queryable via the REST API and CLI. Configurable retention policies control storage duration.

## How It Works

Every modification to security rules — firewall, IDS/IPS, L7, rate limiting — generates an audit entry:

```json
{
  "timestamp": "2026-02-19T10:00:00Z",
  "action": "create",
  "component": "firewall",
  "rule_id": "allow-web",
  "user": "admin",
  "before": null,
  "after": {"id": "allow-web", "priority": 10, "action": "allow", "protocol": "tcp", "dst_port": "80-443"}
}
```

Audit data supports compliance requirements for PCI-DSS (Requirement 10), HIPAA (§164.312(b)), and SOC 2 (CC6.8).

## Configuration

```yaml
audit:
  enabled: true
  retention_days: 90           # How long to keep audit entries
  buffer_size: 10000           # In-memory buffer before flush
  storage_path: "/var/lib/ebpfsentinel/audit"
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

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/audit/` | Audit engine (entity, engine, error) |
| `ports` | `crates/ports/src/secondary/audit.rs` | Storage port trait |
| `application` | `crates/application/src/audit_service_impl.rs` | App service |

## Metrics

- `ebpfsentinel_config_reloads_total{status}` — config reload count (success/failure)
