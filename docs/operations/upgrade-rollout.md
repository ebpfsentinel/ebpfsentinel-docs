# Rolling an Upgrade Out, and Reading Drift

This page is a runbook for an estate where the [operator](../features/enterprise/kubernetes-operator.md)
runs the agents and the [dashboard](../configuration/dashboard.md) moves them
from one release to the next. It answers four questions in the order they come
up on an upgrade day: how an upgrade reaches the nodes, what stops it, how to
put it back, and what to do when a node runs something other than what the
resource says. For a single host, a compose file or a plain `helm upgrade`,
[Upgrading](upgrading.md) is the page to read instead.

## Before the first upgrade

Three things have to be true, and each is a one-time setting.

1. **The dashboard knows which releases exist.** It reads the release index
   the release repository publishes, from a file (`upgrades.release_index`) or,
   with the chart, from a ConfigMap holding it under the key
   `release-index.json` (`upgrades.releaseIndexConfigMap`). A release the index
   does not offer cannot be chosen, and nobody types a version: the tag written
   is the version the index names for the configured component,
   `ebpfsentinel` for the community image or `ebpfsentinel-enterprise` for the
   enterprise one.
2. **The dashboard may touch the agent resource, and only it.** Each resource
   is listed once, with the tenant it belongs to. With the chart,
   `upgrades.enabled=true` mounts the pod's service account token and grants
   `get` and `patch` on exactly the listed `EbpfSentinelAgent` resources, each
   in its own namespace. The NetworkPolicy opens the API server's port
   (`networkPolicy.apiServerPort`, 6443 by default) only then.
3. **Nothing else rewrites the image.** Under Argo CD, Flux or any other
   reconciler, tell it to ignore `spec.image.tag` and `spec.image.canary` on
   those resources. A reconciler that does not will put the old tag back after
   every step, and the watch will then halt the upgrade because no node came
   up on the new one.

```yaml
upgrades:
  enabled: true
  releaseIndexConfigMap: ebpfsentinel-release-index
  component: ebpfsentinel-enterprise
  watchMinutes: 15
  resources:
    - tenant: acme
      namespace: ebpfsentinel-system
      name: edge
```

`api_server` in the dashboard's own configuration is read at startup only;
changing it takes a restart. Every other `upgrades` key follows the
configuration file like the rest of the dashboard.

## How an upgrade reaches the nodes

An upgrade is a two-person change, like a configuration rollout, and it moves
through the same stages.

1. **Propose.** On **Upgrades**, under the rollouts section, pick the
   resource, the release, the canary node, optionally the nodes it covers (all
   of them when none are picked), a reason and a watch window. The screen
   shows the breaking changes the index lists for that release and the
   minimum kernel it needs. Nothing is written yet.
2. **Approve.** Somebody else approves. The proposer can withdraw their own
   upgrade and can never approve it. Approval writes `spec.image.canary`: the
   canary node, and only it, runs the new tag, through a DaemonSet of its
   own named `<agent>-agent-canary`. Every other node keeps the tag it had.
3. **Watch the canary.** The window starts. Promotion is refused until it
   ends, and the watch reads the canary node every thirty seconds.
4. **Promote.** Once the window ends clean, promotion writes `spec.image.tag`.
   The main DaemonSet rolls every other node one at a time, with its own
   `maxUnavailable`, and a second window starts over every node the upgrade
   covers.
5. **Settle.** When the second window ends clean, the canary track is cleared.
   The canary node goes back to the main DaemonSet, which costs it one pod
   restart on the image it already ran, and the resource is on one track
   again.

Only one upgrade of a resource is open at a time. A second proposal is refused
while the first is proposed, written, watched, stopped part way or not yet back
on one track.

```bash
kubectl -n ebpfsentinel-system get ebpfsentinelagent edge -o jsonpath='{.spec.image}'
kubectl -n ebpfsentinel-system get daemonset edge-agent-canary
kubectl -n ebpfsentinel-system get ebpfsentinelagent edge \
  -o jsonpath='{range .status.agentStatuses[*]}{.node}{" "}{.version}{" "}{.healthy}{" "}{.ebpfLoaded}{"\n"}{end}'
```

### Choosing the canary and the window

Pick a canary that carries real traffic and is representative of the rest:
same kernel, same NIC driver, same attach mode. A canary on an idle node
proves the image starts, and nothing about the datapath. If the estate mixes
kernels or drivers, upgrade one class at a time by narrowing the node list,
with a canary from that class.

The window should cover at least one full feed refresh and one reload of the
agent's configuration, so the new version has done every periodic thing it
does once. Fifteen minutes is the default; the longest the dashboard accepts is
twenty-four hours.

## What halts an upgrade

The watch reads every node the upgrade reached and halts it, writing what it
saw on the upgrade, when:

| What the watch sees | When |
|---|---|
| A node runs the new tag and reports itself unhealthy | at any time in the window |
| A node runs the new tag with its eBPF programs unloaded | at any time in the window |
| A node reported no agent at all | at the end of the window |
| A node still reports the old version, or none | at the end of the window |

A halt writes nothing. The nodes that moved stay on the new tag and the others
on the old one, so a halted upgrade is a decision left to a person rather than
a rollback taken for them: the reason is on the screen, in the dashboard's
logs (`upgrade halted`) and in the audit trail.

The last two rows are the ones a cluster produces on its own: an image that
cannot be pulled, a node out of resources, a taint the canary DaemonSet does
not tolerate, or a reconciler reverting `spec.image`. Look at the pod before
the agent:

```bash
kubectl -n ebpfsentinel-system get pods -o wide --field-selector spec.nodeName=<node>
kubectl -n ebpfsentinel-system describe pod <pod>
```

The first two rows are the agent's. An agent that runs but reports
`ebpf_loaded: false` met a kernel it could not load on; its log names the
program and the verifier's answer, and
[Troubleshooting](troubleshooting.md) covers the usual causes.

## How to roll back

Roll back from the upgrade's own row. What it writes depends on how far the
upgrade got:

- **Canary only.** The canary track is cleared, so the canary node goes back to
  the tag every other node still runs. Nothing else moves.
- **Promoted, partly or fully.** The main tag is put back to what it was before
  the upgrade, the main DaemonSet rolls the nodes back one at a time, and the
  canary track is cleared.

A rollback is open to either operator, needs no second approval and is
recorded under the name of whoever pressed it. It is refused on an upgrade that
a later upgrade of the same resource has followed: roll the later one back
first, so the resource is never put back over a version somebody chose after
it.

Rolling the image back does not roll the configuration back. A release whose
breaking changes required a configuration edit needs that edit undone too,
through a [configuration rollout](response-rollout.md) or the resource itself;
the index's breaking-changes list, shown when the upgrade was proposed, is the
list to check.

## What drift means

The operator renders one configuration document per agent resource and every
agent it runs should be running exactly that document. Each agent reports, in
`GET /api/v1/agent/status`, the SHA-256 of the document it last loaded and how
many policy writes its API accepted since the process started. The operator
compares the two with what it rendered, writes the answer per node under
`status.agentStatuses[].config` and folds it into a `ConfigDrift` condition on
the resource:

| Condition | Reason | Meaning |
|---|---|---|
| `False` | `InSync` | every agent runs the rendered document, unchanged |
| `True` | `Drifted` | at least one agent runs another document, or had its policy changed through its API |
| `Unknown` | `NotReported` | no agent drifted, and at least one did not say what it runs |
| `Unknown` | `NoAgentAnswered` | no agent pod answered at all |

An agent that does not answer is never counted in sync: silence is `Unknown`,
not `False`. The digest is of the document's bytes, so a default the agent fills
in on its own is never read as a change. A move to `Drifted` also files a
`Drifted` warning event on the resource, with the nodes and the reason.

```bash
kubectl -n ebpfsentinel-system get ebpfsentinelagent edge \
  -o jsonpath='{.status.conditions[?(@.type=="ConfigDrift")]}'
kubectl -n ebpfsentinel-system get ebpfsentinelagent edge \
  -o jsonpath='{range .status.agentStatuses[*]}{.node}{" "}{.config.state}{" "}{.config.reason}{"\n"}{end}'
```

## What to do about drift

The per-node reason says which of three cases it is.

**"runs document ... rather than ...: a reload is pending or was refused".**
The agent holds an older document. Right after a change to a policy resource
this is the reload still on its way and clears itself on the next poll. If it
does not clear, the agent refused the new document: its log carries the
reload error, and `POST /api/v1/config/reload` on that agent returns it. Fix
the policy resource that produced the refused value; the agent keeps running
the last document it accepted in the meantime, which is the one the digest
names.

**"N policy write(s) through the agent API since it started, last METHOD PATH".**
Somebody changed the policy on that node by hand, through the agent's REST API
or its CLI, and the node is now enforcing something no resource describes.
Triage, a feed refresh, a reload, a capture and other writes that change no
policy the document owns are not counted. Decide which side is right:

- If the hand change was a mistake or an emergency that is over, restart the
  agent pod. It comes back on the rendered document with the count at zero. A
  reload is not enough: it reloads the document and keeps the count, because
  the hand change is still what happened to that process.
- If the hand change should stay, write it into the policy resource, let it
  roll out, then restart the pod so the count goes back to zero and the next
  drift means something.

**"the agent does not report which document it runs" or "has not loaded a
document yet".** The node is `Unknown`. The first is an agent too old to report
provenance, which an upgrade to the current release fixes; the second is an
agent still starting.

A drifted node is not halted, blocked or restarted by the operator: drift is
reported, and the decision is the operator's. A drifted node during an upgrade
does not halt the upgrade either, since the watch reads health and version
only; resolve the drift first if the upgrade's breaking changes touch the
setting that drifted.

## The dashboard API

The **Upgrades** screen is built on four routes. Reading needs the dashboard
view permission; every write needs the permission to push agent
configuration.

| Route | What it does |
|---|---|
| `GET /api/v1/{tenant}/upgrades` | the releases offered, the tenant's agent resources with what each node runs, and its upgrades, newest first |
| `POST /api/v1/{tenant}/upgrades` | propose one: `{resource, release, canary, nodes, reason, watch_minutes}`, `nodes` null for every node |
| `POST /api/v1/{tenant}/upgrades/{id}/{step}` | `approve`, `promote`, `rollback` or `reject` |

Every refusal carries `{code, error}`. A step taken at the wrong stage
(`wrong_stage`), a promotion while the canary is still watched (`watching`) or
does not answer (`canary_dark`), a second upgrade of a busy resource
(`in_flight`) and a rollback under a later upgrade (`superseded`) are a `409`;
an approval by the proposer (`same_operator`) is a `403`; a release the index
does not offer (`invalid`) is a `400`; an unknown resource or upgrade
(`unknown`) and a dashboard with no `upgrades` block (`unconfigured`) are a
`404`; an index or an API server that does not answer (`unavailable`) is a
`503`.
