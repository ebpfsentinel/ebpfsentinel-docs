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
    ewma_enabled: true
    ewma_alpha: 0.01
    ewma_threshold: 3.0
    ewma_warmup_samples: 100
    cusum_enabled: true
    cusum_slack: 0.5
    cusum_threshold: 5.0
    heavy_hitter_enabled: true     # Count-Min Sketch top-K detection
    heavy_hitter_k: 100
    heavy_hitter_threshold_pct: 10.0
    cms_width: 2048
    cms_depth: 4

  # ── DNS Entropy / DGA Detection ─────────────────────────────────
  dns_entropy:
    enabled: true
    entropy_threshold: 3.5         # Shannon entropy (bits/char)
    markov_threshold: -4.0         # bigram log-likelihood
    tunnel_label_length: 30        # min label length for tunneling detection
    tunnel_entropy_threshold: 3.0
    allowlist:
      - "*.cdn.cloudflare.net"
      - "*.cloudfront.net"
      - "*.amazonaws.com"

  # ── TLS Fingerprint Clustering ──────────────────────────────────
  tls_clustering:
    enabled: true
    k: 50                          # number of clusters
    outlier_threshold: 8.0         # Euclidean distance threshold
    batch_size: 32                 # mini-batch size for centroid updates

  # ── C2 Beaconing Detection (TLSH) ──────────────────────────────
  beaconing:
    enabled: true
    min_payload_size: 50           # minimum bytes for TLSH hash
    tlsh_distance_threshold: 40    # 0=identical, <100=similar
    min_similar_count: 3           # similar payloads to trigger alert
    window_secs: 3600              # 1 hour matching window
    max_tracked_tuples: 100        # LRU eviction limit
    hashes_per_tuple: 10
    allowlisted_ports: [53, 123, 5353]

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
    otlp:
      endpoint: http://otel-collector:4318   # OTLP/HTTP; events POSTed to {endpoint}/v1/logs
      timeout_ms: 5000
      max_retries: 3
      initial_backoff_ms: 500                # doubles each retry

  # ── Compliance Reporting ────────────────────────────────────────
  compliance:
    enabled: true
    # pci_dss_4 | hipaa | gdpr_art_32 | soc_2 | nis2 | dora | secnumcloud | hds
    frameworks: [pci_dss_4, hipaa, gdpr_art_32, soc_2]
    schedule:                      # object, not a scalar
      frequency: weekly            # daily | weekly | monthly
    retention_days: 90
    output_dir: /var/lib/ebpfsentinel/reports

  # ── High Availability ───────────────────────────────────────────
  ha:
    enabled: true
    peers:                         # other nodes' listen_addr (peer gRPC, default :9443)
      - 10.0.0.2:9443
      - 10.0.0.3:9443
    heartbeat_ms: 1000
    failure_threshold: 3
    max_replication_bandwidth: 10485760  # bytes/s (optional)
    replication_interval_ms: 200
    split_brain_policy: prefer_active    # prefer_active | prefer_standby | fence
    listen_addr: "0.0.0.0:9443"
    data_dir: /var/lib/ebpfsentinel/ha
    mode: active-passive           # active-passive | active-active
    # interface_assignments required only in active-active mode:
    # interface_assignments:
    #   - { node_id: node-a, interfaces: [eth0] }
    #   - { node_id: node-b, interfaces: [eth1] }
    degradation_policy: continue   # continue | read-only | fail-closed

  # ── Multi-Cluster ───────────────────────────────────────────────
  multi_cluster:
    enabled: false
    is_management: false                # true on the management cluster
    management_endpoint: https://mgmt.example.com:8444  # set on member clusters
    ca_cert: /etc/ebpfsentinel/cluster-ca.crt
    heartbeat_interval_secs: 30
    degraded_threshold_secs: 90
    offline_threshold_secs: 180
    data_dir: /var/lib/ebpfsentinel/federation

  # ── Advanced RBAC ───────────────────────────────────────────────
  advanced_rbac:
    enabled: true
    custom_roles:
      - id: soc-analyst
        name: SOC Analyst
        grants: ["firewall:read", "ids:read", "alerts:read"]  # "domain:permission"
      - id: soc-lead
        name: SOC Lead
        parent: soc-analyst             # inherit grants from a parent role
        grants: ["firewall:write"]

  # ── Analytics ───────────────────────────────────────────────────
  analytics:
    enabled: true
    retention_days: 30
    data_dir: /var/lib/ebpfsentinel/analytics

  # ── AI / LLM security ───────────────────────────────────────────
  ai_security:
    enabled: true
    shadow_ai:
      mode: monitor                     # monitor | block | allow_list
      exempt_sources: ["10.0.0.5"]
    exfiltration:
      per_request_threshold_bytes: 10485760           # 10 MiB
      aggregate_threshold_bytes_per_hour: 104857600   # 100 MiB
      burst_requests_per_minute: 60

  # ── TLS intelligence ────────────────────────────────────────────
  tls_intelligence:
    enabled: true
    anomaly:
      rarity_threshold: 0.01            # must be in (0, 1)
    crypto_policy:
      min_tls_version: 771              # 0x0303 = TLS 1.2 (range 769-772)
    pqc:
      enabled: true

  # ── Network forensics ───────────────────────────────────────────
  forensics:
    enabled: true
    ring_buffer_max_events: 10000
    ring_buffer_max_age_secs: 300
    retention_days: 7
    trigger:
      components: [ids, threatintel, ddos, dlp]
      min_severity: high                # low | medium | high | critical

  # ── Automated response ──────────────────────────────────────────
  response:
    enabled: true
    audit_max_entries: 10000

  # ── Air-gap feed bundles ────────────────────────────────────────
  air_gap:                              # object, NOT a bool
    enabled: false
    bundle_dir: /var/lib/ebpfsentinel/bundles
    max_age_days: 7
    auto_import: true

  # ── Fleet management ──────────────────────────────────────────
  fleet:
    enabled: false
    data_dir: /var/lib/ebpfsentinel/fleet
```

> A full annotated reference covering every block (including DNS entropy, TLS
> clustering, beaconing, extended TLS probes and the Random Cut Forest detector)
> ships at `../ebpfsentinel-enterprise/config/examples/enterprise.yaml`, with
> focused single-feature examples alongside it under `config/examples/`.

## Field Reference

### SIEM exporters

The `siem` block fans events out to one or more destinations (Splunk, Elastic,
OpenSearch, QRadar, Microsoft Sentinel, Wazuh, ClickHouse, S3, syslog, OTLP, …),
each behind a shared **durable buffer + circuit breaker** with at-least-once
delivery.

The **OTLP SIEM exporter** (`siem.otlp`) is distinct from the OSS OTLP alert
sink ([alerting.otlp](alerting.md)): it posts OTLP/HTTP **JSON** to
`{endpoint}/v1/logs`, carries the full enriched `SiemEvent` (not just the raw
alert), and adds per-batch retry with exponential backoff feeding the circuit
breaker. Use it when you need reliable SIEM delivery; use the OSS alert OTLP for
a lightweight, best-effort collector feed.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `otlp.endpoint` | string | Required | OTLP/HTTP collector base URL (events POSTed to `/v1/logs`) |
| `otlp.timeout_ms` | u64 | `5000` | Per-request timeout |
| `otlp.max_retries` | u32 | `3` | Retries per batch before tripping the circuit breaker |
| `otlp.initial_backoff_ms` | u64 | `500` | Initial backoff, doubled each retry |

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
