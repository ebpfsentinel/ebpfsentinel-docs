# JA4+ TLS Fingerprinting

eBPFsentinel extracts [JA4+](https://github.com/FoxIO-LLC/ja4) fingerprints from TLS ClientHello messages, enabling identification of clients by their TLS behavior without decrypting traffic.

## How It Works

1. The existing L7 payload capture (TC classifier, 512 bytes) intercepts TLS ClientHello messages
2. The userspace parser extracts all JA4+ fields: TLS version, cipher suites, extensions, supported groups, signature algorithms, ALPN protocols, supported versions
3. GREASE values (RFC 8701) are filtered automatically
4. The JA4 hash is computed per the FoxIO specification and cached per flow tuple

## JA4 Hash Format

```
t13d0305h2_8daaf6152771_02713d6af862
│││ ││││││  │              │
││╰─╯│││╰╰──╰── Section b: SHA-256 of sorted cipher suites (12 hex chars)
││   │││         Section c: SHA-256 of sorted extensions + sig algs (12 hex chars)
││   ││╰── ALPN hint (first+last char of first ALPN, or "00")
││   │╰── Extension count (2 digits)
││   ╰── Cipher suite count (2 digits)
│╰── SNI indicator: d (domain) or i (IP/absent)
╰── TLS version: 13, 12, 11, 10
t = TCP protocol
```

## Extracted Fields

| Field | Source |
|-------|--------|
| `record_version` | TLS record header |
| `handshake_version` | ClientHello handshake version |
| `cipher_suites` | ClientHello cipher suite list |
| `extension_types` | Extension type IDs in order |
| `supported_groups` | Extension 0x000A (named curves) |
| `signature_algorithms` | Extension 0x000D |
| `alpn_protocols` | Extension 0x0010 |
| `supported_versions` | Extension 0x002B (TLS 1.3 negotiation) |

## JA4S ServerHello Fingerprinting

JA4S complements client-side JA4 by fingerprinting the server's `ServerHello` response. Available in the OSS domain crate (`compute_ja4s()`).

### JA4S Hash Format

```
t1302_1301_abcdef012345
│││││ │     │
││╰╰╰─╰─── Section b: selected cipher (4 hex chars)
││          Section c: SHA-256 of sorted extensions (12 hex chars)
│╰── Extension count (2 digits)
╰── TLS version
t = TCP protocol
```

### Extracted Fields

| Field | Source |
|-------|--------|
| `selected_cipher` | ServerHello selected cipher suite |
| `selected_version` | ServerHello protocol version |
| `extensions` | ServerHello extension type IDs |
| `selected_group` | KeyShare or ServerKeyExchange group |

The enterprise TLS intelligence engine tracks JA4S per SNI and alerts when a server's fingerprint changes from its established baseline (e.g., certificate rotation, compromise, or MITM).

## Session ID Tracking

The `TlsClientHello` struct includes an optional `session_id` field parsed from the ClientHello. The enterprise TLS intelligence engine uses it for session resumption anomaly tracking (detecting ticket reuse across multiple destinations).

## Alert Enrichment

Alerts for TLS-based connections are enriched with `ja4_fingerprint` when the flow is in the fingerprint cache. The cache stores up to 10,000 fingerprints with a 5-minute TTL.

## API

```
GET /api/v1/fingerprints/summary
```

Returns the current cache size and configuration.

## CLI

```bash
ebpfsentinel fingerprints summary
```
