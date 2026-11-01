# Host Rules Configuration

A host rule names an intention from the [catalogue](../features/host-rules.md),
the values its fields must hold, and what to do when one event matches. Rules
are read once at startup, with the rest of the file, and every rule is checked
against the field registry then: a rule that loads is a rule every matcher of
which can be true of some event.

## Configuration

```yaml
host_rules:
  rules:
    - id: shell-under-web-server
      description: an interactive shell started below the web server
      severity: high
      workload:
        ancestor: /usr/sbin/nginx
      when:
        process.starts:
          exe: [/bin/sh, /bin/bash, /usr/bin/dash]
      then: [alert, kill_process]

    - id: setuid-transition
      severity: critical
      when:
        process.starts:
          uid: 0
          uid_ne_field: parent_uid

    - id: shell-then-fetcher
      description: a shell, then a download tool below it
      when:
        process.starts:
          exe: [/bin/sh, /bin/bash]
      followed_by:
        within: 30s
        process.starts:
          exe: [/usr/bin/curl, /usr/bin/wget]

    - id: fork-burst
      description: one process starting many short-lived children
      when:
        process.starts:
          count:
            min: 50
            within: 10s
            per: host

    - id: fetcher-from-tmp
      when:
        any_of:
          - process.starts:
              exe_matches: /tmp/*
          - process.starts:
              exe_on_disk: false
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `rules` | list | `[]` | The rules, at most 1024, each identifier used once |
| `rules[].id` | string | required | Letters, digits, `-` and `_`, at most 128 characters; the `rule_id` of every alert it raises |
| `rules[].description` | string | none | Written into the alert message in place of the intention's name |
| `rules[].severity` | string | `medium` | `low`, `medium`, `high` or `critical` |
| `rules[].workload` | map | none | A [workload selector](workload-firewall.md#the-matchers), every matcher of it true of the process the event is about |
| `rules[].when` | map | required | One intention and its matchers, or one `any_of` listing alternatives |
| `rules[].followed_by` | map | none | A second step: `within` and one intention and its matchers, or one `any_of` |
| `rules[].then` | list | `[alert]` | `alert`, and `kill_process` to stop the process the event is about |

## Matchers

Each key of an intention's map is a field of that intention, optionally
followed by a suffix. Every key must hold; a list of values means any one of
them.

| Key | Holds when the field | Fields |
|-----|----------------------|--------|
| `<field>` or `<field>_in` | equals one of the values | every type |
| `<field>_not_in` | equals none of the values | every type |
| `<field>_matches` | matches one of the globs, `*` any run of characters, `?` one | text, path and digest |
| `<field>_regex` | contains a match of one of the regular expressions | text, path and digest |
| `<field>_gt`, `<field>_lt` | is above, below the one value | integer and port |
| `<field>_eq_field`, `<field>_ne_field` | equals, differs from the other field named, of the same intention and type | every type |

A field the event does not carry is a mismatch for every matcher,
`<field>_not_in` included: a value nobody could read is neither one a rule
lists nor one it excludes. An empty map matches every event of its intention.

`any_of` sits once, at the top of `when`, and lists alternatives, each an
intention with its matchers; it does not nest. The rule holds when one
alternative does.

## Regular expressions

`_regex` takes the syntax of Rust's `regex` crate. It searches the text rather
than matching all of it, so `^` and `$` are written when the whole value is
meant, where a glob is anchored at both ends without saying so. The engine runs
in time linear in the text and has no backtracking, no lookaround and no
backreference, so no pattern can be written whose cost explodes on a crafted
path.

Glob stays the default because what a regular expression costs is memory: a
pattern may compile to 512 KiB and cache another 512 KiB while it searches,
where a glob holds its own characters. Per event the two are close, tens of
nanoseconds either way on a path. A pattern that compiles larger is refused at
load, and the refusal says what usually causes it: a counted repetition of a
Unicode class such as `\w{200}`, which `(?-u)` or a narrower class shrinks.

## Counts

`count` sits inside an intention, beside its matchers, and makes the block hold
only on the event that brings enough matching events into the window. It is
four typed fields and nothing else.

| Key | Default | Description |
|-----|---------|-------------|
| `min` | required | How many events, from 2 to 1024 |
| `within` | required | The window, written like a sequence's: a whole number followed by `ms`, `s`, `m` or `h`, at most `1h`, inclusive at both ends |
| `per` | `process` | What the events are grouped by: `process`, `workload` (its container, else its cgroup, else its systemd unit) or `host` |
| `distinct` | none | One field of the intention: count distinct values of it rather than events |

- The window slides: each event leaves it when it is older than `within`, so
  three events in any ten seconds reach `min: 3`, not three events in the same
  ten-second slot.
- `distinct` is what separates two hundred writes to one log from two hundred
  files written: the first is one distinct `path`.
- The group starts again from nothing once it fires, so a burst raises one
  alert for every `min` events rather than one for every event past `min`.
- An event with nothing to group by is not counted: no process for
  `per: process`, no workload for `per: workload`, no value of the `distinct`
  field.
- A node holds at most 8192 groups and 262144 events across every count. An
  event arriving with either bound reached by groups still in their window is
  not counted, and is counted as `counting_refused` by `GET /api/v1/host-rules`
  rather than evicting a group that is still counting.
- A count may sit in `when`, including the first step of a sequence, and not in
  `followed_by`: a sequence closes on one event.

## Sequences

`followed_by` makes a rule two steps: `when` opens it, and an event matching
`followed_by` closes it within the window, about the same process or one
started below it. The alert is raised on the second event, names the process
of the second event, says which first step it followed, and `kill_process`
stops that process.

| Key | Description |
|-----|-------------|
| `within` | Required. A whole number followed by `ms`, `s`, `m` or `h`, above zero and at most `1h`; inclusive |
| an intention, or `any_of` | Required. The second step, written like `when` |

- `workload` scopes the first step only: the second is tied to it by the
  process tree, so a selector naming the shell would otherwise refuse the
  `curl` it starts.
- One first step closes once. A process matching the first step again while
  it waits starts the window again.
- One event never both opens and closes the same rule: the second steps are
  tried first.
- A node holds at most 8192 first steps across every rule. One arriving with
  the set full of steps whose window is still open is not held, and is counted
  as `pending_refused` by `GET /api/v1/host-rules` rather than evicting a step
  that waits.
- Two steps is the limit. Whatever came before the first is in the ancestry
  the alert carries, and a third step is a second rule.

## What is refused at load

- A field the intention does not carry, with the list of those it does, and an
  unknown intention, with the list of known ones.
- A value of the wrong type, an address that does not parse, a glob on a
  number, `_gt` or `_lt` on text, and two fields of different types compared.
- A regular expression that does not parse, with the engine's reason, or that
  compiles to more than 512 KiB.
- `count` without `min` or `within`, `min: 1`, `min` above 1024, a `per`
  outside the three, a `distinct` field the intention does not carry, a
  `per: process` or `per: workload` on an intention whose event names no
  process, a count in `followed_by`, and `kill_process` on a count not
  `per: process`, which many processes reach together.
- `followed_by` without `within`, a window over an hour, a `followed_by` inside
  `followed_by`, a `workload` inside it, and either step on an intention whose
  event names no process: a sequence follows a process.
- `kill_process` on an intention whose event names no process, and on
  `process.ends`, whose process has already ended.
- `kill_process` while `response.kill_process.enabled` is `false`, so a
  configuration never reads as a containment that does not happen.
- Any rule while `process_table.enabled` is `false`: the rules are evaluated on
  the process table's events.
- A `workload` naming a `guest`: a virtual machine runs its processes in its own
  kernel.

## What is evaluated in this build

`process.starts` and `process.ends` reach the rules, from the
[process table](process-table.md): an exec is evaluated once the table holds
the new program, an exit before the entry is purged. A rule naming any other
intention loads and is reported `not_applicable` by
`GET /api/v1/host-rules`, with the sentence saying no source delivers it.

- `command_line` is carried only with `process_table.capture_command_line`.
- `exe_on_disk` is read from `/proc` when a rule names it, and only then.
- `parent_exe` and `parent_uid` are those of the parent the table holds; a
  process whose parent it never saw carries neither.
- `exit_code` is never carried: the exit notification holds no status, so a
  rule naming it matches nothing and should not be written yet.
- An exit for a pid already reused by a newer process reaches no rule.

A match raises an alert of component `host_rule` with the rule's identifier,
severity and the process's workload block and lineage. An alert lost to a full
alert queue is counted as `dropped` by `GET /api/v1/host-rules`, and so are
the first steps waiting, as `pending`, and the counts running, as `counting`.
A counted rule's alert ends with what was counted, such as
`, 50 events within 10s per host`.
