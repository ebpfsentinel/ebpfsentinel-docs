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
keyword the engine cannot evaluate - state kept across packets, an HTTP, DNS or
TLS field, a reassembled stream - is refused rather than loaded with that part
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
query. This engine is a payload matcher. It sees the bytes of one TCP segment
at a time, on the ports a rule names, and decodes nothing for the rules to
read. Most of the Emerging Threats Open corpus is written against what
Suricata decodes, so most of it is refused: 534 of the 53,073 enabled rules of
the Suricata 8 build compile, and the rest are refused by name before
anything loads (the corpus measured in
[Importing Emerging Threats Open](../examples/scenarios/suricata-migration.md#step-3-the-whole-corpus-measured)).

What an imported rule can do here:

| Suricata capability | Here |
|---|---|
| `content` with `nocase`, `offset`, `depth`, `distance`, `within`, `startswith`, `endswith`, negated or not, with Suricata's backtracking | Yes, on one captured segment |
| `pcre` on PCRE2 with flags `i`, `s`, `m`, `x`, `A`, `E`, `G`, `R`, lookarounds and backreferences | Yes; an expression PCRE2 refuses is refused, as Suricata refuses it |
| `isdataat`, `bsize`, `byte_test`, `byte_jump`, `byte_extract`, `byte_math`, `entropy`, `base64_decode`, `base64_data` | Yes, on the captured payload |
| Transforms: `to_lowercase`, `to_uppercase`, `strip_whitespace`, `compress_whitespace`, `url_decode`, `from_base64`, `to_md5`, `to_sha1`, `to_sha256`, `xor`, `pcrexform`, `dotprefix`, `header_lowercase`, `strip_pseudo_headers` | Yes |
| `flow` with `established`, `stateless` and the direction words | Yes, from the side of the rule's port |
| `threshold` (`limit`, `threshold`, `both`) | Yes |
| Address variables, address lists and negated addresses | Yes, checked against the segment's addresses |
| Several alerts for one segment | Yes, every matching rule raises its own alert |
| State across packets and rules: `flowbits`, `xbits` and `hostbits` on a flow, a host or a pair of hosts, `flowint`, `noalert`, `detection_filter` | Yes. A bit lives on the flow in both directions, on an address or on a pair with its `expire`; a rule writing state runs before a rule reading it on the same segment. Not yet: `xbits` with `track tx`, `detection_filter` with `unique_on`, `flowvar` and `pktvar` |

Each of these decides as Suricata 8 decides: `crates/domain/tests/suricata_inspect.rs`
in the agent tree runs a few hundred rules and payloads through a real Suricata
(the script beside its fixture) and asserts the same verdict here, case by case;
`crates/domain/tests/suricata_flow.rs` does the same for the state rules keep
across segments, replaying packets in order through one loaded engine.

What it cannot do, each one refused at import with the keyword that stopped
it (the refusals are asserted by the compiler's tests in
`crates/domain/src/ids/suricata.rs` of the agent tree). These are the
engine's gaps, not choices Suricata leaves open:

| Suricata capability | Here |
|---|---|
| Application-layer buffers: `http.*`, `tls.*`, `dns.*`, `ja3`, `file.*`, `smb`, `dcerpc`, `ssh`, `smtp`, `ftp` keywords, and rules whose protocol is `http`, `tls`, `dns` or another application protocol | No. Nine refused rules in ten in the measured corpus are refused for this |
| Rules over UDP, ICMP or IP (`alert udp`, `alert icmp`, `alert ip`) | No, only a TCP payload is captured |
| Stream reassembly by sequence number, `stream_size`, `flow:only_stream` | No. A pattern split across two segments is not seen |
| Packet fields: `dsize`, `flags`, `ttl`, `seq`, `ack`, `window`, `ipopts` and the rest | No; `dsize` because the payload is cut at 2048 bytes |
| A pcre flag naming an application-layer buffer (`U`, `H`, `C` and the rest) | No, for the reason of the first row |
| Rules with `any` port on both sides, a port on both sides, a negated port, or a range naming more than 16 ports | No, a rule is keyed on a port the kernel captures for |
| `drop`, `reject`, `pass` actions, inline blocking | No, an imported rule alerts and never drops: the match is decided after the segment has gone through |
| `lua`, `replace`, `filestore`, `dataset`, `iprep`, file extraction | No |

How a captured payload differs from what Suricata inspects:

- **One segment, up to 2048 bytes.** The kernel copies at most 2048 bytes of a
  segment's payload; `offset` and `depth` count within that. A pattern beyond
  it, or across two segments, does not match.
- **Captured on the rule's ports.** The kernel copies payload only on the
  ports content rules name, so a protocol on another port is not inspected.
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
- `ebpfsentinel_packets_total{interface="IDS_METRICS", action}` - kernel-side counters (`matched`, `dropped`, `errors`, `events_dropped`, `total_seen`, `cgroup_resolved`, `cgroup_attributed`, `ct_kill_confirmed`, and `l7_flow_dropped` for packets of a connection an [L7 rule refused](l7-firewall.md#what-a-deny-blocks))
