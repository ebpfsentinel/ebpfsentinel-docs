# ML Anomaly Detection

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Machine learning-based behavioral anomaly detection that identifies threats without signature rules. Uses ONNX Runtime for inference, multi-window traffic aggregation for feature extraction, and Z-score-based scoring against learned baselines. A parallel **EWMA streaming engine** adapts continuously with no learning period, catching drift the window-based approach misses. Both engines are fused via `max(baseline, ewma)` severity. Detected anomalies generate MITRE ATT&CK-mapped alerts, can automatically generate IDS/IPS rule suggestions, and operators can submit feedback to improve detection accuracy.

## Architecture

```
PacketEvent (eBPF kernel)
  └── packet_event_to_sample() (IPv4/IPv6 handling)
        └── MultiWindowAggregator (3 parallel windows)
              ├── WindowAggregator (1min)   ─┐
              ├── WindowAggregator (5min)    ─┼── FeatureVector (14 features)
              └── WindowAggregator (15min)  ─┘
                    ├── TrafficBaseline (Welford's algorithm, per-scope)
                    │     └── AnomalyScorer (weighted Z-scores)
                    │           ├── AnomalyScore (severity classification)
                    │           │     └── RuleSuggester (→ IDS/IPS rule proposals)
                    │           └── Optional: OnnxEngine (model inference)
                    │                 └── ModelHolder (reconstruction error)
                    └── EwmaEngine (streaming, per-feature exponential decay)
                          └── EwmaAnomalyScore (adaptive Z-scores)
                                └── fuse_scores() → max(baseline, ewma) severity
                                      └── Alert (with MITRE ATT&CK mapping)
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
| 12 | `dst_ip_cardinality` | HyperLogLog estimate of unique destination IPs |
| 13 | `flow_cardinality` | HyperLogLog estimate of unique (src, dst, port) tuples |

The `as_model_input()` method flattens these into a `[f64; 14]` array for ML model inference.

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

## EWMA Streaming Engine

The EWMA (Exponentially Weighted Moving Average) engine runs in parallel with the baseline scorer, adapting continuously with no learning/detection mode split. It catches gradual drift that the window-based baseline approach misses.

### Algorithm

Per-feature accumulators track mean and variance via exponential decay:

```
mean     ← α × value + (1 - α) × mean
variance ← α × (value - mean)² + (1 - α) × variance
z_score  = |value - mean| / sqrt(variance)
```

When variance is near-zero (stable baseline) and a significant deviation occurs, the z-score is maximized, ensuring anomaly detection even against perfectly stable traffic.

Composite score is `max(feature z-scores)` — this catches single-feature spikes better than weighted averages.

### Score Fusion

Both engines score every completed `FeatureVector`. The final severity is `max(baseline_severity, ewma_severity)`:

| Baseline | EWMA | Engine Label | Behavior |
|----------|------|--------------|----------|
| Active | Active | `fused` | Both score, max severity wins |
| Active | Inactive | `baseline` | Baseline only |
| Learning | Active | `ewma` | EWMA detects during baseline learning period |
| Learning | Warmup | — | No scoring yet |

### MITRE ATT&CK Mapping

Every ML anomaly alert is enriched with MITRE ATT&CK technique mapping based on the top contributing feature:

| Feature(s) | Anomaly Type | Technique | Tactic |
|------------|-------------|-----------|--------|
| `packet_rate`, `byte_rate` | Traffic volume drift | T1498.001 Direct Network Flood | impact |
| `tcp/udp/icmp/other_ratio` | Protocol ratio drift | T1572 Protocol Tunneling | command-and-control |
| `port_entropy` | Port entropy spike | T1046 Network Service Scanning | discovery |
| `unique_src_ips` | Source diversity spike | T1090 Proxy | command-and-control |
| `unique_dst_ports` | Dest port diversity spike | T1570 Lateral Tool Transfer | lateral-movement |
| `avg/std_payload_size` | Payload size anomaly | T1074 Data Staged | collection |
| `connection_count` | Connection count spike | T1110 Brute Force | credential-access |

These 7 techniques appear in the MITRE coverage matrix under the `ml-anomaly` component.

### Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ewma_enabled` | bool | `true` | Enable EWMA streaming engine |
| `ewma_alpha` | f64 | `0.01` | Decay factor — lower values adapt slower, higher values track recent traffic more closely. Must be in (0, 1) |
| `ewma_threshold` | f64 | `3.0` | Z-score threshold for anomaly detection. Must be > 0 |
| `ewma_warmup_samples` | u32 | `100` | Minimum samples before scoring begins. Must be > 0 |

### Memory

12 accumulators × 24 bytes each = **288 bytes** total state. Well under the 10 MB budget.

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
| `feature_vector` | The 14-feature vector that triggered the anomaly |
| `anomaly_score` | The composite Z-score |
| `category` | Top contributing feature name (e.g., `"packet_rate"`) |
| `submitted_by` | Optional operator identity |

### FeedbackStore

- Tracks per-category false positive rates: `FP / (TP + FP)`
- Export threshold: **100** samples (default) — when reached, `export_ready()` returns true
- Export formats: JSON (`export_json()`) and CSV (`export_csv()` with header: `label, anomaly_score, category, f0-f13`)
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
    ewma_enabled: true
    ewma_alpha: 0.01
    ewma_threshold: 3.0
    ewma_warmup_samples: 100
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable ML detection pipeline |
| `model_path` | string | — | Path to ONNX model file (optional, baseline-only if omitted) |
| `learning_days` | u32 | `7` | Baseline learning period in days |
| `anomaly_threshold` | f64 | `2.0` | Z-score threshold for low-severity anomalies (must be > 0) |
| `time_windows` | list | `[60, 300, 900]` | Aggregation windows in seconds (mapped to OneMin/FiveMin/FifteenMin) |
| `ewma_enabled` | bool | `true` | Enable EWMA streaming engine |
| `ewma_alpha` | f64 | `0.01` | EWMA decay factor, must be in (0, 1) |
| `ewma_threshold` | f64 | `3.0` | EWMA z-score threshold, must be > 0 |
| `ewma_warmup_samples` | u32 | `100` | Min samples before EWMA scores, must be > 0 |

## REST API

| Method | Endpoint | Query/Body | Description |
|--------|----------|------------|-------------|
| `GET` | `/api/v1/enterprise/ml/status` | — | Pipeline status (baseline learning, EWMA state, model loaded, counts) |
| `GET` | `/api/v1/enterprise/ml/anomalies` | `limit` (default 100) | Recent anomalies (newest first) |
| `GET` | `/api/v1/enterprise/ml/alerts` | `limit` (default 100) | Recent ML alerts with MITRE ATT&CK mapping (newest first) |
| `GET` | `/api/v1/enterprise/ml/suggestions` | — | Pending rule suggestions |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/approve` | — | Approve suggestion (201) |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/reject` | — | Reject suggestion (200) |
| `POST` | `/api/v1/enterprise/ml/feedback` | `{ anomaly_id, is_false_positive, comment }` | Submit FP/TP feedback (201) |
| `GET` | `/api/v1/enterprise/ml/feedback/stats` | — | Feedback statistics and FP rates |
| `GET` | `/api/v1/enterprise/ml/training-data` | — | Export labeled training dataset |
| `POST` | `/api/v1/enterprise/ml/model/reload` | `{ model_path }` | Hot-swap ONNX model |
| `GET` | `/api/v1/enterprise/ml/ewma/status` | — | EWMA engine status (warmed_up, sample_count, alpha, threshold) |
| `POST` | `/api/v1/enterprise/ml/ewma/reset` | — | Reset EWMA accumulators |

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
| `ewma_enabled` | Whether the EWMA streaming engine is active |
| `ewma_warmed_up` | Whether EWMA has accumulated enough samples to score |
| `ewma_sample_count` | Total feature vectors processed by EWMA |

### EWMA Status Response

| Field | Description |
|-------|-------------|
| `enabled` | Always `true` when engine exists |
| `warmed_up` | Whether `total_samples >= warmup_samples` |
| `total_samples` | Feature vectors processed since last reset |
| `alpha` | Configured decay factor |
| `threshold` | Configured z-score threshold |
| `warmup_samples` | Configured warmup count |

## Advanced Streaming Algorithms (E17)

Beyond EWMA and baseline scoring, the ML pipeline includes specialized streaming statistical algorithms that operate independently on different traffic dimensions.

### CUSUM Change-Point Detection

Two-sided CUSUM (Cumulative Sum) detects sustained mean shifts that EWMA adapts to — catching slow-ramp DDoS and gradual exfiltration that evade standard anomaly detectors.

- Per-feature accumulators: `S+ = max(0, S+ + (x - mu - k))`, `S- = max(0, S- - (x - mu + k))`
- Alert when cumulative sum exceeds threshold `h` (default: 5.0)
- Drift direction (increase/decrease) and duration reported per feature
- Configurable slack `k` (default: 0.5) and threshold `h` (default: 5.0)

| Config | Default | Description |
|--------|---------|-------------|
| `cusum_enabled` | `true` | Enable CUSUM engine |
| `cusum_slack` | `0.5` | Allowable drift before accumulation (parameter k) |
| `cusum_threshold` | `5.0` | Cumulative sum alert threshold (parameter h) |

API: `POST /api/v1/enterprise/ml/cusum/reset` — reset CUSUM accumulators.

### HyperLogLog Cardinality Estimation

Memory-efficient unique count estimation for source IPs, destination IPs, and flow tuples. Used within the `WindowAggregator` to compute `dst_ip_cardinality` and `flow_cardinality` features without per-element state.

- Precision: 12 bits (~1.5 KB per counter, <1.6% error)
- Three counters per window: source IPs, destination IPs, flow tuples (src_ip, dst_ip, dst_port)
- Feeds into the feature vector as dimensions 12 and 13

### Count-Min Sketch & Heavy-Hitter Detection

Approximate top-K heavy hitter identification using a Count-Min Sketch probabilistic data structure. Identifies elephant flows (potential exfiltration) and top talkers in constant memory.

- CMS dimensions: width=2048, depth=4 (~64 KB, epsilon ~0.001)
- TopK tracker: min-heap maintaining the top-K sources by byte volume
- Window rotation: CMS resets per aggregation window with snapshot of previous top-K
- Threshold alerting: sources exceeding X% of total traffic trigger alerts

| Config | Default | Description |
|--------|---------|-------------|
| `heavy_hitter_enabled` | `true` | Enable heavy-hitter tracking |
| `heavy_hitter_k` | `100` | Top-K count |
| `heavy_hitter_threshold_pct` | `10.0` | Alert threshold (% of total traffic) |
| `cms_width` | `2048` | CMS width (columns) |
| `cms_depth` | `4` | CMS depth (hash functions) |

API: `GET /api/v1/enterprise/ml/heavy-hitters` — current top-K heavy hitters with estimated bytes and rank.

### DNS Entropy & Character Markov Model

Statistical DGA (Domain Generation Algorithm) and DNS tunneling detection based on domain name entropy and character sequence analysis. Detects algorithmically generated C2 domains without signature updates.

- Shannon entropy per second-level domain label (threshold: 3.5 bits/char)
- Character bigram Markov model: 37x37 transition matrix (a-z, 0-9, hyphen) scoring domain name plausibility by log-likelihood
- Combined threshold: entropy > X AND Markov log-likelihood < Y triggers DGA flag
- DNS tunneling heuristic: subdomain labels > 30 chars with high entropy
- Allowlist for legitimate high-entropy domains (CDNs, cloud providers)
- Pre-trained model on common English domain character patterns (~5.3 KB)

| Config | Default | Description |
|--------|---------|-------------|
| `dns_entropy.enabled` | `false` | Enable DGA/tunneling detection |
| `dns_entropy.entropy_threshold` | `3.5` | Shannon entropy threshold (bits/char) |
| `dns_entropy.markov_threshold` | `-4.0` | Bigram log-likelihood threshold |
| `dns_entropy.tunnel_label_length` | `30` | Min label length for tunneling detection |
| `dns_entropy.tunnel_entropy_threshold` | `3.0` | Entropy threshold for tunneling labels |

API:
- `GET /api/v1/enterprise/dns/dga-scores` — recent DGA scores
- `GET /api/v1/enterprise/dns/dga-scores/{domain}` — score a domain on demand
- `POST /api/v1/enterprise/dns/allowlist` — add allowlist pattern
- `DELETE /api/v1/enterprise/dns/allowlist/{pattern}` — remove pattern

### TLS Fingerprint Clustering (Mini-Batch K-Means)

Groups JA4+ TLS fingerprints into behavioral clusters and flags outliers (novel or spoofed fingerprints). Pre-seeded with known browser profiles (Chrome, Firefox, Safari, Edge, curl, Python, Go, Java).

- Mini-Batch K-Means: incremental centroid updates without full recomputation
- 10-dimensional feature vector from `TlsClientHello` fields (cipher count, extension count, groups, signature algorithms, ALPN, versions, SNI, handshake version, key shares)
- Outlier detection: Euclidean distance > configurable threshold from all centroids
- Memory: K x 10 x 8 bytes (~4 KB for K=50)

| Config | Default | Description |
|--------|---------|-------------|
| `tls_clustering.enabled` | `false` | Enable fingerprint clustering |
| `tls_clustering.k` | `50` | Number of clusters |
| `tls_clustering.outlier_threshold` | `8.0` | Euclidean distance threshold for outliers |
| `tls_clustering.batch_size` | `32` | Mini-batch size for centroid updates |

API: `GET /api/v1/enterprise/tls-intelligence/clusters` — cluster centroids, member counts, and labels.

### TLSH Payload Similarity (C2 Beaconing Detection)

Detects command-and-control beaconing channels by identifying repetitive payload patterns across sessions using TLSH locality-sensitive hashing.

- TLSH hash computed per flow payload (minimum 50 bytes)
- Per-tuple (src_ip, dst_ip, dst_port) hash ring with LRU eviction
- Similarity comparison: TLSH distance < threshold across N sessions within time window
- Periodicity estimation: inter-arrival time variance (low = regular beaconing)
- Allowlist for known repetitive protocols (NTP, DNS, mDNS)

| Config | Default | Description |
|--------|---------|-------------|
| `beaconing.enabled` | `false` | Enable beaconing detection |
| `beaconing.min_payload_size` | `50` | Minimum payload bytes for TLSH |
| `beaconing.tlsh_distance_threshold` | `40` | TLSH distance threshold (0=identical, <100=similar) |
| `beaconing.min_similar_count` | `3` | Minimum similar payloads to trigger alert |
| `beaconing.window_secs` | `3600` | Similarity matching window (seconds) |
| `beaconing.max_tracked_tuples` | `100` | Maximum tracked flow tuples |
| `beaconing.hashes_per_tuple` | `10` | Hash ring size per tuple |

API: `GET /api/v1/enterprise/ml/beaconing` — active beaconing suspects with similarity scores, periodicity estimates, and sample hashes.

## Feature Gating

ML Anomaly Detection (including all E17 streaming algorithms) requires a valid license with the `ml-detection` feature. Without a license, the ML pipeline is disabled and all endpoints return 402.
