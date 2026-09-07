# TLS Intelligence & PQC Compliance

> **Edition: Enterprise** | **License Feature: `tls-intelligence`**

## Overview

TLS Intelligence provides deep visibility into TLS handshake metadata across the network. It fingerprints clients and servers using JA4+ hashes, detects anomalous TLS behavior via statistical rarity scoring, tracks post-quantum cryptography adoption, and enforces cipher/protocol compliance policies. All analysis operates on handshake metadata extracted by eBPF -- no decryption required.

Four sub-capabilities:

| Capability | Description |
|-----------|-------------|
| JA4+ Threat Database | Fingerprint-based threat detection with 14 built-in C2, malware and scanner signatures |
| TLS Behavior Anomaly | Statistical rarity scoring of TLS fingerprints over a sliding window |
| PQC Compliance Detection | Track ML-KEM and hybrid key exchange adoption per destination |
| Cipher/Protocol Compliance | Enforce minimum TLS versions, block weak ciphers and signature algorithms |

## JA4+ Threat Database

Fourteen built-in threat fingerprints ship with the agent:

| Category | Entries | Threats |
|----------|---------|---------|
| `c2` | 8 | Cobalt Strike (three versions), Metasploit Meterpreter, Metasploit over TLS 1.2, Sliver, Havoc, Brute Ratel C4 |
| `malware` | 4 | Emotet (two variants), Trickbot, IcedID |
| `scanner` | 2 | Nmap TLS probe, Masscan TLS probe |

The list is short on purpose. A JA4 fingerprint is a truncated SHA-256 of the
handshake, so an entry whose hash was written by hand rather than observed on the
wire matches nothing while still counting towards a number a reader compares.
Every entry above is a fingerprint that can be seen. Two categories the
vocabulary carries, `botnet` and `exploit_tool`, ship no built-in entry today and
exist for entries a deployment adds.

Each entry contains:

| Field | Description |
|-------|-------------|
| `ja4_hash` | JA4+ fingerprint hash (identity of the entry) |
| `threat_name` | Human-readable threat name |
| `category` | One of `c2`, `malware`, `exploit_tool`, `scanner`, `botnet`, `custom` |
| `confidence` | Match confidence 0-100 (default 80) |

A `category` outside that vocabulary is refused by name at startup rather than
filed under `custom`, so a typo in a feed stops the agent instead of producing
entries in a category nobody wrote.

### Custom Threat Entries

Add organization-specific or emerging threat fingerprints:

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  tls_intelligence:
    threat_db:
      custom_entries:
        - ja4_hash: "t13d1516h2_8daaf6152771_e5627efa2ab1"
          threat_name: Internal Red Team Implant
          category: c2                # c2 | malware | exploit_tool | scanner | botnet | custom
          confidence: 90              # 0-100 (default 80)
```

### Allowlist

Suppress false positives for known-good fingerprints:

```yaml
enterprise:
  tls_intelligence:
    threat_db:
      allowlist:                      # plain list of JA4 hashes to exempt
        - "t13d1516h2_8daaf6152771_e5627efa2ab1"
        - "t13d1517h2_ab3c4d5e6f7a_1234567890ab"
```

Allowlisted fingerprints are skipped during threat matching. The allowlist is evaluated before the threat database.

### API

```
GET    /api/v1/enterprise/tls-intelligence/threats
POST   /api/v1/enterprise/tls-intelligence/threats
DELETE /api/v1/enterprise/tls-intelligence/threats/{id}
GET    /api/v1/enterprise/tls-intelligence/threats/matches
```

The allowlist is configuration only. No route reads or writes it, so a change
to it is a configuration change followed by a reload.

## TLS Behavior Anomaly

Statistical rarity scoring detects unusual TLS fingerprints that may indicate novel malware, misconfigured clients, or tunneling tools not yet in the threat database.

### Rarity Score

For each observed JA4+ fingerprint, the rarity score is calculated as:

```
rarity = 1.0 - (occurrences / total_handshakes)
```

The score is the share of the window's handshakes that were **not** this
fingerprint, so it rises as a fingerprint gets rarer. A fingerprint seen once out
of 100,000 handshakes scores 0.99999. A browser fingerprint carrying half the
traffic scores 0.5, and one carrying 99 per cent of it still scores 0.01: a low
score means a fingerprint is most of what the estate does, not that it is a
common browser. In an estate with a dozen client types, everything scores high.

### Sliding Window

Observations are tracked over a **7-day sliding window**. Expired entries are garbage-collected every 60 seconds. The window ensures that scores adapt to traffic pattern changes and do not accumulate stale data indefinitely.

### Alert Threshold

A fingerprint whose rarity score is greater than or equal to the configured
threshold generates an anomaly alert. The comparison is inclusive, so a score
landing exactly on the threshold alerts:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `rarity_threshold` | `0.01` | Rarity score (must be in `(0, 1)`) at or above which a fingerprint alerts |

`rarity_threshold` is the only tunable; the sliding window (7 days) and garbage-collection cadence are fixed internally.

Because the score rises with rarity, **a higher threshold is quieter**. The
default of `0.01` alerts on every fingerprint accounting for less than 99 per
cent of the window's handshakes, which in practice is nearly all of them, so it
is a setting for a first look at an estate rather than one to leave running.
`0.99` alerts on fingerprints under 1 per cent of the handshakes and `0.999` on
those under a tenth of a per cent, which is where a large estate usually ends up.

```yaml
enterprise:
  tls_intelligence:
    anomaly:
      rarity_threshold: 0.01
```

### API

```
GET /api/v1/enterprise/tls-intelligence/anomalies
GET /api/v1/enterprise/tls-intelligence/anomalies/config
PUT /api/v1/enterprise/tls-intelligence/anomalies/config
GET /api/v1/enterprise/tls-intelligence/clusters
```

## PQC Compliance Detection

Tracks adoption of post-quantum key exchange groups across the network. Identifies which destinations negotiate ML-KEM (NIST FIPS 203) groups and which remain on classical-only key exchange.

### Tracked Key Exchange Groups

| Code Point | Name | Type |
|------------|------|------|
| `0x0200` | ML-KEM-512 | Pure post-quantum |
| `0x0201` | ML-KEM-768 | Pure post-quantum |
| `0x0202` | ML-KEM-1024 | Pure post-quantum |
| `0x11EB` | SecP256r1MLKEM768 | Hybrid (classical + PQ) |
| `0x11EC` | X25519MLKEM768 | Hybrid (classical + PQ) |
| `0x11ED` | SecP384r1MLKEM1024 | Hybrid (classical + PQ) |
| `0x6399` | X25519Kyber768Draft00 | Hybrid, retired draft |
| `0x639A` | P256Kyber768Draft00 | Hybrid, retired draft |

The three hybrid code points in the `0x11EB`-`0x11ED` range are what current
clients offer: OpenSSL 3.5, BoringSSL, Chrome and rustls all negotiate
`X25519MLKEM768` at `0x11EC`. The two `0x63xx` entries are the Kyber draft
hybrids that preceded them; they are still tracked because older clients offer
them, and a client offering one has migrated in every sense this report
measures.

### Per-Destination Breakdown

For each destination (IP or SNI), the engine tracks:

| Field | Description |
|-------|-------------|
| `destination` | SNI where the handshake carried one, otherwise the destination address |
| `total` | Total observed TLS handshakes |
| `pqc_count` | Handshakes offering a pure or hybrid post-quantum group |
| `classical_count` | Handshakes offering classical-only key exchange |

The report as a whole carries the same counts across every destination, plus the
split between the two kinds of post-quantum group:

| Field | Description |
|-------|-------------|
| `total` | Total observed TLS handshakes |
| `pqc_compliant` | Handshakes offering a pure or hybrid post-quantum group |
| `classical_only` | Handshakes offering classical-only key exchange |
| `pqc_hybrid` | Of the compliant ones, those offering a hybrid group |
| `pqc_pure` | Of the compliant ones, those offering ML-KEM alone |
| `pqc_percentage` | `pqc_compliant / total` as a percentage |
| `per_destination` | The per-destination breakdown above |

### Compliance Reporting

The compliance ratio enables tracking PQC migration progress:

- **100.0**: every observed handshake offered a post-quantum group
- **0.0**: no post-quantum group observed
- **0.0 < percentage < 100.0**: mixed deployment (e.g., partial rollout or client diversity)

PQC compliance tracking is a single toggle; the per-destination breakdown, ratios and reporting thresholds are computed internally.

```yaml
enterprise:
  tls_intelligence:
    pqc:
      enabled: true
```

### API

```
GET /api/v1/enterprise/tls-intelligence/pqc/report
GET /api/v1/enterprise/tls-intelligence/pqc/connections
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

The policy ships with a default blocked list (the categories above) and is matched against the negotiated cipher suite in the ServerHello. Additional ciphers are blocked by their numeric IANA cipher-suite ID (`blocked_ciphers`), not by name.

### Minimum TLS Version

| Setting | Default | Description |
|---------|---------|-------------|
| `min_tls_version` | `771` (`0x0303`, TLS 1.2) | Minimum acceptable TLS version, as the protocol code point |

Connections negotiating a version below the minimum generate a compliance violation alert. `min_tls_version` is the numeric TLS protocol code point: `769` (`0x0301`, TLS 1.0), `770` (`0x0302`, TLS 1.1), `771` (`0x0303`, TLS 1.2), `772` (`0x0304`, TLS 1.3). Values outside `769`-`772` are rejected at load.

### Blocked Signature Algorithms

Block specific signature algorithms in the handshake:

```yaml
enterprise:
  tls_intelligence:
    crypto_policy:
      blocked_signature_algs:         # numeric SignatureScheme code points
        - 257                         # 0x0101 rsa_pkcs1_md5
        - 513                         # 0x0201 rsa_pkcs1_sha1
        - 515                         # 0x0203 ecdsa_sha1
```

### Full Configuration

```yaml
enterprise:
  tls_intelligence:
    crypto_policy:
      min_tls_version: 771            # 0x0303 = TLS 1.2 (range 769-772)
      blocked_ciphers:                # numeric IANA cipher-suite IDs (extends the default weak list)
        - 5                           # 0x0005 TLS_RSA_WITH_RC4_128_SHA
        - 10                          # 0x000A TLS_RSA_WITH_3DES_EDE_CBC_SHA
        - 47                          # 0x002F TLS_RSA_WITH_AES_128_CBC_SHA (no forward secrecy)
      blocked_signature_algs:         # numeric SignatureScheme code points
        - 257                         # 0x0101 rsa_pkcs1_md5
        - 513                         # 0x0201 rsa_pkcs1_sha1
```

### API

```
GET /api/v1/enterprise/tls-intelligence/crypto/policy
PUT /api/v1/enterprise/tls-intelligence/crypto/policy
GET /api/v1/enterprise/tls-intelligence/crypto/violations
```

## TLS Behavioral Scoring

Advanced behavioral analysis extending the core sub-capabilities with 7 detection engines:

### Cipher Downgrade Detection

Tracks per-destination cipher baselines. When a client that always used TLS 1.3+AES-GCM to a destination suddenly offers TLS 1.2+RC4, an alert fires. Configurable warmup period (default 10 observations) prevents false positives during baseline learning.

### JA4S ServerHello Fingerprinting

Server-side fingerprinting complements client-side JA4. Tracks JA4S per SNI and detects server fingerprint changes (certificate rotation, compromise, MITM). Available as OSS (`compute_ja4s()`) and enterprise (server fingerprint change tracking).

### SNI / Certificate Mismatch Detection

When the TLS proxy intercepts a connection, the upstream server certificate CN/SAN is checked against the ClientHello SNI. Mismatches (e.g., SNI `api.example.com` but cert for `evil.com`) trigger alerts. Supports wildcard matching (`*.example.com`). Requires `x509-parser` for cert parsing.

### Session Resumption Anomaly Tracking

Tracks TLS session ticket reuse across destinations. If the same session ticket hash appears at 3+ different destinations within 1 hour, a lateral movement alert fires. The `session_id` from the ClientHello is hashed for privacy-preserving tracking.

### Beaconing-TLS Bridge

Feeds ClientHello timestamps into the existing C2 beaconing detector. Key: `(src, dst, ja4)` - same TLS fingerprint to the same destination at regular intervals = potential C2 beacon. Uses periodicity estimation with variance thresholds.

### ONNX TLS Feature Extraction

Vectorizes ClientHello into an 8-dimensional feature vector and feeds the existing ONNX inference engine. Anomaly scores above the configured threshold generate alerts.

| # | Feature | How it is computed |
|---|---------|--------------------|
| 0 | Cipher set hash | Offered cipher suites, sorted, folded with FNV-1a 64 and normalized to `[0, 1]` |
| 1 | Extension set hash | Offered extension IDs, same treatment |
| 2 | Groups hash | Supported groups, same treatment |
| 3 | ALPN hash | Offered ALPN protocols, sorted, each folded with its length before its bytes |
| 4 | TLS version | Handshake version, normalized |
| 5 | Destination port | The port the handshake was seen on, normalized |
| 6 | Cipher count | Number of offered cipher suites, normalized |
| 7 | Extension count | Number of offered extensions, normalized |

Two properties of that vector matter when you train a model against it:

- **The four hashes are stable across releases.** They are FNV-1a 64, deliberately not the standard library's default hasher, which carries no cross-release stability guarantee: a model trained on one build would read a different vocabulary on the next and mean nothing. The four values a given ClientHello produces are pinned by a test.
- **The sets are sorted before hashing**, so the same offer in a different order is the same feature, and each ALPN string's length is folded in before its bytes, so `["ab", "c"]` and `["a", "bc"]` do not collapse onto one value.

Feature 5 comes from the `dst_port` on the submitted observation. An estate serving TLS on a port other than 443 must send its real port, or every connection is vectorized as though it went to the same place.

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
| `ebpfsentinel_ent_tls_intel_threat_entries_loaded` | Gauge | - |
| `ebpfsentinel_ent_tls_intel_threat_matches_total` | Counter | `category` |
| `ebpfsentinel_ent_tls_intel_allowlist_skipped_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_anomalies_detected_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_fingerprints_tracked` | Gauge | - |
| `ebpfsentinel_ent_tls_intel_events_processed_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_pqc_connections_total` | Counter | `status` |
| `ebpfsentinel_ent_tls_intel_pqc_compliance_ratio` | Gauge | - |
| `ebpfsentinel_ent_tls_intel_crypto_violations_total` | Counter | `violation_type` |
| `ebpfsentinel_ent_tls_intel_weak_protocol_seen_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_clustering_outliers_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_cipher_downgrades_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_sni_cert_mismatches_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_session_resume_anomalies_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_ml_inferences_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_ml_anomalies_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_peer_group_anomalies_total` | Counter | - |
| `ebpfsentinel_ent_tls_intel_peer_groups_tracked` | Gauge | - |

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/tls-intelligence/threats` | viewer | tls-intelligence | List all threat fingerprint entries. |
| `POST` | `/api/v1/enterprise/tls-intelligence/threats` | operator | tls-intelligence | Add custom threat entry. |
| `DELETE` | `/api/v1/enterprise/tls-intelligence/threats/{id}` | operator | tls-intelligence | Remove threat entry. |
| `GET` | `/api/v1/enterprise/tls-intelligence/threats/matches` | viewer | tls-intelligence | List threat match detections. |
| `GET` | `/api/v1/enterprise/tls-intelligence/anomalies` | viewer | tls-intelligence | List behavior anomaly alerts. |
| `GET` | `/api/v1/enterprise/tls-intelligence/anomalies/config` | viewer | tls-intelligence | Current anomaly detector thresholds. |
| `PUT` | `/api/v1/enterprise/tls-intelligence/anomalies/config` | operator | tls-intelligence | Replace the anomaly detector thresholds. |
| `GET` | `/api/v1/enterprise/tls-intelligence/clusters` | viewer | tls-intelligence | Fingerprint clusters with centroids and labels. |
| `GET` | `/api/v1/enterprise/tls-intelligence/server-fingerprints` | viewer | tls-intelligence | List server fingerprint changes. |
| `GET` | `/api/v1/enterprise/tls-intelligence/pqc/report` | viewer | tls-intelligence | Post-quantum readiness summary for the estate. |
| `GET` | `/api/v1/enterprise/tls-intelligence/pqc/connections` | viewer | tls-intelligence | Connections carrying post-quantum key exchange. |
| `GET` | `/api/v1/enterprise/tls-intelligence/crypto/policy` | viewer | tls-intelligence | Current cryptographic policy. |
| `PUT` | `/api/v1/enterprise/tls-intelligence/crypto/policy` | operator | tls-intelligence | Replace the cryptographic policy. |
| `GET` | `/api/v1/enterprise/tls-intelligence/crypto/violations` | viewer | tls-intelligence | Connections that breached the cryptographic policy. |
| `GET` | `/api/v1/enterprise/tls-intelligence/status` | viewer | tls-intelligence | Overall TLS intelligence status. |
| `GET` | `/api/v1/enterprise/tls-intelligence/cipher-downgrades` | viewer | tls-intelligence | List cipher downgrade detections. |
| `GET` | `/api/v1/enterprise/tls-intelligence/sni-cert-mismatches` | viewer | tls-intelligence | List SNI/cert mismatch detections. |
| `GET` | `/api/v1/enterprise/tls-intelligence/session-anomalies` | viewer | tls-intelligence | List session resumption anomalies. |
| `GET` | `/api/v1/enterprise/tls-intelligence/ml/status` | viewer | tls-intelligence | TLS ML inference status. |
| `GET` | `/api/v1/enterprise/tls-intelligence/peer-groups/status` | viewer | tls-intelligence | Peer-group rarity status. |
| `GET` | `/api/v1/enterprise/tls-intelligence/alerts` | viewer | tls-intelligence | List TLS intelligence alerts. |
| `POST` | `/api/v1/enterprise/tls-intelligence/events` | operator | tls-intelligence | Ingest a TLS handshake observation. |

**Example: `POST /api/v1/enterprise/tls-intelligence/events`**

```json
{
  "ja4": "t13d1516h2_8daaf6152771_e5627efa2ab1",
  "cipher_suites": [4865, 4866, 4867, 49195, 49199],
  "extensions": [0, 11, 10, 35, 16, 43, 51],
  "supported_versions": [772, 771],
  "supported_groups": [29, 23, 24],
  "signature_algorithms": [1027, 2052, 1025],
  "sni": "api.example.com",
  "alpn": ["h2", "http/1.1"],
  "handshake_version": 771,
  "src_addr": [167772162, 0, 0, 0],
  "dst_addr": [167772163, 0, 0, 0],
  "is_ipv6": false,
  "dst_port": 8443,
  "timestamp_ns": 1756900000000000000
}
```

`src_addr` and `dst_addr` are four 32-bit words: an IPv4 address occupies the
first word and the rest are zero, while an IPv6 address fills all four.

`dst_port` is the port the handshake was actually seen on, and it is read by two
things rather than recorded for display: the TLS ML feature vector carries it as
a dimension, and beaconing keys its intervals on the destination endpoint. An
estate whose TLS runs on `8443` and reports `443` is scored and correlated as
though every connection went to the same place. The field defaults to `443` when
omitted, so a submitter written against the earlier shape keeps working and a
caller that genuinely cannot determine the port sends the value the service used
to assume rather than a zero nothing can interpret.

## Configuration

Complete configuration example:

```yaml
enterprise:
  tls_intelligence:
    enabled: true

    # JA4+ Threat Database
    threat_db:
      custom_entries:
        - ja4_hash: "t13d1516h2_8daaf6152771_e5627efa2ab1"
          threat_name: Internal Red Team Implant
          category: c2
          confidence: 90
      allowlist:
        - "t13d1516h2_8daaf6152771_e5627efa2ab1"

    # TLS Behavior Anomaly
    anomaly:
      rarity_threshold: 0.01          # must be in (0, 1)

    # PQC Compliance Detection
    pqc:
      enabled: true

    # Cipher/Protocol Compliance
    crypto_policy:
      min_tls_version: 771            # 0x0303 = TLS 1.2
      blocked_ciphers:                # numeric IANA cipher-suite IDs
        - 5                           # 0x0005 TLS_RSA_WITH_RC4_128_SHA
        - 47                          # 0x002F TLS_RSA_WITH_AES_128_CBC_SHA
      blocked_signature_algs:         # numeric SignatureScheme code points
        - 257                         # 0x0101 rsa_pkcs1_md5
        - 513                         # 0x0201 rsa_pkcs1_sha1

    # Cipher Downgrade Detection
    cipher_baseline:
      enabled: true
      warmup_observations: 10

    # Beaconing-TLS Bridge
    beaconing_bridge:
      enabled: true

    # ML Anomaly Detection
    ml:
      model_path: /etc/ebpfsentinel/tls-anomaly.onnx
      anomaly_threshold: 0.7

    # Peer-Group Rarity
    peer_group_rarity:
      enabled: true
      min_group_observations: 50
```

## Feature Gating

TLS Intelligence requires a valid license with the `tls-intelligence` feature. Without a license, all TLS intelligence endpoints return 404 and no fingerprint analysis, anomaly detection, PQC tracking, or compliance checking occurs.
