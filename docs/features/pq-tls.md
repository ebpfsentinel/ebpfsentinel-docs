# Post-Quantum Cryptography

A recording of today's traffic can be decrypted later by whoever holds a
quantum computer able to break the classical key exchange it was protected
with. eBPFsentinel answers that on every link it opens or accepts: the hybrid
key exchange `X25519MLKEM768` (ML-KEM-768, FIPS 203, combined with X25519) is
offered first by default, every handshake says which group it settled on, and
`require` refuses a peer that cannot answer it. No licence gates any of it:
cryptography follows the component it lives in, open source or not.

This page says, link by link, what is hybrid, what stays classical and why,
and how to hold an estate to `require`.

## How It Works

Every TLS link is built from one vocabulary, `pq_mode`, with three values:

| Mode | Groups offered | Use |
|------|----------------|-----|
| `prefer` (default) | `X25519MLKEM768`, then `X25519`, then `secp256r1` | Hybrid whenever the other side can, classical otherwise |
| `require` | `X25519MLKEM768` only | A peer without the hybrid group is refused |
| `disable` | `X25519`, then `secp256r1` | Legacy peers only |

The hybrid group exists only in TLS 1.3, so `require` cannot be combined with
`allow_tls12: true`: that pair leaves a TLS 1.2 client no usable key exchange
and is refused when the configuration is read.

Two settings, one per direction:

- `agent.tls.pq_mode` is what the agent's listeners accept.
- `agent.tls.outbound_pq_mode` is what the agent's own clients dial with. Left
  out, it follows `pq_mode` with `require` read as `prefer`, because a feed, a
  webhook or an identity provider is a server somebody else runs, and
  requiring the hybrid group from it is a decision to write out rather than to
  inherit. See [TLS configuration](../configuration/tls.md#outbound-links).

## Which Link Is Hybrid

Every row below counts its handshakes under
`ebpfsentinel_tls_handshakes_total{link, group}` (the operator and the
dashboard carry the same counter under their own prefix), so the answer for a
running process is read off `/metrics` rather than taken from this table.

### Agent (open source)

| Link | Direction | Policy | `link` label |
|------|-----------|--------|--------------|
| REST API | Inbound | `pq_mode` | `api` |
| gRPC | Inbound | `pq_mode` | `grpc` |
| Flow export to a collector over TLS | Outbound | `outbound_pq_mode` | `flow-export` |
| Threat intelligence feeds, GeoIP, webhooks, OIDC discovery and JWKS, OTLP, SMTP, the anonymous heartbeat | Outbound | `outbound_pq_mode` | `outbound` |

`GET /api/v1/crypto/posture` and `ebpfsentinel-agent tls links` list each of
the agent's own links with the policy it was built with and the group it last
negotiated; `all_required` is `true` only when every one of them requires the
hybrid group.

### Enterprise agent

| Link | Direction | Policy | `link` label |
|------|-----------|--------|--------------|
| REST listener on 8444, when `enterprise.api.tls` names a certificate | Inbound | `pq_mode` | `api` |
| High-availability peers on 9443 (mutual TLS) | Both | `pq_mode` on the listener, `outbound_pq_mode` on the dialling side | `ha-peer` |
| Federation listener and its clients (mutual TLS) | Both | `pq_mode` inbound, `outbound_pq_mode` outbound | `federation` |
| Syslog, CEF, Sentinel and QRadar connectors over TLS | Outbound | `outbound_pq_mode` | `siem-syslog` |
| HTTP SIEM exporters, vendor portal report, content channel | Outbound | `outbound_pq_mode` | `outbound` |
| TLS inspection proxy | Both | hybrid first, classical fallback, never `require` | `tls-proxy-workload`, `tls-proxy-upstream` |

The inspection proxy stands between a workload and a server neither of which
it chose; refusing a classical client there would not harden the agent, it
would stop the traffic the proxy exists to read. Under `require`, each syslog
collector configured over TLS is asked for the hybrid group before the agent
starts, and one that answers only a classical exchange stops the start with a
message naming it. The peer link is described in
[High Availability](enterprise/high-availability.md), the listener in
[Enterprise configuration](../configuration/enterprise.md#rest-listener).

### Dashboard and operator

| Process | Link | Policy |
|---------|------|--------|
| Dashboard | HTTPS listener | `server.tls.pq_mode`, `require` included |
| Dashboard | Agents, OIDC, ClickHouse, SMTP, webhooks | hybrid first, classical fallback |
| Operator | Kubernetes API server, agents, console | hybrid first, classical fallback |
| Operator | Admission webhook listener | hybrid first, classical fallback |

`require` on the dashboard closes TLS 1.2 on its listener, and a certificate
hot reload rebuilds the listener through the same policy. The field takes
effect only where the dashboard terminates TLS itself: behind an ingress the
browser's handshake is the ingress's. See the
[dashboard configuration](../configuration/dashboard.md) and
[operator monitoring](../operations/operator-monitoring.md).

## Signatures

Where we own both ends, a signature is dual: Ed25519 and ML-DSA-65 (FIPS 204)
over the same bytes, and both must verify.

| What is signed | Signatures | Verified by |
|----------------|-----------|-------------|
| Licence keys and offline bundles | Ed25519 + ML-DSA-65 | the enterprise agent, the operator, the dashboard |
| Content bundles, release measurements | Ed25519 + ML-DSA-65 | the enterprise agent |
| Signed stop of a tamper-protected agent | Ed25519 + ML-DSA-65 | the enterprise agent |
| Agent API tokens minted by the dashboard | Ed25519 JWT + ML-DSA-65 cosignature | the agent, per `auth.pq_tokens` |

`auth.pq_tokens` (`prefer`, `require`, `disable`) decides whether a token
without its cosignature is accepted; see
[authentication](../configuration/auth.md#post-quantum-token-cosignature).

## What Stays Classical, and Why

| What | Why it stays |
|------|--------------|
| Image and release signatures (cosign keyless, Fulcio certificates, Rekor) | The Sigstore ecosystem issues ECDSA certificates; a post-quantum signature nobody's verifier reads proves nothing. The dual-signed measurements manifest is the post-quantum statement about the same artefacts |
| WebPKI certificates on any listener | Certificate authorities do not issue post-quantum certificates yet. The key exchange is hybrid; the certificate that authenticates it is what the CA signed |
| Tokens and assertions from your identity provider (`auth.oidc`) | Your identity provider signs what it signs; the agent verifies it and asks it for nothing more |
| API keys | A shared secret compared in constant time, no asymmetric step to replace |
| A peer that cannot answer the hybrid group under `prefer` | `prefer` is the decision to fall back; `require` is the decision not to |

A key exchange protects what is recorded today; a signature protects only
while it is being verified, and nobody forges a signature after the fact on a
link already closed. That is why the key exchange moved first and everywhere,
and signatures moved where we own both ends.

## Data at Rest

Symmetric cryptography with 256-bit keys is not what a quantum computer
breaks, so data at rest needed no change of algorithm; what had to be checked
was every place a key is derived, wrapped or exchanged.

| Store | Mechanism | Verdict |
|-------|-----------|---------|
| Enterprise encrypted assets | AES-256-GCM, key derived by HKDF-SHA-256 from the licence signature | symmetric, stays |
| Capture store and compliance report custody | HMAC chain under the custody key, no encryption | symmetric, stays |
| Agent and enterprise redb stores | no application-level wrap; the disk under them is the host's | nothing to move |
| Dashboard refresh-token sealer | AES-256-GCM, HKDF-derived key | symmetric, stays |

No X25519 or RSA key wrap protects stored data anywhere in the product. RSA
reaches the dashboard only to verify an identity provider's signature, which
is the classical case above. On the platform that runs the vendor portal, the
one classical wrap found (the escrow of the secret store's recovery shares)
moved to a hybrid ML-KEM-768 + X25519 recipient.

## Holding an Estate to `require`

1. Read what each link negotiates today: `ebpfsentinel-agent tls links`, or
   `ebpfsentinel_tls_handshakes_total` grouped by `link` and `group`. A link
   showing only `X25519` or `secp256r1` has a peer that will be refused.
2. Set the listeners:

   ```yaml
   agent:
     tls:
       enabled: true
       cert_path: /etc/ebpfsentinel/server.crt
       key_path: /etc/ebpfsentinel/server.key
       pq_mode: require
       outbound_pq_mode: require   # only once every dialled peer answers the hybrid group
   auth:
     jwt:                          # the dashboard's tokens, verified here
       public_key_path: /etc/ebpfsentinel/jwt.pub
       ml_dsa_public_key_path: /etc/ebpfsentinel/jwt-ml-dsa.pub
     pq_tokens: require            # tokens minted by the dashboard must carry the cosignature
   ```

3. Restart and read `GET /api/v1/crypto/posture`: `all_required: true` means
   every link the agent opens or accepts holds the hybrid group.
4. On the dashboard, set `server.tls.pq_mode: require` where it terminates TLS.

### What a Client Without Hybrid Support Sees

Under `prefer` and `disable`, nothing: the handshake completes on a classical
group. Under `require`, the server has no group in common with the client and
the handshake fails with a TLS alert, not an HTTP status:

```text
# curl
curl: (35) error:0A000410:SSL routines::ssl/tls alert handshake failure

# openssl s_client
140...:error:...:SSL alert number 40
```

gRPC clients report a transport error rather than a gRPC status, because the
connection never reaches HTTP/2. The agent logs the refusal on its side.

## Verification

```bash
openssl s_client -connect localhost:8080 2>&1 | grep "Server Temp Key"
# Expected: Server Temp Key: X25519MLKEM768

openssl s_client -connect localhost:50051 -alpn h2 2>&1 | grep "Server Temp Key"
```

An `openssl` build without ML-KEM support reports a classical group instead,
which says what the client can do, not what the listener offered. The counter
on `/metrics` is the server's own answer.

## Related

- [TLS configuration](../configuration/tls.md)
- [Network Cryptography](network-cryptography.md): the key exchange of the workloads' own traffic, read off their handshakes
- [Tamper Protection](enterprise/tamper-protection.md): the other half of the same hardening
