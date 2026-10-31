# Process Detections

Three detections read the process tree where it touches the network. Each asks one question about a process that holds a connection, and each answers from what the agent already keeps: the [process table](../configuration/process-table.md) for the chain of ancestors, the connection table for the flow, and two facts read from `/proc` at the moment of the test.

Open source, in every tier, on by default, alerting and stopping nothing until the configuration says otherwise.

## The three detections

| Detection | Rule id | Severity | Fires when | ATT&CK |
|---|---|---|---|---|
| Reverse shell | `process-reverse-shell` | critical | A shell or interpreter has its standard input or output on an internet socket, or connects out from under a server | T1059, execution |
| Fileless | `process-fileless` | critical | A process holding a connection runs a binary that was deleted after it started, or that never had a file (`memfd_create`) | T1620, defense-evasion |
| Server descendant | `process-server-descendant` | high | A process started, directly or further down, by a server connects out and is not in `expected` | T1190, initial-access |

A process is tested for the fileless case first, because a binary with no file is the strongest of the three facts whatever its name. A server's own workers, which run the server's own binary, are never a server descendant.

Every alert carries the component `process`, the full workload block with its ancestry, and the destination of the connection that put the process in front of the detector where there is one. A shell found through its standard streams rather than through a connection it opened carries no destination, since it opened none.

## How a process is found

There is no kernel event that says "a process opened a connection" and names the process. The detector therefore samples on an interval, every `interval_secs`:

1. It reads the connection table and resolves each connection this node opened to the process behind it, through the same socket attribution the workload firewall uses.
2. It walks the process table for shells and interpreters no connection named. A shell handed a socket by `nc -e` or `socat` holds the connection without having opened it, so only its standard streams give it away.
3. It reads two facts for each candidate from `/proc/<pid>`: whether `exe` names a deleted or anonymous file, and whether `fd/0` or `fd/1` is a socket that the process's own network namespace lists as TCP or UDP. A service whose output goes to the journal over a unix socket is not a stream on the network.

Each process is reported once per detection for as long as it lives. A pid the kernel hands to another process later is a new process and is tested afresh.

## What it cannot see

- **A connection that opens and closes between two samples is never tested.** Lower `interval_secs` narrows the gap and costs a read of both tables per sample.
- **A rootless agent reads no fact about a process outside its own user namespace.** The `/proc` links are refused, so the fileless detection and the stream test answer nothing there, and only the server descendant and an interpreter dialling out from under a server still fire. Run the agent with the host `/proc` and the privileges the [deployment matrix](./deployment-matrix.md) lists for full coverage.
- **A name is not proof.** An interpreter is recognised by its executable's file name or path, and a binary copied under another name is not one. The fileless detection does not depend on a name.
- **A server whose children legitimately connect out** needs those children listed in `expected`, or every call it makes is a server-descendant alert. A PHP application calling `curl` is the usual case.

## Reading the tree in the dashboard

An alert that names a process opens on its process tree, drawn under the attribution panel, and the page of a workload draws the trees its alerts sit in. A tree is rooted at the highest ancestor below init and every process of the chain is a line under its parent, so a shell spawned by a web server reads as a branch of that server rather than as a lone process.

Each connection is a leaf under the process that holds it, and the two kinds are kept apart:

- **Raised** - a connection an alert named, drawn in the alert's severity and linked to that alert. Every other alert of the same host under the same root is drawn in the same tree, so two shells under one worker read as one incident.
- **Expected** - a connection the host's connection table holds and no alert named, drawn muted beside the raised ones. A process holding more than a dozen shows the first twelve and counts the rest.

A branch with nothing raised below it is closed, because the tree answers which branch did something its siblings did not. An ancestor that has exited is still drawn and marked so, since the chain was captured while it lived, and a chain cut short by the depth limit or by an unreadable `/proc` entry is said under the tree rather than drawn as if it were whole.

The connections are read from the host that raised the alert. Where that host refuses its connection table, the raised branch is still drawn and the panel says the rest could not be read. A workload running on many nodes draws the four hosts with the newest alerts and counts the others. A tree exists only where something raised: a workload no alert names has a timeline and no tree.

How complete a tree is depends on whether the agent can read the node's processes: complete on a host and wherever `/host/proc` is mounted, partial without it, absent under the pod profile. The [deployment matrix](deployment-matrix.md#process-table-and-the-process-tree) states it per platform.

## Stopping the process

With `kill_process: true` the agent stops each process an alert names, through the same in-kernel signal an [IPS](./ips.md) rule asks for, with the same protected commands. It is refused at load unless `response.kill_process.enabled` is set, so a configuration never reads as a containment that does not happen. It is off by default: the lists that decide what is a shell and what is a server are the operator's, and a kill on a list somebody else wrote is the operator's decision.

## Configuration

```yaml
process_table:
  enabled: true
  detections:
    enabled: true
    interval_secs: 10
    expected: [curl]
    kill_process: false
```

Every field is described in the [process table reference](../configuration/process-table.md#detections).

## Coverage

`GET /api/v1/mitre/coverage` counts the three techniques under the component `process` while the detections are sampling, and reports them as switched off otherwise.
