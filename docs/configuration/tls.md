# TLS Configuration

The `tls` section configures TLS 1.3 encryption for both the REST API and gRPC endpoints.

## Reference

```yaml
agent:
  tls:
    enabled: true
    cert_path: /etc/ebpfsentinel/server.crt
    key_path: /etc/ebpfsentinel/server.key
    allow_tls12: false            # TLS 1.3 only by default
    pq_mode: prefer               # Post-quantum key exchange: prefer, require, disable. Default: prefer
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable TLS |
| `cert_path` | `string` | — | Path to PEM certificate file |
| `key_path` | `string` | — | Path to PEM private key file |
| `allow_tls12` | `bool` | `false` | Allow TLS 1.2 connections. When `false` (default), only TLS 1.3 is accepted |
| `pq_mode` | `string` | `prefer` | Post-quantum key exchange mode: `prefer`, `require`, or `disable` (see below) |

## Implementation

TLS is provided by **rustls** with the **aws-lc** cryptographic backend. By default, only TLS 1.3 is accepted -- older protocol versions are rejected. Set `allow_tls12: true` to permit TLS 1.2 connections for legacy clients.

When enabled, both REST API and gRPC endpoints use TLS:

- REST: `https://localhost:8080/`
- gRPC: TLS on port 50051

## Post-Quantum Key Exchange

The `pq_mode` field controls whether the agent advertises the `X25519MLKEM768` hybrid key exchange during TLS handshakes.

| Mode | Behavior |
|------|----------|
| `prefer` | Advertise PQ hybrid key exchange; fall back to classical X25519 if the client does not support it. Default. |
| `require` | Only accept connections that negotiate PQ hybrid key exchange. Clients without PQ support are rejected. |
| `disable` | Do not advertise PQ key exchange. Only classical key exchanges are used. |

`pq_mode` states which *inbound* clients this listener accepts. The agent's own
outbound connections keep a classical fallback under `require`, so requiring PQ
of the clients that reach the API does not cut the agent off from the threat
intelligence feeds, webhooks, SIEM endpoints and OIDC provider it dials, few of
which offer hybrid key exchange today. Only `disable` takes the hybrid group off
the wire in both directions. See [Post-Quantum TLS](../features/pq-tls.md).

**Important**: PQ hybrid key exchange (`X25519MLKEM768`) exists only in TLS 1.3.
`allow_tls12: true` therefore cannot be combined with `pq_mode: require`: the
hybrid group would be the only one offered and no TLS 1.2 client could complete
a handshake, so the agent refuses that pair at startup rather than serving a
listener the legacy clients it was enabled for can never reach. Under `prefer`
and `disable`, a classical group stays on the wire and TLS 1.2 connections
negotiate it as usual.

## Certificate Generation

### Self-Signed (Development)

```bash
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt \
  -days 365 -nodes -subj '/CN=ebpfsentinel'
```

### Let's Encrypt (Production)

Use certbot or acme.sh to obtain certificates, then point `cert_path` and `key_path` to the generated files. Reload the agent after certificate renewal:

```bash
kill -HUP $(pidof ebpfsentinel-agent)
```

## Security Notes

- Key files should be `chmod 600` and owned by the agent's runtime user
- The agent warns on world-readable key files at startup
- Post-quantum hybrid key exchange (`X25519MLKEM768`) requires TLS 1.3 -- a connection that negotiates TLS 1.2 uses a classical key exchange, which is why `allow_tls12` and `pq_mode: require` cannot both be set
