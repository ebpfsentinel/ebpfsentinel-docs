# Importing Emerging Threats Open

Bringing an existing Suricata ruleset across, read for what it is: which rules
the engine runs, which it refuses, and why each refusal is the right answer.

## Scenario

A team runs Suricata with the Emerging Threats Open ruleset and wants the
agent to carry the rules it can. The engine compiles a rule only when it means
here exactly what it means in Suricata, so two dozen rules of the corpus are refused. The
refusal report is the useful half of this walkthrough: it says what is not
evaluated, rule by rule, before anything is loaded.

## Step 1: fetch the ruleset

```bash
curl -sSfLO https://rules.emergingthreats.net/open/suricata-8.0/emerging.rules.tar.gz
tar xzf emerging.rules.tar.gz
```

The archive unpacks into `rules/`, one file per category.

## Step 2: check a category without an agent

`ids suricata-check` compiles a file with the stock Suricata variables and
prints the report the agent would give. Nothing is loaded and no agent needs
to be running.

```bash
ebpfsentinel-agent ids suricata-check rules/emerging-scan.rules \
  --address-var HOME_NET=10.0.0.0/8
```

Against the ruleset fetched on 2026-11-23:

```text
RULESET              ENABLED  COMPILED  NATIVE  REFUSED  SHARE  DISABLED
emerging-scan.rules      286       285     285        1   0.3%        81

Refused in emerging-scan.rules, by keyword:
KEYWORD    RULES
ssh_proto      1
```

How to read it:

- **Enabled** is the rules not commented out; the 81 disabled ones are not read.
- **Compiled** is the Suricata rules that load, and **native** the detection
  rules they become: a rule naming two ports becomes two native rules.
- **Refused, by keyword** is the reason. `snmp.version` means the rule is
  written against a parsed SNMP field, which the engine does not evaluate yet.
  Rules reading HTTP/1 fields (`http.uri`, `http.user_agent`, `file.data` and
  the rest), DNS fields (`dns.query`, `dns.rrtype` and the rest), SSH
  identification strings (`ssh.software`, `ssh.proto`) and SMTP attachments
  (`file.data` on `smtp`) compile. Rules over
  UDP or ICMP, rules reading the TCP flags or the packet size, rules asking
  whether a connection is established, and rules whose protocol is `http`,
  `tls`, `ssh`, `smtp`, `ftp` or `dns` with no decoded field compile.

Add `--refusals` to list every refused rule with its line, sid and reason.

## Step 3: the whole corpus, measured

The same check run over every category of that release:

| Measure | Value |
|---------|-------|
| Enabled rules | 53,073 |
| Compiled | 53,049 |
| Native detection rules | 53,049 |
| Refused share | 0.05% |

The categories that compile the most:

| Category | Enabled | Compiled | Refused share |
|----------|---------|----------|---------------|
| `emerging-malware.rules` | 19,511 | 19,508 | 0.0% |
| `emerging-dyn_dns.rules` | 6,108 | 6,108 | 0.0% |
| `emerging-web_specific_apps.rules` | 6,103 | 6,102 | 0.0% |
| `emerging-info.rules` | 4,550 | 4,549 | 0.0% |
| `emerging-phishing.rules` | 2,951 | 2,950 | 0.0% |
| `emerging-exploit_kit.rules` | 2,718 | 2,718 | 0.0% |
| `emerging-exploit.rules` | 1,717 | 1,715 | 0.1% |
| `emerging-hunting.rules` | 1,422 | 1,412 | 0.7% |

What the refused rules ask for, by the first keyword that stopped each one:

| Refused for | Rules |
|-------------|-------|
| A field of a protocol the agent does not decode yet, or a protocol it does not find (`file.magic`, `ftp-data`, `sip` and the rest) | 19 |
| `asn1` | 4 |
| An HTTP/2 field | 1 |

Most refusals are rules reading a field this engine does not decode yet,
a file type first; RDP, SMB and Telnet flows are found
the way Suricata finds them, and HTTP/1, DNS, TLS, DCE/RPC, SSH identification
strings and SMTP attachments are decoded, JA3,
JA3S and JA4 included, DCE/RPC whether it runs over TCP, UDP or the named
pipes of an SMB conversation. A rule reading an HTTP buffer and the payload together compiles and
is inspected when Suricata inspects it, on the stream of the transaction's
direction. Suricata runs every one of them. This engine does not,
and [Compared with Suricata](../../features/ids.md#compared-with-suricata)
says capability by capability what it does instead.

## Step 4: load what compiles

The default `max_refused_share` of `0.5` rejects any of these files, so
loading one is a decision taken in writing:

```yaml
ids:
  enabled: true
  mode: alert
  suricata:
    rulesets:
      - /etc/ebpfsentinel/suricata/emerging-scan.rules
      - /etc/ebpfsentinel/suricata/emerging-exploit.rules
    vars:
      addresses:
        HOME_NET: "[10.0.0.0/8]"
    max_refused_share: 0.95
```

Once loaded, the agent reports the same table:

```bash
ebpfsentinel-agent ids suricata
ebpfsentinel-agent ids suricata --refusals
```

Keep Suricata where the refused rules matter. Imported rules cost userspace
time per captured segment on each port they name; see
[Configuration: IDS](../../configuration/ids.md#suricata-rulesets) for the
measured cost.

## Keyword support

Generated from the compiler's own keyword list, which names every keyword of
Suricata 8. A rule Suricata 8 itself refuses to load is refused here too,
with the reason; the compiler's test runs the same rules through a Suricata
8.0.8 binary and compares. A rule Suricata loads is read whole, each keyword's
arguments checked; it is then refused by the first keyword below that is **parsed, not
yet inspected** (the engine reads it but does not evaluate it yet) or
**refused** (out of scope: scripts, rewriting the packet, writing files).

<!-- BEGIN GENERATED SURICATA KEYWORDS -->

| Keyword | Support | What it means here |
|---|---|---|
| `msg` | Compiled | Becomes the rule description. |
| `sid` | Compiled | Required. Names the rule `suricata-<sid>`, with `-<port>` when it names several ports. |
| `rev` | Compiled | Kept with the rule. |
| `gid` | Compiled | Only generator 1, the rule engine's own. |
| `classtype` | Compiled | Kept with the rule, and sets the severity from the stock classification priorities. |
| `priority` | Compiled | Sets the severity: 1 is high, 2 medium, 3 and above low. |
| `reference` | Compiled | Kept with the rule. |
| `flow` | Compiled | `established`, `not_established`, `stateless` and the four direction words. A rule read on every packet asks the session the agent keeps from them: the client sent the first packet, TCP is established after its handshake, another protocol once answered. On a TCP connection whose SYN was seen, a rule is read on each packet, on the stream as Suricata inspects it, or on both, as Suricata decides; `only_stream` keeps it to the stream, and a packet keyword beside it is refused as Suricata refuses it; `no_stream` keeps it to the packet. `only_frag` and `no_frag` are refused. |
| `content` | Compiled | Literal and `\|hex\|` bytes, negated with `!`. A match moves the cursor to its end, and when a later match fails the engine tries the next occurrence, as Suricata does. |
| `nocase` | Compiled | ASCII case-insensitive match of the content before it. |
| `offset` | Compiled | From the start of the buffer. |
| `depth` | Compiled | Counted from `offset`, as Suricata counts it. |
| `distance` | Compiled | From the cursor the previous content or pcre left, negative included. |
| `within` | Compiled | From the cursor the previous content or pcre left. A window shorter than the content is refused, as Suricata refuses it. |
| `startswith` | Compiled | Anchors the content to the start of the buffer. |
| `endswith` | Compiled | Anchors the content to the end of the buffer. |
| `fast_pattern` | Compiled | Names the content the prefilter looks for, `chop` naming a slice of it; without it the longest content of the payload is the one. A payload without that content runs no more of the rule, and the rule is then matched in full. |
| `pcre` | Compiled | PCRE2, on bytes. Flags `i`, `s`, `m`, `x`, `A`, `E`, `G` and `R`, and the buffer flags of the buffers the engine inspects; lookarounds and back-references run as Suricata runs them. |
| `threshold` | Compiled | Types `limit`, `threshold` and `both`, tracked by source, destination or both. |
| `isdataat` | Compiled | Absolute or relative to the cursor, negated with `!`. |
| `bsize` | Compiled | The length of the buffer it follows. |
| `dsize` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `byte_test` | Compiled | Every operator, string and binary reads, endianness, `dce` read little-endian, bitmask, relative. |
| `byte_jump` | Compiled | Every option: multiplier, align, from_beginning, from_end, post_offset, relative, bitmask. |
| `byte_extract` | Compiled | Sets a variable that a later offset, depth, distance, within, isdataat or byte keyword reads. A variable read before it is set refuses the rule. |
| `byte_math` | Compiled | Every operator; a division by zero does not match. Sets a variable as byte_extract does. |
| `entropy` | Compiled | Shannon entropy in bits per byte over the bytes named; a window past the buffer does not match. |
| `base64_decode` | Compiled | Decodes from the start of the buffer or from the cursor, padding optional. |
| `base64_data` | Compiled | Inspects what the last base64_decode produced. |
| `urilen` | Compiled | The length of the normalised URI, or of the raw one with `raw`, read on the HTTP/1 request. |
| `uricontent` | Compiled | A content on the normalised URI of the HTTP/1 request. |
| `flowbits` | Compiled | Every command, `noalert`, and `a\|b` as any of the names on `isset` and `isnotset`; elsewhere `\|` and `&` are part of the name, as in Suricata. A bit set on a packet is seen on that packet by the rules that test it, and by both directions of the flow after it. |
| `xbits` | Compiled | On `ip_src`, `ip_dst` and `ip_pair`, with `expire` (30 seconds when unnamed; setting a live bit again keeps its expiry), and `noalert`. A rule naming no `track`, which Suricata keeps nowhere, and `track tx` are refused. |
| `hostbits` | Compiled | On the source, the destination or both, sharing the host bits of `xbits`, with `expire`. |
| `flowint` | Compiled | Every operator, against a number or another flow variable. A comparison of a variable never set fails, a variable never set reads 0 on the right of one, and adding to one starts it from 0. A rule writes only once every test of it held. |
| `flowvar` | Compiled | Holds when the flow's variable contains the bytes, anywhere in it. The variable is what a `pcre` capture `flow_name` (or `flow:name` after its flags) took on the last match of a rule that held, on either side of the flow; it is set before the rules that read it run on the same packet. |
| `pktvar` | Compiled | Holds when the packet's variable contains the bytes: what a `pcre` capture `pkt_name` took on that packet, read by any rule matching it and forgotten after. An `alert_name` capture, which only decorates Suricata's alert record, is accepted and kept nowhere. |
| `noalert` | Compiled | The rule raises no alert and still writes the state it names. |
| `detection_filter` | Compiled | Alerts on every match past `count` in a window of `seconds` opened by the first match, tracked by source, destination, both, rule or flow; with `unique_on`, past `count` distinct source or destination ports. |
| `flow.age` | Compiled | Whole seconds: the packet's second minus the second the flow began, as Suricata counts it. |
| `flow.pkts` | Compiled | Counted on every packet of the flow the kernel hands over, the packet judged included, bytes from the link layer; `either` holds when either direction's count does. |
| `flow.pkts_toserver` | Compiled | Counted on every packet of the flow the kernel hands over, the packet judged included, bytes from the link layer; `either` holds when either direction's count does. |
| `flow.pkts_toclient` | Compiled | Counted on every packet of the flow the kernel hands over, the packet judged included, bytes from the link layer; `either` holds when either direction's count does. |
| `flow.bytes` | Compiled | Counted on every packet of the flow the kernel hands over, the packet judged included, bytes from the link layer; `either` holds when either direction's count does. |
| `flow.bytes_toserver` | Compiled | Counted on every packet of the flow the kernel hands over, the packet judged included, bytes from the link layer; `either` holds when either direction's count does. |
| `flow.bytes_toclient` | Compiled | Counted on every packet of the flow the kernel hands over, the packet judged included, bytes from the link layer; `either` holds when either direction's count does. |
| `stream_size` | Compiled | Each side's bytes as Suricata counts them: its SYN, every byte up to the highest sequence number sent, and its FIN from the packet after it. Read on every packet of a connection whose SYN was seen; never matches midstream. |
| `dataset` | Compiled | Over the sets the configuration names with their type and file, or a set a rule creates empty with its type; string, md5 and sha256 sets. A rule loading a file the configuration does not name, saving a set or naming a set of addresses is refused; a set a rule fills starts empty again on reload. |
| `datarep` | Compiled | Over the sets the configuration names, a value without a reputation counting 0; the operators '<', '>' and '==', as Suricata 8 accepts them. |
| `iprep` | Compiled | Over the categories file and the lists the configuration names. An address listed on its own scores in every category, 0 where no line gives one, and hides the networks it sits in; 'isnotset' holds for an address not listed or scoring 0. A rule naming a category the file does not name, or with no lists configured, is refused. |
| `flags` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tcp.flags` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `seq` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tcp.seq` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `ack` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tcp.ack` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `window` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tcp.window` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tcp.mss` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tcp.wscale` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `ttl` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `id` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tos` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `ipopts` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `fragbits` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `fragoffset` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `sameip` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `ip_proto` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `l3_proto` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `itype` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `icode` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `icmp_id` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `icmp_seq` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `icmpv6.mtu` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `app-layer-protocol` | Compiled | The protocol is found from the traffic for HTTP/1, TLS, SSH, SMTP, FTP and DNS, and `failed`, `unknown` and every mode are read as Suricata reads them; another protocol is refused. |
| `to_lowercase` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `to_uppercase` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `to_md5` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `to_sha1` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `to_sha256` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `strip_whitespace` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `compress_whitespace` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `url_decode` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `header_lowercase` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `pcrexform` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `from_base64` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `dotprefix` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `strip_pseudo_headers` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `xor` | Compiled | Runs in the inspection engine on the buffer it follows, as Suricata 8 transforms it; a rule loads once that buffer is inspected. |
| `file.data` | Compiled | The content of a file: the body of an HTTP request or response, decompressed from gzip or deflate, and an attachment of a mail sent over SMTP, decoded from base64 or quoted-printable, as Suricata reads them. Files carried by other protocols are not read yet: such a rule is refused. |
| `file_data` | Compiled | The older name of `file.data`. The content of a file: the body of an HTTP request or response, decompressed from gzip or deflate, and an attachment of a mail sent over SMTP, decoded from base64 or quoted-printable, as Suricata reads them. Files carried by other protocols are not read yet: such a rule is refused. |
| `http.uri` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.uri.normalized` | Compiled | The older name of `http.uri`. Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_uri` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.uri.raw` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_raw_uri` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.method` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_method` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.request_line` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_request_line` | Compiled | The older name of `http.request_line`. Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.request_body` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_client_body` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.header` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_header` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.header.raw` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_raw_header` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.cookie` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_cookie` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.user_agent` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_user_agent` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.host` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_host` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.host.raw` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_raw_host` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.accept` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_accept` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.accept_enc` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_accept_enc` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.accept_lang` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_accept_lang` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.referer` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_referer` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.connection` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_connection` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.content_type` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_content_type` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.content_len` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_content_len` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.start` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_start` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.protocol` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_protocol` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.header_names` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_header_names` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.request_header` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.response_header` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.stat_code` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_stat_code` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.stat_msg` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_stat_msg` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.response_line` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_response_line` | Compiled | The older name of `http.response_line`. Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.response_body` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http_server_body` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.server` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `http.location` | Compiled | Read on each HTTP/1 transaction the agent parses, the buffer filled as Suricata fills it. |
| `dns.query` | Compiled | Read on each DNS request over UDP and TCP, one buffer per question, the name as it travelled with its labels joined by a dot. |
| `dns_query` | Compiled | The older name of `dns.query`. Read on each DNS request over UDP and TCP, one buffer per question. |
| `dns.queries.rrname` | Compiled | Read on each DNS message over UDP and TCP, one buffer per question name. |
| `dns.answers.rrname` | Compiled | Read on each DNS message over UDP and TCP, one buffer per answer owner name. |
| `dns.authorities.rrname` | Compiled | Read on each DNS message over UDP and TCP, one buffer per authority owner name. |
| `dns.additionals.rrname` | Compiled | Read on each DNS message over UDP and TCP, one buffer per additional owner name. |
| `dns.response.rrname` | Compiled | Read on each DNS response over UDP and TCP: the questions, every owner name, and the names NS, CNAME, PTR, MX and the SOA primary server point to. |
| `tls.sni` | Compiled | Read on the client's side of a TLS handshake over TCP: the server name of the ClientHello, case kept. |
| `tls_sni` | Compiled | The older name of `tls.sni`. Read on the client's side of a TLS handshake over TCP. |
| `tls.cert_subject` | Compiled | Read on the server's leaf certificate over TCP, the subject as an RFC 4514 string. |
| `tls_cert_subject` | Compiled | The older name of `tls.cert_subject`. Read on the server's leaf certificate over TCP. |
| `tls.cert_issuer` | Compiled | Read on the server's leaf certificate over TCP, the issuer as an RFC 4514 string. |
| `tls_cert_issuer` | Compiled | The older name of `tls.cert_issuer`. Read on the server's leaf certificate over TCP. |
| `tls.cert_serial` | Compiled | Read on the server's leaf certificate over TCP, the serial in uppercase hex bytes joined by colons. |
| `tls_cert_serial` | Compiled | The older name of `tls.cert_serial`. Read on the server's leaf certificate over TCP. |
| `tls.cert_fingerprint` | Compiled | Read on the server's leaf certificate over TCP, its SHA-1 in lowercase hex bytes joined by colons. |
| `tls_cert_fingerprint` | Compiled | The older name of `tls.cert_fingerprint`. Read on the server's leaf certificate over TCP. |
| `tls.certs` | Compiled | Read on the server's certificate chain over TCP, one buffer per certificate as it travelled. |
| `tls.subjectaltname` | Compiled | Read on the server's leaf certificate over TCP, one buffer per DNS name or address of its alternative names. |
| `tls.alpn` | Compiled | Read on a TLS handshake over TCP, one buffer per protocol: those the client offers, the one the server selects. |
| `tls.random` | Compiled | Read on a TLS handshake over TCP, the 32 bytes of each side's hello; the server's once the client's hello was read, as Suricata does. |
| `tls.random_time` | Compiled | Read on a TLS handshake over TCP, the first 4 bytes of each side's hello random. |
| `tls.random_bytes` | Compiled | Read on a TLS handshake over TCP, the last 28 bytes of each side's hello random. |
| `ja3.hash` | Compiled | Read on the client's side of a TLS handshake over TCP: the JA3 fingerprint of the ClientHello, its MD5 in lowercase hex, GREASE left out. |
| `ja3_hash` | Compiled | The older name of `ja3.hash`. Read on the client's side of a TLS handshake over TCP. |
| `ja3.string` | Compiled | Read on the client's side of a TLS handshake over TCP: the JA3 string of the ClientHello, GREASE left out. |
| `ja3_string` | Compiled | The older name of `ja3.string`. Read on the client's side of a TLS handshake over TCP. |
| `ja3s.hash` | Compiled | Read on the server's side of a TLS handshake over TCP: the JA3S fingerprint of the ServerHello, its MD5 in lowercase hex. |
| `ja3s.string` | Compiled | Read on the server's side of a TLS handshake over TCP: the JA3S string of the ServerHello. |
| `ja4.hash` | Compiled | Read on the client's side of a TLS handshake over TCP: the JA4 fingerprint of the ClientHello. |
| `ja4_hash` | Compiled | The older name of `ja4.hash`. Read on the client's side of a TLS handshake over TCP. |
| `ssh.proto` | Compiled | The protocol version of a side's identification string, between its first two hyphens. Read over TCP, once the side's first line is whole. |
| `ssh_proto` | Compiled | The older name of `ssh.proto`, read alike. |
| `ssh.software` | Compiled | The software version of a side's identification string, up to its first space: the comments are not part of it. Read over TCP, once the side's first line is whole. |
| `ssh_software` | Compiled | The older name of `ssh.software`, read alike. |
| `dcerpc.stub_data` | Compiled | The stub of a DCE/RPC request or response: what follows its header to the end of the PDU, an authentication verifier included, each fragment alone. Read over TCP, in the named pipes of SMB and over UDP. |
| `dce_stub_data` | Compiled | The older name of `dcerpc.stub_data`, read alike. |
| `ipv4.hdr` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `ipv6.hdr` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `tcp.hdr` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `udp.hdr` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `icmpv4.hdr` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `icmpv6.hdr` | Compiled | Read on every packet the kernel hands up for the rule's protocol and ports, headers included. |
| `dns.opcode` | Compiled | Compared on each DNS message over UDP and TCP. |
| `dns.rcode` | Compiled | Compared on each DNS message over UDP and TCP, a request carrying its own. |
| `dns.rrtype` | Compiled | Compared on the question types of a DNS request and the answer types of a response, any one matching. |
| `tls.version` | Compiled | Compared on each side of a TLS handshake over TCP: the record version until a hello is read, then the hello's, then the one `supported_versions` names. |
| `ssl_version` | Compiled | Compared on each side of a TLS handshake over TCP, the version read as `tls.version` reads it, any listed one matching. |
| `ssl_state` | Compiled | Compared on a TLS handshake over TCP for `client_hello` and `server_hello`, the state frozen at the server's second read as Suricata freezes it. `client_keyx`, `server_keyx` and `unknown` are refused: the key exchange states are not yet followed the way Suricata moves them. |
| `tls.cert_chain_len` | Compiled | Compared on the server's side of a TLS handshake over TCP, once its chain is known: read, or passed over by the handshake. |
| `tls_cert_expired` | Compiled | Compared on the server's leaf certificate over TCP against the packet's time. |
| `tls_cert_valid` | Compiled | Compared on the server's leaf certificate over TCP against the packet's time. |
| `tls_cert_notbefore` | Compiled | Compared on the server's leaf certificate over TCP, before, after or at a date; a range is refused. |
| `tls_cert_notafter` | Compiled | Compared on the server's leaf certificate over TCP, before, after or at a date; a range is refused. |
| `tls.fingerprint` | Compiled | Compared on the server's leaf certificate over TCP, its SHA-1 equal to the value, case aside. |
| `tls.subject` | Compiled | Compared on the server's leaf certificate over TCP, the value contained in its subject, or with `!` absent from a subject present. |
| `tls.issuerdn` | Compiled | Compared on the server's leaf certificate over TCP, the value contained in its issuer, or with `!` absent from an issuer present. |
| `dcerpc.iface` | Compiled | The interface a DCE/RPC request's context was bound to, once the server accepted the binding, and its major version; `any_frag` changes nothing, every fragment is read alike. Read over TCP and in the named pipes of SMB; over UDP Suricata matches it on no request, nor does this engine. |
| `dcerpc.opnum` | Compiled | The operation number of a DCE/RPC request, on the request's side and the response's. Read over TCP and in the named pipes of SMB; over UDP Suricata matches it on no request, nor does this engine. |
| `metadata` | Accepted, changes nothing | Read and not kept. |
| `target` | Accepted, changes nothing | Read and not kept. |
| `rawbytes` | Accepted, changes nothing | The payload is already matched as raw bytes. |
| `pkt_data` | Accepted, changes nothing | The payload is the only buffer there is. |
| `tag` | Accepted, changes nothing | Packets after the alert are not logged; the alert itself is raised. |
| `prefilter` | Accepted, changes nothing | A prefilter hint; the engine chooses its own prefilter. |
| `requires` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the requirements it states are checked against the engine. |
| `absent` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the inspection engine evaluates it. |
| `asn1` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the inspection engine evaluates it. |
| `flow.elephant` | Parsed, not yet inspected | Parsed and checked; refused until the agent measures a flow's rate the way Suricata decides an elephant. |
| `tcp.session` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the session phases it names are compared with Suricata. |
| `geoip` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the GeoIP database answers it. |
| `vlan.id` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `vlan.layers` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `igmp.type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `decode-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `stream-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `engine-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `app-layer-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `app-layer-state` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the application protocol is detected from the traffic. |
| `ftpbounce` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `filename` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `fileext` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `filemd5` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `filesha1` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `filesha256` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `filesize` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `gunzip` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until transforms run on a buffer. |
| `zlib_deflate` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until transforms run on a buffer. |
| `domain` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until transforms run on a buffer. |
| `tld` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until transforms run on a buffer. |
| `file.name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `http2.header_name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `mdns.queries.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for mDNS. |
| `mdns.answers.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for mDNS. |
| `mdns.authorities.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for mDNS. |
| `mdns.additionals.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for mDNS. |
| `mdns.response.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for mDNS. |
| `llmnr.queries.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for LLMNR. |
| `llmnr.answers.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for LLMNR. |
| `llmnr.authorities.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for LLMNR. |
| `llmnr.additionals.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for LLMNR. |
| `llmnr.response.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers for LLMNR. |
| `ssh.hassh` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh.hassh.string` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh.hassh.server` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh.hassh.server.string` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ftp.command` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `ftp.command_data` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `ftp.completion_code` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `ftp.reply` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `smtp.helo` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `smtp.mail_from` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `smtp.rcpt_to` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.from` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.to` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.cc` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.subject` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.date` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.message_id` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.x_mailer` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.url` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.received` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `email.body_md5` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMTP parser exposes its buffers. |
| `smb.named_pipe` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB parser exposes its fields. |
| `smb_named_pipe` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB parser exposes its fields. |
| `smb.share` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB parser exposes its fields. |
| `smb_share` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB parser exposes its fields. |
| `smb.ntlmssp_user` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB parser exposes its fields. |
| `smb.ntlmssp_domain` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB parser exposes its fields. |
| `krb5_cname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the Kerberos parser exposes its buffers. |
| `krb5_sname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the Kerberos parser exposes its buffers. |
| `snmp.community` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SNMP parser exposes its buffers. |
| `snmp.usm` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SNMP parser exposes its buffers. |
| `snmp.trap_oid` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SNMP parser exposes its buffers. |
| `snmp.trap_address` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SNMP parser exposes its buffers. |
| `sip.method` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.uri` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.request_line` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.stat_code` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.stat_msg` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.response_line` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.protocol` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.from` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.to` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.via` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.user_agent` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.content_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `sip.content_length` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SIP parser exposes its buffers. |
| `quic.sni` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the QUIC parser exposes its buffers. |
| `quic.ua` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the QUIC parser exposes its buffers. |
| `quic.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the QUIC parser exposes its buffers. |
| `quic.cyu.hash` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the QUIC parser exposes its buffers. |
| `quic.cyu.string` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the QUIC parser exposes its buffers. |
| `mqtt.connect.clientid` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.connect.username` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.connect.password` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.connect.willtopic` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.connect.willmessage` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.connect.protocol_string` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.publish.topic` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.publish.message` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.subscribe.topic` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.unsubscribe.topic` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `ldap.request.dn` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.request.attribute_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.responses.dn` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.responses.message` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.responses.attribute_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.bind_request.sasl.mechanism` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.bind_request.sasl.credentials` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ike.vendor` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a IKE parser exposes its fields. |
| `ike.key_exchange_payload` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a IKE parser exposes its fields. |
| `ike.nonce_payload` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a IKE parser exposes its fields. |
| `pgsql.query` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a PostgreSQL parser exposes its fields. |
| `rfb.name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a RFB parser exposes its fields. |
| `websocket.payload` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a WebSocket parser exposes its fields. |
| `dnp3_data` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `dnp3.data` | Parsed, not yet inspected | The older name of `dnp3_data`. Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `enip.product_name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `enip.service_name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `ntp.reference_id` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a NTP parser exposes its fields. |
| `sdp.origin` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.session_name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.session_info` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.uri` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.email` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.phone_number` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.connection_data` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.bandwidth` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.time` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.repeat_time` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.timezone` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.encryption_key` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.attribute` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.media.media` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.media.session_info` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.media.connection_data` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sdp.media.encryption_key` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a SDP parser exposes its fields. |
| `sctp.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `igmp.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ether.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ssh.protoversion` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh.softwareversion` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `http2.frametype` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.errorcode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.priority` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.window` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.size_update` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.settings` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `smb.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB parser exposes its fields. |
| `krb5_err_code` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the Kerberos parser exposes its buffers. |
| `krb5_msg_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the Kerberos parser exposes its buffers. |
| `krb5.ticket_encryption` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the Kerberos parser exposes its buffers. |
| `krb5.weak_encryption` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the Kerberos parser exposes its buffers. |
| `snmp.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SNMP parser exposes its buffers. |
| `snmp.pdu_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SNMP parser exposes its buffers. |
| `ftp.dynamic_port` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `ftp.mode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `ftp.reply_received` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `ftpdata_command` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the FTP parser exposes its buffers. |
| `mqtt.type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.flags` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.qos` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.protocol_version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.reason_code` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.connack.session_present` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `mqtt.connect.flags` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the MQTT parser exposes its buffers. |
| `ldap.request.operation` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.responses.operation` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.responses.count` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.responses.result_code` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.bind_request.authentication` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `ldap.bind_request.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the LDAP parser exposes its buffers. |
| `modbus` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a Modbus parser exposes its fields. |
| `dnp3_func` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `dnp3.func` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `dnp3_ind` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `dnp3.ind` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `dnp3_obj` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `dnp3.obj` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DNP3 parser exposes its fields. |
| `enip_command` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `cip_service` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `enip.status` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `enip.vendor_id` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `enip.product_code` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `enip.device_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a ENIP parser exposes its fields. |
| `nfs_procedure` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a NFS parser exposes its fields. |
| `nfs.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a NFS parser exposes its fields. |
| `rpc` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a RPC parser exposes its fields. |
| `ntp.mode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a NTP parser exposes its fields. |
| `ntp.stratum` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a NTP parser exposes its fields. |
| `ntp.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a NTP parser exposes its fields. |
| `rfb.secresult` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a RFB parser exposes its fields. |
| `rfb.sectype` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a RFB parser exposes its fields. |
| `ike.exchtype` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a IKE parser exposes its fields. |
| `ike.chosen_sa_attribute` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a IKE parser exposes its fields. |
| `ike.key_exchange_payload_length` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a IKE parser exposes its fields. |
| `ike.nonce_payload_length` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a IKE parser exposes its fields. |
| `websocket.flags` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a WebSocket parser exposes its fields. |
| `websocket.mask` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a WebSocket parser exposes its fields. |
| `websocket.opcode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a WebSocket parser exposes its fields. |
| `dhcp.leasetime` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DHCP parser exposes its fields. |
| `dhcp.rebinding_time` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DHCP parser exposes its fields. |
| `dhcp.renewal_time` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until a DHCP parser exposes its fields. |
| `sctp.chunk_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `sctp.vtag` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `sctp.chunk_cnt` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `frame` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the application protocol is detected from the traffic. |
| `lua` | Refused | Runs a Lua script; the agent embeds no interpreter. |
| `luajit` | Refused | Runs a Lua script; the agent embeds no interpreter. |
| `luaxform` | Refused | Transforms a buffer with a Lua script; the agent embeds no interpreter. |
| `replace` | Refused | Rewrites the packet in flight; the agent matches a copy and never rewrites traffic. |
| `filestore` | Refused | Writes files to disk; the agent stores no payload. |
| `filemagic` | Refused | Needs libmagic, which the agent does not link. |
| `file.magic` | Refused | Needs libmagic, which the agent does not link. |
| `bypass` | Refused | Hands the flow to a bypass path the agent does not have. |
| `nfq_set_mark` | Refused | Marks a packet in an NFQUEUE the agent does not read. |
| `tls_store` | Refused | Writes certificates to disk; the agent stores no payload. |
| `tls.store` | Refused | Writes certificates to disk; the agent stores no payload. |
| `config` | Refused | Changes how Suricata logs and bypasses a flow, which the agent does not imitate. |

<!-- END GENERATED SURICATA KEYWORDS -->
