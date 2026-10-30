# IDS Configuration

The `ids` section configures intrusion detection rules, sampling, and threshold detection.

## Reference

```yaml
ids:
  enabled: true                       # enable/disable IDS (default: true)
  mode: alert                         # alert or block
  inspect_egress: false               # also classify on the egress hook
  sampling:                           # optional packet sampling
    mode: none                        # none, random, hash, or country_based
    rate: 1.0                         # sample rate 0.0-1.0 (random/hash modes)
  rules:
    - id: "rule-id"
      severity: high                  # critical, high, medium, low, info
      protocol: any                   # any, tcp, udp, icmp (default: any)
      dst_port: 22                    # destination port (or src_port; 0 for ICMP)
      pattern: "regex-pattern"        # optional payload regex
      description: "Rule description"
      threshold:                      # Optional threshold detection
        type: threshold               # limit, threshold, or both
        count: 5
        window_secs: 60               # Seconds
        track_by: src_ip              # src_ip, dst_ip, or both
  suricata:                           # optional Suricata rulesets
    rulesets:
      - /etc/ebpfsentinel/suricata/emerging-scan.rules
    vars:
      addresses:
        HOME_NET: "[10.0.0.0/8]"
      ports:
        HTTP_PORTS: "[80,8080]"
    max_refused_share: 0.5            # refused share above which the load fails
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the IDS module |
| `mode` | `string` | `alert` | `alert` (detect only) or `block` (requires IPS) |
| `sampling` | `Sampling` | - | Sampling configuration (see below) |
| `inspect_egress` | `bool` | `false` | Also run the classifier on the egress hook. Enables cgroup/container attribution of locally-originated (e.g. container outbound) traffic, since on egress the originating socket is bound to the packet |
| `rules` | `[Rule]` | `[]` | Detection rules |
| `suricata` | `Suricata` | - | Suricata rulesets compiled into detection rules at load (see below) |

### Sampling

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mode` | `string` | `none` | `none`, `random`, `hash`, or `country_based` |
| `rate` | `float` | - | Share sampled, 0.0-1.0. Required for `random` (drawn per packet in the `tc-ids` classifier) and `hash` (selected on the address pair) |
| `high_risk_countries` | `[string]` | `[]` | ISO 3166-1 alpha-2 codes for full inspection (`country_based` mode). Max 250 codes |
| `high_risk_rate` | `float` | `1.0` | Sample rate for high-risk countries (default: 100%) |
| `default_rate` | `float` | `0.1` | Sample rate for all other countries |

### Rule

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique identifier |
| `severity` | `string` | Yes | `critical`, `high`, `medium`, `low`, `info` |
| `protocol` | `string` | No | `any` (default), `tcp`, `udp`, `icmp`. `any` covers TCP, UDP and ICMP |
| `dst_port` | `integer` | One of the two | Destination port to match. Use `0` for a protocol that carries no port, such as ICMP |
| `src_port` | `integer` | One of the two | Source port to match, for rules that fire on the reply leg |
| `pattern` | `string` | No | Regex matched against the captured TCP payload (see [Content patterns](#content-patterns)). TCP only |
| `mode` | `string` | No | Per-rule mode override (`alert` or `block`). The section `mode` is a master switch: while it is `alert`, a rule asking to block only raises an alert |
| `description` | `string` | No | Human-readable description |
| `enabled` | `bool` | No | Enable/disable this rule (default: `true`) |
| `threshold` | `Threshold` | No | Threshold detection settings |
| `domain_pattern` | `string` | No | Match against the SNI/DNS domain (requires `domain_match_mode`) |
| `domain_match_mode` | `string` | No | `exact`, `wildcard`, or `regex` (required when `domain_pattern` is set) |
| `country_thresholds` | `map<string, Threshold>` | No | Per-country threshold overrides (ISO 3166-1 alpha-2 → Threshold). Overrides the rule's `threshold` for traffic from listed countries |
| `interfaces` | `[string]` | No | Restrict the rule to specific interfaces or interface groups |
| `workload` | `Workload` | No | Restrict the rule to the containers, pods or units it names (see [Workload scope](#workload-scope)). A rule names `interfaces` or a `workload`, not both |
| `tenant_id` | `integer` | No | Tenant this rule belongs to. `0` (the default) is global: the rule applies to traffic from every tenant. A non-zero value scopes the rule to packets the agent resolves to that tenant, and takes precedence over a global rule on the same port. An agent without tenant attribution resolves every packet to `0`, so leave it unset there |

The classifier keys its lookup on a port, and it is the only thing that
raises an IDS event: a rule naming neither `dst_port` nor `src_port` could
never fire, so the agent refuses to start on one.

### Content patterns

A rule without a `pattern` fires on the port alone: the kernel classifier
keys on `(protocol, port)` and every matching packet is a detection. A rule
carrying a `pattern` is decided on the payload instead, in userspace, against
the bytes the classifier copies out of the packet. What that changes:

- **TCP only.** Only TCP payloads are captured, so a content rule must set
  `protocol` to `tcp` or `any`. The agent refuses to start on a content rule
  declared `udp` or `icmp`.
- **The port is captured automatically.** The ports a content rule names are
  added to the payload capture set on top of `l7.ports`; nothing has to be
  listed twice. The combined set is still bound by the 256-port limit.
- **Up to 2048 bytes per segment** are captured, from the start of the TCP
  payload. A pattern spanning a segment boundary, or landing past that
  offset, does not match.
- **The pattern matches raw bytes.** Unicode mode is on by default, so
  `\x90` means the code point U+0090 and not the byte `0x90`. Prefix the
  pattern with `(?-u)` to match bytes literally, as in `(?-u)\xffSMB`.
- **Encrypted traffic carries no plaintext.** A pattern on port 443 matches
  the TLS record bytes, not the request inside them.

Both `dst_port` and `src_port` are honoured, so a rule can fire on the reply
leg of a conversation.

### Suricata rulesets

A Suricata ruleset is compiled when the configuration is loaded, one rule at a
time. A rule whose every keyword the engine can evaluate on a captured TCP
payload becomes one detection rule per port it names; any other rule is
refused, and the refusal names the keyword that stopped it. Nothing is
approximated: a rule either means here what it means in Suricata, or it does
not load. What was refused is read with `ids suricata` or
`GET /api/v1/ids/suricata/report`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `rulesets` | `[string]` | `[]` | Ruleset files, read in this order. At most 256, each at most 128 MiB |
| `vars.addresses` | `map` | stock | Address variables by name without the `$`, laid over the ones Suricata ships in its own `suricata.yaml` |
| `vars.ports` | `map` | stock | Port variables, the same way |
| `max_refused_share` | `float` | `0.5` | The share of a ruleset's enabled rules that may be refused, from 0 to 1. A ruleset refusing more fails the load |

What holds across the import:

- **The stock variables apply unless replaced.** `HOME_NET` defaults to
  `[192.168.0.0/16,10.0.0.0/8,172.16.0.0/12]` and `EXTERNAL_NET` to
  `!$HOME_NET`, as in a fresh Suricata install. Set `HOME_NET` to your own
  networks, or a rule written `$EXTERNAL_NET -> $HOME_NET` watches the wrong
  direction.
- **A sid is one rule across every ruleset.** A sid compiled from an earlier
  file is refused in a later one rather than loaded twice.
- **A commented-out rule is counted as disabled** and is not read.
- **Imported rules take no kernel slot.** They are decided on the payload in
  userspace, like any content rule, and the ports they name join the payload
  capture set. That set is still bound by the 256-port limit, and imported
  rules count against the 50,000 detection rules a configuration may hold.
- **A failed import keeps the running configuration.** A file that cannot be
  read, or a ruleset refusing more than `max_refused_share`, rejects the whole
  configuration; on a reload the one already running stays in place.

The default share is deliberately strict. A whole Emerging Threats Open
corpus is mostly rules on HTTP, DNS and TLS fields and on flow state, which
the engine does not evaluate, so it refuses about 99% of its rules and fails
the load at `0.5`. Import the categories written on raw content, such as scan
or exploit rulesets, and check one first without an agent:

```bash
ebpfsentinel-agent ids suricata-check emerging-scan.rules --address-var HOME_NET=10.0.0.0/8
```

Raising `max_refused_share` to load a whole corpus is allowed, and the report
then says what share of it is not evaluated at all.

#### What an imported rule costs

Every imported rule on a port is tried against each segment captured on that
port, so the cost grows with the number of rules sharing a port. Measured on
one core, all rules on port 80 and none matching, which is the worst case:

| Imported rules on the port | Time per segment | Segments per second per core |
|----------------------------|------------------|------------------------------|
| 100 | 2.8 us | about 350,000 |
| 1,000 | 67 us | about 15,000 |
| 5,000 | 556 us | about 1,800 |

A few hundred rules per port is comfortable on a busy link; thousands on one
port are not, which is another reason to import by category.

### Workload scope

A `workload` block limits a port rule to traffic that crosses the link of a
selected container. The agent learns which container owns each veth or netkit
device as the link appears, and the kernel classifier decides the rule on that
container's cgroup, so a scoped rule costs two map lookups and no extra pass
over the packet. On a host interface, where there is no container link, the
cgroup is the one of the local socket that sent the packet.

| Field | Type | Description |
|-------|------|-------------|
| `unit` | `string` | A systemd unit, such as `nginx.service` |
| `cgroup` | `string` | A cgroup path prefix, such as `/system.slice/docker-` |
| `container` | `string` | A container name or id |
| `pods` | `LabelSelector` | Kubernetes pod labels (`matchLabels`, `matchExpressions`) |
| `namespaces` | `LabelSelector` | Kubernetes namespace labels, combined with `pods` |
| `service_account` | `string` | A Kubernetes service account |

Every field set must match, and at least one must be set. What a scoped rule
does not do:

- **No executable path.** A packet crossing a container link has no process
  attached, so a selector on an executable could never be decided there. The
  agent refuses it.
- **No content pattern.** A rule carrying a `pattern` is decided in userspace,
  on bytes copied out of the packet, where the link it crossed is no longer
  known. The agent refuses a `workload` on a content rule.
- **On Kubernetes, select pods.** The link belongs to the pod sandbox, not to
  any one of its containers, so a `container` selector matches the sandbox.
  Name the pods by label instead.
- **Coverage starts once the workload is seen.** A container is known from the
  moment its link appears with a process behind it, or from its first exec
  once the process table is on. Traffic before that is not inspected by the
  scoped rule.

```yaml
ids:
  rules:
    - id: redis-from-anywhere
      severity: high
      protocol: tcp
      dst_port: 6379
      description: "Redis reached on the cache pods"
      workload:
        pods:
          matchLabels:
            app: cache
```

`GET /api/v1/ids/rules` returns the selector of a scoped rule in its
`workload` field, as one line.

### Threshold

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `string` | Yes | `limit`, `threshold`, or `both` |
| `count` | `integer` | Yes | Match count for the mode |
| `window_secs` | `integer` | Yes | Time window in seconds |
| `track_by` | `string` | No | Tracking key: `src_ip` (default), `dst_ip`, or `both` |

## Threshold Modes

| Mode | Behavior |
|------|----------|
| `limit` | Alert on first N matches, then suppress until window resets |
| `threshold` | Alert only after N matches within the window |
| `both` | Alert after N matches, then suppress until window resets |

## Examples

### SQL injection and XSS detection

```yaml
ids:
  mode: alert
  rules:
    - id: sql-injection
      protocol: tcp
      dst_port: 80
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: high
      description: "SQL injection attempt"
    - id: xss
      protocol: tcp
      dst_port: 80
      pattern: "(?i)(<script|javascript:|on\\w+\\s*=)"
      severity: high
      description: "Cross-site scripting attempt"
```

### Country-based sampling with per-country thresholds

```yaml
ids:
  mode: alert
  sampling:
    mode: country_based
    rate: 1.0
    high_risk_countries: [RU, CN, KP, IR]
    high_risk_rate: 1.0                   # 100% inspection for high-risk countries
    default_rate: 0.1                     # 10% for all others
  rules:
    - id: ssh-bruteforce
      protocol: tcp
      dst_port: 22
      severity: high
      threshold:
        type: threshold
        count: 5
        window_secs: 60
        track_by: src_ip
      country_thresholds:
        RU:
          type: threshold
          count: 2                        # Only 2 attempts from Russia
          window_secs: 60
          track_by: src_ip
```
