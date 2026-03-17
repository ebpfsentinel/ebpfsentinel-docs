# ML Anomaly Detection

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Machine learning-based behavioral anomaly detection that identifies threats without signature rules. Uses ONNX Runtime for inference, multi-window traffic aggregation for feature extraction, and Z-score-based scoring against learned baselines. Detected anomalies can automatically generate IDS/IPS rule suggestions, and operators can submit feedback to improve detection accuracy.

## Architecture

```
PacketEvent (eBPF kernel)
  └── packet_event_to_sample() (IPv4/IPv6 handling)
        └── MultiWindowAggregator (3 parallel windows)
              ├── WindowAggregator (1min)   ─┐
              ├── WindowAggregator (5min)    ─┼── FeatureVector (12 features)
              └── WindowAggregator (15min)  ─┘
                    └── TrafficBaseline (Welford's algorithm, per-scope)
                          └── AnomalyScorer (weighted Z-scores)
                                ├── AnomalyScore (severity classification)
                                │     └── RuleSuggester (→ IDS/IPS rule proposals)
                                └── Optional: OnnxEngine (model inference)
                                      └── ModelHolder (reconstruction error)
```

## Feature Extraction

Each `FeatureVector` contains 12 numeric features computed from aggregated traffic:

| Index | Feature | Description |
|-------|---------|-------------|
| 0 | `packet_rate` | Packets per second |
| 1 | `byte_rate` | Bytes per second |
| 2 | `tcp_ratio` | TCP fraction (0.0–1.0) |
| 3 | `udp_ratio` | UDP fraction (0.0–1.0) |
| 4 | `icmp_ratio` | ICMP fraction (0.0–1.0) |
| 5 | `other_ratio` | Other protocols fraction (0.0–1.0) |
| 6 | `port_entropy` | Shannon entropy of destination ports (bits) |
| 7 | `unique_src_ips` | Count of unique source IPs |
| 8 | `unique_dst_ports` | Count of unique destination ports |
| 9 | `avg_payload_size` | Mean payload in bytes |
| 10 | `std_payload_size` | Standard deviation of payload |
| 11 | `connection_count` | Total connections in window |

The `as_model_input()` method flattens these into a `[f64; 12]` array for ML model inference.

### Shannon Entropy

Port entropy measures destination port diversity: `-Σ(p_i × log2(p_i))` where `p_i` is the frequency ratio of each port. High entropy suggests scanning or distributed activity.

## Multi-Window Aggregation

Traffic samples are aggregated across configurable time windows to capture patterns at different scales:

| Window | Default | Duration | Purpose |
|--------|---------|----------|---------|
| `OneMin` | 60s | Short burst detection |  Rapid changes |
| `FiveMin` | 300s | Session-level anomalies | Medium patterns |
| `FifteenMin` | 900s | Slow scans, persistent threats | Long patterns |

Each `WindowAggregator` uses **Welford's online algorithm** for numerically stable mean/variance computation of payload statistics. On window boundary, it emits a `FeatureVector` and resets.

`MultiWindowAggregator` manages parallel aggregators for all configured windows. A single `TrafficSample` is ingested into all windows simultaneously.

### TrafficSample

```rust
TrafficSample {
    src_ip: IpAddr,
    dst_port: u16,
    protocol: u8,      // 6=TCP, 17=UDP, 1=ICMP
    payload_size: u32,
    timestamp: u64,     // epoch seconds
}
```

## Baseline Learning

The baseline engine learns normal traffic behavior over a configurable learning period.

### Scopes

Baselines can be maintained at different granularities:

| Scope | Description |
|-------|-------------|
| `Global` | Single global baseline |
| `PerInterface(name)` | Per network interface |
| `PerSubnet(cidr)` | Per CIDR subnet |
| `PerService(name)` | Per service name |

### Baseline Statistics

Each `TrafficBaseline` maintains per-feature `OnlineStats` (Welford's algorithm):

- `count` — number of samples seen
- `mean` — running mean
- `m2` — sum of squared deviations (for variance/std_dev computation)

Default learning period: **7 days** (`learning_days × 86400` seconds). Learning is complete when `now - learning_started >= learning_period_secs`.

The `BaselineRegistry` stores baselines keyed by scope, with `export()` and `import()` methods for persistence.

## Anomaly Scoring

Z-score-based scoring compares current feature vectors against learned baselines.

### Severity Thresholds

Five severity levels with configurable thresholds (derived from `anomaly_threshold`):

| Severity | Default Threshold | Formula |
|----------|-------------------|---------|
| `Normal` | < 2.0 | Below low threshold |
| `Low` | ≥ 2.0 | `anomaly_threshold` |
| `Medium` | ≥ 3.0 | `anomaly_threshold × 1.5` |
| `High` | ≥ 4.0 | `anomaly_threshold × 2.0` |
| `Critical` | ≥ 5.0 | `anomaly_threshold × 2.5` |

### Scoring Algorithm

1. Skip if `baseline.sample_count < 2` (insufficient data)
2. Compute per-feature Z-scores: `z_i = |value_i - mean_i| / std_dev_i`
3. Weighted composite: `composite = Σ(z_i × w_i) / Σ(w_i)` (default weights: all 1.0)
4. Identify top-N features by Z-score (default N=3)
5. Classify severity based on composite score

### AnomalyScore

```rust
AnomalyScore {
    anomaly_id: Uuid,              // UUIDv7
    score: f64,                    // composite Z-score
    feature_scores: Vec<f64>,      // 12 per-feature Z-scores
    top_features: Vec<usize>,      // feature indices sorted by score desc
    severity: AnomalySeverity,
}
```

Up to **10,000** recent anomalies are retained in memory (FIFO eviction).

## Feature Normalization

Before model inference, features can be normalized:

| Strategy | Description |
|----------|-------------|
| `MinMax` | Scale to [0, 1] using learned min/max bounds |
| `ZScore` | Center and scale using learned mean/std_dev |
| `None` | Pass-through (no normalization) |

The `FeatureNormalizer` can be fitted from training data using a two-pass algorithm (compute mean/min/max, then variance).

## ONNX Engine

The ML pipeline uses ONNX Runtime (`ort` crate) for model inference:

- Load `.onnx` models from file or in-memory bytes (for encrypted/decrypted models)
- Input conversion: f64 → f32 (ONNX Runtime expects f32), tensor shape `[1, input_size]`
- Session mutex for thread-safe inference
- Model metadata extracted from ONNX properties (version, training_date, feature_names, model_type)
- `reconstruction_error()` computes MSE for autoencoder models
- Hot-swap models at runtime without restart

### Built-in Engines

| Engine | Purpose |
|--------|---------|
| `OnnxEngine` | Production ONNX Runtime inference |
| `IdentityEngine` | Pass-through for baseline-only or testing |
| `ScaledEngine` | Linear scaling for testing |

All engines implement the `InferenceEngine` trait (`infer()`, `input_size()`, `output_size()`, `engine_name()`).

## Rule Suggestion

When anomalies are detected, the `RuleSuggester` proposes IDS/IPS rules based on the top contributing features.

### Feature-to-Rule Mapping

| Feature | Rule Type | Threshold |
|---------|-----------|-----------|
| `packet_rate` | RateThreshold | value × 0.8 |
| `byte_rate` | RateThreshold | value × 0.8 |
| `port_entropy` | PortScan | value × 0.9 |
| `tcp_ratio` / `udp_ratio` / `icmp_ratio` | ProtocolAnomaly | exact value |
| `unique_src_ips` / `unique_dst_ports` | ConnectionFlood | value as u32 |

### Suggestion Workflow

1. For each top feature with Z-score ≥ `min_feature_zscore` (default: 2.0):
   - Map feature to rule type with computed threshold
   - Compute confidence: `min(zscore / 10.0, 1.0)`
   - Create `RuleSuggestion` with `Pending` status
2. Suggestions stored in `SuggestionRegistry` (keyed by UUIDv7)
3. Admin reviews via API → `Approved` or `Rejected`
4. Approved suggestions include `RuleProvenance` (anomaly_id, approved_by, confidence)

## Feedback Loop

Operators can submit false positive / true positive feedback to improve detection:

### FeedbackEntry

| Field | Description |
|-------|-------------|
| `anomaly_id` | UUID of the anomaly being labeled |
| `label` | `TruePositive` or `FalsePositive` |
| `feature_vector` | The 12-feature vector that triggered the anomaly |
| `anomaly_score` | The composite Z-score |
| `category` | Top contributing feature name (e.g., `"packet_rate"`) |
| `submitted_by` | Optional operator identity |

### FeedbackStore

- Tracks per-category false positive rates: `FP / (TP + FP)`
- Export threshold: **100** samples (default) — when reached, `export_ready()` returns true
- Export formats: JSON (`export_json()`) and CSV (`export_csv()` with header: `label, anomaly_score, category, f0-f11`)
- `TrainingDataset` export includes all labeled samples with FP rates for model retraining

## Configuration

```yaml
enterprise:
  ml_detection:
    enabled: true
    model_path: /etc/ebpfsentinel/model.onnx
    learning_days: 7
    anomaly_threshold: 2.0
    time_windows: [60, 300, 900]
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable ML detection pipeline |
| `model_path` | string | — | Path to ONNX model file (optional, baseline-only if omitted) |
| `learning_days` | u32 | `7` | Baseline learning period in days |
| `anomaly_threshold` | f64 | `2.0` | Z-score threshold for low-severity anomalies (must be > 0) |
| `time_windows` | list | `[60, 300, 900]` | Aggregation windows in seconds (mapped to OneMin/FiveMin/FifteenMin) |

## REST API

| Method | Endpoint | Query/Body | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/v1/enterprise/ml/status` | — | Pipeline status (baseline learning, model loaded, counts) |
| `GET` | `/api/v1/enterprise/ml/anomalies` | `limit` (default 100) | Recent anomalies (newest first) |
| `GET` | `/api/v1/enterprise/ml/suggestions` | — | Pending rule suggestions |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/approve` | — | Approve suggestion (201) |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/reject` | — | Reject suggestion (200) |
| `POST` | `/api/v1/enterprise/ml/feedback` | `{ anomaly_id, is_false_positive, comment }` | Submit FP/TP feedback (201) |
| `GET` | `/api/v1/enterprise/ml/feedback/stats` | — | Feedback statistics and FP rates |
| `GET` | `/api/v1/enterprise/ml/training-data` | — | Export labeled training dataset |
| `POST` | `/api/v1/enterprise/ml/model/reload` | `{ model_path }` | Hot-swap ONNX model |

### Status Response

| Field | Description |
|-------|-------------|
| `baseline_learning` | Whether baseline is still in learning phase |
| `baseline_sample_count` | Number of samples learned |
| `learning_days_configured` | Configured learning period |
| `anomaly_count` | Total anomalies detected |
| `suggestion_count` | Pending rule suggestions |
| `feedback_count` | Total feedback entries |
| `model_loaded` | Whether an ONNX model is loaded |
| `model_engine` | Engine name (e.g., "onnx-runtime", "identity") |
| `anomaly_threshold` | Configured threshold |

## Feature Gating

ML Anomaly Detection requires a valid license with the `ml-detection` feature. Without a license, the ML pipeline is disabled and all endpoints return 402.
