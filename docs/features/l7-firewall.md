# L7 Firewall

> **Edition: OSS (13 built-in protocols) + Enterprise (4 extended protocols)** | **Enforcement: Userspace**

## Overview

The L7 firewall provides application-layer filtering with protocol-aware rules. The OSS edition ships detection and parsing for HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB, SSH, Redis, MySQL, PostgreSQL, DNS-over-TCP, IMAP, and POP3. The enterprise edition plugs MQTT, AMQP 0-9-1, NATS, and Cassandra CQL detection into the same dispatcher via a pluggable `L7ExtendedParser` port. Rules are evaluated in priority order (first-match-wins) against parsed protocol fields.

## How It Works

The L7 firewall operates in userspace. Packets forwarded from TC programs are parsed by protocol-specific parsers, then evaluated against L7 rules:

1. **Protocol detection** - identify the application protocol from the payload
2. **Field extraction** - parse protocol-specific fields (HTTP path, TLS SNI, gRPC method, etc.)
3. **Rule evaluation** - match extracted fields against configured rules in priority order
4. **Action** - record the decision, and for `deny` raise an alert

The payload reaching step 1 is a copy: the packet that carried it has
already been forwarded by the time the parser sees it. A `deny` therefore
marks the flow as denied in the audit trail and raises an alert an automated
response can act on; it does not drop that packet in the data path. Dropping
traffic at line rate is the job of the L3/L4 firewall and the IPS.

### Supported Protocols - OSS

| Protocol | Detection | Matchable Fields |
|----------|-----------|-----------------|
| **HTTP/1.1** | Request-line methods | Method, path, host, headers, user-agent |
| **HTTP/2 (gRPC)** | Connection preface `PRI * HTTP/2.0` | Service name, method |
| **TLS** | Handshake content type `0x16` | SNI, JA4, ALPN, supported groups |
| **SMTP** | Banner + EHLO/HELO/MAIL/RCPT/DATA/QUIT/RSET/NOOP/VRFY/EXPN | Command |
| **FTP** | USER/PASS/LIST/RETR/… commands or `220` banner mentioning FTP | Command |
| **SMB** | NetBIOS header + `\xffSMB` / `\xfeSMB` / `\xfdSMB` magic | Command, SMB1 vs SMB2 flag; behind the SMB 3 transform header (`\xfdSMB`) the message is encrypted, so it is known to be SMB and carries no command, and a rule naming an `smb_command` never matches it |
| **SSH** | Banner prefix `SSH-` | Software banner substring (`OpenSSH_9.6`, …) |
| **Redis** | RESP array `*N\r\n$L\r\n…` | Command verb + first key |
| **MySQL** | 3-byte LE length + known `COM_*` command byte | Command byte, SQL query text (COM_QUERY) |
| **PostgreSQL** | `Q` Simple Query or StartupMessage v3.0 | Message type, SQL query text |
| **DNS-over-TCP** | 2-byte length prefix + DNS header | First QNAME, question/answer counts, is_response |
| **IMAP** | Tagged commands (LOGIN/SELECT/LIST/FETCH/…) or untagged `* OK`/`* BAD` | Command verb |
| **POP3** | Server `+OK` / `-ERR` response (client commands collide with FTP; use port 110/995 to disambiguate) | Command verb |

### Supported Protocols - Enterprise (extension port)

The enterprise edition registers an `L7ExtendedParser` on the dispatcher. It is consulted when the built-in detector returns `Unknown`, so enabling the enterprise crate never shadows an OSS protocol.

| Protocol | Detection | Parsed fields |
|----------|-----------|---------------|
| **MQTT** (v3.1.1 / v5) | CONNECT packet with literal `MQTT` or `MQIsdp` protocol name | Packet type, remaining length, client id (CONNECT), topic (PUBLISH) |
| **AMQP 0-9-1** | 8-byte literal `AMQP\x00\x00\x09\x01` header | Major / minor / revision |
| **NATS** | Line-prefixed verb (CONNECT / INFO / PUB / HPUB / SUB / UNSUB / MSG / HMSG / PING / PONG / +OK / -ERR) | Command verb, first subject |
| **Cassandra CQL v3/v4/v5** | 9-byte frame header with version 0x03-0x05 and opcode ≤ 0x10 | Version, opcode, stream, body length, CQL query text (opcode QUERY) |

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
  enabled: true
  # A payload is inspected only when one end of the conversation uses a
  # listed port. The agent refuses to start on an enabled section with an
  # empty list, since no rule below could ever be evaluated.
  ports: [80, 443, 445]
  rules:
    - id: block-admin-panel
      priority: 10
      action: deny
      protocol: http
      path: "/admin"
    - id: block-sensitive-api
      priority: 20
      action: deny
      protocol: http
      path: "/api/internal/.*"
    - id: allow-grpc-health
      priority: 30
      action: allow
      protocol: grpc
      service: "grpc.health.v1.Health"
      grpc_method: "Check"
    - id: block-legacy-smb1
      priority: 40
      action: deny
      protocol: smb
      is_smb2: false
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

Every L7 protocol reuses a fixed set of YAML fields on the rule - the
field interpretation depends on the `protocol` string:

| Protocol | `command` | `path` (substring) | `host` | `service` | `method` | `smb_command` |
|----------|-----------|--------------------|--------|-----------|----------|---------------|
| http | - | request path | Host header | - | HTTP method | - |
| tls | - | - | SNI | - | - | - |
| grpc | - | - | - | service | gRPC method | - |
| smtp / ftp / imap / pop3 | command verb | - | - | - | - | - |
| smb | - | - | - | - | - | SMB command id |
| ssh | - | - | - | software banner substring | - | - |
| redis | command verb | key substring | - | - | - | - |
| mysql | - | SQL substring | - | - | - | command byte override |
| postgres | message type byte | SQL substring | - | - | - | - |
| dns-tcp | - | - | QNAME substring | - | - | - |

### Header selectors

Beside the protocol matcher, a rule narrows on the packet header. Every field
here is optional and an omitted one matches anything:

| Field | Match logic |
|-------|-------------|
| `src_ip` | CIDR containing the source address |
| `dst_ip` | CIDR containing the destination address |
| `dst_port` | Port range containing the destination port, or a single port |
| `src_country_codes` | Source address resolved to a country in the list |
| `dst_country_codes` | Destination address resolved to a country in the list |
| `src_ip_alias` | Names an IP-set alias instead of writing the source CIDR out |
| `dst_ip_alias` | The same, on the destination address |
| `dst_port_alias` | Names a port alias instead of writing the destination port out |

The three alias fields are resolved at load and at every configuration reload:
an L7 rule holds one address per side and one port range, so an alias naming
several networks, or naming none, leaves that side with nothing to match on and
the rule is dropped with its reason rather than installed unrestricted.

Addresses are matched as IPv4 only: a rule whose CIDR is an IPv6 prefix matches
nothing, and an IPv6 packet is tested against the first 32 bits of its address,
so name IPv6 traffic by port, protocol or country rather than by address. There
is no `src_port`, since the source port of a connection is ephemeral.

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

Each item of `GET /api/v1/firewall/l7-rules` carries the rule's `id`,
`priority`, `action`, `enabled` and `matcher`, plus what the rule is narrowed
to: `src_ip`, `dst_ip` and `dst_port` as the criteria it matches on,
`src_country_codes` and `dst_country_codes` where the rule names them, and
`src_ip_alias`, `dst_ip_alias` and `dst_port_alias` in the words the
configuration file used, so a reader can find the line that wrote the rule.
Each is omitted where the rule names none, and a rule created through this API
names none of the last five.

`POST /api/v1/firewall/l7-rules` is narrower than the configuration file on
purpose. It accepts `http`, `tls`, `grpc`, `smtp`, `ftp` and `smb` and refuses
any other `protocol`, so the remaining built-in protocols and the enterprise
ones are configuration-file only. It takes `src_ip`, `dst_ip` and `dst_port`
as literals, and accepts neither a country list nor an alias name: a rule
scoped that way is written in the file, where the alias it names can be
resolved.

## A protocol on the wrong port

A tunnel hides in a port that firewalls leave open: SSH on 443, HTTP on 53, a
shell over whatever reaches the internet. The agent already knows which
protocol each inspected payload speaks, so it compares that with the protocol
the connection's port promises and raises an alert when they differ. It is on
by default and costs nothing to configure.

| Port | Promises |
|---|---|
| 21 | ftp |
| 22 | ssh |
| 25, 587 | smtp |
| 53 | dns-tcp |
| 80, 8080 | http or grpc |
| 110 | pop3 |
| 139, 445 | smb |
| 143 | imap |
| 443, 465, 853, 993, 995, 8443 | tls |
| 3306 | mysql |
| 5432 | postgres |
| 6379 | redis |

The destination port is read first and the source port second, so a reply
from a server on a listed port is judged the same way as a request to it.

**When it alerts.** Only when the protocol spoken is one whose detection is
conclusive: tls, ssh, http, grpc and smb carry a magic number or a
request line no other protocol starts with. A payload detected as smtp, ftp,
imap, pop3, redis, mysql, postgres or dns-tcp rests on a heuristic that also
matches ordinary text, so it is recorded as `unclassified` rather than called a
mismatch, and so is a payload shorter than eight bytes or one no parser
recognised. A false alert on an internal service would teach the reader to
ignore the rule.

**Once per connection.** The first payload long enough to judge decides, and
the connection is remembered in both directions so the rest of it raises
nothing. The agent remembers at most 65536 connections and forgets one idle for
300 seconds; a connection arriving while the table is full and nothing has
gone idle is not judged and is counted in
`ebpfsentinel_l7_port_promise_uncounted_total`.

**What it sees.** Only the payloads the L7 path already inspects: L7 must be
enabled and the port must be in `l7.ports`. A port with a promise that is not
listed there is not judged.

**The alert.** Rule `l7-port-mismatch`, component `l7`, severity Medium,
mapped to MITRE ATT&CK T1571 Non-Standard Port, with a detail such as
`ssh spoken on port 443, which promises tls`. Like every packet alert it
carries the workload block when the agent knows the process behind the
connection, so the alert says which program opened the tunnel.

```yaml
l7:
  enabled: true
  ports: [22, 53, 80, 443]
  port_mismatch:
    enabled: true
    ignore_ports: [8080]   # a known service on a well-known port
```

**Cost.** On a developer workstation the check adds about 30 ns to a payload
of a connection already judged, which is nearly all of them, and about 130 ns
to the first payload of a connection, measured with criterion over protocol
detection on the same payload.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/l7/` | L7 engine (parsers, rule evaluation) |
| `ports` | `crates/ports/src/secondary/geoip_port.rs` | GeoIP lookup for source and destination country matching |
| `ports` | `crates/ports/src/secondary/l7_extended_parser_port.rs` | Extension point consulted when the built-in detector returns `Unknown`; the enterprise edition implements it, the open-source build has no implementation |
| `application` | `crates/application/src/l7_service_impl.rs` | App service |
| `agent` | `crates/agent/src/http/l7_handler.rs` | HTTP handler |

## Metrics

- `ebpfsentinel_rules_loaded{component="l7"}` - number of loaded L7 rules
- `ebpfsentinel_packet_processing_duration_seconds{program="l7"}` - L7 rule evaluation latency
- `ebpfsentinel_l7_port_promise_total{port,verdict}` - connections judged against their port's promise
- `ebpfsentinel_l7_port_promise_uncounted_total` - connections left unjudged because the table was full

## Requests, errors and duration per service

Every L7 payload the agent inspects is also read for a request and its
answer, so the agent counts how many requests each service received or sent,
how many failed and how long each one took, with no instrumentation inside the
application and no sidecar.

| Protocol | A request is | A failure is |
|----------|--------------|--------------|
| HTTP/1.x | A line opening with a method | A `5xx` status; a `1xx` interim answer is skipped and the final one is awaited |
| Redis | An array command (`*`) | An error reply (`-`) |
| PostgreSQL | A simple (`Q`) or extended (`P`) query | An `ErrorResponse` (`E`) |
| MySQL | `COM_QUERY`, `COM_STMT_PREPARE` or `COM_STMT_EXECUTE` | An `ERR` packet |
| DNS over TCP | A query | `SERVFAIL` or `REFUSED`; `NXDOMAIN` is an answer, not a failure |

Each request ends in one of three outcomes: `ok`, `error`, or `unanswered`
when no answer came within 30 seconds or the table of pending requests was
full. Only answered requests are timed, so an unanswered request never
stretches the duration histogram.

The service is the workload at each end of the connection, taken from the
socket and process tables the agent already keeps, and named, in order of
preference:

1. the Kubernetes namespace and controller, `namespace/name`, with the
   generated pod suffix and statefulset ordinal removed;
2. the systemd unit;
3. the container image name, without its registry, tag or digest;
4. the executable's file name;
5. `unattributed` when neither end of the connection is a process on this
   node.

A request between two processes on the same node is counted once against the
client (`role="client"`) and once against the server (`role="server"`).

Only what the L7 capture sees is measured: the request and its answer must
both cross an interface the agent inspects, on a port the L7 capture covers.
TLS, gRPC over TLS and every protocol whose failure is not readable in clear
are not measured.

### Bounds

Every label is bounded so that the series count stays predictable:

| Label | Values |
|-------|--------|
| `service` | At most 256 distinct names; every name after the 256th is counted as `other` |
| `role` | `client`, `server` |
| `protocol` | `http`, `redis`, `postgres`, `mysql`, `dns-tcp` |
| `outcome` | `ok`, `error`, `unanswered` |

At most 65,536 requests wait for their answer at once; when the table is full
the oldest is counted as `unanswered` to make room. The histogram buckets run
from 0.5 ms to 10 s: 0.5, 1, 2.5, 5, 10, 25, 50, 100, 250, 500 ms, then 1,
2.5, 5 and 10 s.

### Cost

Measured with the agent's own benchmark (`cargo bench -p application --bench
l7_red_meter`), one request and its answer cost about 285 ns of agent time on
a table already holding 65,536 pending requests, with the oldest evicted on
every request, and that figure includes counting the request on its edge of
the [service map](#service-map). It is the aggregation alone: the socket table
lookup that names each end comes on top of it and is the same lookup the
alerts already make.

### Series

- `ebpfsentinel_l7_requests_total{service, role, protocol, outcome}` - requests finished or abandoned
- `ebpfsentinel_l7_request_duration_seconds{service, role, protocol}` - time from request to answer, answered requests only

```promql
# Error ratio per service over five minutes
sum by (service) (rate(ebpfsentinel_l7_requests_total{outcome="error"}[5m]))
  / sum by (service) (rate(ebpfsentinel_l7_requests_total[5m]))

# 95th percentile duration per service
histogram_quantile(0.95,
  sum by (service, le) (rate(ebpfsentinel_l7_request_duration_seconds_bucket[5m])))
```

## Service map

The same requests are also folded into a graph of who called whom: one edge
per client, server, server port and protocol, carrying its request count, its
errors, its unanswered requests and the summed duration of the answered ones.
An end is the service named as above when the process runs on this node, and
its address alone otherwise.

Each edge also records the side of the connection the agent saw it from:
`server` when the server process runs on this node, `client` when only the
client does, and `transit` when neither does and the request merely crossed
it. A request whose two ends both run on the node is counted once, from the
server side.

```bash
ebpfsentinel-agent flows services            # last 15 minutes
ebpfsentinel-agent flows services -m 60 -o json
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" \
  "http://localhost:8080/api/v1/services/graph?minutes=5"
```

### Bounds

| Bound | Value |
|-------|-------|
| Window | One-minute buckets for the last 60 minutes; a reading covers 1 to 60 of them, 15 by default |
| Edges | At most 4,096 distinct edges per minute |
| Dropped | A request whose edge does not fit in its minute is counted in `dropped` rather than folded into another edge, so a reading says how much it is missing |

A service name is bounded the same way as the `service` label above, so an
edge never names more than 257 distinct services.

### Cost

The edge count is included in the 285 ns per request above. Reading the full
60-minute window of a graph holding 4,096 edges in every minute takes about
23.6 ms on the same benchmark, which is the price of one `flows services -m 60`
or one dashboard refresh, not of a request.

### Across the fleet

The dashboard's **Service map** screen asks every agent in scope for its graph
over the chosen window (5, 15, 30 or 60 minutes) and merges the answers. When
two agents saw the same edge, the reading from the server side wins over the
client side, which wins over a transit node, so a call is never counted twice;
server and client readings from two different agents of the same rank add up.
An address that exactly one agent named as a service is drawn as that service.
Every edge shows its rate per minute, its failure ratio (errors and unanswered
requests over requests), its mean time and, when the kept side sampled
[TCP round trips](tcp-health.md#reading-it), their 50th and 99th percentiles,
and an edge failing more than 5 % of
its requests is drawn as failing. Agents that gave no graph are named above the
canvas, with the requests the agents dropped.
