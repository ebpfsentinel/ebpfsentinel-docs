# Audit Trail Configuration

The `audit` section configures rule change auditing and retention.

## Reference

```yaml
audit:
  enabled: true
  retention_days: 90
  buffer_size: 10000
  storage_path: "/var/lib/ebpfsentinel/audit"
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable audit trail |
| `retention_days` | `integer` | `90` | Days to retain audit entries |
| `buffer_size` | `integer` | `10000` | In-memory buffer size before flush |
| `storage_path` | `string` | `/var/lib/ebpfsentinel/audit` | On-disk storage path |

## Compliance Notes

- **PCI-DSS Requirement 10** — 90-day minimum retention recommended
- **HIPAA §164.312(b)** — 6-year (2190-day) retention required
- **SOC 2 CC6.8** — audit evidence for security operations

Adjust `retention_days` to meet your compliance requirements.
