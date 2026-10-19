# Post-Quantum TLS

eBPFsentinel supports X25519MLKEM768 hybrid post-quantum key exchange for all TLS connections, protecting against "harvest now, decrypt later" quantum attacks.

## How It Works

The agent uses [aws-lc-rs](https://github.com/aws/aws-lc-rs) as its cryptographic provider, which supports ML-KEM (FIPS 203) hybrid key exchange. The PQ-aware `CryptoProvider` is installed at startup and applies to both directions, with the per-direction differences described under [Outbound TLS](#outbound-tls):

- **Inbound TLS**: the REST API, the gRPC listener, and on the enterprise layer the high-availability and federation mTLS listeners
- **Outbound TLS**: CTI feed downloads, OIDC JWKS fetch, webhook delivery, SMTP email alerts, syslog and SIEM export, and the mTLS calls an agent makes to its peers

Every one of those surfaces builds its key exchange from the same `pq_mode`,
rather than from whichever provider happened to be installed first. The gRPC
listener terminates TLS itself for that reason: a server built from the
process-wide default would have offered the outbound group ordering, so
`require` would have been accepted on the way in and not enforced.

## Configuration

```yaml
agent:
  tls:
    enabled: true
    cert_path: /etc/ebpfsentinel/server.crt
    key_path: /etc/ebpfsentinel/server.key
    pq_mode: prefer
```

### PQ Mode

| Mode | Inbound key exchange groups | Use Case |
|------|---------------------------|----------|
| `prefer` (default) | X25519MLKEM768 > X25519 > secp256r1 | Production -- PQ when client supports it, classical fallback |
| `require` | X25519MLKEM768 only | High-security / government -- rejects non-PQ clients |
| `disable` | X25519 > secp256r1 | Compatibility with legacy clients |

The hybrid group exists only in TLS 1.3, so `require` cannot be combined with
`allow_tls12: true` -- that pair leaves a TLS 1.2 client no usable key exchange
and is rejected when the configuration is read. See
[TLS configuration](../configuration/tls.md).

## What Is Protected

| Component | PQ Status |
|-----------|-----------|
| TLS key exchange (inbound + outbound) | X25519MLKEM768 hybrid |
| JWT authentication (RS256) | Classical -- TLS PQ protects transport |
| Symmetric crypto (AES-256-GCM, SHA-256) | Quantum-safe already |
| License signing (enterprise) | Ed25519, dual-signed with ML-DSA-65 |

## Outbound TLS

The PQ `CryptoProvider` is installed globally at startup, before any HTTP or SMTP client is created. This means:

- `reqwest` HTTP clients (CTI feeds, webhooks, OIDC, GeoIP) inherit PQ automatically
- `lettre` SMTP client (email alerts) inherits PQ via `tokio1-rustls-tls`
- No per-client configuration needed

Outbound connections follow `pq_mode` with one deliberate exception: `require`
is an inbound admission policy, and the servers the agent dials are not its
clients. Offering `X25519MLKEM768` alone on the way out would make every feed,
webhook and identity provider without hybrid key exchange unreachable, so
outbound keeps the `prefer` ordering -- hybrid first, classical fallback --
while the listener still rejects non-PQ clients. `disable` is a statement about
PQ itself rather than about inbound clients, so it removes the hybrid group in
both directions.

| `pq_mode` | Inbound | Outbound |
|-----------|---------|----------|
| `prefer` | hybrid first, classical fallback | hybrid first, classical fallback |
| `require` | hybrid only, non-PQ clients rejected | hybrid first, classical fallback |
| `disable` | classical only | classical only |

## Enterprise Surfaces

| Surface | Direction | Groups |
|---------|-----------|--------|
| High-availability replication (mTLS) | Outbound | hybrid first, classical fallback |
| Federation mTLS listener | Inbound | follows `pq_mode`, including `require` |
| Federation and member registration clients | Outbound | hybrid first, classical fallback |
| Syslog, CEF and SIEM export over TLS | Outbound | hybrid first, classical fallback |
| TLS inspection proxy (both halves) | Both | hybrid first, classical fallback |

The inspection proxy is the one surface that never requires the hybrid group.
It stands between a workload and a server neither of which it chose, so
refusing a classical client would not harden the agent, it would stop the
traffic the proxy exists to read.

## What a Client Without Hybrid Support Sees

Under `prefer` and `disable`, nothing: the handshake completes on a classical
group and the connection behaves as it always did.

Under `require`, the server has no key exchange group in common with the client
and the handshake fails. The client sees a TLS alert, not an HTTP status, so
there is no response body and no log line on the client naming post-quantum
anything:

```text
# curl
curl: (35) error:0A000410:SSL routines::ssl/tls alert handshake failure

# openssl s_client
140...:error:...:SSL alert number 40
```

The agent logs the refusal on its side. `grpcurl` and the gRPC clients report
the same failure as a transport error rather than a gRPC status, because the
connection never reaches HTTP/2. An estate that turns `require` on without
checking its clients first should expect exactly this, which is why `prefer`
is the default and `require` is a deliberate statement.

## Verification

Check the negotiated key exchange group in the TLS handshake:

```bash
openssl s_client -connect localhost:8080 2>&1 | grep "Server Temp Key"
# Expected: Server Temp Key: X25519MLKEM768
```

The gRPC listener answers the same question on its own port, with the ALPN
protocol gRPC needs:

```bash
openssl s_client -connect localhost:50051 -alpn h2 2>&1 | grep "Server Temp Key"
# Expected: Server Temp Key: X25519MLKEM768
```

An `openssl` build without ML-KEM support cannot negotiate the hybrid group and
will report a classical one instead - which says what the client can do, not
what the listener offered.
