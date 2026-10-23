# Automated Response Orchestration

> **Edition: Enterprise**

## Overview

Automated response orchestration evaluates every security alert against configurable policies and executes response actions in real-time. Supports IP blocking, rate limiting, flow isolation, and SOAR webhook integration with cooldown protection and a full audit trail.

> **OSS includes basic auto-response**: up to 3 severity-based policies with block/throttle actions. See [Auto-Response (OSS)](../operational-essentials.md#auto-response). Enterprise adds unlimited policies, MITRE ATT&CK tactic matching, SOAR webhooks, per-IP cooldowns, flow isolation, and a queryable audit trail.

## Architecture

```
OSS Alert Pipeline
  └── SIEM Broadcast Channel
        └── Response Bridge (tokio task)
              └── ResponseOrchestrationService.ingest_siem_event()
                    ├── to_snapshot() → AlertSnapshot
                    ├── engine.evaluate_alert() → actions + budget notices
                    │     ├── Match policies by component + severity + MITRE tactic
                    │     ├── Check cooldown per (policy_id, src_addr)
                    │     └── Decide a disposition per action:
                    │           never-act hit → refused
                    │           rule in dry run → reported, nothing enforced
                    │           budget spent  → refused, one notice per window
                    │           otherwise     → executed
                    ├── execute_action() → ResponseActionResult
                    │     ├── BlockIp / RateLimitIp / IsolateFlow → OssEnforcementAdapter → eBPF maps
                    │     ├── QuarantineCgroup / ReleaseCgroup → OssEnforcementAdapter → cgroup map
                    │     └── WebhookNotify → HTTP POST with retry + backoff
                    ├── engine.record_cooldown()
                    ├── engine.record_action_result() → audit trail
                    └── Metrics (actions, evaluations, webhooks, cooldowns, audit depth)
```

## Response Actions

Seven types of automated response actions can be configured per policy:

| Action | Description |
|--------|-------------|
| **BlockIp** | Block source/destination/both IP addresses for a bounded duration |
| **RateLimitIp** | Apply rate limiting to the offending IP |
| **IsolateFlow** | Block the specific 5-tuple flow via firewall deny rule |
| **QuarantineCgroup** | Cut the workload that owns the offending flow off the network, leaving it running |
| **ReleaseCgroup** | Lift a quarantine this node placed, before its own expiry |
| **KillProcess** | Stop the process that owns the offending flow |
| **WebhookNotify** | Send alert details to a SOAR/webhook endpoint with retry |

`BlockIp`, `RateLimitIp`, and `IsolateFlow` are enforced at the eBPF kernel level via the `OssEnforcementAdapter`, which calls into the OSS IPS blacklist and firewall services to inject actual blocking rules into eBPF maps. `WebhookNotify` executes an HTTP POST to the configured SOAR endpoint. All actions are recorded in the audit trail.

### QuarantineCgroup and ReleaseCgroup

The step between blocking one flow and stopping a program. The workload that owns the offending flow keeps its memory, its logs and its open files, and loses the network: its next `connect()`, `sendmsg()` and `bind()` are refused by the kernel, and the connections it already holds are torn down. It is undoable, by its own expiry and by a release, which is what makes it the action to reach for when an operator wants the process alive to look at.

It is keyed on the cgroup rather than on an address or a process id, which is the whole point: a workload that forks, re-execs or is restarted inside its own cgroup stays cut off, where a process kill would have caught one pid of several and a flow block would have caught one tuple of many. An alert whose workload block carries no cgroup is skipped rather than aimed at a guess, exactly as a kill is.

Unlike the kill, the action carries two fields of its own:

| Field | Default | Description |
|-------|---------|-------------|
| `duration_secs` | the node's configured window | How long the quarantine lasts. Clamped by the node, never trusted as given |
| `report_only` | `false` | Arm the entry and refuse nothing, so a rule can be watched before it cuts |

The duration is the policy's to choose because the right window depends on the alert rather than on the host, and it is clamped on the node because a policy shipped from elsewhere must not be able to cut a workload off for longer than the operator allowed. What the agent will never quarantine whatever a policy asks, and what `tear_down_flows: false` leaves open, is in [Response Configuration](../../configuration/response.md).

Outcomes to read rather than assume:

- `skipped` with a reason is a node where the capability is off, an alert that named no workload, or a cgroup the node protects. A refused cgroup is a configured decision rather than a breakage, so it is a skip carrying the node's own sentence and not a failure.
- `failed` with a reason is the attempt itself having failed: the map could not be written, or the node could not be reached.
- `success` on a quarantine means an entry is armed, and a release's `success` includes a cgroup that was not quarantined, because a release racing an expiry is the ordinary case.

### KillProcess

The only action whose blast radius is a running program rather than a packet, and the only one that cannot be undone: a blocked address is unblocked when the action expires, a stopped process does not come back. It is therefore opt-in twice over. The agent loads nothing that can signal a process unless `response.kill_process.enabled` is set on that node, and a policy carrying this action is refused nothing and simply skipped where it is off, with the reason recorded.

The action carries no signal number and no window of its own. Both are the node's configuration, so an operator who chose a gentler signal or widened the protected list cannot have a policy shipped from elsewhere override it. What the agent will never signal, whatever a policy asks, and how a target is confirmed stopped rather than assumed stopped, is in [Response Configuration](../../configuration/response.md).

Two outcomes to read in the audit trail rather than assume:

- `skipped` with a reason is a node where the capability is off, or an alert that named no process. A transited flow has no local process, and an alert whose node refused the attribution hooks carries no thread group; neither is invented, so the action is skipped rather than aimed at a guess.
- `failed` with a reason is a target the agent refused to signal, or one that outlived the signal. The agent looks the process up again after signalling, so a survivor is reported as one.

`success` means the process is gone, not that a signal was sent.

## Response Policies

Policies map alert conditions to response actions. Multiple actions can be configured per policy. Policies are evaluated in priority order (lower number = higher priority).

### Policy Conditions

| Field | Description |
|-------|-------------|
| `components` | Alert components that trigger this policy (empty = all) |
| `min_severity` | Minimum severity: `Low`, `Medium`, `High`, `Critical` |
| `mitre_tactics` | Optional MITRE ATT&CK tactic filter (empty = all) |

### Cooldown

Each policy has a `cooldown_secs` setting (default: 300 seconds) that prevents action storms. After an action is executed for a `(policy_id, src_addr)` pair, no further actions for the same pair are triggered until the cooldown expires. Expired cooldowns are cleaned up every 60 seconds.

### Dry run

A policy carrying `"dry_run": true` is evaluated exactly as an enforcing one
and enforces nothing: every action it matched is written to the audit trail with
the outcome `dry_run` and a detail line saying what it would have done, and no
map is written, no process is signalled and no webhook is sent.

It defaults to off rather than on, because a rule somebody wrote to enforce must
not be silently disarmed by a field they did not write. The way to arrive at
enforcement safely is the other direction: create the rule in dry run, read the
trail for as long as the estate's traffic needs, then turn the field off.

A dry run spends nothing. It is refused by the never-act list like any other
action, because an operator reading the trail should see the same refusal they
would get in enforcement, and it draws nothing from the rule's budget, because
a ceiling counts what reached a node.

### The never-act list

The list of what the automation may never touch, whatever a policy asks. It is
configuration rather than API state: a rule arriving over the REST surface, or
restored from a state file somebody edited, cannot shorten it. An invalid list
is refused at startup and the subsystem does not arm at all, rather than arming
with a fence the operator believes is there.

Each entry carries an `id` and at least one selector. Entries are matched by
**workload selector, not by address alone**, because the address an alert
carries is the address of a flow and the thing an operator wants spared is a
service:

| Selector | Matches |
|----------|---------|
| `cidr` | Either endpoint of the alert inside the prefix, both families |
| `exe` | The workload's executable path |
| `unit` | The systemd unit the workload runs under |
| `container` | The container id |
| `image` | The container image |
| `pod` | The Kubernetes pod name |
| `namespace` | The Kubernetes namespace |
| `cgroup_id` | The cgroup id the alert was attributed to |
| `pid` | The thread group id |

An entry naming several selectors matches only a target carrying **all** of
them, so `{unit, namespace}` is narrower than either alone and never wider. A
fact the agent could not read matches nothing: an alert whose workload block
carries no unit is not spared by an entry naming a unit, in the same way that an
alert naming no process is not killed. An entry's `id` is what the audit trail
and the metric name, so it is required and has to be unique.

```yaml
enterprise:
  response:
    never_act:
      - id: control-plane
        cidr: 10.0.0.0/24
      - id: database
        unit: postgresql.service
      - id: ingress
        namespace: ingress-nginx
        image: registry.k8s.io/ingress-nginx/controller
```

A refused action is written to the trail as `skipped`, naming the entry that
refused it, and counted on
`ebpfsentinel_ent_response_never_act_refusals_total`. A refusal is a configured
decision rather than a breakage, which is why it is a skip and not a failure.

### A budget per rule and per window

A policy may carry a ceiling:

```json
{"budget": {"max_actions": 20, "window_secs": 300}}
```

Twenty actions per five minutes, counted per rule. The window is tumbling: the
allowance is spent against the window the rule's first action opened, and the
next window starts clean. A sliding window would be fairer and would also mean
holding every action's timestamp per rule for the length of the longest window
configured, which is unbounded memory driven by alert volume, and a ceiling that
fails under volume is not a ceiling. A `max_actions` of `0`, or a `window_secs`
of `0`, is refused when the policy is created rather than accepted as a rule
that can never act.

Exhausting the budget **raises an alert**. Continuing silently and stopping
silently are both incidents, of different kinds: one is an automated outage
nobody authorised, the other is containment an operator believes is running and
is not. So the subsystem emits one alert per window, on component
`response-budget` at severity `high`, naming the rule, the ceiling and the alert
that hit it, and the alert travels the ordinary path: it reaches the SIEM
exporters and the dashboard like any other.

The subsystem does not respond to its own notice. An alert whose component is
`response-budget` is evaluated against no policy, so a rule matching every
component cannot answer the exhaustion of its own ceiling with another action.

Further actions in the same window are refused, written to the trail as
`skipped` naming the rule's own ceiling, and counted on
`ebpfsentinel_ent_response_budget_refusals_total`. That counter deliberately
carries no rule label: a label whose values come from operator-chosen ids is an
unbounded series, and the rule's name is in the alert and in the trail.

### Example Policy

```json
{
  "id": "block-c2-traffic",
  "name": "Block C2 callback sources",
  "enabled": true,
  "priority": 1,
  "conditions": {
    "components": ["ids", "threatintel"],
    "min_severity": "High",
    "mitre_tactics": ["command-and-control"]
  },
  "actions": [
    {"type": "block_ip", "direction": "src", "duration_secs": 3600},
    {"type": "webhook_notify", "endpoint_id": "soar-splunk"}
  ],
  "cooldown_secs": 300,
  "dry_run": false,
  "budget": {"max_actions": 20, "window_secs": 300}
}
```

`dry_run` defaults to `false` and `budget` to absent, which is no ceiling, so a
policy written before either field existed loads unchanged and keeps enforcing.

## SOAR Webhook Integration

Webhook endpoints are configured independently from policies. Multiple policies can reference the same endpoint. Each endpoint supports:

| Field | Default | Description |
|-------|---------|-------------|
| `url` | - | HTTP POST endpoint URL |
| `headers` | `[]` | Custom headers (e.g., `Authorization: Bearer <token>`) |
| `max_retries` | 3 | Retries with exponential backoff (500 ms doubling per retry: 500 ms, 1 s, 2 s, ..., capped at 30 s) |
| `timeout_ms` | 5000 | Per-request timeout |
| `enabled` | true | Enable/disable without deleting |

### Webhook Payload

```json
{
  "alert_id": "1742000000000-ids-rule-42",
  "component": "ids",
  "severity": "Critical",
  "message": "SSH brute force detected",
  "src_port": 54321,
  "dst_port": 22,
  "protocol": 6,
  "timestamp_ns": 1742000000000
}
```

### Example Setup

```bash
# Create webhook endpoint
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://agent:8444/api/v1/enterprise/response/webhooks \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "soar-splunk",
    "name": "Splunk SOAR",
    "url": "https://soar.internal/api/v1/incidents",
    "headers": [["Authorization", "Bearer eyJ..."]],
    "max_retries": 3,
    "timeout_ms": 5000,
    "enabled": true
  }'

# Create policy referencing the webhook
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://agent:8444/api/v1/enterprise/response/policies \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "notify-critical",
    "name": "Notify SOAR on critical alerts",
    "conditions": {"components": [], "min_severity": "Critical"},
    "actions": [{"type": "webhook_notify", "endpoint_id": "soar-splunk"}],
    "cooldown_secs": 60
  }'
```

## Audit Trail

Every executed response action is recorded in a bounded audit trail (default: 10,000 entries), and the trail is returned newest first, so the default limit of 100 answers what the agent has just done rather than what it did after boot. Each record includes:

| Field | Description |
|-------|-------------|
| `id` | Action identifier |
| `action_type` | `block_ip`, `rate_limit_ip`, `isolate_flow`, `quarantine_cgroup`, `release_cgroup`, `kill_process`, `webhook_notify` |
| `outcome` | `success`, `failed` (with reason), `skipped` (with reason), or `dry_run` (with what it would have done) |
| `executed_at_ns` | Execution timestamp |
| `trigger_alert_id` | The alert that triggered this action |
| `trigger_component` | Source component |
| `trigger_severity` | Alert severity |
| `policy_id` | Policy that matched |
| `detail` | Human-readable action description |

### Querying the Audit Trail

```bash
# All recent actions
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://agent:8444/api/v1/enterprise/response/audit

# Filter by policy
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://agent:8444/api/v1/enterprise/response/audit?policy_id=block-c2-traffic"

# Filter by action type
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://agent:8444/api/v1/enterprise/response/audit?action_type=webhook_notify"

# Filter by outcome
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://agent:8444/api/v1/enterprise/response/audit?outcome=failed&limit=50"

# Only what happened after a given moment, in nanoseconds since the epoch
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" "http://agent:8444/api/v1/enterprise/response/audit?since_ns=1750000000000000000"
```

The four filters - `policy_id`, `action_type`, `outcome` and `since_ns` - combine,
are applied before the limit, and the limit keeps the most recent matches. The
answer is a bare array, newest first.

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/response/status` | viewer | automated-response | Service status (active policies, how many of them are in dry run, webhooks, cooldowns, never-act entries, rules whose budget is spent in the window they are in now, audit depth). |
| `GET` | `/api/v1/enterprise/response/policies` | viewer | automated-response | List all response policies. |
| `POST` | `/api/v1/enterprise/response/policies` | operator | automated-response | Create a response policy. |
| `DELETE` | `/api/v1/enterprise/response/policies/{id}` | operator | automated-response | Delete a response policy. |
| `GET` | `/api/v1/enterprise/response/webhooks` | viewer | automated-response | List all webhook endpoints. |
| `POST` | `/api/v1/enterprise/response/webhooks` | operator | automated-response | Create a webhook endpoint. |
| `DELETE` | `/api/v1/enterprise/response/webhooks/{id}` | operator | automated-response | Delete a webhook endpoint. |
| `GET` | `/api/v1/enterprise/response/audit` | viewer | automated-response | Query the audit trail. |

## Metrics

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_response_actions_executed_total` | Counter | `action`, `outcome` | Response actions executed |
| `ebpfsentinel_ent_response_policy_evaluations_total` | Counter | - | Alerts evaluated against policies |
| `ebpfsentinel_ent_response_webhooks_sent_total` | Counter | `result` | Webhook delivery attempts |
| `ebpfsentinel_ent_response_policies_active` | Gauge | - | Active (enabled) policies |
| `ebpfsentinel_ent_response_cooldowns_active` | Gauge | - | Currently active cooldowns |
| `ebpfsentinel_ent_response_audit_trail_depth` | Gauge | - | Audit trail entry count |
| `ebpfsentinel_ent_response_budget_refusals_total` | Counter | - | Actions refused by a rule's own ceiling |
| `ebpfsentinel_ent_response_never_act_refusals_total` | Counter | - | Actions refused by the never-act list |
| `ebpfsentinel_ent_response_policies_in_dry_run` | Gauge | - | Enabled policies that enforce nothing |
| `ebpfsentinel_ent_response_never_act_entries` | Gauge | - | Entries on the never-act list |

`response_policies_in_dry_run` is the series to alert on: a rule left in dry run
after the trail was read is containment the estate believes it has.

## State Persistence

Response policies and webhook endpoints are persisted to a **redb** key-value
store, in the `response_policies` and `response_webhooks` tables, and are
restored on startup. The state store path is configured via
`enterprise.response.state_path` (default:
`/var/lib/ebpfsentinel/response_state.redb`). When that directory does not exist
and the configuration names no path, the agent falls back to
`ebpfsentinel_response_state.redb` in the system temporary directory, so a
policy written on an agent running without `/var/lib/ebpfsentinel` survives a
reload but not a reboot.

Two things are deliberately not in that store, and an operator planning a restart
has to count on neither:

- **The audit trail is in memory.** It is a bounded ring of the most recent
  action results, capped by `audit_max_entries`, and it is empty after a restart. Export
  it to a SIEM if the record has to outlive the process.
- **Containment does not survive a restart.** An active block, rate limit or flow
  isolation lives in an eBPF map with a TTL, and nothing replays those entries
  into the maps on startup, so an agent that restarts mid-containment comes back
  with the maps empty. The policy that produced the action is restored, so the
  next matching alert re-arms it; what is lost is the remainder of the TTL on
  whatever was already blocked.

## eBPF Enforcement

When `BlockIp`, `RateLimitIp`, or `IsolateFlow` actions fire, the `OssEnforcementAdapter` translates them into real eBPF program calls:

| Action | eBPF Enforcement |
|--------|-----------------|
| `BlockIp` | Adds source/destination IP to the IPS blacklist eBPF map |
| `RateLimitIp` | Adds a rate-limit entry for the IP in the XDP rate limiter |
| `IsolateFlow` | Injects a deny rule into the XDP firewall for the specific 5-tuple |
| `KillProcess` | Arms the thread group in the signal program's target map, which signals it at that task's next system call |

`KillProcess` is the one action with no TTL, because there is nothing to expire: a process is stopped once. What is bounded is the attempt, by the node's `window_ms`, after which the target is disarmed whether or not it was ever reached.

The other enforcement actions include a TTL (duration) and auto-expire. The enforcement adapter works in both standalone and fleet/HA modes.

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  response:
    enabled: true
    audit_max_entries: 10000
    never_act:
      - id: control-plane
        cidr: 10.0.0.0/24
      - id: database
        unit: postgresql.service
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Whether the subsystem is wired at all |
| `audit_max_entries` | usize | `10000` | Ring size of the in-memory audit trail |
| `state_path` | string | a well-known system path | Where policies and webhooks are persisted. Set it explicitly when several agents share a host, otherwise they restore each other's policies |
| `never_act` | list of entry | `[]` | What the automation may never act on. Each entry carries an `id` and at least one selector |

Policies and webhook endpoints are managed via the REST API at runtime, not in
static YAML configuration. `never_act` is the exception on purpose: it is the
operator's own fence, so it is not reachable over the API and an entry cannot be
removed by a rule.

## Feature Gating

Automated Response requires a valid license with the `automated-response` feature. Without a license, the response orchestration subsystem is disabled.
