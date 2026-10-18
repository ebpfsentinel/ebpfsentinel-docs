# Process Table Configuration

The process table is the one place where a pid becomes a name. Two tracepoints
fill it - `sched_process_exec` writes an entry when a program execs,
`sched_process_exit` removes it when the process ends - and userspace adds the
parent, the container and, where the configuration allows it, the command line.

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
| `enabled` | bool | `true` | Attach the exec and exit tracepoints and keep the table |
| `capacity` | usize | `8192` | Maximum number of live processes held, in entries |
| `capture_command_line` | bool | `false` | Read `/proc/<pid>/cmdline` and keep the full command line on the entry |

`capacity` is accepted between `256` and `262144`. Below the floor the table is
too small to describe a node of any size; above the ceiling it is a memory
decision that belongs in a deployment review rather than in a default.

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
attached, which ones took, whether the command line is being read, and the
reason where nothing attached. The two process routes answer `503` with the
same sentence rather than an empty list, because a node running no process is
never true.

## Counters

The exec and exit path exports per-CPU counters under
`ebpfsentinel_packets_total{interface="PROCESS_METRICS"}`, one series per
`action` label: `exec` and `exit` for the two tracepoints, `thread_exit` for an
exit that was a thread rather than the process ending, and `events_dropped`
where the ring buffer was full because userspace was not draining it fast
enough. A non-zero `events_dropped` means the table is missing entries, and the
node is busier than the ring buffer was sized for.
