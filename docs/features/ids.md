# Intrusion Detection System (IDS)

> **Edition: OSS** | **eBPF Program: tc-ids**

## Overview

The IDS inspects packet payloads against regex-based signature rules. The kernel-side TC classifier performs initial filtering - sampling and backpressure - while the userspace engine runs protocol classification, full regex evaluation and alert generation.

## How It Works

### Kernel Side (tc-ids)

The TC classifier program:

1. **Sampling** - `bpf_get_prandom_u32` selects packets based on the configured sample rate, reducing userspace load
2. **Packet sizing** - `bpf_dynptr_from_skb` and `bpf_dynptr_size` measure the full packet, fragments included, so the payload copy is bounded by what the packet actually carries rather than by the linear length
3. **RingBuf backpressure** - `bpf_ringbuf_query` checks buffer fill level; if >75% full, events are skipped
4. **Event emission** - matching packets are forwarded to userspace via `RingBuf` as `PacketEvent` structures

Protocol detection is userspace-only. The classifier ships the payload and does not match protocol signatures in the kernel; the L7 engine classifies HTTP, TLS, gRPC, SMTP, FTP and SMB from that payload. See [L7 Firewall](l7-firewall.md).

### Userspace Side

The IDS engine:

1. Receives `PacketEvent` from the event dispatcher
2. Matches a rule that names no `pattern` on the `(protocol, port)` pair the classifier keyed on
3. Matches a rule that carries a `pattern` against the captured TCP payload instead, so the port alone never fires it
4. Matches a rule that carries a `domain_pattern` against the name the DNS engine resolved for the peer, rather than against the payload
5. Applies **threshold detection** (per-rule limit, threshold, and combined modes)
6. Generates alerts with severity, matched rule ID, and packet context

### Interface Groups

IDS rules can be scoped to specific interface groups using the `interfaces` field. For example, you can apply stricter detection rules on DMZ interfaces while using lighter sampling on internal networks. Rules without an `interfaces` field are floating and apply to all interfaces. See [Interface Groups](interface-groups.md).

### What a Rule Is Narrowed To

A rule names a protocol, and three optional fields cut it down to a slice of that protocol. A rule carrying none of them sees everything its protocol carries.

| Field | Effect |
|-------|--------|
| `dst_port` | Fires only on that destination port |
| `src_port` | Fires only on that source port, which is how a rule watches the reply leg of a flow (a DNS answer, an FTP data channel) |
| `domain_pattern` | Fires only where the resolved name of the peer matches, with `domain_match_mode` deciding how: `exact`, `wildcard` (a single leading `*.`) or `regex` |

### Threshold Detection

Three threshold modes control alert volume:

| Mode | Behavior |
|------|----------|
| `limit` | Alert on the first N matches within a time window, then suppress |
| `threshold` | Alert only after N matches within a time window |
| `both` | Alert after N matches, then suppress until the window resets |

### Sampling Modes

| Mode | Description |
|------|-------------|
| `random` | Kernel-side `bpf_get_prandom_u32` against the rate written to `IDS_SAMPLING_CONFIG`: a match not drawn is never written to the ring buffer. Captured payloads, which the kernel does not sample, select on the address pair at the same rate |
| `hash` | Consistent sampling on a hash of the source and destination addresses, in userspace |
| `country_based` | Full inspection for high-risk countries, reduced rate for others |

**Country-Based Sampling** - Sources from `high_risk_countries` (e.g. `[RU, CN, KP, IR]`) are inspected at `high_risk_rate` (default: 1.0 = 100%), while all other sources use `default_rate` (e.g. 0.1 = 10%). This focuses IDS resources on traffic from high-risk regions without dropping inspection entirely for the rest.

### Per-Country Threshold Overrides

Each IDS rule supports `country_thresholds` - per-country threshold configuration that overrides the rule's default threshold. This allows stricter detection for traffic from specific countries:

```yaml
rules:
  - id: ids-ssh-bruteforce
    severity: high
    protocol: tcp
    dst_port: 22
    threshold:
      type: threshold
      count: 5
      window_secs: 60
      track_by: src_ip
    country_thresholds:
      RU:
        type: threshold
        count: 2            # Alert after only 2 attempts from Russia
        window_secs: 60
        track_by: src_ip
```

### Imported Suricata Rules

Suricata rulesets listed under `ids.suricata` are compiled at load into
ordinary detection rules, decided on the payload in userspace. A rule using a
keyword the engine cannot evaluate - a field of a protocol it does not decode,
such as a SIP method or an SMB share - is refused rather than loaded with that part
ignored, and each refusal names its keyword. A ruleset refusing more than the
configured share fails the load. See
[Configuration: IDS](../configuration/ids.md#suricata-rulesets) for the
variables, the limits and what an imported rule costs per segment. [Importing Emerging Threats Open](../examples/scenarios/suricata-migration.md)
walks a public ruleset through the check, with the keyword table the
compiler works from.

### Compared with Suricata

Suricata is a stream and protocol engine: it reassembles each TCP connection
by sequence number, decodes some thirty application protocols, and lets a
rule look at a decoded field such as an HTTP URI, a TLS server name or a DNS
query. This engine reassembles TCP the same way on a connection whose handshake it
saw, and reads each rule on the packet, on the stream or on both, as Suricata
decides; every other rule sees the whole packet, headers included, for any
protocol. It finds a flow's application protocol from its bytes for HTTP/1,
TLS, SSH, SMTP, FTP, DNS, SMB and DCE/RPC, whatever the port, RDP and
Telnet on their ports, and decodes HTTP/1, DNS, TLS, DCE/RPC (over TCP,
UDP and the named pipes of SMB), SSH identification strings and the
attachments of SMTP mail into the buffers Suricata names, the JA3, JA3S
and JA4 fingerprints included; the fields of the other protocols are not
decoded yet. 53,049 of
the 53,073 enabled rules of the Emerging Threats Open Suricata 8 build
compile, and the rest are refused by name before
anything loads (the corpus measured in
[Importing Emerging Threats Open](../examples/scenarios/suricata-migration.md#step-3-the-whole-corpus-measured)).
The ruleset is also held to Suricata whole: Suricata 8.0.8 runs every enabled
rule over 53 crafted conversations, hostile and benign (scanners, injection,
log4j and shellshock against a web server; address lookups, tunnels, paste
sites and executable downloads going out over HTTP, DNS and TLS; SSH, FTP,
telnet and SMTP logins; SYN, ping, SNMP, SSDP and SIP scans; plain browsing,
lookups and handshakes that should raise nothing), and the same packets
through this engine with the same ruleset raise the same alerts, sid for sid,
and no other. The agent's CI downloads the ruleset, runs Suricata and the
comparison on that one download, and fails below 99 rules in 100 loaded.

What an imported rule can do here:

| Suricata capability | Here |
|---|---|
| `content` with `nocase`, `offset`, `depth`, `distance`, `within`, `startswith`, `endswith`, negated or not, with Suricata's backtracking | Yes, on the packet and on the reassembled stream |
| TCP stream reassembly by sequence number: segments reordered, overlaps resolved first-data-wins, a retransmission inspected once, each side flushed when the other acknowledges 2560 bytes, on its FIN or on a reset, and at the end of the flow; `stream_size`, `flow:only_stream`, `flow:no_stream`, `tcp-stream` and `tcp-pkt` | Yes, on a connection whose SYN was seen, up to 1 MiB of each side. A rule mixing `only_stream` or `tcp-stream` with a packet keyword is refused, as Suricata refuses it |
| `pcre` on PCRE2 with flags `i`, `s`, `m`, `x`, `A`, `E`, `G`, `R`, lookarounds and backreferences | Yes; an expression PCRE2 refuses is refused, as Suricata refuses it |
| `isdataat`, `bsize`, `byte_test`, `byte_jump`, `byte_extract`, `byte_math`, `entropy`, `base64_decode`, `base64_data` | Yes, on the captured payload |
| Transforms: `to_lowercase`, `to_uppercase`, `strip_whitespace`, `compress_whitespace`, `url_decode`, `from_base64`, `to_md5`, `to_sha1`, `to_sha256`, `xor`, `pcrexform`, `dotprefix`, `header_lowercase`, `strip_pseudo_headers` | Yes |
| Rules over TCP, UDP, ICMP, ICMPv6 or IP, on any port shape: `any` on both sides, ports on both sides, negations, ranges | Yes. The kernel hands up whole every packet a loaded rule can match, by protocol and port, read off the ruleset |
| Packet fields: `dsize`, `flags`, `seq`, `ack`, `window`, `tcp.mss`, `tcp.wscale`, `ttl`, `id`, `tos`, `ipopts`, `fragbits`, `fragoffset`, `sameip`, `ip_proto`, `itype`, `icode`, `icmp_id`, `icmp_seq`, `icmpv6.mtu`, and the header buffers `ipv4.hdr`, `ipv6.hdr`, `tcp.hdr`, `udp.hdr`, `icmpv4.hdr`, `icmpv6.hdr` | Yes, on every packet of the rule's protocol and ports |
| `flow` with `established`, `not_established`, `stateless` and the direction words; `flow.age`, `flow.pkts`, `flow.bytes` and their per-direction forms | Yes. A rule read on the packet asks the session kept from the flow's packets: the client sent the first one, TCP is established after its handshake, another protocol once answered. A TCP rule read on the payload is captured on an established connection, its direction the side of its port |
| The application protocol: a rule whose protocol is `http`, `http1`, `tls`, `ssl`, `ssh`, `smtp`, `ftp` or `dns`, and `app-layer-protocol` with `unknown`, `failed`, negation and the modes `to_server`, `to_client`, `either`, `final`, `original` | Yes. The protocol is found from the bytes each side sent, once the other side acknowledged them, by the patterns and ports Suricata uses, and fails as Suricata fails it at the first close; a rule of `app-layer-protocol` alone alerts on the packet where the protocol was settled. `original` never matches, as the agent does not follow a flow changing protocol. Another protocol name is refused |
| HTTP/1: every `http.*` buffer and its older modifier (`http_uri`, `http_header` and the rest), the URI normalised as Suricata normalises it and raw, `urilen`, `uricontent`, the request and response lines and headers one by one, cookies, the bodies once dechunked and decompressed from gzip or deflate up to 100 KiB, `file.data` on them | Yes, per transaction, pipelined requests each their own, read on the packet after the one the other side acknowledged as Suricata reads them, each rule alerting once per transaction. A rule mixing request and response buffers, a request buffer under `flow:to_client` or a response buffer other than the body under `flow:to_server`, `http.header.raw` without a direction and `http.host` with an uppercase content are refused, as Suricata refuses them |
| DNS over UDP and TCP: `dns.query` (and `dns_query`), `dns.queries.rrname`, `dns.answers.rrname`, `dns.authorities.rrname`, `dns.additionals.rrname`, `dns.response.rrname`, `dns.opcode`, `dns.rcode`, `dns.rrtype`, beside payload contents read on the message | Yes, one buffer per name, the name as it travelled with compression pointers followed, its case and any dot, space or zero byte inside a label kept. A query over UDP alerts on its datagram, over TCP on the client's next packet once the server acknowledged it, each framed message its own transaction. `dns.response.rrname` holds the questions, every owner name and the names NS, CNAME, PTR, MX and the SOA primary server point to; `dns.rrtype` the question types of a request and the answer types of a response. `dns.query` under `flow:to_client`, `dns.response.rrname` under `flow:to_server` and a DNS buffer on `tcp-pkt` or another protocol are refused, as Suricata refuses them. Port 5353 is mDNS, which has no `dns.query` |
| TLS: `tls.sni`, `tls.cert_subject`, `tls.cert_issuer`, `tls.cert_serial`, `tls.cert_fingerprint`, `tls.certs`, `tls.subjectaltname`, `tls.alpn`, `tls.random`, `tls.random_time`, `tls.random_bytes`, `tls.version`, `ssl_version`, `ssl_state`, `tls.cert_chain_len`, `tls_cert_notbefore`, `tls_cert_notafter`, `tls_cert_expired`, `tls_cert_valid`, the older `tls.subject`, `tls.issuerdn` and `tls.fingerprint`, and the fingerprints `ja3.hash`, `ja3.string`, `ja3s.hash`, `ja3s.string` and `ja4.hash` | Yes, read off the ClientHello, the ServerHello and the certificate chain the server sent, once per connection: the client's fields alert on the client's packets, the server's on the server's, and a dated keyword is decided against the time of the packet. JA3 and JA3S (Salesforce, BSD 3-Clause) and JA4 (FoxIO, BSD 3-Clause) are built as Suricata builds them, GREASE left out. A client field under `flow:to_client`, a server field under `flow:to_server`, the two mixed in one rule, and `ssl_state` naming `client_keyx`, `server_keyx` or `unknown` are refused; the handshake of TLS 1.3 past the ServerHello is encrypted, so its certificate is read on TLS 1.2 and below only |
| `threshold` (`limit`, `threshold`, `both`) | Yes, counted per rule and tracked address when the match would alert. The window runs on the agent's clock rather than the packet's: the same on live traffic, not on a capture replayed faster than it was recorded: our gap |
| Address variables, address lists and negated addresses | Yes, checked against the segment's addresses |
| Several alerts for one segment | Yes, every matching rule raises its own alert |
| State across packets and rules: `flowbits`, `xbits` and `hostbits` on a flow, a host or a pair of hosts, `flowint`, `noalert`, `detection_filter` | Yes. A bit lives on the flow in both directions, on an address or on a pair with its `expire`; a rule writing state runs before a rule reading it on the same segment. A `pcre` capture is kept on the flow or the packet and read back by `flowvar` and `pktvar`; `detection_filter` with `unique_on`, which Suricata parses from version 9, counts distinct source or destination ports. Not yet: `xbits` with `track tx` |
| Sets and reputation: `dataset`, `datarep`, `iprep` | Yes, over the files the configuration names (`ids.suricata.datasets`, `ids.suricata.reputation`, see [IDS configuration](../configuration/ids.md#suricata-rulesets)): string, md5 and sha256 sets, the `datarep` operators Suricata 8 accepts, and `iprep` scores with an address listed on its own hiding the networks it sits in (held to Suricata by `crates/domain/tests/fixtures/suricata/dataset-verdicts.txt` and `iprep-verdicts.txt`). A set of addresses and `save`/`state` are refused; a set a rule fills starts empty again on reload: our gap |
| An HTTP buffer and a content on the payload in the same rule | Yes, inspected when Suricata inspects it: on the stream of the transaction's direction once its message is whole, the payload content reading that window and the buffers the transaction it belongs to (held to Suricata by `crates/domain/tests/fixtures/suricata/http-payload-verdicts.txt`) |
| DCE/RPC: `dcerpc.iface`, `dcerpc.opnum`, `dcerpc.stub_data` | Yes, over TCP, over the named pipes of SMB1 and SMB2, and the stub over UDP, matched on the packets Suricata matches them on (held to Suricata by `crates/domain/tests/fixtures/suricata/dcerpc-verdicts.txt`). Where a segment carries several PDUs this engine reads every one, which Suricata 8 does not always do (`every_pdu_of_a_segment_is_read` in `crates/domain/src/ids/dcerpc.rs`) |
| SSH: `ssh.proto`, `ssh.software` | Yes, over TCP on any port, each side's first line read as its identification, the software version up to its first space (held to Suricata by `crates/domain/tests/fixtures/suricata/ssh-verdicts.txt`) |
| SMTP attachments: `file.data` on SMTP | Yes, every part naming a file name at any depth of multiparts, decoded from base64 or quoted-printable, inspected when the server answers the message (held to Suricata by `crates/domain/tests/fixtures/suricata/smtp-verdicts.txt`). A message is read up to its first MiB and eight levels of nested multiparts; past them, this engine reads no further, where Suricata reads to its own limits: our gap |
| `pass`, `drop`, `reject` actions | Yes, as far as Suricata reaches them in IDS mode: a `pass` silences every match of the same inspection, and a `pass`, `drop` or `reject` matched on the stream or a transaction leaves the rest of the flow uninspected, one matched on a packet that packet alone (held to Suricata by `crates/domain/tests/fixtures/suricata/action-verdicts.txt`). The match is decided after the packet has gone through, so the matched packet is never stopped: a `drop` has the IPS block the source from its next packet, a `reject` has the firewall answer its next packets with a TCP reset or an ICMP unreachable, both for the IPS blacklist duration and installed only when the IPS is enabled and in `block` mode, as every IPS block. `rejectdst` and `rejectboth` are refused: the agent answers only the sender. A block restored after a restart drops, whichever action installed it: our gap |

Each of these decides as Suricata 8 decides: `crates/domain/tests/suricata_inspect.rs`
in the agent tree runs a few hundred rules and payloads through a real Suricata
(the script beside its fixture) and asserts the same verdict here, case by case;
`crates/domain/tests/suricata_flow.rs` does the same for the state rules keep
across segments, replaying packets in order through one loaded engine, and
`crates/domain/src/ids/suricata_header_tests.rs` for the header keywords on
crafted packets and for `flow` and its counters on whole conversations: a TCP
handshake and close, a connection seen without its handshake, a refused one,
UDP and ICMP exchanges, the application protocol of conversations on their
usual ports and on others, and the HTTP/1 buffers of requests and responses:
odd URIs, chunked, compressed, split and close-delimited bodies, pipelined
requests, `HEAD` and `100 Continue`; and the DNS buffers of queries and
answers over UDP and TCP: compressed, dotted, root and truncated names, two
messages in one segment, one message over two, and every record section; and
the TLS buffers and fingerprints of handshakes a real client and server made,
TLS 1.2 and 1.3, the certificate dates checked against the capture's clock.

What it cannot do, each one refused at import with the keyword that stopped
it (the refusals are asserted by the compiler's tests in
`crates/domain/src/ids/suricata.rs` of the agent tree). These are the
engine's gaps, not choices Suricata leaves open:

| Suricata capability | Here |
|---|---|
| Application-layer buffers of the other protocols: `mdns.*`, `file.*` beyond `file.data`, `smb`, `ssh.hassh`, `smtp` and `email` fields, `ftp` keywords, `snmp.*`, `http2.*`, `app-layer-event`, and rules whose protocol is an application protocol the agent does not find (`ftp-data`, `http2`, `sip`, `ike`, `bittorrent-dht` and the rest) | No. 11 of the 24 rules the measured corpus refuses: 3 `ftp-data`, 2 `app-layer-event`, one each of `ike`, `sip`, `bittorrent-dht`, `http2.frametype`, `snmp.version` and `ftpbounce`; the other 13 are the two rows below |
| `file.magic` | No: it needs libmagic, which the agent does not link. 9 rules of the measured corpus |
| `asn1` | No. 4 rules of the measured corpus |
| Link-layer and other headers: `vlan.id`, `ether.hdr`, `igmp.type`, `sctp.*`, `tcp.session`, `flow.elephant`, `flow:only_frag`, `flow:no_frag` | No |
| A pcre flag naming an application-layer buffer (`U`, `H`, `C` and the rest) | No, for the reason of the first row |
| Inline blocking of the matched packet | No: the agent reads a copy of the packet after it went through |
| `lua`, `replace`, `filestore`, file extraction | No |

How a captured payload differs from what Suricata inspects:

- **Packets up to 2048 bytes.** The kernel copies at most 2048 bytes of a
  packet from its IP header; a longer one is cut, counted in
  `packets_truncated`, and its missing bytes are a hole in the stream as a
  lost segment would be. `dsize` still reads the length the IP header
  declares, so a packet cut short keeps its size.
- **Captured for the loaded rules.** The kernel copies a TCP payload only on
  the ports content rules name, and hands up a whole packet only for the
  protocols and ports the rules read on the packet need: a ruleset with none
  costs one table read per packet, a rule with `any` on both sides takes its
  protocol whole. A packet copied, lost to a full ring buffer or cut short is
  counted (`packets_captured`, `packets_lost`, `packets_truncated` below).
- **Sessions from the first packet seen.** A flow's session starts with the
  first packet the kernel hands up: a TCP connection opened before the rules
  loaded is never established for them and its stream is not kept, as in a
  Suricata that started after it (with `stream.midstream` off, its default).
- **The stream's last bytes alert when the flow ends.** Bytes the other side
  has not acknowledged are held, as Suricata holds them, and inspected on the
  side's FIN, a reset, or once the flow has been idle past its timeout. Held
  bytes across all connections are capped at 256 MiB; a segment arriving past
  that is not kept, and its bytes are a hole in its stream.
- **Fail-open under load.** When the ring buffer to userspace is more than
  three quarters full, the kernel skips the event rather than slow the
  traffic: under a burst a segment can go uninspected.
- **The L7 reassembler, when enabled, delays the match.** With
  `l7.reassembly.enabled` the rules see a flow's bytes once the reassembler
  calls the message complete (an HTTP body by its `Content-Length`, a TLS
  record by its length) or after five idle seconds, concatenated in arrival
  order rather than by sequence number. It is off by default.

Where the refused rules matter, keep Suricata beside the agent.

## Configuration

```yaml
ids:
  mode: alert           # alert or block (block requires IPS)
  sampling:
    mode: random        # none, random, hash, or country_based
    rate: 0.01          # fraction sampled, 0.0-1.0 (0.01 = 1-in-100)
  rules:
    - id: detect-sql-injection
      protocol: tcp
      dst_port: 80
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: high
      description: "SQL injection attempt"
    - id: detect-xss
      protocol: tcp
      dst_port: 80
      pattern: "(?i)(<script|javascript:|on\\w+\\s*=)"
      severity: high
      description: "Cross-site scripting attempt"
    - id: detect-shell-shock
      protocol: tcp
      dst_port: 80
      pattern: "\\(\\)\\s*\\{"
      severity: critical
      description: "Shellshock exploit attempt"
      threshold:
        type: threshold
        count: 5
        window_secs: 60
        track_by: src_ip
```

See [Configuration: IDS](../configuration/ids.md) for the full reference.

## CLI Usage

```bash
# Detection status and the rule count behind it
ebpfsentinel-agent ids status

# List detection rules, what each is narrowed to, and the thresholds behind them
ebpfsentinel-agent ids rules

# The same rules read as prevention rules
ebpfsentinel-agent ips list

# What the imported Suricata rulesets compiled to, and what they refused
ebpfsentinel-agent ids suricata --refusals

# Compile a Suricata ruleset locally, without an agent
ebpfsentinel-agent ids suricata-check emerging-scan.rules --address-var HOME_NET=10.0.0.0/8

# View alerts
ebpfsentinel-agent alerts list --component ids --severity high --limit 50

# Mark a false positive
ebpfsentinel-agent alerts mark-fp alert-001
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ids/status` | IDS status and detection rule count |
| GET | `/api/v1/ids/rules` | List detection rules |
| GET | `/api/v1/ids/suricata/report` | What each imported Suricata ruleset compiled to |
| GET | `/api/v1/ips/rules` | List prevention rules |
| GET | `/api/v1/alerts` | List alerts (filter by `component=ids`) |
| POST | `/api/v1/alerts/{id}/false-positive` | Mark alert as false positive |

Both rule listings answer the same ruleset, in the vocabulary the configuration file uses: a severity, a mode, a protocol, a threshold type and what it tracks by are spelled exactly as they were written in the file, so a rule on screen matches the line that declared it.

`GET /api/v1/ids/status` answers `enabled`, `mode` and `rule_count`. Each item of `GET /api/v1/ids/rules` carries:

| Field | Meaning |
|-------|---------|
| `id`, `description`, `severity`, `enabled` | As configured |
| `mode` | `alert` or `block`, capped by the service mode |
| `protocol` | The protocol the rule is written for |
| `dst_port`, `src_port` | What the rule is narrowed to; omitted where the rule names neither |
| `pattern` | The payload regex, omitted where the rule carries none |
| `domain_pattern`, `domain_match_mode` | The resolved name the rule is decided on, omitted where the rule names none |
| `threshold` | `threshold_type`, `count`, `window_secs`, `track_by`, omitted where the rule carries none |
| `country_thresholds` | Per-country overrides keyed by ISO 3166-1 alpha-2, omitted where the rule carries none |
| `workload` | The containers, pods or units the rule is scoped to, as one line, omitted where the rule applies to every workload |
| `kernel_slot` | Present only where the slot is contended, see below |

Both rule listings add a `kernel_slot` block to any rule whose `(protocol, dst_port)` slot another rule holds, since detection and prevention rules share the same kernel maps. See [IPS](ips.md) for what a lost slot means for each kind of rule.

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/tc-ids/` | TC classifier kernel program |
| `domain` | `crates/domain/src/ids/` | IDS engine (entity, engine, error) |
| `ports` | `crates/ports/src/secondary/ids_map_port.rs` | Kernel pattern and sampling map writes |
| `application` | `crates/application/src/ids_service_impl.rs` | App service |

## Metrics

- `ebpfsentinel_alerts_total{component="ids", severity}` - IDS alerts generated
- `ebpfsentinel_alerts_by_rule_total{component="ids", rule_id}` - IDS alerts per rule
- `ebpfsentinel_alerts_dropped_total{reason}` - alerts suppressed before delivery, `reason="dedup"` inside the dedup window and `reason="throttle"` for the per-rule rate limit
- `ebpfsentinel_ids_domain_matches_total{rule_id}` - matches driven by a domain pattern
- `ebpfsentinel_packet_processing_duration_seconds{program="ids"}` - IDS event dispatch latency
- `ebpfsentinel_packets_total{interface="IDS_METRICS", action}` - kernel-side counters (`matched`, `dropped`, `errors`, `events_dropped`, `total_seen`, `cgroup_resolved`, `cgroup_attributed`, `ct_kill_confirmed`, `l7_flow_dropped` for packets of a connection an [L7 rule refused](l7-firewall.md#what-a-deny-blocks), and `packets_captured`, `packets_lost`, `packets_truncated` for the whole packets handed up to the rules read on the packet: copied, lost to a full ring buffer, or cut at 2048 bytes)
