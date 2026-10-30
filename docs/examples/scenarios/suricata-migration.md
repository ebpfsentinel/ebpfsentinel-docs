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
curl -sSfLO https://rules.emergingthreats.net/open/suricata-7.0.3/emerging.rules.tar.gz
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

Against the ruleset published on 2026-07-21:

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
| Enabled rules | 52,798 |
| Compiled | 534 |
| Native detection rules | 611 |
| Refused share | 99.0% |
| Time to compile the corpus | 207 ms |

The categories that compile the most:

| Category | Enabled | Compiled | Refused share |
|----------|---------|----------|---------------|
| `emerging-malware.rules` | 19,375 | 120 | 99.4% |
| `emerging-exploit.rules` | 1,714 | 87 | 94.9% |
| `emerging-info.rules` | 4,549 | 53 | 98.8% |
| `emerging-sql.rules` | 191 | 27 | 85.9% |
| `emerging-scan.rules` | 286 | 23 | 92.0% |
| `emerging-misc.rules` | 21 | 17 | 19.0% |

Suricata runs every one of the refused rules. This engine does not, and the
report is where that is said rather than a feature table.

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

Generated from the compiler's own keyword list. A keyword absent from this
table is refused as outside the compiled subset, and so is any keyword
reading an application-layer buffer.

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
| `content` | Compiled | Literal and `\|hex\|` bytes. Contents chained by `distance` or `within` compile into one expression; independent contents must each match. |
| `nocase` | Compiled | ASCII case-insensitive match of the content before it. |
| `offset` | Compiled | From the start of the captured payload, up to its 2048-byte limit. |
| `depth` | Compiled | Counted from `offset`, as Suricata counts it. |
| `distance` | Compiled | Relative to the previous content. A negative distance is refused. |
| `within` | Compiled | Relative to the previous content. A window shorter than the content is refused. |
| `startswith` | Compiled | Anchors the content to the start of the payload. |
| `endswith` | Compiled | Anchors the content to the end of the payload, only as the last of its chain. |
| `pcre` | Compiled | Flags `i`, `s`, `m`, `x`, `A` and `E`. A construct the matcher does not implement, such as a backreference or a lookaround, refuses the rule; so does a buffer or relative flag. |
| `threshold` | Compiled | Types `limit`, `threshold` and `both`, tracked by source, destination or both. |
| `metadata` | Accepted, changes nothing | Read and not kept. |
| `target` | Accepted, changes nothing | Read and not kept. |
| `fast_pattern` | Accepted, changes nothing | A prefilter hint; every pattern is matched in full. |
| `rawbytes` | Accepted, changes nothing | The payload is already matched as raw bytes. |
| `pkt_data` | Accepted, changes nothing | The payload is the only buffer there is. |
| `flowbits` | Refused | State carried from one rule to another is not kept. |
| `xbits` | Refused | State carried from one rule to another is not kept. |
| `flowint` | Refused | State carried from one rule to another is not kept. |
| `noalert` | Refused | A rule that never alerts only sets state for another. |
| `dsize` | Refused | The captured payload is cut at 2048 bytes, so its size is not the segment's. |
| `isdataat` | Refused | Not in the compiled subset. |
| `byte_test` | Refused | Decoding a field out of the payload is not in the compiled subset. |
| `byte_jump` | Refused | Decoding a field out of the payload is not in the compiled subset. |
| `byte_extract` | Refused | Decoding a field out of the payload is not in the compiled subset. |
| `byte_math` | Refused | Decoding a field out of the payload is not in the compiled subset. |
| `bsize` | Refused | Measures an application-layer buffer. |
| `stream_size` | Refused | Streams are not reassembled. |
| `flags` | Refused | A payload is matched per segment, without its TCP flags. |
| `detection_filter` | Refused | Not in the compiled subset; `threshold` is. |
| `http.uri` | Refused | Inspects an application-layer buffer; so does every sticky buffer and every `http_`, `tls`, `dns`, `ja3`, `file` and `smb` keyword. |

<!-- END GENERATED SURICATA KEYWORDS -->
