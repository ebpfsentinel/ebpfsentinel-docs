# TLS Intelligence & PQC Compliance

> **Edition: Enterprise** | **Status: Shipped** | **License Feature: `tls-intelligence`**

## Overview

TLS Intelligence provides deep visibility into TLS handshake metadata across the network. It fingerprints clients and servers using JA4+ hashes, detects anomalous TLS behavior via statistical rarity scoring, tracks post-quantum cryptography adoption, and enforces cipher/protocol compliance policies. All analysis operates on handshake metadata extracted by eBPF -- no decryption required.

Four sub-capabilities:

| Capability | Story | Description |
|-----------|-------|-------------|
| JA4+ Threat Database | E13.1 | Fingerprint-based threat detection with 20+ built-in C2/malware signatures |
| TLS Behavior Anomaly | E13.2 | Statistical rarity scoring of TLS fingerprints over a sliding window |
| PQC Compliance Detection | E13.3 | Track ML-KEM and hybrid key exchange adoption per destination |
| Cipher/Protocol Compliance | E13.4 | Enforce minimum TLS versions, block weak ciphers and signature algorithms |

## JA4+ Threat Database (E13.1)

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

## TLS Behavior Anomaly (E13.2)

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

## PQC Compliance Detection (E13.3)

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

## Cipher/Protocol Compliance (E13.4)

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

## MITRE ATT&CK Coverage

| Story | Technique | Name | Tactic |
|-------|-----------|------|--------|
| E13.1 JA4+ Threat DB | T1573.002 | Encrypted Channel: Asymmetric Cryptography | command-and-control |
| E13.2 Behavior Anomaly | T1071.001 | Application Layer Protocol: Web Protocols | command-and-control |
| E13.3 PQC Compliance | T1573.001 | Encrypted Channel: Symmetric Cryptography | command-and-control |
| E13.4 Cipher Compliance | T1600.001 | Weaken Encryption: Reduce Key Space | defense-evasion |

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

## Configuration

Complete configuration example:

```yaml
enterprise:
  tls_intelligence:
    enabled: true

    # E13.1 - JA4+ Threat Database
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

    # E13.2 - TLS Behavior Anomaly
    behavior_anomaly:
      rarity_threshold: 0.01
      window_days: 7
      min_total_handshakes: 1000

    # E13.3 - PQC Compliance Detection
    pqc_compliance:
      enabled: true
      report_classical_only: true
      min_handshakes: 100

    # E13.4 - Cipher/Protocol Compliance
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
```

## Feature Gating

TLS Intelligence requires a valid license with the `tls-intelligence` feature. Without a license, all TLS intelligence endpoints return 404 and no fingerprint analysis, anomaly detection, PQC tracking, or compliance checking occurs.
