# Process Table Configuration

The process table is the one place where a pid becomes a name. Three
tracepoints fill it - `sched_process_fork` writes an entry when a process is
created, `sched_process_exec` rewrites it when it runs a program,
`sched_process_exit` removes it when the process ends - and userspace adds the
container and, where the configuration allows it, the command line. The parent
and both start times are read in the kernel at the fork or exec, before the
parent has a chance to exit and hand its child to a reaper.

Nothing here enforces anything. The table answers "what was pid 4242", and a
flow or an alert that carries a pid can be read as a name instead of a number.

## Configuration

```yaml
process_table:
  enabled: true
  capacity: 8192
  capture_command_line: false
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Attach the fork, exec and exit tracepoints and keep the table |
| `capacity` | usize | `8192` | Maximum number of live processes held, in entries |
| `capture_command_line` | bool | `false` | Read `/proc/<pid>/cmdline` and keep the full command line on the entry |

`capacity` is accepted between `256` and `262144`. Below the floor the table is
too small to describe a node of any size; above the ceiling it is a memory
decision that belongs in a deployment review rather than in a default.

## Detections

The table also carries three detections that read it where a process touches
the network. What each one looks for and what it cannot see is on
[Process detections](../features/process-detections.md); the settings are here.

```yaml
process_table:
  detections:
    enabled: true
    interval_secs: 10
    kinds:
      reverse_shell: true
      fileless: true
      server_descendant: true
    interpreters: [sh, bash, dash, zsh, ksh, ash, busybox, "python*", "perl*", "ruby*", php, "php[0-9]*", node, "lua*"]
    servers: [nginx, apache2, httpd, "php-fpm*", lighttpd, caddy, uwsgi]
    expected: []
    kill_process: false
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `detections.enabled` | bool | `true` | Sample the connection and process tables and run the detections. Needs `process_table.enabled` |
| `detections.interval_secs` | u64 | `10` | Seconds between two samples. Accepted between `1` and `3600` |
| `detections.kinds.reverse_shell` | bool | `true` | A shell or interpreter whose standard input or output is an internet socket, or that connects out from under a server |
| `detections.kinds.fileless` | bool | `true` | A process holding a connection whose binary was deleted after it started, or never had a file (`memfd`) |
| `detections.kinds.server_descendant` | bool | `true` | A process a server started that connects out and is not in `expected` |
| `detections.interpreters` | list of string | see above | The shells and interpreters a reverse shell is made of |
| `detections.servers` | list of string | see above | The servers whose descendants are expected to answer rather than dial out |
| `detections.expected` | list of string | `[]` | Programs a server is expected to start and that may connect out, such as the client a PHP application calls |
| `detections.kill_process` | bool | `false` | Stop each process an alert names. Refused at load unless `response.kill_process.enabled` is set |

An entry in the three lists is matched against the executable's file name, or
against its full path when the entry contains a `/`. A trailing `*` matches any
suffix and `[0-9]` matches one digit; a `*` anywhere else, or an empty entry,
is refused at load. Setting `interpreters`, `servers` or `expected` replaces
the default list rather than adding to it.

## An entry is removed, not aged out

An exit purges the entry for that pid. The table therefore holds the processes
that are alive, not the processes that were recently seen, and it needs no TTL
to stay truthful: a pid is reused by the kernel only after the previous holder
is gone, and the exit that frees the pid removes the entry before the exec that
takes it writes a new one.

Two counters say when that stops being exact, and both are in
`GET /api/v1/processes`:

- `missing_exit` counts exits for a pid the table did not hold. A process that
  execed before the tracepoints attached has no entry to purge, so a non-zero
  value right after a start is expected and a value that keeps climbing is not.
- `evicted` counts entries dropped because the table was full. The table evicts
  the oldest entry rather than refusing the newest one, so a node that runs more
  than `capacity` concurrent processes loses the name of its longest-lived
  processes first. That is the opposite of what an operator wants, which is why
  the bound is a configuration field rather than a constant.

## An exited ancestor is kept while its descendants run

The shell of a one-liner exits long before the binary it launched opens a
socket, and the chain from that socket back to whatever started it is the one
thing an operator wants named. So a process that exits while something it
started is still known is not dropped: it moves to a second, smaller set, keyed
by its pid and its start time because its pid may already belong to someone
else, and it goes when its last descendant does.

That set is bounded at a quarter of `capacity`. When it is full the ancestor
that exited first is dropped and `ancestors_evicted` counts it; the descendants
it leaves then show a chain that stops early, and
`GET /api/v1/processes/{pid}` says so with `ancestry.incomplete` rather than
presenting the shortened chain as the whole of it.

A fork copies its parent's entry - executable, command line, container - since
the child runs the parent's image until it execs, and no `/proc` read is made
for it. Forks are counted in `forks`, apart from `recorded`, which still counts
execs. A thread is not a process and creates no entry.

An exit carries the start time of the process that ended. Where the table holds
a later process on that pid, the late exit is counted in `missing_exit` and the
live entry is left alone.

## How complete the chain is per platform

The kernel reports every process on the node; naming it needs the node's
procfs, which a container reads through the `/host/proc` mount. Where the chain
is complete, partial or absent - host, Docker, Kubernetes and the pod profile -
is on the [deployment matrix](../features/deployment-matrix.md#process-table-and-the-process-tree).

## Where the kernel cannot read the parent

Reading a parent and a start time in the kernel needs the offsets of four
`task_struct` fields, taken from the running kernel's BTF at startup. A kernel
whose BTF does not describe them keeps the table working on execs, forks and
exits, takes the parent from `/proc` at exec as before, and reports
`lineage: false` with the reason in `lineage_reason`. Without start times an
exited ancestor is still kept, but a reused pid can then no longer be told
apart from the process that held it before.

## What the command line costs

`capture_command_line` is off by default for two reasons, and neither is
performance. A command line frequently carries a secret - a password passed as
an argument, a token in a URL - and the table is read over the API, so turning
it on widens what an operator with a read token can see. It is also read from
`/proc/<pid>/cmdline` at exec time, which is a race: a process that exits
immediately leaves nothing to read and the field is absent rather than empty.

The command line is truncated at 4096 bytes, and a truncated one ends in ` ...`
so a reader can tell the difference between a long command and a cut one.

## Identity strength is written into the entry

Each entry says what kind of identity it carries:

| `identity.kind` | What it means |
|---|---|
| `path` | The executable path was read at exec. |
| `unknown` | No path could be read, so the entry carries only the kernel's 16-byte `comm`. |

A path is not proof. The binary it names can be replaced or deleted after the
exec, and `comm` is a string the task can set itself. The field exists so a rule,
a screen or an alert can say which of the two it is looking at rather than
treating both as a name.

## When nothing attaches

The attach is degradable in the same way as the socket hooks. A host that
refuses the tracepoints leaves the agent running without a process table, logs
the reason once at startup, and reports it:

```bash
ebpfsentinel-agent ebpf kernel-features
```

The `Process tracing` section of that output says whether the tracepoints
attached, which ones took, whether the kernel reads the lineage, whether the command line is being read, and the
reason where nothing attached. The two process routes answer `503` with the
same sentence rather than an empty list, because a node running no process is
never true.

## Counters

The fork, exec and exit path exports per-CPU counters under
`ebpfsentinel_packets_total{interface="PROCESS_METRICS"}`, one series per
`action` label: `exec`, `fork` and `exit` for the three tracepoints,
`thread_fork` and `thread_exit` for a thread created or ended rather than a
process, `lineage_unresolved` for an event whose parent or start time the
kernel could not read, and `events_dropped` where the ring buffer was full
because userspace was not draining it fast enough. A non-zero `events_dropped` means the table is missing entries, and the
node is busier than the ring buffer was sized for.
