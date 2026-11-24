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
  kernel_digest: true
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Attach the fork, exec and exit tracepoints and keep the table |
| `capacity` | usize | `8192` | Maximum number of live processes held, in entries |
| `capture_command_line` | bool | `false` | Keep the command line on the entry, copied by the kernel at exec where it can and read from `/proc/<pid>/cmdline` otherwise |
| `kernel_digest` | bool | `true` | Take each executable's SHA-256 in the kernel at the exec, from IMA, where the BPF LSM and IMA are active; see [Executable digests](#executable-digests) |

`capacity` is accepted between `256` and `262144`. Below the floor the table is
too small to describe a node of any size; above the ceiling it is a memory
decision that belongs in a deployment review rather than in a default.

## Executable digests

Each entry carries the digest of the file the process runs, which is what a
workload rule's `exe_hash` matches ([Workload firewall](workload-firewall.md)).
Where the BPF LSM and IMA are both among the active security modules, the
kernel takes the SHA-256 at the exec itself, from IMA's hash of the file, and
keeps it on the file until the file is opened for writing or truncated; the
agent then reads nothing. Everywhere else, and for a file the kernel did not
hash, the agent reads the file as before. The value is the same SHA-256 either
way, written `sha256:<hex>`, so a rule does not depend on which took it.

The kernel leaves to the agent's own read a file with fs-verity on, which
keeps its `fsverity-sha256:` measurement, a file above 64 MiB, and any file
IMA hashes with another algorithm than SHA-256 (`ima_hash=` on the kernel
command line). Two limits are the kernel's:

- No SHA-256 can be computed by a BPF program itself, so the hash exists only
  through IMA. A kernel built without IMA, or booted with an `lsm=` list
  leaving it out, takes none.
- The entry is dropped where a write-open or a truncation reaches the file
  the exec named. On overlayfs a write through the lower layer's own mount is
  a write to another inode, and the entry of the overlay file stays until
  the file is opened for writing through the overlay. The exec reads the
  size and both change times again and hashes again when any differs, which
  catches such a write unless it preserved all three.

`kernel_digest: false` keeps the agent's own read on every file. Whether the
kernel takes the digests on a node is the `executable_digest` entry of
`ebpfsentinel-agent ebpf kernel-features`, with the reason where it does not.
The object's counters are under
`ebpfsentinel_packets_total{interface="EXEC_DIGEST_METRICS"}`: `execs`,
`computed` for a file IMA hashed, `reused` for an exec answered from the
file's unchanged entry, `unavailable`, `verity`, `too_large` and `unreadable`
for an exec left to the agent's read, and `invalidated` for an entry dropped
by a write.

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
it on widens what an operator with a read token can see. The agent narrows that
before anything else sees the line: see
[what is removed before the line is kept](#what-is-removed-before-the-line-is-kept).

## Where the command line is read

Where the BPF LSM is active, a sleepable LSM program on
`bprm_committed_creds` copies the arguments out of the new image with
`bpf_copy_from_user_task_str` during the exec, before the exec is reported, so
a process that exits at once still has its command line. Elsewhere, and for
every exec the kernel could not copy, the line is read from
`/proc/<pid>/cmdline` once the exec is seen. That is a race: a process that
exits immediately leaves nothing to read and the field is absent rather than
empty.

Both reads go through the same bound and the same redaction, so the line an
entry carries does not depend on which read produced it. The kernel copy shares
the event ring with the fork, exec and exit records and only ever takes half of
it: when the ring is fuller than that, the exec goes on without its arguments,
is counted as `command_line_lost`, and falls back to `/proc`.

The kernel read needs `bpf` among the active security modules
(`lsm=...,bpf` on the kernel command line) and the agent reports whether it is
in use as `command_line_kernel`, with the reason in `command_line_reason` when
it is not, on `GET /api/v1/processes` and in the `Process tracing` section of
`ebpfsentinel-agent ebpf kernel-features`. The kernel fact it rests on is
`copy_from_user_str` in the [capability report](../operations/compatibility.md).

It is also what [mass encryption](../features/mass-encryption.md#backups-destroyed)
reads the destruction of snapshots and backups from, so with it off that prior
is named unavailable in every verdict.

The command line is truncated at 4096 bytes, and a truncated one ends in ` ...`
so a reader can tell the difference between a long command and a cut one.

## What is removed before the line is kept

The line is redacted before it enters the table, whichever read produced it, so the table, every alert carrying the process, every SIEM export, every
context freeze and every screen see the same redacted line, and the raw one is
never stored. A host rule matching on `command_line` matches the redacted line
too. Each removed value becomes `[redacted]`; the flag, the key, the user name,
the host and the path stay, because they are what an investigation reads. The
list of shapes is closed:

| Shape | Example as typed | As kept |
|---|---|---|
| A flag or assignment whose name says it holds a secret: `password`, `passwd`, `passphrase`, `pwd`, `secret`, `token`, `apikey`, `accesskey`, `privatekey`, `credential`, `auth`, `sessionid`, `cookie`, compared with `-`, `_` and `.` removed | `mysql --password=hunter2`, `vault login --token s.abc`, `API_KEY=abc run` | `mysql --password=[redacted]`, `vault login --token [redacted]`, `API_KEY=[redacted] run` |
| The same names inside a connection or query string, split on `;`, `&` and `?` | `Server=db;Password=p;Database=x`, `?user=a&access_token=x` | `Server=db;Password=[redacted];Database=x`, `?user=a&access_token=[redacted]` |
| The password of `user:password` after `-u`, `--user` or `--proxy-user` | `curl -u admin:letmein` | `curl -u admin:[redacted]` |
| The password in an address | `postgres://app:s3cret@db:5432/main` | `postgres://app:[redacted]@db:5432/main` |
| The credential after `Bearer` or `Basic` | `Authorization: Bearer abc.def` | `Authorization: Bearer [redacted]` |
| A value whose own shape names it, wherever it stands: a cloud access key id, a forge or chat platform token, a JSON web token, private key material | `deploy AKIA...` | `deploy [redacted]` |

A secret in a shape the list does not name is kept as typed: a bare positional
argument (`sshpass -p hunter2`), or the value of a flag whose name says
nothing. A tool that takes its password that way should be given it through a
file or the environment of a process the agent does not record. The published
privacy notice states the same list.

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
attached, which ones took, whether the kernel reads the lineage, whether the
command line is being read and whether the kernel reads it at exec, and the
reason where nothing attached. The two process routes answer `503` with the
same sentence rather than an empty list, because a node running no process is
never true.

## Counters

The fork, exec and exit path exports per-CPU counters under
`ebpfsentinel_packets_total{interface="PROCESS_METRICS"}`, one series per
`action` label: `exec`, `fork` and `exit` for the three tracepoints,
`thread_fork` and `thread_exit` for a thread created or ended rather than a
process, `lineage_unresolved` for an event whose parent or start time the
kernel could not read, `outside_namespace` for a task the agent's pid
namespace cannot see, `command_line_read` for an exec whose arguments the
kernel copied, `command_line_lost` for one it could not copy, whose line is
then read from `/proc`, and `events_dropped` where the ring buffer was full
because userspace was not draining it fast enough. A non-zero `events_dropped` means the table is missing entries, and the
node is busier than the ring buffer was sized for.

## Pid namespaces

The table names a process by the pid the agent's procfs shows
(`EBPFSENTINEL_HOST_PROC`, `/proc` otherwise). On a machine that procfs is the
initial pid namespace and the kernel's own pid is that number. Where the node
is itself a container, a kind node for instance, the procfs belongs to the
node's namespace and every task in it has another number there. The agent
reads which namespace its procfs is in at start-up and writes it to every
kernel program that reports or keys on a pid: the process table, workload
firewall rules, socket attribution, network executables, write refusal,
process kill, crypto call counts and DLP. Each of them then numbers tasks the
way that procfs does, so a workload rule names and refuses a pod's task on a
kind node as on a machine.

The namespace is read from the link of the procfs's pid 1 where the agent may
read it. An agent with a pid namespace of its own, the pod of a chart that
shares none with its node, is refused that link; it then counts how many
levels the procfs sits above its own namespace from `NSpid` in
`<procfs>/self/status`, and a small program it runs as its own task reads that
ancestor's identity from the kernel, checking that the agent's number there is
the one the procfs shows.

A pod's task on such a node lives in a pid namespace below the node's and has
a number in the node's as well. The kernel's helper answers only for a task of
the node's namespace itself, so for a pod's task the programs read the number
off the task's `struct pid`, at the depth of the node's namespace, with
offsets taken from the running kernel's BTF. A kernel whose BTF does not
describe them leaves those tasks at pid 0, and the start-up log says so.

A task the namespace cannot see, one of the machine around the node, has no
number there. It is left out of the table and counted as `outside_namespace`,
and the workload rules treat it as a task they cannot name. The start-up log
says which namespace was read, or why none could be, in which case the
kernel's own pids are used.
