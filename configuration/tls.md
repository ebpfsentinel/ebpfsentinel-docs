# TLS Configuration

The `tls` section configures TLS 1.3 encryption for both the REST API and gRPC endpoints.

## Reference

```yaml
tls:
  enabled: true
  cert_path: /etc/ebpfsentinel/server.crt
  key_path: /etc/ebpfsentinel/server.key
  allow_tls12: false              # TLS 1.3 only by default
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable TLS |
| `cert_path` | `string` | — | Path to PEM certificate file |
| `key_path` | `string` | — | Path to PEM private key file |
| `allow_tls12` | `bool` | `false` | Allow TLS 1.2 connections. When `false` (default), only TLS 1.3 is accepted |

## Implementation

TLS is provided by **rustls** with the **aws-lc** cryptographic backend. By default, only TLS 1.3 is accepted -- older protocol versions are rejected. Set `allow_tls12: true` to permit TLS 1.2 connections for legacy clients.

When enabled, both REST API and gRPC endpoints use TLS:

- REST: `https://localhost:8080/`
- gRPC: TLS on port 50051

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
- Post-quantum hybrid key exchange (`X25519MLKEM768`) requires TLS 1.3 -- it is not available when `allow_tls12` is set to `true` for the TLS 1.2 negotiation path
