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

## Configuration and commands

The keys are in [Learning mode configuration](../configuration/learning.md); the commands are [`ebpfsentinel-agent learning`](../cli-reference/index.md#learning), and the routes are `/api/v1/learning/sessions` in the [REST API](../api-reference/rest-api.md#learning-mode). Nothing is observed until a window is opened: with the section enabled and no window open, the sampler does not run.

The tutorial [From observation to a deny-by-default policy](../tutorials/first-policy-from-observation.md) runs the whole path on one host, in one sitting.
