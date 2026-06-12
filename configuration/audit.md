# Audit Trail Configuration

The `audit` section configures rule change auditing and retention.

## Reference

```yaml
audit:
  enabled: true
  retention_days: 90
  buffer_size: 100000
  storage_path: "/var/lib/ebpfsentinel/audit.redb"
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable audit trail |
| `retention_days` | `integer` | `90` | Days to retain audit entries |
| `buffer_size` | `integer` | `100000` | In-memory buffer size before flush |
| `storage_path` | `string` | `data/audit.redb` | Path to the redb database file (relative to the working directory by default; set an absolute path in production) |

## Compliance Notes

- **PCI-DSS Requirement 10** — 90-day minimum retention recommended
- **HIPAA §164.312(b)** — 6-year (2190-day) retention required
- **SOC 2 CC6.8** — audit evidence for security operations

Adjust `retention_days` to meet your compliance requirements.
