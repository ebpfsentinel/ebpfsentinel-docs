# Importing Emerging Threats Open

Bringing an existing Suricata ruleset across, read for what it is: which rules
the engine runs, which it refuses, and why each refusal is the right answer.

## Scenario

A team runs Suricata with the Emerging Threats Open ruleset and wants the
agent to carry the rules it can. The engine compiles a rule only when it means
here exactly what it means in Suricata, so most of the corpus is refused. The
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
emerging-scan.rules      286        23      24      263  92.0%        81

Refused in emerging-scan.rules, by keyword:
KEYWORD    RULES
http         187
udp           24
flags         16
icmp          12
http1          6
dsize          3
byte_test      2
ftp            2
pcre           2
ssh            2
...
```

How to read it:

- **Enabled** is the rules not commented out; the 81 disabled ones are not read.
- **Compiled** is the Suricata rules that load, and **native** the detection
  rules they become: a rule naming two ports becomes two native rules.
- **Refused, by keyword** is the reason. `http` means the rule is written
  against a parsed HTTP field, which the engine does not evaluate. `udp` and
  `icmp` mean the rule watches a protocol whose payload is not captured.
  `flags` means the rule needs the TCP flags of the segment, which a
  payload match does not see.

Add `--refusals` to list every refused rule with its line, sid and reason.

## Step 3: the whole corpus, measured

The same check run over every category of that release:

| Measure | Value |
|---------|-------|
| Enabled rules | 53,073 |
| Compiled | 534 |
| Native detection rules | 611 |
| Refused share | 99.0% |

The categories that compile the most:

| Category | Enabled | Compiled | Refused share |
|----------|---------|----------|---------------|
| `emerging-malware.rules` | 19,511 | 120 | 99.4% |
| `emerging-exploit.rules` | 1,717 | 87 | 94.9% |
| `emerging-info.rules` | 4,550 | 53 | 98.8% |
| `emerging-sql.rules` | 191 | 27 | 85.9% |
| `emerging-scan.rules` | 286 | 23 | 92.0% |
| `emerging-misc.rules` | 21 | 17 | 19.0% |

What the refused rules ask for, by the first keyword that stopped each one:

| Refused for | Rules |
|-------------|-------|
| An application-layer buffer or protocol (`http`, `dns`, `tls`, `smtp`, `rdp`, `ftp`, `smb` and the rest) | 47,828 |
| State across packets or rules (`flowbits`, `stream_size`, ...) | 1,465 |
| A port shape the kernel cannot key on (`any` on both sides, ranges, negation) | 1,248 |
| A protocol whose payload is not captured (`ip`, `udp`, `icmp`, `tcp-pkt`) | 1,152 |
| A packet field or payload decoding (`dsize`, `pcre` constructs, `byte_test`, `isdataat`, `flags`, ...) | 846 |

Nine refusals in ten are rules written against a field Suricata decodes and
this engine does not. Suricata runs every one of them. This engine does not,
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
| `flow` | Compiled | `established`, `stateless` and the four direction words. A payload is only captured on an established connection, and direction is already the header's port side. |
| `content` | Compiled | Literal and `\|hex\|` bytes, negated with `!`. A match moves the cursor to its end, and when a later match fails the engine tries the next occurrence, as Suricata does. |
| `nocase` | Compiled | ASCII case-insensitive match of the content before it. |
| `offset` | Compiled | From the start of the buffer. |
| `depth` | Compiled | Counted from `offset`, as Suricata counts it. |
| `distance` | Compiled | From the cursor the previous content or pcre left, negative included. |
| `within` | Compiled | From the cursor the previous content or pcre left. A window shorter than the content is refused, as Suricata refuses it. |
| `startswith` | Compiled | Anchors the content to the start of the buffer. |
| `endswith` | Compiled | Anchors the content to the end of the buffer. |
| `pcre` | Compiled | PCRE2, on bytes. Flags `i`, `s`, `m`, `x`, `A`, `E`, `G` and `R`, and the buffer flags of the buffers the engine inspects; lookarounds and back-references run as Suricata runs them. |
| `threshold` | Compiled | Types `limit`, `threshold` and `both`, tracked by source, destination or both. |
| `isdataat` | Compiled | Absolute or relative to the cursor, negated with `!`. |
| `bsize` | Compiled | The length of the buffer it follows. |
| `byte_test` | Compiled | Every operator, string and binary reads, endianness, `dce` read little-endian, bitmask, relative. |
| `byte_jump` | Compiled | Every option: multiplier, align, from_beginning, from_end, post_offset, relative, bitmask. |
| `byte_extract` | Compiled | Sets a variable that a later offset, depth, distance, within, isdataat or byte keyword reads. A variable read before it is set refuses the rule. |
| `byte_math` | Compiled | Every operator; a division by zero does not match. Sets a variable as byte_extract does. |
| `entropy` | Compiled | Shannon entropy in bits per byte over the bytes named; a window past the buffer does not match. |
| `base64_decode` | Compiled | Decodes from the start of the buffer or from the cursor, padding optional. |
| `base64_data` | Compiled | Inspects what the last base64_decode produced. |
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
| `metadata` | Accepted, changes nothing | Read and not kept. |
| `target` | Accepted, changes nothing | Read and not kept. |
| `fast_pattern` | Accepted, changes nothing | A prefilter hint; every pattern is matched in full. |
| `rawbytes` | Accepted, changes nothing | The payload is already matched as raw bytes. |
| `pkt_data` | Accepted, changes nothing | The payload is the only buffer there is. |
| `tag` | Accepted, changes nothing | Packets after the alert are not logged; the alert itself is raised. |
| `prefilter` | Accepted, changes nothing | A prefilter hint; the engine chooses its own prefilter. |
| `requires` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the requirements it states are checked against the engine. |
| `dsize` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `absent` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the inspection engine evaluates it. |
| `asn1` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the inspection engine evaluates it. |
| `urilen` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `uricontent` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `flowbits` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `xbits` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `hostbits` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flowint` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flowvar` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `pktvar` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `noalert` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `detection_filter` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.age` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.pkts` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.pkts_toserver` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.pkts_toclient` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.bytes` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.bytes_toserver` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.bytes_toclient` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `flow.elephant` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the flow table keeps the state it reads. |
| `stream_size` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until TCP is reassembled by sequence number. |
| `tcp.session` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until TCP is reassembled by sequence number. |
| `dataset` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the datasets the configuration names are loaded. |
| `datarep` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the datasets the configuration names are loaded. |
| `iprep` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the reputation lists the configuration names are loaded. |
| `geoip` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the GeoIP database answers it. |
| `flags` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tcp.flags` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `seq` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tcp.seq` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ack` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tcp.ack` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `window` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tcp.window` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tcp.mss` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tcp.wscale` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ttl` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `id` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tos` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ipopts` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `fragbits` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `fragoffset` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `sameip` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ip_proto` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `l3_proto` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `itype` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `icode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `icmp_id` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `icmp_seq` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `icmpv6.mtu` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `vlan.id` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `vlan.layers` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `igmp.type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `decode-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `stream-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `engine-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `app-layer-event` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the engine reports the events it names. |
| `app-layer-protocol` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the application protocol is detected from the traffic. |
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
| `file.data` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `file_data` | Parsed, not yet inspected | The older name of `file.data`. Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `file.name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until files are extracted from the protocols that carry them. |
| `http.uri` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.uri.normalized` | Parsed, not yet inspected | The older name of `http.uri`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_uri` | Parsed, not yet inspected | Moves the content before it into `http.uri`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.uri.raw` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_raw_uri` | Parsed, not yet inspected | Moves the content before it into `http.uri.raw`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.method` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_method` | Parsed, not yet inspected | Moves the content before it into `http.method`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.request_line` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_request_line` | Parsed, not yet inspected | The older name of `http.request_line`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.request_body` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_client_body` | Parsed, not yet inspected | Moves the content before it into `http.request_body`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.header` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_header` | Parsed, not yet inspected | Moves the content before it into `http.header`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.header.raw` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_raw_header` | Parsed, not yet inspected | Moves the content before it into `http.header.raw`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.cookie` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_cookie` | Parsed, not yet inspected | Moves the content before it into `http.cookie`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.user_agent` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_user_agent` | Parsed, not yet inspected | Moves the content before it into `http.user_agent`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.host` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_host` | Parsed, not yet inspected | Moves the content before it into `http.host`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.host.raw` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_raw_host` | Parsed, not yet inspected | Moves the content before it into `http.host.raw`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.accept` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_accept` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.accept_enc` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_accept_enc` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.accept_lang` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_accept_lang` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.referer` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_referer` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.connection` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_connection` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.content_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_content_type` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.content_len` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_content_len` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.start` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_start` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.protocol` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_protocol` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.header_names` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_header_names` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.request_header` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.response_header` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.stat_code` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_stat_code` | Parsed, not yet inspected | Moves the content before it into `http.stat_code`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.stat_msg` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_stat_msg` | Parsed, not yet inspected | Moves the content before it into `http.stat_msg`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.response_line` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_response_line` | Parsed, not yet inspected | The older name of `http.response_line`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.response_body` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http_server_body` | Parsed, not yet inspected | Moves the content before it into `http.response_body`. Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.server` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http.location` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the HTTP/1 parser exposes its buffers. |
| `http2.header_name` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `dns.query` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns_query` | Parsed, not yet inspected | The older name of `dns.query`. Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns.queries.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns.answers.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns.authorities.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns.additionals.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns.response.rrname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
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
| `tls.sni` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_sni` | Parsed, not yet inspected | The older name of `tls.sni`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.cert_subject` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_subject` | Parsed, not yet inspected | The older name of `tls.cert_subject`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.cert_issuer` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_issuer` | Parsed, not yet inspected | The older name of `tls.cert_issuer`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.cert_serial` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_serial` | Parsed, not yet inspected | The older name of `tls.cert_serial`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.cert_fingerprint` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_fingerprint` | Parsed, not yet inspected | The older name of `tls.cert_fingerprint`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.certs` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.subjectaltname` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.alpn` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.random` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.random_time` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.random_bytes` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja3.hash` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja3_hash` | Parsed, not yet inspected | The older name of `ja3.hash`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja3.string` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja3_string` | Parsed, not yet inspected | The older name of `ja3.string`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja3s.hash` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja3s.string` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja4.hash` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ja4_hash` | Parsed, not yet inspected | The older name of `ja4.hash`. Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ssh.proto` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh_proto` | Parsed, not yet inspected | The older name of `ssh.proto`. Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh.software` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh_software` | Parsed, not yet inspected | The older name of `ssh.software`. Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
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
| `smb.named_pipe` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `smb_named_pipe` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `smb.share` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `smb_share` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `smb.ntlmssp_user` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `smb.ntlmssp_domain` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `dcerpc.stub_data` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `dce_stub_data` | Parsed, not yet inspected | The older name of `dcerpc.stub_data`. Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
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
| `ipv4.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ipv6.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `tcp.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `udp.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `icmpv4.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `icmpv6.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `sctp.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `igmp.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `ether.hdr` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the kernel hands over the packet header it reads. |
| `dns.opcode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns.rcode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `dns.rrtype` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the DNS parser exposes its buffers. |
| `tls.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ssl_version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ssl_state` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.cert_chain_len` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_expired` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_valid` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_notbefore` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls_cert_notafter` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.fingerprint` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.subject` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `tls.issuerdn` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the TLS parser exposes its buffers. |
| `ssh.protoversion` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `ssh.softwareversion` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SSH parser exposes its buffers. |
| `http2.frametype` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.errorcode` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.priority` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.window` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.size_update` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `http2.settings` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until an HTTP/2 parser exposes its fields. |
| `dcerpc.iface` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `dcerpc.opnum` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
| `smb.version` | Parsed, not yet inspected | Parsed and checked; a rule carrying it is refused until the SMB and DCE/RPC parsers expose their buffers. |
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
