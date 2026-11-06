# Hidden Processes

A rootkit that hides a process does it by editing what the kernel lists, not by
stopping the process: the task keeps running, keeps its pid and still answers a
signal, while `/proc`, `ps` and `top` leave it out. Delivering a signal goes
through the kernel's own pid table, which cannot be edited the same way without
the process becoming unreachable to everything, its own parent included.

The agent asks the kernel twice and compares the answers: once by listing
`/proc`, and once by sending the null signal, `kill(pid, 0)`, which delivers
nothing and only reports whether the pid exists. A pid that answers, twice,
while neither listing of `/proc` shows it is reported hidden.

## Benign Causes First

Most pids that answer and are not listed as a process are ordinary, and each
one the sweep explains is counted under its reason rather than reported:

- **A thread.** `/proc` lists thread groups, and every thread has a pid of its
  own that answers a signal. Each listed group's `task` directory is read
  before the sweep, and a pid found there is counted as a thread.
- **A process on its way out.** A zombie waiting for its parent, or a task
  being torn down, still answers and may already be gone from the listing.
- **Process churn.** A process that started or ended between the listing and
  the signal. The sweep reads twice, and a pid gone by the second signal, or
  listed by the second listing, is counted as `unconfirmed` and never reported.
- **A pid reused** between the two observations: when its start time changed,
  the two readings are of two different processes, and it is counted as
  `reused`.
- **Another pid namespace.** A pid only means something inside one pid
  namespace. When the `/proc` being read belongs to another namespace than the
  one the signals are sent in, the sweep is not taken at all and says why,
  rather than comparing two namespaces and reporting the difference.

## How It Works

1. On an interval, fifteen minutes by default, the sweep lists `/proc` and
   every listed thread group's `task` directory.
2. It sends `kill(pid, 0)` to every pid from 1 to `pid_max`, in slices, paced
   to `pids_per_second`, so a full 22-bit pid space at the default pace takes
   about 42 seconds and the sweep is never itself a load. A pid answers when
   the call succeeds or is refused for want of permission.
3. A pid that answered and was listed nowhere is observed through
   `/proc/<pid>`, which the kernel still serves for a pid it does not list:
   its thread group, state, start time and command name.
4. `/proc` is listed again and those pids are signalled and observed again. A
   pid that answers both times, is listed neither time, is a thread group
   leader that is not exiting and kept the same start time, is reported hidden.
5. A hidden process the previous sweep did not report raises an alert, and
   is handed to the [host rules](host-rules.md) as `process.hidden`, carrying
   its pid and command name.

In the rootless posture the agent runs in a pid namespace of its own and can
signal nothing outside it, so the sweep is made by the warden, which runs in
the host's; otherwise the agent sweeps from the host's `/proc` itself.

## The Alert

| Field | Value |
|-------|-------|
| Component | `hidden_process` |
| Rule | `process-hidden` |
| Severity | `high` |
| MITRE ATT&CK | T1014, Rootkit (defense evasion) |

The alert carries the pid and, where its `/proc` entry could be read, the
command name.

## What This Is Not

This is a comparison of two readings of the same kernel, not a rootkit scanner.
There is no signature database and nothing is matched against a known rootkit.

- **A rootkit that hides consistently from both readings is missed.** One that
  also intercepts the signal, or that takes the task out of the pid table, leaves
  nothing to compare.
- **A process hidden between two sweeps and gone before the next** is never
  seen. The sweep is a sample.
- **A process in another pid namespace** is seen only through the pid the host
  namespace gives it, which is the namespace the sweep runs in.

## Reading the Sweep

- REST: `/api/v1/ebpf/hidden-processes`, see the [REST API](../api-reference/rest-api.md#get-apiv1ebpfhidden-processes)
- CLI: `ebpfsentinel-agent ebpf hidden-processes`
- Dashboard: the node panel, which names every other node holding the same finding, as described in [What this node hides, and where else](../operations/node-observers.md#what-this-node-hides-and-where-else)
- Configuration: [`hidden_checks`](../configuration/hidden-checks.md)
- Editions: both. The open-source agent and the enterprise agent run the same sweep and serve the same route, and on the enterprise agent the host rules reading it fire as well
