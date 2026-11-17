# Tamper Protection

> **Edition: Enterprise** | licence feature `tamper-protection`

## Overview

An agent that root can stop is an agent an intruder with root stops first. With
tamper protection armed, the kernel itself refuses a signal that would end the
agent or its warden, a trace of either, a write to their memory through
`/proc/<pid>/mem`, the removal or renaming of the agent's pinned links, of its
configuration and of its licence, and a write to the `cgroup.kill` or
`cgroup.freeze` of the cgroup holding them. Root included.

The way to stop the agent anyway is a **signed stop**: a short document signed
with both a classical (Ed25519) and a post-quantum (ML-DSA-65) key that the
licence holder controls, naming the one node it stops, valid for minutes, and
used once. The agent verifies it, opens a window in the kernel for sixty
seconds, records the stop and ends itself.

Every refusal and every admitted or refused stop is an alert.

## The condition: the BPF LSM at boot

The refusal is a BPF LSM program, `lsm-tamper-guard`, on `task_kill`,
`ptrace_access_check`, `inode_unlink`, `inode_rename` and `file_open`. It needs
the BPF LSM active at boot, with `bpf` listed in the `lsm=` kernel parameter. That
is a boot parameter rather than a kernel version, and one not every distribution
or host provider sets. `ebpfsentinel-agent ebpf host-check` answers for your own
host, and `/api/v1/ebpf/kernel-features` reports it per node under
`tamper_protection`.

Without it, root stops the agent like any process, and the fleet raises the
silence after the fact. The signed stop route stays mounted either way, so the
procedure is the same on every node.

Tamper protection is never guaranteed. What still ends it:

- A reboot into a kernel command line without `bpf` in `lsm=`.
- A kernel module, which runs with the kernel's own privilege and is not asked.
- Physical access to the machine.

## Configuration

```yaml
enterprise:
  tamper_protection:
    enabled: true
    stop_keys:
      - public_key: /etc/ebpfsentinel/stop-signing.pub
        pq_public_key: /etc/ebpfsentinel/stop-signing-pq.pub
    # node_name: worker-3            # unset: the node or host name
    # protected_directories: [/sys/fs/bpf/ebpfsentinel-links]
    # protected_files: []            # beside the configuration and the licence
    # cgroup_root: /sys/fs/cgroup
    # stop_record_path: /var/lib/ebpfsentinel/stop-record.json
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Arms the protection, on a licence carrying `tamper-protection` |
| `stop_keys` | empty | The key pairs allowed to sign a stop. Empty, no stop is admitted until the agent restarts with one, and the agent warns at every start |
| `node_name` | node or host name | The name a stop must carry for this node |
| `protected_directories` | the link pin directory | Directories whose entries cannot be unlinked or renamed |
| `protected_files` | none | Files held themselves, beside the configuration and the licence the agent started with |
| `cgroup_root` | `/sys/fs/cgroup` | Where the unified cgroup hierarchy is mounted; empty leaves the cgroup undecided |
| `stop_record_path` | `/var/lib/ebpfsentinel/stop-record.json` | Where an admitted stop is recorded, so the next start and the console tell it from a silent one |

The stop keys are configuration, never the document's claim: a stop says
nothing about which key signed it, and only the pairs listed here are tried.

## Stopping a protected agent

Generate a stop key pair once and keep the private halves offline, the way a
break-glass key is kept:

```bash
ebpfsentinel-license keygen \
  --private-key stop-signing.key --public-key stop-signing.pub \
  --pq-private-key stop-signing-pq.key --pq-public-key stop-signing-pq.pub
```

Sign a stop for one node, then hand it to the agent on that node:

```bash
ebpfsentinel-license stop-authorise --node worker-3 --minutes 5 \
  --requested-by "on-call" --reason "kernel upgrade" \
  --signing-key stop-signing.key --pq-signing-key stop-signing-pq.key \
  --output stop.auth

ebpfsentinel-enterprise-agent stop --authorisation stop.auth
```

`stop` posts the document to `POST /api/v1/agent/stop` on the local agent. The
agent refuses it when it is malformed, of a schema it does not read, not signed
by a configured pair, for another node, issued ahead of its clock by more than
two minutes, valid for longer than fifteen minutes, expired, or already used.
Admitted, it opens the kernel's window for sixty seconds, writes the stop record,
raises a `tamper-stop-admitted` alert and exits with status `79`, so a supervisor
restarting the agent on any other exit leaves this one stopped. A refusal answers
`403` and raises a `tamper-stop-refused` alert naming the reason.

The window closes on its own: a stop whose shutdown hangs does not become an
open door. A trace stays refused even inside the window, since a stop never
needs the agent's memory.

## Alerts

| Rule | Raised when |
|---|---|
| `tamper-signal-refused` | A signal that would end the agent or its warden was refused |
| `tamper-trace-refused` | A trace, or a write to the agent's memory, was refused |
| `tamper-unlink-refused` | A pinned link, the configuration or the licence was about to be removed |
| `tamper-rename-refused` | One of those was about to be renamed away |
| `tamper-cgroup-refused` | A write to the agent's `cgroup.kill` or `cgroup.freeze` was refused |
| `tamper-stop-admitted` | A signed stop was admitted |
| `tamper-stop-refused` | A stop was presented and refused |

Each refusal names the process that tried, so the alert answers who as well as
what.

## Limits

- A licence lost while the agent runs leaves the protection in place until the
  next start, which then runs unprotected.
- The protection covers the agent's own maps once their identifiers are first
  read, within thirty seconds of start; the guard on its links and maps from the
  open source core covers the rest (see [Foreign programs](../foreign-programs.md)).
- On a host without the BPF LSM nothing is refused, and the node reports itself
  unprotected rather than claiming otherwise.
