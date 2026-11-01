# Host Rules

A host rule names what a workload does in the product's own words -
`process.connects`, `file.changes`, `bpf.foreign_program` - and never the
kernel mechanism that observes it. Which hook serves an intention, on which
kernel and with what fallback, is the agent's table, resolved on the host it
runs on, so a rule written once means the same thing on every node and nobody
writing one has to know a kprobe symbol or an argument index.

The price is stated rather than hidden: only the intentions listed below can be
named. Adding one is a change to the agent, never a configuration key.

## Intentions

| Intention | Family | Fields |
|-----------|--------|--------|
| `process.starts` | process | `exe`, `uid`, `command_line`, `exe_on_disk`, `parent_exe`, `parent_uid` |
| `process.ends` | process | `exe`, `uid`, `exit_code` |
| `process.connects` | process | `exe`, `uid`, `exe_on_disk`, `remote_address`, `remote_port`, `protocol` |
| `process.listens` | process | `exe`, `uid`, `exe_on_disk`, `local_address`, `local_port`, `protocol` |
| `process.resolves` | process | `exe`, `uid`, `domain`, `query_type` |
| `process.sends_tls` | process | `exe`, `uid`, `remote_address`, `remote_port`, `server_name`, `ja4` |
| `file.changes` | file | `path`, `extension`, `exe`, `uid`, `host_path`, `device`, `inode` |
| `file.appears` | file | `path`, `extension`, `exe`, `uid`, `host_path`, `device`, `inode` |
| `file.disappears` | file | `path`, `extension`, `exe`, `uid`, `host_path`, `device`, `inode` |
| `file.permissions_change` | file | `path`, `exe`, `uid`, `host_path`, `device`, `inode`, `mode`, `previous_mode`, `owner_uid` |
| `file.integrity_breaks` | file | `path`, `exe`, `uid`, `host_path`, `device`, `inode`, `expected_hash`, `actual_hash` |
| `port.hidden` | posture | `local_address`, `local_port`, `protocol` |
| `process.hidden` | posture | `pid`, `comm` |
| `bpf.foreign_program` | posture | `program_id`, `program_name`, `program_type`, `attach_point`, `loader_exe` |
| `packet_socket.appears` | posture | `exe`, `uid`, `interface` |
| `package.vulnerable_reachable` | surface | `package`, `version`, `vulnerability`, `severity`, `exe`, `listening_port` |

Every field has one declared type - text, path, integer, port, address,
boolean or SHA-256 digest - and a rule comparing a field with a value of
another type, or naming a field its intention does not carry, is refused when
it is loaded rather than matching nothing for as long as nobody notices. An
unknown intention is refused with the list of known ones.

## What this host serves

Each intention needs one or more sources, and whether a source is present is
read from what the agent actually attached and is reading, not from the kernel
version:

| Source | Serves |
|--------|--------|
| `process_tracing` - the exec, fork and exit tracepoints | `process.starts`, `process.ends` |
| `socket_attribution` - the cgroup socket hooks | `process.connects`, `process.listens`, and with the two below `process.resolves` and `process.sends_tls` |
| `dns_capture` - the `tc-dns` program | `process.resolves` |
| `tls_capture` - the `tc-ids` program, which reads the client hello | `process.sends_tls` |
| `network_program_inventory` | `bpf.foreign_program` |
| `raw_socket_inventory` | `packet_socket.appears` |
| `file_watch` - the [file watch](../configuration/file-watch.md), present while at least one filesystem is watched | the five file intentions |
| `hidden_process_scan`, `hidden_port_scan`, `package_inventory` | the hidden and package intentions; no source for them is part of this build |

An intention whose sources are absent is **not applicable, with the reason**,
one sentence per missing source, rather than a rule that loads and is quietly
never matched:

```bash
ebpfsentinel-agent host-rules intents
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/host-rules/intents
```

See [`GET /api/v1/host-rules/intents`](../api-reference/rest-api.md#get-apiv1host-rulesintents)
for the response.

A source being present is half of it: something in the agent must also hand
the source's events to the rules. In this build that is the process table,
for `process.starts` and `process.ends`, and the file watch, for the five file
intentions; every other intention is reported `not_applicable` with the
sentence saying no source delivers it, even on a host where its hook is
attached.

### File intentions

A file intention is raised once the changed path has been read again, so what
it says is what the change amounted to rather than which call made it:

- `file.appears` - a name that held nothing known before. A name created over
  a file that was already there, by `mv` or by a container writing a file of
  its image for the first time, is `file.changes` instead.
- `file.changes` - a known file was written, or replaced by a move.
- `file.disappears` - a known file was deleted or moved away.
- `file.permissions_change` - its permission bits or its owner changed.
- `file.integrity_breaks` - its content hash differs from the one kept.

`path` is the path **as the writer sees it**: a write inside a container
reaches the host under the container's overlay upper directory, and the agent
strips that prefix off the writer's own root mount, so a rule on
`/root/.ssh/authorized_keys` matches the same file in every container and on
the host. `host_path` is where the change landed on the host, and `device` and
`inode` name the file itself. Where the writer is gone, or wrote outside its
root (a volume mounted into it), `path` is the host path.

Every file alert carries the writer - its executable, its user, its container
and pod - and the processes above it, as the process table holds them. A
change whose writer the table no longer holds is evaluated without one: a rule
on `exe` or `uid` does not match it, and `kill_process` stops nothing for it.

## Rules

A rule names one intention, or alternatives under one `any_of`, a map of
matchers on its fields, an optional workload selector, and `alert` or
`kill_process`. It may add one second step under `followed_by` with the window
it must arrive in, about the same process or one started below it, and no
third. A block may carry a `count`: how many events, or distinct values of one
field, within a window, per process, workload or host. There is no expression language: no parenthesis, no operator
and no function, and every check that can be made when the rule loads is made
then. The keys, the matchers and what is refused are in
[Host Rules Configuration](../configuration/host-rules.md).

```yaml
host_rules:
  rules:
    - id: shell-under-web-server
      severity: high
      workload:
        ancestor: /usr/sbin/nginx
      when:
        process.starts:
          exe: [/bin/sh, /bin/bash]
      then: [alert, kill_process]
      mode: enforce
```

A rule that does not say `mode: enforce` is in shadow: it raises no alert and
stops nothing, and counts instead what it would have done, per workload it
would have hit. That reading is the one to weigh before putting a rule in
force on a node; see
[Shadow and enforce](../configuration/host-rules.md#shadow-and-enforce).

The agent ships fifteen rules of its own - a reverse shell, an executable with
no file on disk, a hidden port, a foreign eBPF program, a change to
`authorized_keys` and ten more - loaded in shadow with `host_rules.shipped:
true`, which the default configuration sets. They are detections every engine
of the category carries, so they are open source; see
[Shipped rules](../configuration/host-rules.md#shipped-rules).

What is loaded, whether this host can match each rule, and how many events
matched:

```bash
ebpfsentinel-agent host-rules list
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/host-rules
```

A rule is `applicable` when every intention it names is served here,
`partially_applicable` when some alternative of its `any_of` is, and
`not_applicable` when none is. See
[`GET /api/v1/host-rules`](../api-reference/rest-api.md#get-apiv1host-rules).
