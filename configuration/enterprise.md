# Enterprise Configuration

> **Edition: Enterprise**

## Overview

Enterprise-specific configuration is nested under the `enterprise:` key in the agent YAML config file. OSS builds ignore this section entirely.

## Full Reference

```yaml
enterprise:
  # ── License ─────────────────────────────────────────────────────
  license_path: /etc/ebpfsentinel/license.key

  # ── Advanced DLP (Vectorscan) ───────────────────────────────────
  advanced_dlp:
    enabled: true
    mode: alert                    # global mode: alert | block
    custom_patterns:
      - id: PROJ-CODE
        name: Project Code
        regex: "PROJ-[A-Z]{3}-\\d{6}"
        severity: high             # low | medium | high | critical
        data_type: internal_code
        description: "Internal project tracking codes"
        mode: block                # per-pattern override (optional)
    tls_inspection:
      enabled: false
      ca_cert: /etc/ebpfsentinel/ca.crt
      ca_key: /etc/ebpfsentinel/ca.key
      bypass_domains:
        - "*.bank.com"
        - "healthcare.example.org"
      bypass_ips:
        - "10.0.0.0/8"

  # ── ML Detection ────────────────────────────────────────────────
  ml_detection:
    enabled: true
    model_path: /opt/models/anomaly.onnx
    learning_days: 7               # baseline learning period
    anomaly_threshold: 2.0         # standard deviations
    time_windows: [60, 300, 900]   # feature extraction windows (seconds)

  # ── Multi-Tenancy ───────────────────────────────────────────────
  tenants:
    enabled: true
    tenants:
      - id: team-alpha
        name: Team Alpha
        namespaces: [ns-alpha, ns-alpha-staging]
        description: "Alpha team workloads"
        quotas:
          max_rules: 100
          max_alert_rate_per_sec: 500
          max_patterns: 50
      - id: team-beta
        name: Team Beta
        namespaces: [ns-beta]

  # ── SIEM Integration ────────────────────────────────────────────
  siem:
    enabled: true
    buffer_size_bytes: 1073741824  # 1 GB
    batch_size: 1000
    flush_interval_ms: 5000
    splunk:
      endpoint: https://splunk.example.com:8088
      token: my-hec-token
      sourcetype: ebpfsentinel
      index: security
    elasticsearch:
      endpoint: https://es.example.com:9200
      api_key: base64-api-key
      index_pattern: "ebpfsentinel-{yyyy.MM.dd}"
      ilm_policy: hot-warm-delete

  # ── Compliance Reporting ────────────────────────────────────────
  compliance:
    enabled: true
    frameworks: [pci-dss, hipaa, gdpr, soc2]
    schedule: weekly               # daily | weekly | monthly
    retention_days: 90
    output_dir: /var/lib/ebpfsentinel/reports

  # ── High Availability ───────────────────────────────────────────
  ha:
    enabled: true
    peers:
      - 10.0.0.2:8445
      - 10.0.0.3:8445
    heartbeat_ms: 1000
    failure_threshold: 3
    max_replication_bandwidth: 10485760  # 10 MB/s

  # ── Multi-Cluster ───────────────────────────────────────────────
  multi_cluster:
    enabled: false
    is_management: false
    management_endpoint: https://mgmt.example.com:8446
    ca_cert: /etc/ebpfsentinel/cluster-ca.crt

  # ── Air-Gap Mode ────────────────────────────────────────────────
  air_gap: false

  # ── Fleet Management ──────────────────────────────────────────
  fleet:
    enabled: true
    data_dir: /var/lib/ebpfsentinel/fleet
```

## Field Reference

### License

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `license_path` | string | none | Path to the license key file |

### Advanced DLP

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `advanced_dlp.enabled` | bool | `true` | Enable advanced DLP |
| `advanced_dlp.mode` | string | `alert` | Global mode: `alert` or `block` |
| `advanced_dlp.custom_patterns` | list | `[]` | Custom pattern definitions |
| `advanced_dlp.tls_inspection.enabled` | bool | `false` | Enable TLS deep inspection |
| `advanced_dlp.tls_inspection.ca_cert` | string | required | CA certificate PEM path |
| `advanced_dlp.tls_inspection.ca_key` | string | required | CA private key PEM path |
| `advanced_dlp.tls_inspection.bypass_domains` | list | `[]` | Domains to skip (exact or `*.suffix`) |
| `advanced_dlp.tls_inspection.bypass_ips` | list | `[]` | IPs/CIDRs to skip |

### Custom DLP Pattern

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique pattern identifier |
| `name` | string | required | Display name |
| `regex` | string | required | Vectorscan-compatible regex |
| `severity` | string | `medium` | `low`, `medium`, `high`, `critical` |
| `data_type` | string | `custom` | Category label |
| `description` | string | none | Optional description |
| `mode` | string | global mode | Per-pattern override: `alert` or `block` |

### Fleet Management

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `fleet.enabled` | bool | `false` | Enable fleet management endpoints |
| `fleet.data_dir` | string | none | Directory for persisting agent identity |

### Validation Rules

- `license_path` cannot be empty if set
- Custom pattern IDs must be unique (no collision with built-in `dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`)
- Custom pattern regex validated via Vectorscan `expression_info` at config load
- `ml_detection.anomaly_threshold` must be positive
- Tenant IDs must be unique, namespaces cannot overlap between tenants
- `ha.heartbeat_ms` and `ha.failure_threshold` must be > 0
- `fleet.data_dir` cannot be empty when set
