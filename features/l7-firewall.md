# L7 Firewall

> **Edition: OSS** | **Status: Shipped** | **Enforcement: Userspace**

## Overview

The L7 firewall provides application-layer filtering with protocol-aware rules for HTTP, TLS/SNI, gRPC, SMTP, FTP, and SMB traffic. Rules are evaluated in priority order (first-match-wins) against parsed protocol fields.

## How It Works

The L7 firewall operates in userspace. Packets forwarded from TC programs are parsed by protocol-specific parsers, then evaluated against L7 rules:

1. **Protocol detection** — identify the application protocol from the payload
2. **Field extraction** — parse protocol-specific fields (HTTP path, TLS SNI, gRPC method, etc.)
3. **Rule evaluation** — match extracted fields against configured rules in priority order
4. **Action** — allow or deny the connection

### Supported Protocols

| Protocol | Matchable Fields |
|----------|-----------------|
| **HTTP** | Method, path, host, headers, user-agent |
| **TLS/SNI** | Server Name Indication (SNI) |
| **gRPC** | Service name, method |
| **SMTP** | Sender, recipient, commands |
| **FTP** | Commands, paths |
| **SMB** | Share names, commands |

### GeoIP Country Matching

L7 rules support `src_country_codes` and `dst_country_codes` fields for geographic filtering. Source and destination IPs are resolved to country codes via GeoIP at evaluation time:

```yaml
l7:
  rules:
    # Block all HTTP traffic from sanctioned countries
    - id: block-http-sanctioned
      priority: 5
      action: deny
      protocol: http
      src_country_codes: [KP, IR, SY]

    # Block TLS to destinations in high-risk countries
    - id: block-tls-high-risk-dst
      priority: 6
      action: deny
      protocol: tls
      dst_country_codes: [KP, SY, CU]
```

## Configuration

```yaml
l7:
  rules:
    - id: block-admin-panel
      priority: 10
      action: deny
      protocol: http
      path: "/admin"
      description: "Block access to admin panel"
    - id: block-sensitive-api
      priority: 20
      action: deny
      protocol: http
      path: "/api/internal/.*"
      description: "Block internal API endpoints"
    - id: allow-grpc-health
      priority: 30
      action: allow
      protocol: grpc
      method: "grpc.health.v1.Health/Check"
    - id: block-smb-share
      priority: 40
      action: deny
      protocol: smb
      share: "C$"
      description: "Block admin share access"
    - id: restrict-tls-sni
      priority: 50
      action: deny
      protocol: tls
      sni: "*.malware-domain.com"
```

See [Configuration: L7 Firewall](../configuration/l7.md) for the full reference.

## CLI Usage

```bash
# List L7 rules
ebpfsentinel-agent l7 list

# Add a rule
ebpfsentinel-agent l7 add --json '{
  "id": "block-uploads",
  "priority": 15,
  "action": "deny",
  "protocol": "http",
  "path": "/upload",
  "method": "POST"
}'

# Delete a rule
ebpfsentinel-agent l7 delete block-uploads
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/firewall/l7-rules` | List L7 rules |
| POST | `/api/v1/firewall/l7-rules` | Create an L7 rule |
| DELETE | `/api/v1/firewall/l7-rules/{id}` | Delete an L7 rule |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/l7/` | L7 engine (parsers, rule evaluation) |
| `ports` | `crates/ports/src/primary/l7.rs` | Port trait |
| `application` | `crates/application/src/l7_service_impl.rs` | App service |
| `adapters` | `crates/adapters/src/http/l7_handler.rs` | HTTP handler |

## Metrics

- `ebpfsentinel_rules_loaded{domain="l7"}` — number of loaded L7 rules
- `ebpfsentinel_processing_duration_seconds{domain="l7"}` — L7 rule evaluation latency
