# ML Anomaly Detection

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Machine learning-based behavioral anomaly detection that identifies threats without signature rules. The ML pipeline combines multiple detection engines — each covering a different class of anomaly — and fuses their results into a single severity score with MITRE ATT&CK-mapped alerts.

**Detection engines:**

| Engine | What it catches | Learning period |
|--------|----------------|-----------------|
| **Baseline** | Deviations from learned normal traffic behavior (Z-score) | 7 days (configurable) |
| **EWMA** | Gradual drift and short-term spikes (exponential moving average) | None — scores from first sample |
| **CUSUM** | Sustained mean shifts (slow-ramp DDoS, gradual exfiltration) | None — immediate |
| **ONNX Model** | Custom anomalies via user-trained autoencoder models | Pre-trained offline |
| **Heavy-Hitter** | Elephant flows / top talkers (Count-Min Sketch) | None — constant memory |
| **DNS Entropy** | DGA domains and DNS tunneling (Shannon entropy + Markov model) | None — pre-trained bigram model |
| **TLS Clustering** | Novel/spoofed TLS fingerprints (Mini-Batch K-Means) | None — browser-seeded centroids |
| **C2 Beaconing** | Repetitive payload patterns in C2 channels (TLSH similarity) | None — per-flow hash ring |

All engines run in parallel. Scores are fused via `max(severity)` across engines.

---

## Architecture

```
PacketEvent (eBPF kernel)
  └── MultiWindowAggregator (1min / 5min / 15min)
        │
        ├── FeatureVector (14 features)
        │     ├── TrafficBaseline → AnomalyScorer (Z-scores)
        │     ├── EwmaEngine (streaming, per-feature exponential decay)
        │     ├── CusumEngine (cumulative sum, per-feature drift detection)
        │     └── Optional: OnnxEngine (model inference)
        │           └── fuse_scores() → Alert (MITRE ATT&CK mapped)
        │
        └── HeavyHitterTracker (Count-Min Sketch + TopK)
              └── threshold check → Alert

DNS Query → DnsEntropyEngine (Shannon entropy + Markov bigram)
              └── DGA / tunneling flag → Alert

TLS ClientHello → TlsClusteringEngine (Mini-Batch K-Means)
                    └── outlier flag → TLS Intelligence alert enrichment

L7/DLP payload → BeaconingDetector (TLSH hash ring per flow tuple)
                   └── similarity threshold → Alert
```

---

## Feature Vector

Each `FeatureVector` contains 14 numeric features computed from aggregated traffic within sliding windows:

| # | Feature | Description |
|---|---------|-------------|
| 0 | `packet_rate` | Packets per second |
| 1 | `byte_rate` | Bytes per second |
| 2 | `tcp_ratio` | TCP fraction (0.0–1.0) |
| 3 | `udp_ratio` | UDP fraction |
| 4 | `icmp_ratio` | ICMP fraction |
| 5 | `other_ratio` | Other protocols fraction |
| 6 | `port_entropy` | Shannon entropy of destination ports (bits) |
| 7 | `unique_src_ips` | Unique source IPs (exact count) |
| 8 | `unique_dst_ports` | Unique destination ports |
| 9 | `avg_payload_size` | Mean payload in bytes |
| 10 | `std_payload_size` | Standard deviation of payload |
| 11 | `connection_count` | Total connections in window |
| 12 | `dst_ip_cardinality` | HyperLogLog estimate of unique destination IPs |
| 13 | `flow_cardinality` | HyperLogLog estimate of unique (src, dst, port) tuples |

Features 12–13 use **HyperLogLog** counters (precision=12, ~1.5 KB each, <1.6% error) for memory-efficient cardinality estimation.

---

## Detection Engines

### Baseline Scoring

Learns normal traffic behavior over a configurable period (default: 7 days) using Welford's online algorithm for per-feature mean and variance. After learning, scores incoming feature vectors by weighted Z-score.

**Severity thresholds** (derived from `anomaly_threshold`, default 2.0):

| Severity | Threshold |
|----------|-----------|
| Normal | < 2.0 |
| Low | >= 2.0 |
| Medium | >= 3.0 |
| High | >= 4.0 |
| Critical | >= 5.0 |

**Scopes:** Global, PerInterface, PerSubnet, or PerService baselines.

### EWMA Streaming

Exponentially Weighted Moving Average with adaptive variance. No learning period — catches drift the baseline adapts to.

```
mean     <- alpha * value + (1 - alpha) * mean
variance <- alpha * (value - mean)^2 + (1 - alpha) * variance
z_score  = |value - mean| / sqrt(variance)
```

Defaults: `alpha=0.01`, `threshold=3.0`, `warmup_samples=100`.

### CUSUM Change-Point Detection

Two-sided Cumulative Sum detects sustained mean shifts. Catches slow-ramp DDoS and gradual exfiltration that EWMA adapts to over time.

```
S+ = max(0, S+ + (x - mu - k))     # detects increases
S- = max(0, S- - (x - mu + k))     # detects decreases
Alert when S+ > h or S- > h
```

Per-feature accumulators with configurable slack `k` (default: 0.5) and threshold `h` (default: 5.0). Reports drift direction, magnitude, and duration.

### ONNX Model Inference

Optional user-trained autoencoder model loaded via ONNX Runtime. Computes reconstruction error — high error = anomaly. Models can be hot-swapped at runtime without restart.

### Score Fusion

All active engines score every completed `FeatureVector`. Final severity = `max(baseline, ewma, cusum, onnx)`. This ensures the most sensitive engine drives the alert.

---

## Heavy-Hitter Detection

Identifies top-K sources by byte volume using a **Count-Min Sketch** probabilistic data structure in constant memory (~64 KB).

- CMS dimensions: width=2048, depth=4 (epsilon ~0.001, delta ~0.018)
- TopK tracker: min-heap maintaining the K heaviest sources
- Window rotation: resets each aggregation window, snapshots previous top-K
- **Threshold alerting:** sources exceeding X% of total traffic trigger alerts

---

## DNS Entropy & DGA Detection

Statistical detection of Domain Generation Algorithm (DGA) domains and DNS tunneling without signature updates.

**Two scoring methods combined:**

1. **Shannon entropy** per second-level domain label — high entropy (>3.5 bits/char) indicates random generation
2. **Character bigram Markov model** — 37x37 transition matrix (a-z, 0-9, hyphen) scoring domain plausibility by log-likelihood. Pre-trained on common domain name patterns (~5.3 KB model)

**DGA verdict:** entropy > threshold AND Markov log-likelihood < threshold.

**DNS tunneling heuristic:** subdomain labels > 30 chars with high entropy and many unique subdomains to the same base domain.

**Allowlist:** built-in patterns for CDNs and cloud providers (`*.cdn.cloudflare.net`, `*.amazonaws.com`, etc.). Configurable via API.

---

## TLS Fingerprint Clustering

Groups JA4+ TLS fingerprints into behavioral clusters using **Mini-Batch K-Means** and flags outliers (novel or spoofed fingerprints).

- 10-dimensional feature vector from `TlsClientHello` (cipher count, extension count, supported groups, signature algorithms, ALPN, versions, SNI, handshake version, key shares)
- Pre-seeded with 8 known client profiles: Chrome, Firefox, Safari, Edge, curl, Python, Go, Java
- Outlier detection: Euclidean distance to nearest centroid > threshold
- Memory: ~4 KB for K=50 clusters

---

## C2 Beaconing Detection

Detects command-and-control beaconing channels by identifying repetitive payload patterns using **TLSH** locality-sensitive hashing.

- TLSH hash computed per flow payload (minimum 50 bytes)
- Per-tuple `(src_ip, dst_ip, dst_port)` hash ring with LRU eviction
- Beaconing alert: >= N similar payloads (TLSH distance < threshold) within time window
- **Periodicity estimation:** inter-arrival time variance — low variance = regular beaconing interval
- Allowlist for known repetitive protocols (NTP, DNS, mDNS)

---

## Rule Suggestion

When anomalies are detected, the `RuleSuggester` proposes IDS/IPS rules based on the top contributing features:

| Feature | Rule Type |
|---------|-----------|
| `packet_rate`, `byte_rate` | Rate threshold |
| `port_entropy` | Port scan detection |
| `tcp/udp/icmp_ratio` | Protocol anomaly |
| `unique_src_ips`, `unique_dst_ports` | Connection flood |

Suggestions are stored as `Pending`, reviewed by admins via API (`approve` / `reject`), and include confidence scores based on Z-score magnitude.

## Feedback Loop

Operators submit false positive / true positive labels per anomaly. The `FeedbackStore` tracks per-category FP rates and exports labeled datasets for model retraining when threshold is reached (default: 100 samples).

---

## MITRE ATT&CK Mapping

Every ML anomaly alert includes MITRE ATT&CK technique mapping:

| Anomaly Type | Technique | Tactic |
|-------------|-----------|--------|
| Traffic volume drift | T1498.001 Direct Network Flood | Impact |
| Protocol ratio drift | T1572 Protocol Tunneling | Command & Control |
| Port entropy spike | T1046 Network Service Scanning | Discovery |
| Source diversity spike | T1090 Proxy | Command & Control |
| Dest port diversity spike | T1570 Lateral Tool Transfer | Lateral Movement |
| Payload size anomaly | T1074 Data Staged | Collection |
| Connection count spike | T1110 Brute Force | Credential Access |

---

## Configuration

```yaml
enterprise:
  ml_detection:
    enabled: true
    model_path: /etc/ebpfsentinel/model.onnx    # optional ONNX model
    learning_days: 7
    anomaly_threshold: 2.0
    time_windows: [60, 300, 900]
    # EWMA streaming engine
    ewma_enabled: true
    ewma_alpha: 0.01
    ewma_threshold: 3.0
    ewma_warmup_samples: 100
    # CUSUM change-point detection
    cusum_enabled: true
    cusum_slack: 0.5
    cusum_threshold: 5.0
    # Heavy-hitter detection (Count-Min Sketch)
    heavy_hitter_enabled: true
    heavy_hitter_k: 100
    heavy_hitter_threshold_pct: 10.0
    cms_width: 2048
    cms_depth: 4

  # DNS entropy / DGA detection (separate config section)
  dns_entropy:
    enabled: true
    entropy_threshold: 3.5
    markov_threshold: -4.0
    tunnel_label_length: 30
    tunnel_entropy_threshold: 3.0
    allowlist:
      - "*.cdn.cloudflare.net"
      - "*.amazonaws.com"

  # TLS fingerprint clustering (separate config section)
  tls_clustering:
    enabled: true
    k: 50
    outlier_threshold: 8.0
    batch_size: 32

  # C2 beaconing detection (separate config section)
  beaconing:
    enabled: true
    min_payload_size: 50
    tlsh_distance_threshold: 40
    min_similar_count: 3
    window_secs: 3600
    max_tracked_tuples: 100
    hashes_per_tuple: 10
    allowlisted_ports: [53, 123, 5353]
```

---

## REST API

### Core ML Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/ml/status` | Pipeline status (all engines) |
| `GET` | `/api/v1/enterprise/ml/anomalies` | Recent anomalies (limit param) |
| `GET` | `/api/v1/enterprise/ml/alerts` | ML alerts with MITRE mapping |
| `GET` | `/api/v1/enterprise/ml/suggestions` | Pending rule suggestions |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/approve` | Approve suggestion |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/reject` | Reject suggestion |
| `POST` | `/api/v1/enterprise/ml/feedback` | Submit FP/TP feedback |
| `GET` | `/api/v1/enterprise/ml/feedback/stats` | Feedback statistics |
| `GET` | `/api/v1/enterprise/ml/training-data` | Export labeled dataset |
| `POST` | `/api/v1/enterprise/ml/model/reload` | Hot-swap ONNX model |
| `GET` | `/api/v1/enterprise/ml/ewma/status` | EWMA engine status |
| `POST` | `/api/v1/enterprise/ml/ewma/reset` | Reset EWMA state |
| `POST` | `/api/v1/enterprise/ml/cusum/reset` | Reset CUSUM state |

### Streaming Algorithm Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/ml/heavy-hitters` | Top-K heavy hitters by byte volume |
| `GET` | `/api/v1/enterprise/ml/beaconing` | Active C2 beaconing suspects |

### DNS Entropy Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/dns/dga-scores` | Recent DGA scores |
| `GET` | `/api/v1/enterprise/dns/dga-scores/{domain}` | Score a domain on demand |
| `POST` | `/api/v1/enterprise/dns/allowlist` | Add allowlist pattern |
| `DELETE` | `/api/v1/enterprise/dns/allowlist/{pattern}` | Remove pattern |

### TLS Clustering Endpoint

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/tls-intelligence/clusters` | Fingerprint clusters with centroids and labels |

---

## Feature Gating

ML Anomaly Detection requires a valid license with the `ml-detection` feature. Without a license, all ML endpoints return 402.
