# Learning Mode

Most hosts have no inventory of what they talk to. Learning mode is how one gets written: the agent watches a node for a window an operator declares, keeps what it saw as a set of destinations rather than a log of flows, and renders that set as firewall rules in the product's own schema. The output is a draft somebody reads, edits and decides on; it is never a policy the node starts enforcing on its own.

Open source, in every tier, and part of the firewall rather than a tool beside it: the document a window produces loads through the same parser, the same validation and the same reload path as a rule written by hand.

## What it is for

- **A first workload policy on a host nobody documented.** Watch for an hour, read back what the node actually dialled, and start from that instead of from a blank file.
- **An inventory that is a reading, not a guess.** Each destination carries the workload that opened the connection, so the draft is already grouped the way a workload rule is written.
- **A before-and-after on a change.** A window opened over a deployment says which destinations are new.

## How a window works

A window is opened with a duration and a scope. While it is open the agent reads the connection table every `sample_interval_secs` and folds each reading into a bounded aggregate keyed by destination address, port, protocol and workload. A thousand connections from one service to one database on one port are one entry, counted; that is what makes a window of several hours affordable.

Three scopes:

| Scope | What it watches |
|---|---|
| The node | every flow this node opened that can be attributed to a workload |
| One cgroup v2 subtree | by absolute path: one systemd slice, one pod |
| A set of workloads | named the way a firewall rule names them: by executable, unit, cgroup or container |

A window reports its own progress, and the figure that matters is `secs_since_new_edge`: how long since it last found a destination it had not already seen. A window whose last new destination was twenty minutes ago has probably run long enough; one that is still finding them every few seconds has not.

A window survives a restart, or says it did not. The agent writes it down as it changes and takes it back at startup; a window that was open across a gap keeps its destinations, records the seconds the agent was down in `gap_secs` and reports `continuous: false`. A window whose declared time passed while the agent was down is closed rather than resumed, because a window silently reset by a redeploy produces a policy missing a day.

## The document

`learning policy` renders the window as YAML. The shape is deliberate:

- **One rule per workload, destination and port range**, with the workload written as the selector a firewall rule already carries: container, unit or executable, whichever the attribution could name.
- **Contiguous ports collapse into a range.** 8080, 8081 and 8082 are one rule; 80 and 443 are two.
- **Four or more addresses of one workload inside the same /24, or /64 on IPv6, collapse into that prefix**, and the rule carries a comment naming the addresses it was built from. Collapsing widens a rule past what was observed, so it is stated in the output rather than performed quietly, and an operator who does not want the generalisation deletes the prefix and writes the addresses back. Three addresses or fewer are always written one by one.
- **Each workload gets a closing deny**, which is what makes the rules above it an allow-list rather than a set of permissions.
- **Every rule comes out in `observe` mode.** Applying the document refuses nothing: each rule counts what it would have refused, under `ebpfsentinel_workload_denials_total`, and moving a rule to `enforce` is a decision somebody takes afterwards.

The header states the window, the scope, how much of it was really watched, how many readings were folded in, and how many destinations were refused for want of room.

## Segmenting a Docker bridge

`learning segmentation` renders a second document from the same window, for the containers on the node's Docker bridge networks. Containers on one bridge reach each other on every port by default; this document turns that into the peers the window actually saw each container reach. For each container on a bridge, in order:

- **Docker's embedded resolver**, `127.0.0.11` on port 53 in UDP and TCP, on every user-defined network. The default `bridge` network has no embedded resolver and gets no such rule.
- **The bridge's gateway**, which is the host itself. What a container may reach on the host is the allow-list's question rather than the bridge's.
- **Each peer the container reached during the window**, by address and port range, with the peer's name in a comment.
- **A closing deny for the rest of the bridge's subnet.**

Destinations off the bridge are left to the allow-list, and the two documents load together: segmentation rules take priorities from 100 and the allow-list from 1000, so a bridge's closing deny is evaluated before an allow-list rule could let a peer through. Every rule comes out in `observe` mode, like the allow-list.

A container the window never saw gets **no rule at all** and is named in the header, because segmenting a container from a reading that never included it would cut every peer it has. A container seen under a name no selector can carry, such as a short hexadecimal name that reads as an id, is named the same way. The header also warns when the document would carry more rules than the workload firewall's 64-rule ceiling.

The bridges are read from the Docker socket when the document is asked for, so `container.docker.enabled` must be on; without it, or when the socket does not answer, the route answers `503` with the reason.

## Segments across the fleet

One node's window says what its workloads reached. Read across every node of a tenant, the windows are a graph, and the dashboard proposes segments from it.

- **A workload is the name the agents give it**: a container, a systemd unit or an executable. The replicas of one container on three nodes are one workload, and the flows each replica opened are added together.
- **A destination is recognised as a workload** when some agent saw that workload dial from the address. Each window keeps, for every workload that reached something, up to 16 local addresses it dialled from. An address nobody dialled from is listed as an external destination of the workload that reached it, and joins nothing.
- **An address several workloads dialled from names none of them.** A node address shared by its systemd units is the usual case. Flows to it are listed with the candidates, and never used to join two segments on a guess.
- **A segment is a set of workloads held together by at least two independent paths.** Each segment lists the links that put its workloads together, so the grouping can be checked rather than trusted. A link whose removal would split the graph is a **bridge**, named with the two segments it is the only link between: the one flow keeping them joined.
- **A segment carries its window.** `window_secs` is the shortest window among the agents whose flows built it, so a segment read off a two-day window says two days even when its neighbour was read off a week. An agent with no window is named, and so is a window the agent was down for part of, or one that filled up.

Each agent's most recent window holding at least one flow is read, running or not. The raw reading is `ebpfsentinel-agent learning edges` on one node, and the fleet's proposal is `GET /api/v1/{tenant}/segments/proposal` on the dashboard.

## The proposal as policy

`GET /api/v1/{tenant}/segments/policy` writes the same windows as workload rules, in both shapes a rule can take: the agent's `firewall.rules` block and an operator `FirewallPolicy`. Nothing is applied: the text goes through the same rollout, approval and replay as any other change, and its first lines say which window it was computed from.

- **One allow rule per destination, port and protocol** a workload was seen reach, each to the single address it reached, then **one rule refusing everything else** for that workload. Every allow sits at a lower priority number than every refusal.
- **Every rule is written in `observe` mode**, so applying the text as it stands changes no verdict. Moving a rule to `enforce` is a decision taken after reading what it would have refused.
- **A workload enters whole or not at all.** An agent holds at most 64 workload rules at once, so the busiest workloads are written first and the ones that do not fit are listed as `unrestricted` with the reason: the ceiling, a destination that is not an address, or a kind no rule can name. Confining half of a workload's destinations would refuse the other half.
- **The replay reads every rule as if it were enforced.** Every observed flow is asked against the proposal, and a flow the proposal would refuse is listed in `refused` rather than summed away; read off its own window, that list is empty. The same flows are asked against each agent's deployed workload rules, and `changes` lists every flow whose verdict the proposal would change on its node, with the deployed rule that decides it today.
- **A deployed rule the window cannot answer for is named, not guessed**: a cgroup, a pod or namespace selector, a domain name, a source address, an alias, a negation, or several workload matchers on one rule. The window records one name per workload and a destination address, nothing more. Rules carrying no workload block belong to the packet firewall and are not asked.
- **The diff is by rule id**, agent by agent: proposed rules not deployed, deployed workload rules the proposal does not carry, and rules carrying the same id with different fields, naming the fields.

A recommendation describes a window; a service used once a quarter is not in it. Read the proposal against what the estate is meant to do, not only against what it did.

## What the mode cannot know

This is the part that decides whether the document is useful or dangerous, so the agent writes it into the document itself rather than leaving it in this page:

- **A destination the node did not reach during the window is not in the document.** The window is a reading of one period, not a specification of what the node is allowed to do. A nightly backup, a quarterly licence check and a failover path that was never taken are absent, and applying the draft in `enforce` mode without reading it is how they break.
- **A flow that opened and closed between two readings was not seen.** The sampler reads what is established; `sample_interval_secs` is the resolution, and a short-lived connection can fall between two readings.
- **Only connections this node opened are recorded.** An accepted connection names the client's ephemeral source port, and a rule carrying it would allow a destination nobody ever dialled.
- **Only TCP and UDP are recorded**, because those are the protocols a workload rule can carry.
- **A flow nothing could attribute is kept and counted as `unattributed`**, with no workload on it. It is not written as a rule, and the count is in the header: a window that could name nothing says so instead of producing a short document that looks complete.
- **A full window is incomplete and says so.** The aggregate refuses past `max_edges` rather than evicting, because a policy written from a window that quietly dropped its oldest destinations would be missing exactly the ones nobody remembers. `dropped_edges` above zero means the reading is short by at least that many destinations.
- **An executable path is forgeable** by anything that can write one, like every workload rule: see [Workload firewall rules](../configuration/workload-firewall.md).

## Reading it in the console

The dashboard offers the document in the configuration editor, diffed line by line against what the node runs today, with the caveats of the window it came from stated above the diff. Each replayable rule the draft carries gets the per-rule replay beside it, so "what would this have done over the events already recorded" is answered on the same screen. Taking the proposal puts it in the editor as an unapplied edit: it is then applied, or not, through the ordinary two-person rollout with its canary, like any other configuration change.

The fleet's reading has a screen of its own, **Segments** under the network section. It states the window the proposal was read off before any segment, warns when a window was interrupted or filled up and names every agent left out of the reading. The replay comes before the rules: the flows the proposal would refuse, the verdicts it would change on each node with the deployed rule deciding them today, and the deployed rules the window cannot answer for. Both texts download as they are, and the way to a rollout is the firewall editor, since nothing on that screen is applied.

## Configuration and commands

The keys are in [Learning mode configuration](../configuration/learning.md); the commands are [`ebpfsentinel-agent learning`](../cli-reference/index.md#learning), and the routes are `/api/v1/learning/sessions` in the [REST API](../api-reference/rest-api.md#learning-mode). Nothing is observed until a window is opened: with the section enabled and no window open, the sampler does not run.

The tutorial [From observation to a deny-by-default policy](../tutorials/first-policy-from-observation.md) runs the whole path on one host, in one sitting.
