# Post-Quantum TLS

eBPFsentinel supports X25519MLKEM768 hybrid post-quantum key exchange for all TLS connections, protecting against "harvest now, decrypt later" quantum attacks.

## How It Works

The agent uses [aws-lc-rs](https://github.com/aws/aws-lc-rs) as its cryptographic provider, which supports ML-KEM (FIPS 203) hybrid key exchange. The PQ-aware `CryptoProvider` is installed at startup and applies to both directions, with the per-direction differences described under [Outbound TLS](#outbound-tls):

- **Inbound TLS**: REST API (axum/tokio-rustls) and gRPC (tonic) servers
- **Outbound TLS**: CTI feed downloads, OIDC JWKS fetch, webhook delivery, SMTP email alerts

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

## Verification

Check the negotiated key exchange group in the TLS handshake:

```bash
openssl s_client -connect localhost:8080 2>&1 | grep "Server Temp Key"
# Expected: Server Temp Key: X25519MLKEM768
```
