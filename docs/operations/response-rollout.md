# From Dry Run to Enforcement

> **Edition: Enterprise**

Automated response is the one part of the agent that can stop a production
service on its own. This page is written for the person who signs off on turning
it on: what each action does, what it cannot undo, which guardrail covers which
risk, and what to put on the never-act list before the first day anything
enforces. The reference for every field is
[Automated Response](../features/enterprise/automated-response.md) and
[Response Configuration](../configuration/response.md); this page is the order
to read them in and the order to switch things on.

## What each action does, and what it cannot undo

| Action | What it touches | How far it reaches | How it ends | What stays done |
|--------|-----------------|--------------------|-------------|-----------------|
| `block_ip` | One address, as source, destination or both | Every flow to or from that address on this node, including legitimate ones sharing it behind a NAT | Its own duration, bounded by `max_ttl_secs` | Nothing once it lapses |
| `rate_limit_ip` | One address | Throttles rather than drops, so a busy legitimate client slows down too | Its own duration | Nothing once it lapses |
| `isolate_flow` | One connection, by its addresses, ports and protocol | Only that conversation; the host and its other flows are untouched | Its own duration | Nothing once it lapses |
| `quarantine_cgroup` | One workload: every process in its cgroup and every process it starts afterwards | All of that workload's network, in both families: no new connection, no new listener, and its existing connections torn down unless `tear_down_flows: false` | A kernel deadline on the boot clock, clamped to `max_window_secs`, or `release_cgroup` | A connection the workload lost is not restored when the quarantine lifts; the client has to reconnect |
| `kill_process` | One process, the one the alert named | A running program and whatever it was doing: open transactions, unflushed writes, the requests it was serving | It does not end | Everything. A stopped process does not come back, and if a supervisor restarts it, it restarts from the beginning |
| `webhook_notify` | Nothing on the node | Whatever the receiving playbook does | Delivery, with retries | Whatever the receiver did with it |

Three consequences worth stating before anybody turns a rule on:

- **Only `kill_process` is irreversible.** Every other action on the node
  expires by itself, and the quarantine expires in the kernel, so it lapses even
  when the agent is not running to lift it.
- **An address is not a workload.** A block on an address shared by a load
  balancer, a NAT gateway or a proxy blocks everybody behind it. Where the alert
  names a workload, the quarantine is the narrower tool.
- **A quarantine with `tear_down_flows: false` is half a containment.** The
  workload can open nothing new and keeps every connection it already held. That
  is a legitimate choice for a database that must not drop its replicas, and it
  is not what an operator reading "quarantined" will assume.

## Which guardrail covers which risk

| Risk | Guardrail | Where it is set | Who can change it |
|------|-----------|-----------------|-------------------|
| A new rule matches far more than its author thought | `dry_run: true` on the rule: everything is evaluated and written to the trail as `dry_run`, nothing is enforced | The rule | Anyone allowed to push configuration |
| A rule, any rule, touches the service the business runs on | The never-act list, matched by workload selector and by address | Node configuration | Only whoever deploys the node's configuration; no API call can shorten it |
| A rule that is right in general fires a hundred times in a minute | A budget per rule and per window; past it the rule is refused and one `response-budget` alert says so | The rule | Anyone allowed to push configuration |
| A severe alert is acted on before a person looked at it | Approval above `min_severity`, with a timeout that refuses unless configured otherwise | Node configuration | Only whoever deploys the node's configuration |
| The same source keeps triggering the same rule | `cooldown_secs` per rule and per source address | The rule | Anyone allowed to push configuration |
| The automation stops the runtime, the kubelet or the agent itself | Hard-coded refusals for kill and quarantine, widened by `protected_commands`, `protected_pids`, `protected_paths` and `protected_ids` | Built into the agent, widened by node configuration | Nobody can shorten the built-in list |
| A process is stopped on a node where nobody agreed to that | `response.kill_process.enabled` and `response.quarantine.enabled`, both `false` by default; a rule asking for either is skipped where it is off | Node configuration, per node | Only whoever deploys the node's configuration |
| A block or a quarantine is left in place far longer than meant | `max_ttl_secs` refuses a longer action; `max_window_secs` clamps a quarantine | Node configuration | Only whoever deploys the node's configuration |
| Nobody can say afterwards what the automation did | The audit trail: every match, refusal, approval and outcome, naming the rule and who decided | Always on | Nobody |
| A forged request makes the playbook act | Signed webhooks, HMAC-SHA256 over the timestamp and the body | The webhook endpoint | Anyone allowed to push configuration |

The split in the last column is deliberate. What a rule carries can arrive over
the API from anywhere a rule can be written; what the node carries changes only
with a deployment. The fences a rule should not be able to lower - the
never-act list, the approval threshold, whether a node may stop a process at
all, and the ceilings on how long an action lasts - are all on the node's side.

The order the fences apply in is fixed: the never-act list, then dry run, then
an action already waiting for the same decision, then the rule's budget, then
the approval queue, and only then the action. A dry run therefore reports the
same never-act refusal enforcement would, and an action waiting for approval has
already been counted against its rule's budget.

## What to put on the never-act list before the first enforcement day

Everything whose loss would turn an incident into an outage, or would take away
the way back in. A typical first list:

- **The way in:** the bastions, the VPN concentrators and the address ranges
  the operations team works from. `sshd` and Teleport are already refused by the
  quarantine; a block on an address is not, so the ranges belong here.
- **The control plane:** the Kubernetes API servers and etcd, the namespaces
  `kube-system` and whatever runs the ingress controllers, and the cluster's
  internal service range.
- **Name and time:** the DNS resolvers and the NTP servers the estate uses. A
  blocked resolver looks like every service failing at once.
- **Stateful services:** the databases, message brokers and storage nodes, by
  unit or by image, so an alert on a client of theirs never quarantines the
  server.
- **Monitoring and logs:** the SIEM collectors, the metrics scrapers and the log
  shippers. Cutting them off removes the evidence of what the automation did.
- **Identity and backup:** the identity provider, the secret store and the
  backup targets.
- **Delivery:** the CI runners and the registry the nodes pull from, so a
  response cannot stop the deployment that would fix the problem.

Write each entry with the narrowest selector that still names the service -
`{unit, namespace}` is narrower than either alone - and give it an `id` people
will recognise in the trail, because that id is what a refusal names.

```yaml
enterprise:
  response:
    never_act:
      - id: ops-bastions
        cidr: 10.10.0.0/28
      - id: kube-control-plane
        namespace: kube-system
      - id: resolvers
        cidr: 10.0.53.0/29
      - id: primary-database
        unit: postgresql.service
      - id: log-shipping
        image: docker.io/fluent/fluent-bit
```

## Switching it on, in order

1. **Turn on nothing that touches a process.** Leave
   `response.kill_process.enabled` and `response.quarantine.enabled` at `false`
   on every node, and write the never-act list first.
2. **Create every rule in dry run.** Set `"dry_run": true` and a budget on each
   one. A dry run spends no budget, so the budget is there for the day the rule
   enforces.
3. **Read the trail for as long as the estate's traffic needs.** At least one
   full business cycle: a week covers the batch jobs and the backups that run on
   Sundays. Filter on `outcome=dry_run` per rule, and read the `skipped`
   records too: a never-act refusal in a dry run is the list doing its job.
4. **Set the approval threshold.** `min_severity: high` with the default
   `on_timeout: refuse` puts a person in front of every severe action from the
   first enforcing day, and the queue is on the response screen of the
   dashboard.
5. **Enforce the actions that undo themselves first.** Re-create the rules
   carrying `block_ip`, `rate_limit_ip` and `isolate_flow` without `dry_run`,
   with short durations. Watch
   `ebpfsentinel_ent_response_budget_refusals_total` and the
   `response-budget` alerts: a budget that is hit every day is a rule matching
   too much, not a ceiling set too low.
6. **Enable the quarantine on the nodes that need it.** Turn
   `response.quarantine.enabled` on node by node, start the rules with
   `report_only: true`, then enforce them with a short `duration_secs`.
7. **Enable the kill last, and only where it is wanted.** Turn
   `response.kill_process.enabled` on for the nodes where stopping a process is
   acceptable, add what must survive to `protected_commands`, and give every
   rule carrying `kill_process` a `min_severity` at or above the approval
   threshold, so every stop it asks for waits for a person.

Rules have no update call, and a second rule under an id already in use is
refused: to take one out of dry run, delete it and create it again under the
same id with the field off. The trail keeps the dry-run records under that id,
so the history reads as one rule.

## What the kernel and the node must offer

Neither the quarantine nor the kill depends on the BPF LSM: the kill rides a
tracepoint and the quarantine rides the cgroup socket hooks, both present on the
agent's supported kernel floor. What decides whether they run on a given node is
that node's own configuration and whether the programs loaded there, and the
agent reports both for its own host rather than leaving them to a table:
`GET /api/v1/ebpf/kernel-features` says whether each capability is attached and
armed.

Two limits come from where the action is taken rather than from the kernel:

- **A forwarded flow has no local process.** On a node that only routes or
  balances a connection, an alert carries no process and no cgroup, so the kill
  and the quarantine are skipped and say so, rather than aimed at a guess.
- **A process is stopped at its next system call.** A target that makes none
  inside `window_ms`, or one that handles the signal, is reported as a
  survivor. `success` means the process is gone, not that a signal was sent.

## After every enforcement day

- Read the trail filtered on `outcome=failed` and on the rules that fired most.
- Read `ebpfsentinel_ent_response_approval_decisions_total` by `decision`: a
  queue that mostly times out is a threshold nobody is staffed to answer.
- Read `ebpfsentinel_ent_response_never_act_refusals_total`: a refusal that
  keeps coming from the same rule is a rule aimed at something the business
  has already said must not be touched.
