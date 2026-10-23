# Enterprise Configuration

> **Edition: Enterprise**

## Overview

Enterprise-specific configuration is nested under the `enterprise:` key in the agent YAML config file. OSS builds ignore this section entirely.

## What happens when the section is wrong

The agent refuses to start, naming the file and the key.

There is no fall-back to defaults, because a fall-back is indistinguishable from success: an agent that answered a mistyped key by loading the defaults would start, pass its health check, and run with every feature configured in that file switched off. A refusal at boot is loud; a silently disabled DLP engine is not.

Four things are refused:

| What is wrong | What the agent says |
|---|---|
| The file exists and cannot be read | `cannot read the agent configuration at <path>: <reason>` |
| The file is not YAML | `<path> is not valid YAML: <reason>` |
| A key is not one this build knows, or a value is the wrong type | ``the `enterprise:` section of <path> is not a valid enterprise configuration: unknown field `enabeld`, expected one of `enabled`, ...`` |
| The section parses and then fails its own consistency rules | ``the `enterprise:` section of <path> is invalid: enterprise.portal.base_url must be https`` |

An unknown key is an error rather than an ignored line. A typo, a key renamed by an upgrade, or a key copied from a different product all read the same way to the agent: something was asked for that this build cannot do. The message names the offending key and lists the keys that section accepts, so the correction is on the screen that reported the problem.

Two states are **not** errors, because neither of them asks for anything:

- The configuration file does not exist. The agent runs with no enterprise feature configured.
- The file exists and has no `enterprise:` key, or the key is present with nothing under it. Same outcome.

The agent reads this section exactly once, at startup, before it loads the licence or touches the kernel. Changing the file underneath a running agent changes nothing until it is restarted; there is no reload signal. The files the section points at are another matter: the licence key and the revocation list are read again every minute, see [Renewal and reload](../features/enterprise/license.md#renewal-and-reload).

## Full Reference

```yaml
enterprise:
  # ── License ─────────────────────────────────────────────────────
  license_path: /etc/ebpfsentinel/license.key
  revocations_path: /etc/ebpfsentinel/offline-bundle.json
  license_clock_path: /var/lib/ebpfsentinel/license-clock

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
    l7_advanced:
      # Empty = every payload submitted to the L7 analyze endpoint is
      # scanned. Populate to opt in rule by rule; anything not named is
      # then no longer scanned.
      deep_inspect_rule_ids: []
      custom_inspect_patterns:
        - id: acme-internal-code
          name: Acme internal tracking code
          regex: "ACME-[A-Z]{3}-[0-9]{6}"
          category: data_exfil    # sql_injection | xss | path_traversal |
                                  # command_injection | data_exfil
          severity: medium        # low | medium | high | critical
          enabled: true

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
    heavy_hitter_enabled: true     # Space-Saving top-K talkers
    heavy_hitter_k: 100
    heavy_hitter_threshold_pct: 10.0
    rcf:                           # Random Cut Forest multi-feature detector
      enabled: true
      num_trees: 100               # AWS bound [50, 1000]
      sample_size: 256             # per-tree reservoir, [1, 2048]
      time_decay: 0.0              # 0.0 = uniform reservoir sampling
      anomaly_threshold: 1.5
      # seed: 42                   # optional deterministic seed
      # num_threads: 4             # optional dedicated rayon pool
      recent_capacity: 256         # records kept for /ml/rcf/scores
      pool_capacity: 64            # baselines held at once, one per entity
      entity_idle_secs: 10800      # an entity silent this long loses its baseline
      min_observations: 256        # samples before a baseline is trusted
      adaptive_threshold: true     # a drift detector and a tail quantile move it
      explain: true                # name the features that drove an anomaly
      explain_permutations: 16     # permutations averaged per explanation
      explain_features: 4          # features reported per anomaly
      group_alerts: true           # collapse a burst into one finding
      calibration_capacity: 4096   # verdicts kept to calibrate the probability

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
    # Attribute containers to tenants from their labels (off by default).
    cgroup_attribution:
      enabled: false
      poll_interval_seconds: 10
      tenant_label: "ebpfsentinel.io/tenant"
      cri_sockets:                      # containerd and CRI-O, dialled if present
        - /run/containerd/containerd.sock
        - /run/crio/crio.sock
      cri_timeout_ms: 2000              # bounds each runtime call

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
    otlp:
      endpoint: http://otel-collector:4318   # OTLP/HTTP; events POSTed to {endpoint}/v1/logs
      timeout_ms: 5000
      max_retries: 3
      initial_backoff_ms: 500                # doubles each retry

  # ── Compliance Reporting ────────────────────────────────────────
  compliance:
    enabled: true
    # pci_dss4 | hipaa | gdpr_art32 | soc2 | nis2 | dora | secnumcloud | hds
    # (pci_dss_4, gdpr_art_32, soc_2, nis_2 and sec_num_cloud are accepted too;
    #  a name outside that list is refused at startup rather than skipped)
    frameworks: [pci_dss4, hipaa, gdpr_art32, soc2]
    schedule:                      # object, not a scalar
      frequency: weekly            # daily | weekly | monthly
      frameworks: [pci_dss4, soc2] # left empty, the schedule covers all eight
      email_recipients: []         # addresses mailed each run; needs smtp below
      # smtp:
      #   host: smtp.example.com
      #   port: 587                # 587 with starttls, 465 with starttls: false
      #   from: ebpfsentinel@example.com
      #   starttls: true
      # webhook_url: https://soar.example.com/hooks/compliance
    retention_days: 90
    output_dir: /var/lib/ebpfsentinel/reports

  # ── High Availability ───────────────────────────────────────────
  ha:
    enabled: true
    peers:                         # other nodes' advertised_addr (peer gRPC, default :9443)
      - 10.0.0.2:9443
      - 10.0.0.3:9443
    heartbeat_ms: 1000
    failure_threshold: 3
    max_replication_bandwidth: 10485760  # bytes/s (optional)
    replication_interval_ms: 200
    split_brain_policy: prefer_active    # prefer_active | prefer_standby | fence
    listen_addr: "0.0.0.0:9443"    # peer gRPC: no auth, no TLS - fence it to the peers
    advertised_addr: ""            # what peers reach this node on, required in active-active
    data_dir: /var/lib/ebpfsentinel/ha
    mode: active-passive           # active-passive | active-active
    # advertised_addr and interface_assignments are required only in
    # active-active mode, where a node is named by its address:
    # advertised_addr: "10.0.0.1:9443"
    # interface_assignments:
    #   - { address: "10.0.0.1:9443", interfaces: [eth0] }
    #   - { address: "10.0.0.2:9443", interfaces: [eth1] }
    degradation_policy: continue   # continue | read-only | fail-closed

  # ── Multi-Cluster ───────────────────────────────────────────────
  multi_cluster:
    enabled: false
    is_management: false                # true on the management cluster
    management_endpoint: http://mgmt.example.com:8444  # set on member clusters;
                                                       # https on mtls.listen_port when mtls is on
    ca_cert: /etc/ebpfsentinel/cluster-ca.crt
    heartbeat_interval_secs: 30
    degraded_threshold_secs: 90
    offline_threshold_secs: 180
    data_dir: /var/lib/ebpfsentinel/federation
    # Mutual-TLS for inter-cluster auth (optional; default off = plain HTTP).
    # When enabled, federation routes move to a dedicated client-cert-required
    # listener and the presented client-cert fingerprint is pinned per cluster.
    # See features/enterprise/multicluster.md → "Mutual TLS" for the migration.
    mtls:
      enabled: false
      listen_port: 9444
      ca_cert_path: /etc/ebpfsentinel/cluster-ca.pem
      server_cert_path: /etc/ebpfsentinel/node-server.pem
      server_key_path: /etc/ebpfsentinel/node-server.key
      client_cert_path: /etc/ebpfsentinel/node-client.pem
      client_key_path: /etc/ebpfsentinel/node-client.key

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
        grants: ["firewall:write", "!firewall:write:prod-*"]  # "!" forbids, and a forbid wins
      - id: acme-operator
        name: Acme Operator
        grants:                         # a grant that applies only somewhere
          - grant: "firewall:write"     # the string, with the condition beside it
            when: { when: within_tenant, tenant: acme }
          - grant: "ids:read"
            when: { when: source_cidr, network: 10.0.0.0, prefix_len: 8 }

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

  # ── Vendor portal reporting ─────────────────────────────────────
  portal:
    enabled: false
    base_url: https://portal.ebpfsentinel.io
    join_secret_file: /etc/ebpfsentinel/portal-join-secret
    state_path: /var/lib/ebpfsentinel/portal/enrolment.json
    telemetry_enabled: false
    # ingest_secret_file: /etc/ebpfsentinel/portal-ingest-secret

  # ── Signed content the subscription delivers ────────────────────
  content:
    enabled: false
    interval_seconds: 21600             # 6h; clamped like portal reporting
    directory: /var/lib/ebpfsentinel/content

  # ── Threat intelligence platforms ───────────────────────────────
  intel:
    enabled: false
    marker_path: /var/lib/ebpfsentinel/intel-markers.json
    taxii:
      - id: cert-eu
        discovery_url: https://taxii.example/taxii2/
        collections: []                 # empty: every collection the root serves
        auth: basic
        username: ebpfsentinel
        secret_file: /etc/ebpfsentinel/taxii-password
        interval_seconds: 900
        max_indicators: 100000
        min_confidence: 50
    misp:
      - id: house-misp
        base_url: https://misp.internal.example
        key_file: /etc/ebpfsentinel/misp-key
        tags: ["tlp:amber"]
        distribution: [1, 2, 3]
        published_only: true
        interval_seconds: 1800
        max_indicators: 100000
        min_confidence: 30
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
`{endpoint}/v1/logs` and adds per-batch retry with exponential backoff feeding
the circuit breaker. Use it when you need reliable SIEM delivery; use the OSS
alert OTLP for a lightweight, best-effort collector feed.

Both editions build the same record - same timestamps in epoch nanoseconds, same
`severityNumber` and `severityText`, the alert JSON as the body, and the
`mitre.technique.id`, `alert.component` and `alert.rule_id` attributes - so a
routing rule written against one works against the other. What the enterprise
connector adds is the rest of the `SiemEvent` as further attributes: `event.id`,
`ebpfsentinel.tenant_id` when the event belongs to a tenant, and the L7
enrichment under the names the other connectors already use
(`threat.technique.id`, `threat.technique.name`, `threat.tactic.name`,
`vulnerability.category`, `http.request.method`, `url.path`,
`http.request.fingerprint`, the `ebpfsentinel.l7.*` fields and
`ebpfsentinel.compliance.pci_dss`). The delivery bookkeeping the event carries -
`export_timestamp_ms`, `destination_name` and `delivery_attempt` - is not on the
wire: the moment of export is `observedTimeUnixNano`, and the other two describe
this agent's buffer rather than the alert. This exporter is OTLP Logs as well: it
emits no traces and no OTLP metrics.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `otlp.endpoint` | string | Required | OTLP/HTTP collector base URL (events POSTed to `/v1/logs`). Must be an `http://` or `https://` URL with a host |
| `otlp.timeout_ms` | u64 | `5000` | Per-request timeout |
| `otlp.max_retries` | u32 | `3` | Retries per batch before tripping the circuit breaker |
| `otlp.initial_backoff_ms` | u64 | `500` | Initial backoff, doubled each retry |
| `otlp.headers` | map | - | Headers sent with every batch, which is how a hosted collector is authenticated. Held to the same rule webhook headers are: no control characters, no non-ASCII |
| `otlp.ca_cert` | string | - | Path to a PEM bundle trusted in addition to the system roots |
| `otlp.verify_tls` | bool | `true` | Whether the collector's certificate is verified |

This connector is HTTP only, so `verify_tls: false` is accepted here whatever the
open source block would have said about the gRPC transport. A header that cannot
be sent, and a certificate authority that cannot be read, both refuse at boot
rather than becoming a buffer that never drains.

```yaml
enterprise:
  siem:
    otlp:
      endpoint: "https://otel-collector:4318"
      timeout_ms: 5000
      max_retries: 3
      initial_backoff_ms: 500
      headers:
        authorization: "Bearer <token>"
      ca_cert: "/etc/ebpfsentinel/collector-ca.pem"
      verify_tls: true
```

### Content channel

The `content` block is how a deployment takes the rules, patterns, fingerprints,
provider definitions and models the subscription delivers.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `enabled` | bool | `false` | Whether to fetch content at all |
| `interval_seconds` | int | `21600` | How often to ask. Clamped to the same floor and ceiling portal reporting uses, and the first fetch of each cycle is spread over a share of the interval so a cluster restarting in lockstep does not land on one second |
| `directory` | string | `/var/lib/ebpfsentinel/content` | Where the content in force, and the version it replaced, are kept |

There is no URL here, and that is the design rather than an omission: the
address and the per-agent credential are the `portal` block's, so a machine that
does not report has nothing to fetch with, and a content source somebody can
point elsewhere is the whole attack. A `content` block with `enabled: true` and
no `portal` block is refused at boot rather than ignored.

The block does nothing without the `content-channel` licence feature, and the
directory is where a rollback finds the version it goes back to - a volume that
is not persisted costs the estate its rollback rather than its content.

[Content Channel](../features/enterprise/content-channel.md) covers the format,
the six sets, the refusals and how to verify a bundle by hand.

### Threat intelligence platforms

The `intel` block is how TAXII 2.1 collections and MISP instances reach the
matchers. Every source is polled on its own interval, counted on its own, and
resumed from its own marker, so one platform failing costs nothing to the other
and costs itself nothing it already imported.

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `enabled` | bool | `false` | Whether to poll at all. Enabled with no source configured is refused at boot |
| `marker_path` | string | `/var/lib/ebpfsentinel/intel-markers.json` | Where each source's resume marker is kept, so a restart reads what changed rather than everything |
| `taxii` | list | empty | TAXII 2.1 sources, below |
| `misp` | list | empty | MISP instances, below |

Each `taxii` entry:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `id` | string | required | What the marker, the counters and every indicator's provenance are keyed on. Letters, digits, `-`, `_` and `.` |
| `discovery_url` | string | required | The TAXII discovery document. `https` unless the host is loopback |
| `collections` | list | empty | Which collections to poll. Empty means every collection the API roots serve |
| `auth` | string | `none` | `none`, `basic` or `bearer`. Anything else is refused at boot, naming the field |
| `username` | string | none | Required by `basic` |
| `secret_file` | string | none | The password or the token. Required by `basic` and `bearer`, read on every request so a rotation needs no restart |
| `interval_seconds` | int | `900` | Clamped to 60 to 86400 |
| `max_indicators` | int | `100000` | How many indicators this source may import, counted since the agent started. Past it an indicator is refused and reported as `capped`, and nothing already imported is displaced to make room |
| `min_confidence` | int | `0` | 0 to 100, compared against the indicator's own confidence |

Each `misp` entry:

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `id` | string | required | Same rules and same role as a TAXII source's |
| `base_url` | string | required | The instance address, no path. `https` unless the host is loopback |
| `key_file` | string | required | The automation key, read on every request. Read access is all it needs |
| `tags` | list | empty | Only attributes carrying one of these tags. Empty sends no tag filter |
| `distribution` | list | empty | Only attributes at one of these distribution levels. Empty sends none |
| `published_only` | bool | `false` | Restrict the pull to published events |
| `interval_seconds` | int | `900` | Clamped to 60 to 86400 |
| `max_indicators` | int | `100000` | As above |
| `min_confidence` | int | `0` | MISP states no per-attribute confidence, so an attribute marked fit for automatic detection counts as 75 and one kept as context counts as 30 |

The block does nothing without the `threat-intel-platforms` licence feature, and
the marker file belongs on a persisted volume. A lost marker is not a
correctness problem - the next poll reads the collection from the beginning -
but what it re-imports counts against `max_indicators` again, so a source near
its bound reports `capped` after a marker file that was never persisted.

[Threat Intelligence Platforms](../features/enterprise/threat-intel-platforms.md)
covers what each indicator kind reaches, with
[TAXII 2.1 collections](../integrations/taxii.md) and
[MISP instances](../integrations/misp.md) for the other side of the wire.

### License

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `license_path` | string | none | Path to the license key file, re-read every minute |
| `revocations_path` | string | none, or `revocations.json` beside `portal.state_path` when the portal is enabled | Offline bundle whose `revocations` list the key is checked against, re-read every minute. The portal's heartbeat adds the organisation's revocations to it and never removes one. A path with no file yet revokes nothing; a file that does not parse refuses the key. See [Revocation](../features/enterprise/license.md#revocation) |
| `license_clock_path` | string | `/var/lib/ebpfsentinel/license-clock` | Where the agent records the latest time it has seen, so a clock set back does not extend a key. See [Expiry and grace](../features/enterprise/license.md#expiry-and-grace) |

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
| `advanced_dlp.l7_advanced.deep_inspect_rule_ids` | list | `[]` | Rule ids allowed to trigger a deep-inspection scan. Empty means every submitted payload is scanned |
| `advanced_dlp.l7_advanced.custom_inspect_patterns` | list | `[]` | Deep-inspection patterns loaded on top of the built-in catalogue |

### Custom L7 Inspect Pattern

See [L7 deep inspection](../features/enterprise/l7-deep-inspection.md)
for what triggers a scan.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique identifier, no collision with a built-in pattern id |
| `name` | string | required | Label carried by every match |
| `regex` | string | required | Vectorscan-compatible regex |
| `category` | string | required | `sql_injection`, `xss`, `path_traversal`, `command_injection`, `data_exfil` |
| `severity` | string | required | `low`, `medium`, `high`, `critical` |
| `enabled` | bool | `true` | Load the pattern but keep it out of scans when `false` |

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

### Vendor portal reporting

The `portal` block lets a deployment report itself to the vendor portal so a
subscription is measured against what is actually running. It is **off unless
`enabled: true`**: with no block, or with the block disabled, no client is built
and no connection leaves the machine.

The agent joins once with the **join secret** a person minted in the portal,
stores the per-agent credential it receives at `state_path`, and heartbeats from
then on. The two secrets are not interchangeable: the join secret can be
withdrawn without touching agents that already joined, and the stored credential
only ever heartbeats. An agent that is refused (HTTP 401) discards its stored
credential and joins again; an agent that simply cannot reach the portal keeps
what it holds and retries with a backoff that grows to fifteen minutes.

What travels is the agent's name and its version. The agent never names an
organisation or an environment, and the heartbeat interval is whatever the
portal answers, clamped between 15 seconds and 24 hours and spread by up to ten
percent so a whole cluster restarting does not land on one second.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `portal.enabled` | bool | `false` | Report to the portal. Everything below is ignored when false |
| `portal.base_url` | string | none | Where the portal answers. Required when enabled. `https` unless the host is loopback |
| `portal.join_secret` | string | none | The join secret inline. Prefer one of the two options below |
| `portal.join_secret_file` | string | none | Path to a file holding the join secret. Cannot be combined with `join_secret` |
| `portal.agent_name` | string | host name | The name this agent reports under. Up to 253 characters, no control characters |
| `portal.state_path` | string | `/var/lib/ebpfsentinel/portal/enrolment.json` | Where the credential is kept. Created `0600` inside a `0700` directory |
| `portal.ca_cert_path` | string | none | Extra root certificate, for a portal behind a private CA. Added to the system roots, never replacing them |
| `portal.telemetry_enabled` | bool | `false` | Send the counter readings described below. Requires `portal.enabled` and an ingest secret |
| `portal.ingest_secret` | string | none | The ingest secret inline. Prefer the environment variable or the file |
| `portal.ingest_secret_file` | string | none | Path to a file holding the ingest secret. Cannot be combined with `ingest_secret` |
| `portal.telemetry_interval_seconds` | integer | `300` | Gap between two readings, held between 60 and 86400 rather than refused |

The join secret is read from `EBPFSENTINEL_PORTAL_JOIN_SECRET` first, then from
`join_secret_file`, then from `join_secret`. The environment variable and the
file exist so the secret does not have to live in a configuration file that is
templated, backed up or committed.

Re-enrolling under a name the portal already knows returns the same agent with a
fresh credential, so a machine that lost its state file is not counted twice.

#### Optional analytics

`telemetry_enabled` is a second, separate decision. What it sends is counters
over a window: packets and bytes seen, flows opened and being tracked, alerts
counted by severity and by the part of the agent that raised them, what the
agent dropped or rate limited or tore down, what the ring buffers lost, whether
the programs are loaded, and what the agent itself cost the machine in processor
and memory. It never carries a packet, a payload, an address, a port, a peer, a
rule identifier or an alert. Nothing in the wire format has a field that could.

Its credential is a third one. The **ingest secret** is not the licence key and
not the join secret: it is minted per deployment, revocable on its own, and read
from `EBPFSENTINEL_PORTAL_INGEST_SECRET` first, then from `ingest_secret_file`,
then from `ingest_secret`. Refusing it (HTTP 401) stops the readings and never
costs the agent its enrolment, so revoking analytics does not take a deployment
out of the entitlement count.

The first interval after a start produces no reading: counters are cumulative,
so one sample is a baseline and the window opens with the second. A delivery
that fails keeps its window, and the next attempt reports the whole gap rather
than losing it.

Three numbers travel only where the agent measured them: how full the busiest
eBPF map is, how many loads the verifier refused, and how many programs loaded
but could not be attached. A build or a machine that did not measure one sends
nothing for it rather than a zero, so the portal can say a figure is unmeasured
instead of printing a clean result. Which map is fullest never leaves the
machine, only how full it is.

Each reading also carries the agent's inventory: the name of every eBPF program
the configuration asks for with whether it loaded, and the name of every module of the
configuration (`firewall`, `ids`, `dlp`, an enterprise section, and so on) with
whether it is turned on. A name and a yes or no, and nothing behind it: never a
rule, a threshold, a list or an address a module was given. Sections that carry
no switch of their own are left out, and so is the anonymous heartbeat's own
switch, so whether an estate turned the heartbeat off is never reported here.
The portal keeps at most 64 names of each kind per reading, cuts a name at 64
characters, and drops the inventory altogether for a deployment whose accepted
list of collected fields predates it; the counters themselves still arrive. Our
staff read it per customer, as how many reporting machines carry each name and
on how many it is loaded or on, and never beside the anonymous heartbeat. A
program the configuration does not ask for is not named, which is how the portal
tells a program switched off from one the kernel refused.

The reading also carries what the defences did over the window: for each
threat feed, the matches, the indicators it holds and how long ago it was last
refreshed, under the name of the public list its address matched or `custom`
for every other one, so a feed named after a company or a host never leaves;
attacks detected by kind, addresses blocked, automated responses and domains
blocked on reputation; how many rules each component has loaded; and how many
alerts came from each country, as the two-letter code of
`ebpfsentinel_alerts_by_source_country_total` or `unknown`. Every label is
checked against a closed list on the agent and again by the portal, which
refuses the whole reading if one is off it. A figure the agent did not measure,
such as the size of a feed that never refreshed, is left out rather than sent as
zero. The portal drops this part for a deployment whose accepted list of
collected fields predates it, as it does the inventory, and keeps the counters.

### Validation Rules

- `license_path` cannot be empty if set
- `revocations_path` cannot be empty if set
- `license_clock_path` cannot be empty if set
- Custom pattern IDs must be unique (no collision with built-in `dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`)
- Custom pattern regex validated via Vectorscan `expression_info` at config load
- `l7_advanced.deep_inspect_rule_ids` entries cannot be empty or repeat
- `l7_advanced.custom_inspect_patterns` entries need a unique id (no collision with a built-in pattern), a non-empty name, a regex Vectorscan accepts, and a known category and severity
- `ml_detection.anomaly_threshold` must be positive
- Tenant IDs must be unique, namespaces cannot overlap between tenants
- `ha.heartbeat_ms` and `ha.failure_threshold` must be > 0
- `fleet.data_dir` cannot be empty when set
- `intel.marker_path` cannot be empty, enabled or not
- `intel.enabled` needs at least one `taxii` or `misp` source
- Every `intel` source needs an id of letters, digits, `-`, `_` and `.`, a URL the agent can parse, and `https` unless the host is loopback
- `intel.taxii[].auth` is `none`, `basic` or `bearer`; `basic` needs a `username`, and both `basic` and `bearer` need a `secret_file`
- `intel.misp[].key_file` cannot be empty
- `portal.join_secret` and `portal.join_secret_file` cannot both be set, enabled or not
- `portal.base_url` is required when `portal.enabled`, and must be `https` unless the host is `localhost`, `127.0.0.1` or `::1`
- `portal.state_path` cannot be empty
- `portal.agent_name`, when set, must survive the same checks the portal applies: non-empty after trimming, at most 253 characters, no control characters
- `portal.ca_cert_path` and `portal.join_secret_file` cannot be empty when set
- `portal.ingest_secret` and `portal.ingest_secret_file` cannot both be set, enabled or not, and `ingest_secret_file` cannot be empty when set
- `portal.telemetry_enabled` requires `portal.enabled`, and requires an ingest secret from the environment, the file or the inline field
