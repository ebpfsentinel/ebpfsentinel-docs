# Learning Mode

Learning mode watches what this node reaches, for a window you declare, and records it as a set of destinations rather than as a log of flows. It is how a first workload policy gets written on a host nobody has an inventory for: open a window, let the node do its work, read back the destinations it actually dialled.

Nothing is observed until an operator opens a window. Turning the section on only means the routes and the sampler exist.

```yaml
learning:
  enabled: true
  max_edges: 8192
  sample_interval_secs: 10
  storage_path: data/learning.redb
```

| Key | Type | Default | Meaning |
|-----|------|---------|---------|
| `enabled` | bool | `true` | Whether a window can be opened on this node at all. Off means the learning routes answer 404 and no sampler runs. |
| `max_edges` | integer | `8192` | How many distinct destinations one window may hold. Minimum 64, maximum 131072. |
| `sample_interval_secs` | integer | `10` | Seconds between readings of the connection table. Minimum 1, maximum 300. |
| `storage_path` | string | `data/learning.redb` | Where windows are written down. Empty keeps them in memory only. |

## What a window records

One entry per destination, not per flow: the destination address, the port, the protocol and the workload that opened the connection. A thousand connections from the same service to the same database on the same port are one entry, counted. That is what makes a window of several hours bounded rather than a packet log.

Only connections **this node opened** are recorded. A connection the node accepted names the client's ephemeral source port, and a policy carrying it would allow a destination nobody ever dialled. The direction comes from the socket attribution hooks, which record the end a socket was opened from, so an accepted connection is recognised as one rather than guessed at from address ranges.

Only TCP and UDP are recorded, because those are the protocols a workload rule can carry.

A flow nothing can attribute is still recorded, with no workload on it, and counted separately as `unattributed`. Hiding it would make a window look complete when it is not.

## What a window reports

| Field | What it is for |
|-------|----------------|
| `elapsed_secs` / `remaining_secs` | How much of the declared window has really been watched. |
| `gap_secs` / `continuous` | Seconds of the window the agent was not running for. A window that survived a restart says so rather than pretending to be continuous. |
| `edges` / `capacity` | Destinations held, against the ceiling. |
| `dropped_edges` | Destinations refused because the window was full. Anything but zero means the reading is incomplete. |
| `observations` | Readings folded in, which is how a quiet window is told apart from a broken one. |
| `unattributed` / `out_of_scope` | Flows kept with no workload, and flows outside the declared scope. |
| `secs_since_new_edge` | How long since the window last found a destination it had not seen. The practical signal for when a window has run long enough. |

## Scope

A window watches one of three things:

- **the whole node** - every flow that can be attributed to a workload,
- **one cgroup v2 subtree**, by absolute path, which is how a single systemd slice or a single pod is watched,
- **a set of workloads**, named the way a firewall rule names them: by executable, unit, cgroup or container.

## Restarts

A window is written down as it changes. On start the agent takes back what it wrote, and a window whose declared time has passed while the agent was down is closed rather than resumed. A window that was open across the gap keeps its destinations, records the gap in `gap_secs` and reports `continuous: false`, so a reader knows the period was not fully watched before deciding what to do with it.

With `storage_path` empty, or a store that cannot be opened, the agent logs it and carries on with the windows in memory: what is lost is the memory of a window, never the ability to open one.

## Cost

One reading of `/proc/net/nf_conntrack` per interval, folded into a bounded aggregate, on a thread that is not the agent's event path. A flow that opens and closes between two readings is not seen - this is a sampler of what is established, not a capture of everything that happened.

## The document a window produces

A window is a reading; the document is that reading written as rules. `learning policy` renders it in the agent's own firewall schema, so it diffs against the configuration the node runs today and loads through the ordinary reload path.

What the renderer does, and says it does:

- **One rule per workload, destination and port range.** A workload becomes the selector a rule already uses: container, unit or executable, whichever the attribution could name.
- **Contiguous ports collapse into a range.** A rule carries one range and not a list, so 8080, 8081 and 8082 are one rule while 80 and 443 are two.
- **Four or more addresses of one workload inside the same /24, or /64 on IPv6, collapse into that prefix**, and the rule says in a comment which addresses it was built from and that it is wider than what was observed. Three or fewer are written one by one.
- **Each workload gets a closing deny**, which is what makes the list above it an allow-list rather than a set of permissions.
- **Every rule comes out in `observe` mode.** Applying the document refuses nothing; it counts what it would have refused. Moving a rule to enforce is a decision somebody takes.

The header states the window, the scope, how long was really watched, how many readings were folded in, how many destinations were refused for want of room, and the one thing the document cannot say: a destination this node did not reach during the window is not in it.

```yaml
# What this node reached, written as the rules that would allow it.
#
# Window:       learn-1760000000
# Scope:        every workload on this node
# Observed:     3600s of the 3600s asked for, status completed
# Flows folded: 128 readings, 3 of them naming no workload, 0 outside the scope
# Destinations: 7 distinct, across 2 workloads, written as 9 rules
#
# A destination this node did not reach during the window is not in this
# document. [...]
firewall:
  rules:
    - id: learn-nginx-service-1
      priority: 1000
      action: allow
      protocol: tcp
      dst_ip: 10.0.0.1/32
      dst_port: 443
      workload:
        unit: nginx.service
        mode: observe
```

## Commands and routes

[`ebpfsentinel-agent learning`](../cli-reference/index.md#learning) opens a window, lists them, reports one, closes one and renders its document. The same acts are the `/api/v1/learning/sessions` routes in the [REST API](../api-reference/rest-api.md#learning-mode).
