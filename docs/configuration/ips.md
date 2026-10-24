# IPS Configuration

The `ips` section configures intrusion prevention: automatic IP blacklisting when block-mode rules match, and enforcement of that blacklist in the kernel.

IPS rules are matched by the same kernel program as the IDS rules (`tc-ids`), which watches a `(protocol, destination port)` pair per rule. Two consequences:

- `ids.enabled: false` also silences the IPS rules, because the program that matches them is not attached.
- A rule id may not be reused between `ids.rules` and `ips.rules`, and two rules that watch the same `(protocol, dst_port)` pair cannot both be installed in the kernel map. The IPS rule wins, and the shadowed rule is named in a startup warning.

## Reference

```yaml
ips:
  enabled: true                     # Enable/disable the IPS module (default: true)
  mode: block                       # alert or block (default: alert)
  max_blacklist_duration_secs: 3600 # Blacklist TTL and detection window
  auto_blacklist_threshold: 3       # Detections before an IP is auto-blacklisted
  max_blacklist_size: 10000         # Max entries in the blacklist
  whitelist:                        # IPs/CIDRs that are never blacklisted
    - "10.0.0.0/8"
    - "192.168.1.1"
  whitelist_aliases:                # Named IP-set aliases that are never blacklisted
    - "corp-ranges"
  rules:
    - id: "rule-id"
      description: "Rule description"
      severity: critical
      mode: block              # Per-rule mode override
      protocol: tcp
      dst_port: 4444
      pattern: "(?i)/bin/(ba)?sh"   # Optional payload regex, TCP only
      threshold:
        type: both
        count: 3
        window_secs: 60
        track_by: src_ip
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the IPS module. When disabled, IPS rules raise no alert and nothing escalates to the blacklist |
| `mode` | `string` | `alert` | Enforcement mode. `block` installs blacklisted addresses in the kernel; `alert` is a dry run (see below) |
| `max_blacklist_duration_secs` | `integer` | `3600` | Both the blacklist TTL and the window over which detections are counted (see below). `0` expires entries immediately, it does not mean permanent |
| `auto_blacklist_threshold` | `integer` | `3` | Detections from an IP within the window before it is auto-blacklisted |
| `max_blacklist_size` | `integer` | `10000` | Maximum number of entries in the blacklist. Nothing is evicted to make room: once full, further blacklisting is refused until entries expire |
| `whitelist` | `[string]` | `[]` | IPs/CIDRs that are never blacklisted |
| `whitelist_aliases` | `[string]` | `[]` | Named IP-set aliases that are never blacklisted, resolved once the alias service has loaded |
| `sampling` | `Sampling` | none | Optional sampling configuration (same schema as IDS). Sampled-out packets never reach the blacklist counter |
| `country_thresholds` | `map<string, integer>` | `{}` | Per-country auto-blacklist thresholds (ISO 3166-1 alpha-2 to count). IPs from listed countries are blacklisted after fewer detections. When blacklisted, the source /24 (v4) or /48 (v6) subnet is also injected into the firewall LPM maps |
| `rules` | `[Rule]` | `[]` | IPS rules (`id`, `description`, `severity`, `protocol`, `dst_port`, `pattern`, `mode`, `threshold`, `enabled`, `tenant_id`, `kill_process`) |

An IPS rule shares the IDS rule schema, so those fields behave as they do in
[IDS configuration](ids.md#rule). `tenant_id` defaults to `0`, which is global
and matches traffic from every tenant; set it only on an agent that resolves
packets to tenants.

### Content patterns

An IPS rule may carry a `pattern`, matched against the captured TCP payload
exactly as an IDS rule is, with the same rules: TCP only, up to 2048 bytes
from the start of the payload, `(?-u)` for raw bytes, and the named port
added to the capture set automatically. See
[Content patterns](ids.md#content-patterns) for the detail. An IPS content
rule must name a `dst_port`, since that is the port whose payload is
captured.

### Modes

`ips.mode` decides what reaches the data plane:

- `block` installs every blacklisted address as a host route (/32 or /128) in the firewall LPM maps, so the traffic is dropped at wire speed.
- `alert` is a dry run: detections are alerted and the blacklist still records what would have been blocked, but nothing is installed in the kernel. Removals always go through, so lowering the mode never strands an entry in the kernel.

A per-rule `mode` decides what the match escalates to: a rule in `alert` mode raises an alert but does not feed the auto-blacklist counter, whatever the module mode is.

### Stopping the process behind a blocked flow

`kill_process: true` on a rule asks the agent to stop the process that owns a
flow the rule blocks, on top of blocking it. It is refused at config load
unless the rule's effective mode is `block` (its own `mode`, or `ips.mode`
when it names none) and `response.kill_process.enabled` is on, so a dry run
never stops anything and a node that did not agree to signalling processes
cannot be made to by a rule.

```yaml
response:
  kill_process:
    enabled: true
ips:
  mode: block
  rules:
    - id: ips-reverse-shell
      severity: critical
      protocol: tcp
      dst_port: 4444
      kill_process: true
```

The target is the process the agent attributed the flow to, the same one the
alert names in its `workload` block. A flow nobody could attribute stops no
process: the agent logs that it skipped, and never guesses. The protected list
of [Stopping a process](response.md#stopping-a-process) is checked before
anything is armed, whatever the rule says, and the outcome is in the audit log.
The field shows on `GET /api/v1/ips/rules` only on a rule that sets it.

This is the whole of it in the open-source agent: one rule, one flow, one
process. A dry run of the kill itself, budgets, approval before acting and
policies matching on more than one rule are the
[automated response](../features/enterprise/automated-response.md) of the
Enterprise layer.

### Blacklist duration

`max_blacklist_duration_secs` carries two roles:

- how long a blacklisted address stays blacklisted, after which it is removed and must re-trigger to be blocked again;
- the window over which detections are counted against `auto_blacklist_threshold`. Once an address has been tracked for that long, its counter restarts from the next detection.

Country subnet blocks expire on the same duration.

### What survives a restart

A blacklisted address is written down when it is blocked, in
`mitigations.redb` beside the audit store (the directory is the one
`audit.storage_path` names), and read back when the agent starts. A block comes
back **for what is left of it**, not for a fresh `max_blacklist_duration_secs`:
the record carries the wall-clock time the block was taken, so the time the
agent was down counts against the duration. A block whose duration elapsed
while the agent was down is dropped on the way in and never reaches the kernel,
and a restart loop can therefore not turn a two-hour block into a permanent
one.

Each restored block is written to the audit log with the actor `restore`, so a
reader can tell a block put back at startup from one taken now.

What does not come back:

- **Detection counts.** A restored address starts its counter over, so it needs
  `auto_blacklist_threshold` detections again before the duration is extended.
- **Country subnet blocks.** Only host blocks (/32 and /128) are written down. A
  country threshold that had fired re-fires on the next detection from that
  country.
- **Rate-limit token buckets.** See
  [What survives a restart](response.md#what-survives-a-restart) in the
  response section: a throttle's rate is reinstalled, the credit a source had
  already spent against its bucket is not.

If the store cannot be opened or written, the agent logs it once and keeps
going with an in-memory blacklist: losing the store costs the agent its memory
of a block, never the block itself.

### Whitelist aliases

`whitelist_aliases` names top-level `aliases` entries. An alias value of /32 (or /128) matches that address alone, exactly like a literal `whitelist` entry written without a prefix. An alias that cannot be resolved is logged and skipped rather than failing the startup, so check the logs after renaming an alias.

### Thresholds

`threshold.type`, `threshold.count` and `threshold.window_secs` have no default: a threshold block must carry all three or the configuration is refused. `track_by` defaults to `src_ip`.

## Examples

### Auto-block with whitelist and country thresholds

```yaml
ips:
  mode: block
  max_blacklist_duration_secs: 7200
  whitelist:
    - "10.0.0.0/8"
    - "172.16.0.0/12"
  country_thresholds:
    RU: 2
    CN: 3
    KP: 1
  rules:
    - id: block-reverse-shell
      description: "Reverse shell callback, auto-block"
      severity: critical
      mode: block
      protocol: tcp
      dst_port: 4444

    - id: block-ssh-bruteforce
      description: "SSH brute force, auto-block after 3 hits in a minute"
      severity: high
      mode: block
      protocol: tcp
      dst_port: 22
      threshold:
        type: both
        count: 3
        window_secs: 60
        track_by: src_ip
```
