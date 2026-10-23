# ML Anomaly Detection

> **Edition: Enterprise**

## Overview

Machine learning-based behavioral anomaly detection that identifies threats without signature rules. The ML pipeline runs several detection engines, each covering a different class of anomaly, and emits MITRE ATT&CK-mapped alerts. The engines that read the same traffic window are fused into one severity score; the engines that read something else alert on their own.

**Detection engines:**

| Engine | What it catches | Learning period |
|--------|----------------|-----------------|
| **Baseline** | Deviations from learned normal traffic behavior (Z-score) | 7 days (configurable) |
| **EWMA** | Gradual drift and short-term spikes (exponential moving average) | None - scores from first sample |
| **CUSUM** | Sustained mean shifts (slow-ramp DDoS, gradual exfiltration) | None - immediate |
| **ONNX Model** | Custom anomalies via user-trained autoencoder models | Pre-trained offline |
| **Random Cut Forest** | Correlated multi-feature anomalies no single feature reveals | None - a forest per entity, built as it observes and reloaded after a restart |
| **Heavy-Hitter** | Elephant flows / top talkers (Space-Saving counters) | None - a bounded table |
| **DNS Entropy** | DGA domains and DNS tunneling (Shannon entropy + Markov model) | None - pre-trained bigram model |
| **TLS Clustering** | Novel/spoofed TLS fingerprints (Mini-Batch K-Means) | None - browser-seeded centroids |
| **C2 Beaconing** | Repetitive payload patterns in C2 channels (TLSH similarity) | None - per-flow hash ring |

**Four of the nine are fused.** Baseline, EWMA, CUSUM and the ONNX model all
score the same completed feature vector, so their verdicts are combined into one
alert per window at `max(severity)`.

Every other engine on that list alerts on its own path and is fused with
nothing, because each reads something different: Random Cut Forest scores the
same vector but reports the features that made it unusual, which a fused
severity would discard; Heavy-Hitter counts sources rather than windows; and DNS
entropy, TLS clustering and beaconing each read a different kind of event
entirely. An operator counting alerts should expect at most one fused anomaly
per window plus whatever those five raised.

---

## Architecture

```
PacketEvent (eBPF kernel)
  └── MultiWindowAggregator (1min / 5min / 15min)
        │
        ├── FeatureVector (14 features)
        │     │
        │     ├── fused path
        │     │     ├── TrafficBaseline → AnomalyScorer (Z-scores)
        │     │     ├── EwmaEngine (streaming, per-feature exponential decay)
        │     │     ├── CusumEngine (cumulative sum, per-feature drift detection)
        │     │     ├── Optional: OnnxEngine (reconstruction error, scored vs its own history)
        │     │     └── fuse_scores() → one Alert (MITRE ATT&CK mapped)
        │     │
        │     └── independent path
        │           └── Optional: RcfDetector (one Random Cut Forest per entity)
        │                 ├── adaptive threshold (drift detector + tail quantile)
        │                 ├── Platt calibration (score → probability)
        │                 ├── attribution (which features drove the score)
        │                 ├── grouping (a burst → one finding)
        │                 └── own Alert, ranked queue, state saved to disk
        │
        └── TopTalkerTracker (Space-Saving counters)
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
| 2 | `tcp_ratio` | TCP fraction (0.0-1.0) |
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

Features 12-13 use **HyperLogLog** counters (precision=12, ~1.5 KB each, <1.6% error) for memory-efficient cardinality estimation.

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

Exponentially Weighted Moving Average with adaptive variance. No learning period - catches drift the baseline adapts to.

```
mean     <- alpha * value + (1 - alpha) * mean
variance <- alpha * (value - mean)^2 + (1 - alpha) * variance
z_score  = |value - mean| / sqrt(variance)
```

Defaults: `alpha=0.01`, `threshold=3.0`, `warmup_samples=100`.

**Severity thresholds** (multiples of `ewma_threshold`, so they move when you tune it):

| Severity | Threshold | At the default `threshold=3.0` |
|----------|-----------|-------------------------------|
| Normal | < `threshold` | < 3.0 |
| Low | >= `threshold` | >= 3.0 |
| Medium | >= 1.5x `threshold` | >= 4.5 |
| High | >= 2x `threshold` | >= 6.0 |
| Critical | >= 2.5x `threshold` | >= 7.5 |

This is a different scale from the baseline's fixed 2 / 3 / 4 / 5, and the ONNX model below uses this one too. See [Score Fusion](#score-fusion) for what that means when the two disagree.

### CUSUM Change-Point Detection

Two-sided Cumulative Sum detects sustained mean shifts. Catches slow-ramp DDoS and gradual exfiltration that EWMA adapts to over time.

```
S+ = max(0, S+ + (x - mu - k))     # detects increases
S- = max(0, S- - (x - mu + k))     # detects decreases
Alert when S+ > h or S- > h
```

Per-feature accumulators with configurable slack `k` (default: 0.5) and threshold `h` (default: 5.0). Reports drift direction, magnitude, and duration.

**Severity thresholds** (on the normalised score, which is the largest accumulator divided by `h`, so 1.0 is exactly at threshold):

| Severity | Threshold |
|----------|-----------|
| Normal | < 1.0 |
| Low | >= 1.0 |
| Medium | >= 2.0 |
| High | >= 3.0 |
| Critical | >= 4.0 |

### ONNX Model Inference

Optional user-trained autoencoder model loaded via ONNX Runtime. The model reconstructs the feature vector and the pipeline takes the mean squared error between input and output: high error = anomaly. Models can be hot-swapped at runtime without restart.

That raw error is in no fixed unit - it depends on the model, on how the features were scaled when it was trained, and on how well it converged - so it is never compared against a constant. It is judged as a Z-score against its own history:

```
z = |error - mean(error)| / sqrt(variance(error))
```

with the mean and variance maintained by the same EWMA accumulator used elsewhere on this page. Consequences worth knowing before you deploy a model:

- **The knobs are the EWMA ones.** `ewma_alpha`, `ewma_threshold` and `ewma_warmup_samples` govern the reconstruction score too. There is no separate model threshold, because an operator who slows the moving average down means that for the pipeline rather than for one engine of it.
- **The model contributes nothing until it is warmed up.** Until `ewma_warmup_samples` reconstruction errors have been observed, the engine scores every window Normal. A brand-new model is silent, not clean.
- **A hot swap resets the history.** The new model's errors are on a different scale from the old one's, so the warm-up starts again on load.
- **The model raises severity but attributes nothing.** An autoencoder reconstructs the whole vector at once, so when it is the only engine that scored a window the resulting alert carries an empty `feature_scores` and `top_features`. Use Random Cut Forest below when per-feature attribution is what you need.

`GET /api/v1/enterprise/ml/status` reports both halves of that state as `model_warmed_up` and `model_sample_count`.

### Score Fusion

Baseline, EWMA, CUSUM and the loaded model score every completed `FeatureVector`, and those four are fused:

```
final_severity = max(baseline, ewma, cusum, model)
```

The most sensitive of the four drives the alert. An engine that is not configured, or that has not warmed up, contributes nothing rather than contributing a Normal.

**The four severities are not on one scale, and that is what decides which engine wins.** The baseline classifies an absolute Z-score against fixed bands; EWMA and the model classify a Z-score against multiples of `ewma_threshold`; CUSUM classifies a magnitude against multiples of `h`. At the defaults a Z-score of 5 is Critical to the baseline and only Medium to EWMA, so the baseline is the sensitive one and raising `anomaly_threshold` is what moves the fused severity. Lowering `ewma_threshold` below 2.0 flips it the other way, at which point EWMA drives most alerts. Tune the two together, and read the engine label on the alert to see which one actually settled the severity.

If every engine that scored the window called it Normal, no alert is emitted at all.

Each fused alert carries a label naming **exactly** the engines whose own severity equalled the final severity, joined with `+`:

| Label | Meaning |
|-------|---------|
| `baseline` | Only the baseline reached this severity |
| `ewma+cusum` | EWMA and CUSUM both reached it; baseline and model were lower or absent |
| `baseline+ewma+cusum+model` | All four agreed on the severity |

An engine that ran and stayed below the final severity is not named, because naming it would say it drove an alert it did not drive.

No other engine on this page is part of that fusion.

### Random Cut Forest

Optional. Random Cut Forest observes the same `FeatureVector` the fused engines do, but reports **which dimensions** made the point unusual, which is what the fused severity cannot carry. It therefore emits its own alert on its own path and is deliberately not folded into `fuse_scores`.

- No learning period: the forest builds as it observes, and scores once it holds enough points.
- Hyperparameters are validated by `anomstream` against the AWS reference implementation. A rejected configuration logs a warning and disables the detector rather than aborting the service.
- Attribution is read live from the forest, so an alert raised before the forest can attribute carries an empty `top_features` rather than a guessed one.

#### One baseline per entity

A host is not a workload. A node running a database, an ingress controller and a
batch job has one traffic profile made of three, and a single baseline over the
three learns that everything is normal. The detector therefore holds a **pool of
forests keyed by entity** - the tenant and the workload the sample was attributed
to - and a sample with no workload is keyed `unattributed`, which is its own
entity rather than a sample folded into somebody else's baseline.

The pool is bounded by `pool_capacity`. When it is full the least recently seen
entity is evicted, and an entity silent for `entity_idle_secs` loses its baseline
whether the pool is full or not. Evictions and creations are counted for the life
of the process, so a pool that is churning says so rather than looking merely
busy.

**The memory this costs is a published figure, not a guess.** An entity's forest
holds `num_trees` trees of `sample_size` points in 14 dimensions, so at the
defaults it is roughly 2.5 MiB, and a full pool of 64 entities roughly 160 MiB.
`/api/v1/enterprise/ml/rcf/status` reports both the estimate and, once a forest
has been serialised for persistence, the measured figure, together with what a
full pool would cost at the configured capacity. Read it before raising
`pool_capacity` on an estate with ten thousand workloads: the answer is a number
you can multiply, and the same figure is exported as
`ebpfsentinel_ent_ml_rcf_bytes_per_entity`.

#### A baseline that survives a restart

Every baseline in the pool is written to the agent's state store every five
minutes and once more on the way out, and reloaded at start. Without it a restart
puts every detector back into its warm-up, during which it is both noisy and
blind - which is exactly when an operator restarts an agent.

The format is versioned. A state entry written by an incompatible version, or
truncated, is **discarded with a log line naming how many entries went** rather
than misread, and those entities relearn. The file lives at
`/var/lib/ebpfsentinel/ml_state.redb`, so a container that does not mount a volume
for that directory keeps its baselines in the temporary directory and loses them
with the container.

#### What the probability means

A raw score of `1.7` is a number on a scale nobody outside this estate owns. Once
analysts have confirmed or dismissed enough anomalies, Platt scaling fits a
logistic over the labelled scores, and the queue reports a **probability**: "83%"
means 83% of the labelled alerts that scored like this one were real.

Until the fit exists there is no probability at all - the field is absent, the
queue ranks on the raw grade, and the surface says the figure is not yet
calibrated. An invented probability is worse than a raw score, because it is a raw
score that looks trustworthy. The fit needs at least eight confirmations **and**
eight dismissals, refits every 32 further verdicts, and keeps the most recent
`calibration_capacity` labelled scores. Feedback is submitted through
`POST /api/v1/enterprise/ml/feedback`; `/rcf/status` reports whether a fit exists
and how many labels of each kind it rests on.

#### Thresholds that move, and say why

With `adaptive_threshold` on, the configured `anomaly_threshold` is a starting
point rather than a constant. After `min_observations` samples the detector reads
a high quantile of what this entity's scores actually look like, and a drift
detector watches for the distribution changing underneath it. The threshold is
clamped to between half and four times the configured figure, so adaptation can
never silence the detector or turn it into a pager.

`/rcf/status` reports the threshold in force, the one before it, and the reason it
moved:

| Reason | Meaning |
|--------|---------|
| `static` | Not enough observations yet - the configured threshold is in force |
| `quantile` | The tail of this entity's own score distribution moved it |
| `drift` | The distribution changed, so the threshold was refitted on the new one |

The figure in force is also exported as `ebpfsentinel_ent_ml_rcf_threshold`.

#### A burst is one finding

A scan, a backup window or a misconfigured client raises the same alert a few
hundred times. With `group_alerts` on, near-duplicates are folded into a group and
the queue shows the group once, with its size and its worst member. Alerts are
compared on their **attribution** rather than on their score, so two bursts that
are both "unusually high packet rate" group together while a burst of "unusual
port entropy" stays a separate finding. A group closes after fifteen minutes with
nothing joining it.

An analyst who thinks a group collapsed two different things says so with
`POST /api/v1/enterprise/ml/rcf/groups/{group_id}/reject`: the group is split, its
members regroup on their own, and the similarity bar rises a notch. Disagreement
makes the grouping more conservative rather than being noted and forgotten.

#### The ranked queue

`/api/v1/enterprise/ml/rcf/queue` is the detector's own queue, ordered by
calibrated probability where a calibration exists and by score where it does not,
with each row carrying its entity, its probability, the features that drove it and
its group. The response says which of the two orders it used, so a reader never
has to infer it from the numbers.

**Severity thresholds** (on the RCF score, which is not a Z-score):

| Severity | Threshold |
|----------|-----------|
| Normal | < 1.5 |
| Low | >= 1.5 |
| Medium | >= 2.0 |
| High | >= 3.0 |
| Critical | >= 4.0 |

Scores and attribution are readable directly through `/api/v1/enterprise/ml/rcf/scores` and `/api/v1/enterprise/ml/rcf/attribution`. Every score record names the entity it was scored against; `/rcf/attribution` takes an optional `tenant` and `workload` to pick the baseline the supplied point is judged against, and judges it against the unattributed baseline when neither is given.

Each score record on `/rcf/scores` carries the window it was aggregated over as `OneMin`, `FiveMin` or `FifteenMin`, and an `is_anomalous` flag that is true at or above the configured `anomaly_threshold` - `1.5` by default, so anything the table above calls Low or worse is flagged. The `window` query parameter of `/rcf/attribution` is spelled differently on purpose: it takes `one_min`, `five_min` or `fifteen_min` and defaults to `one_min`.

---

## Heavy-Hitter Detection

Identifies the heaviest sources by byte volume using **Space-Saving** counters in
bounded memory: one table of `heavy_hitter_k` counters per window, with the
guarantee that any source above `total / k` of the window is resident in it.

- Table size: `heavy_hitter_k` counters (100 by default), amortised constant cost per packet
- Window rotation: resets each aggregation window, snapshots the previous one so a reader has something to compare against while the live window fills
- **Threshold alerting:** sources exceeding X% of the window's bytes trigger alerts
- Every row states its own slack: `estimated_bytes` is never an underestimate, and `error_bytes` is the worst case by which it overstates

This replaced a Count-Min sketch paired with a hand-written top-K heap, and three
differences are worth knowing. A sketch can answer "how much did this key send"
but cannot enumerate the heaviest keys, so the old tracker kept a side map of
every source in the window: a talker that went quiet could be pushed out of the
top-K while its counter kept rising, and an evicted key never came back. The
overestimate is now reported rather than folded invisibly into the figure. And the
two configuration keys that sized the sketch, `cms_width` and `cms_depth`, no
longer exist - a configuration carrying them is rejected rather than ignored.

---

## DNS Entropy & DGA Detection

Statistical detection of Domain Generation Algorithm (DGA) domains and DNS tunneling without signature updates.

**Two scoring methods combined:**

1. **Shannon entropy** per second-level domain label - high entropy (>3.5 bits/char) indicates random generation
2. **Character bigram Markov model** - 37x37 transition matrix (a-z, 0-9, hyphen) scoring domain plausibility by log-likelihood. Pre-trained on common domain name patterns (~5.3 KB model)

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
- **Periodicity estimation:** inter-arrival time variance - low variance = regular beaconing interval
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

Operators submit false positive / true positive labels per anomaly. A verdict does
two things, which used to be one module and are now deliberately separate:

- **The ledger** records who said what, when and about which anomaly, and tracks the per-category false-positive rate. It keeps the most recent 10,000 verdicts and counts the rest, so the rates still answer for every verdict ever submitted while an export answers for what is still held. A labeled dataset is worth exporting once 100 samples exist.
- **The score** moves. The verdict goes to the Random Cut Forest detector as well: it calibrates the probability the queue reports, and where the point the alert was raised on is still remembered, it also shifts the score of the next point in that neighbourhood. A verdict on an anomaly whose point has aged out still calibrates; it just cannot move a neighbourhood.

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

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

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
    # Heavy-hitter detection (Space-Saving counters)
    heavy_hitter_enabled: true
    heavy_hitter_k: 100
    heavy_hitter_threshold_pct: 10.0
    # Random Cut Forest
    rcf:
      enabled: true
      num_trees: 100              # AWS bound [50, 1000]
      sample_size: 256            # per-tree reservoir, [1, 2048]
      time_decay: 0.0             # 0.0 = uniform reservoir sampling
      anomaly_threshold: 1.5
      # seed: 42                  # optional deterministic seed
      # num_threads: 4            # optional dedicated rayon pool
      recent_capacity: 256        # records kept for /ml/rcf/scores
      pool_capacity: 64           # baselines held at once, one per entity
      entity_idle_secs: 10800     # an entity silent this long loses its baseline
      min_observations: 256       # samples before a baseline is trusted
      adaptive_threshold: true    # a drift detector and a tail quantile move it
      explain: true               # name the features that drove an anomaly
      explain_permutations: 16    # permutations averaged per explanation
      explain_features: 4         # features reported per anomaly
      group_alerts: true          # collapse a burst into one finding
      calibration_capacity: 4096  # verdicts kept to calibrate the probability

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

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/ml/status` | viewer | ml-detection | Pipeline status (all engines). |
| `GET` | `/api/v1/enterprise/ml/anomalies` | viewer | ml-detection | Recent anomalies (limit param). |
| `GET` | `/api/v1/enterprise/ml/alerts` | viewer | ml-detection | ML alerts with MITRE mapping. |
| `GET` | `/api/v1/enterprise/ml/suggestions` | viewer | ml-detection | Pending rule suggestions. |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/approve` | operator | ml-detection | Approve suggestion. |
| `POST` | `/api/v1/enterprise/ml/suggestions/{id}/reject` | operator | ml-detection | Reject suggestion. |
| `POST` | `/api/v1/enterprise/ml/feedback` | operator | ml-detection | Submit FP/TP feedback. |
| `GET` | `/api/v1/enterprise/ml/feedback/stats` | viewer | ml-detection | Feedback statistics. |
| `GET` | `/api/v1/enterprise/ml/training-data` | viewer | ml-detection | Export labeled dataset. |
| `POST` | `/api/v1/enterprise/ml/model/reload` | operator | ml-detection | Hot-swap ONNX model. |
| `GET` | `/api/v1/enterprise/ml/ewma/status` | viewer | ml-detection | EWMA engine status. |
| `POST` | `/api/v1/enterprise/ml/ewma/reset` | operator | ml-detection | Reset EWMA state. |
| `POST` | `/api/v1/enterprise/ml/cusum/reset` | operator | ml-detection | Reset CUSUM state. |

**Example: `GET /api/v1/enterprise/ml/status`**

```json
{
  "baseline_learning": false,
  "baseline_sample_count": 10080,
  "learning_days_configured": 7,
  "anomaly_count": 42,
  "suggestion_count": 3,
  "feedback_count": 17,
  "model_loaded": true,
  "model_engine": "onnx-runtime",
  "model_warmed_up": true,
  "model_sample_count": 3412,
  "anomaly_threshold": 2.0,
  "ewma_enabled": true,
  "ewma_warmed_up": true,
  "ewma_sample_count": 10080,
  "cusum_enabled": true,
  "cusum_active_drifts": 1,
  "cusum_sample_count": 10080
}
```

`model_engine` names the inference engine holding the model: `onnx-runtime`
while one is loaded, `none` when none is. `model_loaded` says a model is in
memory; `model_warmed_up` says it is contributing to the fusion. A model loaded seconds ago reports `true` and `false` respectively, and scores nothing until `model_sample_count` reaches the configured `ewma_warmup_samples`.

### Streaming Algorithm Endpoints

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/ml/heavy-hitters` | viewer | ml-detection | Top-K heavy hitters by byte volume. |
| `GET` | `/api/v1/enterprise/ml/beaconing` | viewer | ml-detection | Active C2 beaconing suspects. |
| `GET` | `/api/v1/enterprise/ml/rcf/scores` | viewer | ml-detection | Recent Random Cut Forest anomaly scores. |
| `GET` | `/api/v1/enterprise/ml/rcf/attribution` | viewer | ml-detection | Per-feature attribution of an RCF anomaly score for a queried feature vector. |
| `GET` | `/api/v1/enterprise/ml/rcf/queue` | viewer | ml-detection | Anomalies ranked by calibrated probability, each with its explanation and group. |
| `GET` | `/api/v1/enterprise/ml/rcf/status` | viewer | ml-detection | Pool occupancy and memory cost, threshold state, calibration state, open groups. |
| `POST` | `/api/v1/enterprise/ml/rcf/groups/{group_id}/reject` | operator | ml-detection | Say an alert group was wrongly collapsed. Tightens the bar the next group needs. |

### DNS Entropy Endpoints

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/dns/dga-scores` | viewer | ml-detection | Recent DGA scores. |
| `GET` | `/api/v1/enterprise/dns/dga-scores/{domain}` | viewer | ml-detection | Score a domain on demand. |
| `POST` | `/api/v1/enterprise/dns/allowlist` | operator | ml-detection | Add allowlist pattern. |
| `DELETE` | `/api/v1/enterprise/dns/allowlist/{pattern}` | operator | ml-detection | Remove pattern. |

### TLS Clustering Endpoint

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/tls-intelligence/clusters` | viewer | tls-intelligence | Fingerprint clusters with centroids and labels. |

---

## Feature Gating

ML Anomaly Detection requires a valid license with the `ml-detection` feature.
Gating is by route merge rather than by a check inside the handler: without the
feature the ML routes are never mounted, so every ML path answers `404 Not
Found` rather than `402 Payment Required`.
