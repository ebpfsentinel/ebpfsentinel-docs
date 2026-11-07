# JA4 TLS Fingerprinting

eBPFsentinel computes the JA4 fingerprint of TLS ClientHello messages, enabling identification of clients by their TLS behavior without decrypting traffic.

The fingerprint follows the [JA4 method by FoxIO](https://github.com/FoxIO-LLC/ja4), which is licensed BSD 3-Clause. Only the client fingerprint is computed: the other methods FoxIO publishes beside it (for servers, HTTP, certificates, SSH, latency and TCP) are under a different licence and are not implemented.

## How It Works

1. The existing L7 payload capture (TC classifier, 512 bytes) intercepts TLS ClientHello messages
2. The userspace parser extracts every field JA4 reads: TLS version, cipher suites, extensions, supported groups, signature algorithms, ALPN protocols, supported versions
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

## Session ID Tracking

The `TlsClientHello` struct includes an optional `session_id` field parsed from the ClientHello. The enterprise TLS intelligence engine uses it for session resumption anomaly tracking (detecting ticket reuse across multiple destinations).

## Alert Enrichment

Alerts for TLS-based connections are enriched with `ja4_fingerprint` when the flow is in the fingerprint cache. The cache stores up to 10,000 fingerprints with a 5-minute TTL.

## Metrics

`ebpfsentinel_fingerprints_seen_total` counts the ClientHellos the pipeline
fingerprinted. The JA4 value is deliberately not a label: it is derived from
bytes the client chose, so a series per value is an unbounded label set a peer
controls. The values themselves are read per flow from the cache below.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/fingerprints/summary` | State of the JA4 client cache |

It answers four fields, read off the running cache rather than off a
constant: `cached_count` (entries held right now, not since start, since they
expire), `max_size` and `ttl_seconds` (the ceiling and the lifetime that cache
was built with, 10,000 and 300 in the shipped configuration), and `persistent`,
which says whether the cache is mirrored to a store that survives a restart.

The route returns no fingerprint. A JA4 value is derived from bytes a peer
chose, so it is read per flow off an alert's `ja4_fingerprint` rather than
listed, for the same reason it is not a metric label.

`cached_count` at zero has more than one explanation - nothing captured, or a
cache that expired - so read it next
to `l7.ports`, `l7.enabled` and `ids.enabled`, which are what decide whether a
payload reaches the parser at all.

## CLI

```bash
# The JA4 client cache
ebpfsentinel-agent fingerprints summary
```

It prints the same four lines, persistence included, so a cache that fell back
to memory because its store would not open is visible.

