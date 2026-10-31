# Network Cryptography

Moving an estate to post-quantum cryptography starts with knowing what it runs
today: which flows already negotiate a hybrid key exchange, which still settle
on a classical curve, and which are below TLS 1.2. The agent reads that off the
handshakes it already sees, without decrypting anything and without a
certificate or a key of the workloads involved.

## How It Works

1. The agent captures the first bytes the server sends on each TLS connection,
   on the ports the [L7 firewall](l7-firewall.md) inspects.
2. From the `ServerHello` it keeps the negotiated version, the selected cipher
   suite and, in TLS 1.3, the key exchange group of the `key_share`.
3. In TLS 1.2 the group is in the `ServerKeyExchange` of an ECDHE suite, and
   the server's certificate travels in clear: the agent reads the leaf
   certificate's validity window from it.
4. Each handshake is kept, newest first, in a log of the last 4096.

A `HelloRetryRequest` is not recorded: it asks the client for another group and
settles nothing, so the handshake that follows it is the one that counts.

## What Each Handshake Says

| Field | Meaning |
|-------|---------|
| Version | `TLS 1.3`, `TLS 1.2`, `TLS 1.1`, `TLS 1.0` or `SSL 3.0` |
| Cipher suite | The IANA name of the selected suite |
| Group | The IANA name of the key exchange group, for example `X25519MLKEM768` or `x25519` |
| Key exchange | `post_quantum_hybrid`, `post_quantum`, `classical`, `rsa_key_transport` or `unknown` |
| Posture | `post_quantum`, `classical` or `legacy_tls` |
| Certificate | The leaf certificate's validity window, or why it is not known |

The posture is `legacy_tls` for anything below TLS 1.2, whatever the exchange.
Otherwise it is `post_quantum` when the group is a hybrid (`X25519MLKEM768`,
`SecP256r1MLKEM768`, `SecP384r1MLKEM1024`, the earlier
`X25519Kyber768Draft00`) or ML-KEM alone, and `classical` in every other case.

`rsa_key_transport` is a TLS 1.2 suite in which the client encrypts the secret
to the server's RSA key: there is no group at all and no forward secrecy, so a
recorded session is readable by whoever obtains that key later.

## The Certificate

The certificate's state is one of three, so that a hole never reads as a
healthy certificate:

| State | Meaning |
|-------|---------|
| `read` | TLS 1.2: `not_before` and `not_after` are the leaf certificate's |
| `not_observable` | TLS 1.3 encrypts the certificate: nothing about it can be read from the wire |
| `not_captured` | TLS 1.2, but the certificate was not in the bytes the agent read. A resumed session sends none |

The window is read from the start of the certificate, so a chain longer than
the capture still gives it as long as the leaf's validity fits.

## What It Does Not See

- A connection whose server flight never crosses an inspected port.
- QUIC, whose handshake is encrypted from the first packet.
- The group of a TLS 1.2 handshake whose `ServerKeyExchange` lies beyond the
  bytes captured, reported without a group and as `unknown` rather than
  guessed.

## Reading It

```bash
ebpfsentinel-agent tls handshakes
ebpfsentinel-agent tls handshakes -n 20 --output json
```

```
CLIENT              SERVER            VERSION  GROUP           CIPHER                                 POSTURE       CERTIFICATE
10.0.4.12:51022     10.0.7.3:443      TLS 1.3  X25519MLKEM768  TLS_AES_128_GCM_SHA256                 post_quantum  not observable (TLS 1.3)
10.0.4.12:40110     10.0.9.20:8443    TLS 1.2  secp256r1       TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256  classical     expires in 41 days
10.0.4.30:39218     10.0.9.44:636     TLS 1.0  -               TLS_RSA_WITH_AES_128_CBC_SHA           legacy_tls    not captured
```

The same list is served by `GET /api/v1/tls/handshakes`, described in the
[REST API reference](../api-reference/rest-api.md#get-apiv1tlshandshakes).

## Related

- [Post-Quantum TLS](pq-tls.md): the key exchange of the agent's own listeners.
- [JA4+ Fingerprinting](ja4-fingerprinting.md): the same handshakes, read as
  client and server fingerprints.
