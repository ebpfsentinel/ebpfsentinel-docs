# TLS Intelligence & PQC Compliance

> **Edition: Enterprise** | **Status: Shipped** | **License Feature: `tls-intelligence`**

## Overview

TLS Intelligence provides deep visibility into TLS handshake metadata across the network. It fingerprints clients and servers using JA4+ hashes, detects anomalous TLS behavior via statistical rarity scoring, tracks post-quantum cryptography adoption, and enforces cipher/protocol compliance policies. All analysis operates on handshake metadata extracted by eBPF -- no decryption required.

Four sub-capabilities:

| Capability | Description |
|-----------|-------------|
| JA4+ Threat Database | Fingerprint-based threat detection with 20+ built-in C2/malware signatures |
| TLS Behavior Anomaly | Statistical rarity scoring of TLS fingerprints over a sliding window |
| PQC Compliance Detection | Track ML-KEM and hybrid key exchange adoption per destination |
| Cipher/Protocol Compliance | Enforce minimum TLS versions, block weak ciphers and signature algorithms |

## JA4+ Threat Database

20+ built-in threat fingerprint entries covering common offensive tools:

| Category | Tools |
|----------|-------|
| C2 frameworks | Cobalt Strike, Metasploit, Sliver, Havoc, Mythic, Brute Ratel |
| RATs | AsyncRAT, Quasar RAT, DarkComet, NanoCore, njRAT |
| Loaders/Droppers | IcedID, QakBot, BumbleBee, Emotet |
| Implants | Merlin, PoshC2, Covenant, SilentTrinity |
| Tunneling | Chisel, ligolo-ng |

Each entry contains:

| Field | Description |
|-------|-------------|
| `id` | Unique threat identifier |
| `ja4_hash` | JA4+ fingerprint hash |
| `name` | Human-readable threat name |
| `category` | Threat category (c2, rat, loader, implant, tunneling) |
| `severity` | Alert severity (critical, high, medium, low) |
| `description` | Contextual description of the threat |
| `mitre_technique` | Associated MITRE ATT&CK technique ID |

### Custom Threat Entries

Add organization-specific or emerging threat fingerprints:

```yaml
enterprise:
  tls_intelligence:
    threat_db:
      custom_entries:
        - id: custom-c2-001
          ja4_hash: "t13d1516h2_8daaf6152771_e5627efa2ab1"
          name: Internal Red Team Implant
          category: c2
          severity: high
          description: Custom C2 used by internal red team
          mitre_technique: T1573.002
```

### Allowlist

Suppress false positives for known-good fingerprints:

```yaml
enterprise:
  tls_intelligence:
    threat_db:
      allowlist:
        - ja4_hash: "t13d1516h2_8daaf6152771_e5627efa2ab1"
          reason: "Internal monitoring tool"
        - ja4_hash: "t13d1517h2_a]b3c4d5e6f7_1234567890ab"
          reason: "Vendor health-check agent"
```

Allowlisted fingerprints are skipped during threat matching. The allowlist is evaluated before the threat database.

### API

```
GET    /api/v1/enterprise/tls-intelligence/threats
POST   /api/v1/enterprise/tls-intelligence/threats
DELETE /api/v1/enterprise/tls-intelligence/threats/{id}
GET    /api/v1/enterprise/tls-intelligence/threats/matches
GET    /api/v1/enterprise/tls-intelligence/threats/allowlist
PUT    /api/v1/enterprise/tls-intelligence/threats/allowlist
```

## TLS Behavior Anomaly

Statistical rarity scoring detects unusual TLS fingerprints that may indicate novel malware, misconfigured clients, or tunneling tools not yet in the threat database.

### Rarity Score

For each observed JA4+ fingerprint, the rarity score is calculated as:

```
rarity = 1.0 - (occurrences / total_handshakes)
```

A fingerprint seen once out of 100,000 handshakes has a rarity score of 0.99999. Common browsers (Chrome, Firefox) typically score below 0.001.

### Sliding Window

Observations are tracked over a **7-day sliding window**. Expired entries are garbage-collected every 60 seconds. The window ensures that scores adapt to traffic pattern changes and do not accumulate stale data indefinitely.

### Alert Threshold

Fingerprints with a rarity score above the configured threshold generate anomaly alerts:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rarity_threshold` | `0.01` | Minimum rarity score to trigger an alert |
| `window_days` | `7` | Sliding window duration in days |
| `min_total_handshakes` | `1000` | Minimum handshakes before scoring activates |

Setting `rarity_threshold` to `0.001` reduces noise in high-traffic environments. Setting it to `0.1` is more aggressive and catches moderately uncommon fingerprints.

```yaml
enterprise:
  tls_intelligence:
    behavior_anomaly:
      rarity_threshold: 0.01
      window_days: 7
      min_total_handshakes: 1000
```

### API

```
GET /api/v1/enterprise/tls-intelligence/anomalies
GET /api/v1/enterprise/tls-intelligence/anomalies/stats
GET /api/v1/enterprise/tls-intelligence/fingerprints
```

## PQC Compliance Detection

Tracks adoption of post-quantum key exchange groups across the network. Identifies which destinations negotiate ML-KEM (NIST FIPS 203) groups and which remain on classical-only key exchange.

### Tracked Key Exchange Groups

| Code Point | Name | Type |
|------------|------|------|
| `0x0200` | ML-KEM-512 | Post-quantum |
| `0x0201` | ML-KEM-768 | Post-quantum |
| `0x0202` | ML-KEM-1024 | Post-quantum |
| `0x6399` | X25519MLKEM768 | Hybrid (classical + PQ) |
| `0x639A` | SecP256r1MLKEM768 | Hybrid (classical + PQ) |
| `0x639B` | SecP384r1MLKEM1024 | Hybrid (classical + PQ) |

### Per-Destination Breakdown

For each destination (IP or SNI), the engine tracks:

| Field | Description |
|-------|-------------|
| `total_handshakes` | Total observed TLS handshakes |
| `pqc_handshakes` | Handshakes negotiating a PQ or hybrid group |
| `classical_handshakes` | Handshakes using classical-only key exchange |
| `compliance_ratio` | `pqc_handshakes / total_handshakes` (0.0 to 1.0) |
| `groups_seen` | Set of key exchange group code points observed |

### Compliance Reporting

The compliance ratio enables tracking PQC migration progress:

- **1.0**: fully PQC-compliant destination
- **0.0**: no PQC support observed
- **0.0 < ratio < 1.0**: mixed deployment (e.g., partial rollout or client diversity)

```yaml
enterprise:
  tls_intelligence:
    pqc_compliance:
      enabled: true
      report_classical_only: true    # alert on destinations with ratio 0.0
      min_handshakes: 100            # minimum handshakes before reporting
```

### API

```
GET /api/v1/enterprise/tls-intelligence/pqc/summary
GET /api/v1/enterprise/tls-intelligence/pqc/destinations
```

## Cipher/Protocol Compliance

Enforces organizational policies on TLS protocol versions, cipher suites, and signature algorithms.

### Weak Cipher Blocking

Default weak cipher list (blocked unless overridden):

| Cipher Category | Examples |
|----------------|----------|
| NULL | TLS_NULL_WITH_NULL_NULL, TLS_RSA_WITH_NULL_SHA |
| RC4 | TLS_RSA_WITH_RC4_128_SHA, TLS_RSA_WITH_RC4_128_MD5 |
| DES | TLS_RSA_WITH_DES_CBC_SHA |
| 3DES | TLS_RSA_WITH_3DES_EDE_CBC_SHA |
| Export | TLS_RSA_EXPORT_WITH_RC4_40_MD5, TLS_RSA_EXPORT_WITH_DES40_CBC_SHA |

Custom blocked ciphers can be added. The blocked list is matched against the negotiated cipher suite in the ServerHello.

### Minimum TLS Version

| Setting | Default | Description |
|---------|---------|-------------|
| `min_tls_version` | `tls_1_2` | Minimum acceptable TLS version |

Connections negotiating a version below the minimum generate a compliance violation alert. Supported values: `tls_1_0`, `tls_1_1`, `tls_1_2`, `tls_1_3`.

### Blocked Signature Algorithms

Block specific signature algorithms in the handshake:

```yaml
enterprise:
  tls_intelligence:
    cipher_compliance:
      blocked_signature_algorithms:
        - md5_rsa
        - sha1_rsa
        - sha1_ecdsa
```

### Full Configuration

```yaml
enterprise:
  tls_intelligence:
    cipher_compliance:
      min_tls_version: tls_1_2
      blocked_ciphers:
        - TLS_RSA_WITH_RC4_128_SHA
        - TLS_RSA_WITH_3DES_EDE_CBC_SHA
      blocked_cipher_categories:
        - "null"
        - rc4
        - des
        - 3des
        - export
      blocked_signature_algorithms:
        - md5_rsa
        - sha1_rsa
      custom_blocked_ciphers:
        - cipher_id: 0x002F
          name: TLS_RSA_WITH_AES_128_CBC_SHA
          reason: "No forward secrecy"
```

### API

```
GET /api/v1/enterprise/tls-intelligence/compliance/policy
PUT /api/v1/enterprise/tls-intelligence/compliance/policy
GET /api/v1/enterprise/tls-intelligence/compliance/violations
```

## TLS Behavioral Scoring

Advanced behavioral analysis extending the core E13 sub-capabilities with 7 detection engines:

### Cipher Downgrade Detection

Tracks per-destination cipher baselines. When a client that always used TLS 1.3+AES-GCM to a destination suddenly offers TLS 1.2+RC4, an alert fires. Configurable warmup period (default 10 observations) prevents false positives during baseline learning.

### JA4S ServerHello Fingerprinting

Server-side fingerprinting complements client-side JA4. Tracks JA4S per SNI and detects server fingerprint changes (certificate rotation, compromise, MITM). Available as OSS (`compute_ja4s()`) and enterprise (server fingerprint change tracking).

### SNI / Certificate Mismatch Detection

When the TLS proxy intercepts a connection, the upstream server certificate CN/SAN is checked against the ClientHello SNI. Mismatches (e.g., SNI `api.example.com` but cert for `evil.com`) trigger alerts. Supports wildcard matching (`*.example.com`). Requires `x509-parser` for cert parsing.

### Session Resumption Anomaly Tracking

Tracks TLS session ticket reuse across destinations. If the same session ticket hash appears at 3+ different destinations within 1 hour, a lateral movement alert fires. The `session_id` from the ClientHello is hashed for privacy-preserving tracking.

### Beaconing-TLS Bridge

Feeds ClientHello timestamps into the existing C2 beaconing detector. Key: `(src, dst, ja4)` — same TLS fingerprint to the same destination at regular intervals = potential C2 beacon. Uses periodicity estimation with variance thresholds.

### ONNX TLS Feature Extraction

Vectorizes ClientHello into an 8-dimensional feature vector (cipher set hash, extension set hash, groups hash, ALPN hash, TLS version, dst port, cipher count, extension count) and feeds the existing ONNX inference engine. Anomaly scores above the configured threshold generate alerts.

### Peer-Group Rarity (Container-Aware)

Instead of global rarity scoring, clusters fingerprints by peer group (container image + namespace). A binary that deviates from its peer group triggers an alert even if the JA4 is globally common. Requires container resolver integration for `cgroup_id` → pod → image mapping.

### Configuration

```yaml
enterprise:
  tls_intelligence:
    cipher_baseline:
      enabled: true
      warmup_observations: 10
    beaconing_bridge:
      enabled: true
    ml:
      model_path: /etc/ebpfsentinel/tls-anomaly.onnx
      anomaly_threshold: 0.7
    peer_group_rarity:
      enabled: true
      min_group_observations: 50
```

### API

```
GET /api/v1/enterprise/tls-intelligence/cipher-downgrades
GET /api/v1/enterprise/tls-intelligence/server-fingerprints
GET /api/v1/enterprise/tls-intelligence/sni-cert-mismatches
GET /api/v1/enterprise/tls-intelligence/session-anomalies
GET /api/v1/enterprise/tls-intelligence/ml/status
GET /api/v1/enterprise/tls-intelligence/peer-groups/status
```

## MITRE ATT&CK Coverage

| Capability | Technique | Name | Tactic |
|-----------|-----------|------|--------|
| JA4+ Threat DB | T1573.002 | Encrypted Channel: Asymmetric Cryptography | command-and-control |
| Behavior Anomaly | T1071.001 | Application Layer Protocol: Web Protocols | command-and-control |
| PQC Compliance | T1573.001 | Encrypted Channel: Symmetric Cryptography | command-and-control |
| Cipher Compliance | T1600.001 | Weaken Encryption: Reduce Key Space | defense-evasion |
| Cipher Downgrade | T1573.001 | Encrypted Channel: Symmetric Cryptography | command-and-control |
| SNI/Cert Mismatch | T1557 | Adversary-in-the-Middle | credential-access |
| Session Resumption | T1550 | Use Alternate Authentication Material | defense-evasion |
| Peer-Group Anomaly | T1071.001 | Application Layer Protocol: Web Protocols | command-and-control |

## Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `tls_threat_entries_loaded` | Gauge | -- |
| `tls_threat_matches` | Counter | threat_id, category |
| `tls_threat_allowlist_hits` | Counter | -- |
| `tls_anomaly_alerts` | Counter | -- |
| `tls_anomaly_fingerprints_tracked` | Gauge | -- |
| `tls_anomaly_total_handshakes` | Counter | -- |
| `tls_pqc_handshakes` | Counter | group |
| `tls_pqc_classical_handshakes` | Counter | -- |
| `tls_compliance_violations` | Counter | violation_type |
| `tls_compliance_checks` | Counter | -- |
| `tls_cipher_downgrade_detected` | Counter | -- |
| `tls_sni_cert_mismatch` | Counter | -- |
| `tls_session_resume_anomaly` | Counter | -- |
| `tls_ml_inference` | Counter | -- |
| `tls_ml_anomaly` | Counter | -- |
| `tls_peer_group_anomaly` | Counter | -- |
| `tls_peer_groups_tracked` | Gauge | -- |

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/enterprise/tls-intelligence/threats` | List all threat fingerprint entries |
| `POST` | `/api/v1/enterprise/tls-intelligence/threats` | Add custom threat entry |
| `DELETE` | `/api/v1/enterprise/tls-intelligence/threats/{id}` | Remove threat entry |
| `GET` | `/api/v1/enterprise/tls-intelligence/threats/matches` | List threat match detections |
| `GET` | `/api/v1/enterprise/tls-intelligence/threats/allowlist` | Get allowlist entries |
| `PUT` | `/api/v1/enterprise/tls-intelligence/threats/allowlist` | Update allowlist |
| `GET` | `/api/v1/enterprise/tls-intelligence/anomalies` | List behavior anomaly alerts |
| `GET` | `/api/v1/enterprise/tls-intelligence/anomalies/stats` | Anomaly detection statistics |
| `GET` | `/api/v1/enterprise/tls-intelligence/fingerprints` | List tracked fingerprints with rarity scores |
| `GET` | `/api/v1/enterprise/tls-intelligence/pqc/summary` | PQC compliance summary |
| `GET` | `/api/v1/enterprise/tls-intelligence/pqc/destinations` | Per-destination PQC breakdown |
| `GET` | `/api/v1/enterprise/tls-intelligence/compliance/policy` | Get cipher/protocol compliance policy |
| `PUT` | `/api/v1/enterprise/tls-intelligence/compliance/policy` | Update compliance policy |
| `GET` | `/api/v1/enterprise/tls-intelligence/compliance/violations` | List compliance violations |
| `GET` | `/api/v1/enterprise/tls-intelligence/status` | Overall TLS intelligence status |
| `GET` | `/api/v1/enterprise/tls-intelligence/cipher-downgrades` | List cipher downgrade detections |
| `GET` | `/api/v1/enterprise/tls-intelligence/server-fingerprints` | List server fingerprint changes |
| `GET` | `/api/v1/enterprise/tls-intelligence/sni-cert-mismatches` | List SNI/cert mismatch detections |
| `GET` | `/api/v1/enterprise/tls-intelligence/session-anomalies` | List session resumption anomalies |
| `GET` | `/api/v1/enterprise/tls-intelligence/ml/status` | TLS ML inference status |
| `GET` | `/api/v1/enterprise/tls-intelligence/peer-groups/status` | Peer-group rarity status |

## Configuration

Complete configuration example:

```yaml
enterprise:
  tls_intelligence:
    enabled: true

    # JA4+ Threat Database
    threat_db:
      custom_entries:
        - id: custom-c2-001
          ja4_hash: "t13d1516h2_8daaf6152771_e5627efa2ab1"
          name: Internal Red Team Implant
          category: c2
          severity: high
          description: Custom C2 framework fingerprint
          mitre_technique: T1573.002
      allowlist:
        - ja4_hash: "t13d1516h2_8daaf6152771_e5627efa2ab1"
          reason: "Known monitoring tool"

    # TLS Behavior Anomaly
    behavior_anomaly:
      rarity_threshold: 0.01
      window_days: 7
      min_total_handshakes: 1000

    # PQC Compliance Detection
    pqc_compliance:
      enabled: true
      report_classical_only: true
      min_handshakes: 100

    # Cipher/Protocol Compliance
    cipher_compliance:
      min_tls_version: tls_1_2
      blocked_cipher_categories:
        - "null"
        - rc4
        - des
        - 3des
        - export
      custom_blocked_ciphers:
        - cipher_id: 0x002F
          name: TLS_RSA_WITH_AES_128_CBC_SHA
          reason: "No forward secrecy"
      blocked_signature_algorithms:
        - md5_rsa
        - sha1_rsa
        - sha1_ecdsa

    # Cipher Downgrade Detection (E20)
    cipher_baseline:
      enabled: true
      warmup_observations: 10

    # Beaconing-TLS Bridge (E20)
    beaconing_bridge:
      enabled: true

    # ML Anomaly Detection (E20)
    ml:
      model_path: /etc/ebpfsentinel/tls-anomaly.onnx
      anomaly_threshold: 0.7

    # Peer-Group Rarity (E20)
    peer_group_rarity:
      enabled: true
      min_group_observations: 50
```

## Feature Gating

TLS Intelligence requires a valid license with the `tls-intelligence` feature. Without a license, all TLS intelligence endpoints return 404 and no fingerprint analysis, anomaly detection, PQC tracking, or compliance checking occurs.
