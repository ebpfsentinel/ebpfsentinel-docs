# L7 Firewall

> **Edition: OSS (13 built-in protocols) + Enterprise (4 extended protocols)** | **Status: Shipped** | **Enforcement: Userspace**

## Overview

The L7 firewall provides application-layer filtering with protocol-aware rules. The OSS edition ships detection and parsing for HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB, SSH, Redis, MySQL, PostgreSQL, DNS-over-TCP, IMAP, and POP3. The enterprise edition plugs MQTT, AMQP 0-9-1, NATS, and Cassandra CQL detection into the same dispatcher via a pluggable `L7ExtendedParser` port. Rules are evaluated in priority order (first-match-wins) against parsed protocol fields.

## How It Works

The L7 firewall operates in userspace. Packets forwarded from TC programs are parsed by protocol-specific parsers, then evaluated against L7 rules:

1. **Protocol detection** — identify the application protocol from the payload
2. **Field extraction** — parse protocol-specific fields (HTTP path, TLS SNI, gRPC method, etc.)
3. **Rule evaluation** — match extracted fields against configured rules in priority order
4. **Action** — allow or deny the connection

### Supported Protocols — OSS

| Protocol | Detection | Matchable Fields |
|----------|-----------|-----------------|
| **HTTP/1.1** | Request-line methods | Method, path, host, headers, user-agent |
| **HTTP/2 (gRPC)** | Connection preface `PRI * HTTP/2.0` | Service name, method |
| **TLS** | Handshake content type `0x16` | SNI, JA4+, ALPN, supported groups |
| **SMTP** | Banner + EHLO/HELO/MAIL/RCPT/DATA/QUIT/RSET/NOOP/VRFY/EXPN | Command |
| **FTP** | USER/PASS/LIST/RETR/… commands or `220` banner mentioning FTP | Command |
| **SMB** | NetBIOS header + `\xffSMB` / `\xfeSMB` magic | Command, SMB1 vs SMB2 flag |
| **SSH** | Banner prefix `SSH-` | Software banner substring (`OpenSSH_9.6`, …) |
| **Redis** | RESP array `*N\r\n$L\r\n…` | Command verb + first key |
| **MySQL** | 3-byte LE length + known `COM_*` command byte | Command byte, SQL query text (COM_QUERY) |
| **PostgreSQL** | `Q` Simple Query or StartupMessage v3.0 | Message type, SQL query text |
| **DNS-over-TCP** | 2-byte length prefix + DNS header | First QNAME, question/answer counts, is_response |
| **IMAP** | Tagged commands (LOGIN/SELECT/LIST/FETCH/…) or untagged `* OK`/`* BAD` | Command verb |
| **POP3** | Server `+OK` / `-ERR` response (client commands collide with FTP; use port 110/995 to disambiguate) | Command verb |

### Supported Protocols — Enterprise (extension port)

The enterprise edition registers an `L7ExtendedParser` on the dispatcher. It is consulted when the built-in detector returns `Unknown`, so enabling the enterprise crate never shadows an OSS protocol.

| Protocol | Detection | Parsed fields |
|----------|-----------|---------------|
| **MQTT** (v3.1.1 / v5) | CONNECT packet with literal `MQTT` or `MQIsdp` protocol name | Packet type, remaining length, client id (CONNECT), topic (PUBLISH) |
| **AMQP 0-9-1** | 8-byte literal `AMQP\x00\x00\x09\x01` header | Major / minor / revision |
| **NATS** | Line-prefixed verb (CONNECT / INFO / PUB / HPUB / SUB / UNSUB / MSG / HMSG / PING / PONG / +OK / -ERR) | Command verb, first subject |
| **Cassandra CQL v3/v4/v5** | 9-byte frame header with version 0x03–0x05 and opcode ≤ 0x10 | Version, opcode, stream, body length, CQL query text (opcode QUERY) |

Only label detection is wired today (enterprise tier). Per-protocol matcher evaluation for MQTT/AMQP/NATS/Cassandra rules ships in a follow-up release.

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

    # Block SSH from an outdated client build
    - id: block-old-openssh
      priority: 60
      action: deny
      protocol: ssh
      service: "OpenSSH_5"

    # Alert on Redis FLUSHALL commands
    - id: alert-redis-flushall
      priority: 70
      action: log
      protocol: redis
      command: "FLUSHALL"

    # Alert on MySQL DROP TABLE statements
    - id: alert-mysql-drop
      priority: 80
      action: log
      protocol: mysql
      path: "DROP TABLE"

    # Block PostgreSQL superuser connections (example)
    - id: alert-postgres-select
      priority: 81
      action: log
      protocol: postgres
      path: "SELECT"

    # Alert on DNS-over-TCP lookups for a specific domain
    - id: alert-dns-tcp-suspicious
      priority: 90
      action: log
      protocol: dns-tcp
      host: "suspicious.example.com"

    # Block IMAP LOGIN from untrusted subnets
    - id: block-imap-login
      priority: 95
      action: deny
      protocol: imap
      command: "LOGIN"
      src_ip: "10.0.0.0/8"

    # Alert on POP3 errors (account scanning)
    - id: alert-pop3-err
      priority: 96
      action: log
      protocol: pop3
      command: "-ERR"
```

### Matcher field mapping

Every L7 protocol reuses a fixed set of YAML fields on the rule — the
field interpretation depends on the `protocol` string:

| Protocol | `command` | `path` (substring) | `host` | `service` | `method` | `smb_command` |
|----------|-----------|--------------------|--------|-----------|----------|---------------|
| http | — | request path | Host header | — | HTTP method | — |
| tls | — | — | SNI | — | — | — |
| grpc | — | — | — | service | gRPC method | — |
| smtp / ftp / imap / pop3 | command verb | — | — | — | — | — |
| smb | — | — | — | — | — | SMB command id |
| ssh | — | — | — | software banner substring | — | — |
| redis | command verb | key substring | — | — | — | — |
| mysql | — | SQL substring | — | — | — | command byte override |
| postgres | message type byte | SQL substring | — | — | — | — |
| dns-tcp | — | — | QNAME substring | — | — | — |

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
