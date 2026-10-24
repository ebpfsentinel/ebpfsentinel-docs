# Response Configuration

The `response` section bounds manual response actions: the longest TTL `POST /api/v1/response` and `ebpfsentinel-agent response block` will accept.

It is not the [`auto_response`](auto-response.md) section. That one decides whether an action fires on its own when an alert matches a policy and carries its own per-policy TTL. The ceiling here applies to every response action the agent installs, whoever asked for it.

## Reference

```yaml
response:
  max_ttl_secs: 86400
  kill_process:
    enabled: false
    signal: 9
    window_ms: 2000
    protected_commands: []
    protected_pids: []
  quarantine:
    enabled: false
    window_secs: 900
    max_window_secs: 86400
    tear_down_flows: true
    max_flows_scanned: 65536
    protected_paths: []
    protected_ids: []
    sweep_interval_secs: 30
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_ttl_secs` | u64 | `86400` | Longest TTL the agent accepts on a response action, in seconds. Minimum `1`, maximum `2592000` |
| `kill_process.enabled` | bool | `false` | Whether the agent loads the program that can stop a process |
| `kill_process.signal` | u32 | `9` | The signal sent. Minimum `1`, maximum `64` |
| `kill_process.window_ms` | u64 | `2000` | How long the kernel keeps looking for the target, in milliseconds. Minimum `1`, maximum `30000` |
| `kill_process.protected_commands` | list of string | `[]` | Extra executable names the agent refuses to signal. An empty entry is refused at config load |
| `kill_process.protected_pids` | list of u32 | `[]` | Extra process ids the kernel refuses to signal. `0` is refused at config load |
| `quarantine.enabled` | bool | `false` | Whether the agent acquires the maps that cut a workload off the network |
| `quarantine.window_secs` | u64 | `900` | How long a quarantine lasts when the rule names no duration, in seconds. Minimum `1` |
| `quarantine.max_window_secs` | u64 | `86400` | Ceiling a rule's own duration is clamped to, in seconds. Maximum `604800` (seven days) |
| `quarantine.tear_down_flows` | bool | `true` | Whether the connections the workload already holds are deleted as well as the ones it opens next |
| `quarantine.max_flows_scanned` | usize | `65536` | How many conntrack rows the teardown walks. Minimum `1`, maximum `1048576` |
| `quarantine.protected_paths` | list of string | `[]` | Extra cgroup paths the agent refuses to quarantine. An empty or relative entry is refused at config load |
| `quarantine.protected_ids` | list of u64 | `[]` | Extra cgroup ids the agent refuses to quarantine. `0` is refused at config load |
| `quarantine.sweep_interval_secs` | u64 | `30` | How often lapsed entries are removed from the kernel map. Minimum `1`, maximum `3600` |

A request above the ceiling is refused, not clamped. A value of `0`, or one above `2592000` (thirty days), is refused at config load: a response action is a temporary measure that a firewall rule should replace, so the bound is not open-ended.

## Stopping a process

`kill_process` is the only response action whose blast radius is a running
program rather than a packet, so it is off by default and turning it on arms
nothing by itself: with `enabled: true` the agent loads the program and
attaches it, and a process is stopped only where a rule asks for it: an IPS
rule carrying [`kill_process: true`](ips.md#stopping-the-process-behind-a-blocked-flow),
or an Enterprise response policy.
A node that leaves this block out carries no such program at all, and the
`attached` field of `/api/v1/ebpf/kernel-features` says so.

What the agent refuses to signal whatever a rule asks:

- process 1, and the agent and its warden,
- `systemd`, `init`, `containerd`, `containerd-shim*`, `dockerd`, `docker`,
  `crio`, `conmon`, `runc`, `crun`, `podman` and `kubelet`,
- a process whose executable the agent could not read, because an unidentified
  target is not a target,
- everything `protected_commands` and `protected_pids` add.

That first list is not configurable and configuration cannot shorten it: both
settings only widen the refusal. Killing a container runtime to stop one
container's process would take every container on the node with it, and an
operator reading a rule in a hurry should not be able to arm that.

The signal is sent from the kernel at the target's next system call, which is
what bounds `window_ms`: a target that makes no system call before the window
closes is reported as a survivor rather than assumed dead, and so is a target
that handled the signal. The agent looks the process up again after the signal
to tell the two apart, so what an audit record says happened is what was
observed and not what was attempted. `signal` defaults to `9` because `15` can
be caught and ignored.

Both outcomes are written to the audit log, naming the rule, the target and
whether the process is gone, and the five kernel counters
(`sent`, `protected`, `expired`, `helper_failed`, `event_lost`) are exported on
`/metrics` like every other program's. `sent` counts a signal delivered, which
is not the same as a process stopped.

## Quarantining a workload

`quarantine` is the action between denying one flow and stopping a process: the
workload keeps its memory, its logs and its open files, and loses the network.
It is keyed on the cgroup rather than on an address or a process, so it covers
every process in that cgroup and every process the workload starts afterwards,
and it survives the process the alert happened to catch.

It rides the same kernel program as the [workload
rules](workload-firewall.md), so turning it on loads that program whether or
not the configuration carries a workload rule, and the quarantine is asked
first: an allow rule cannot overrule it. The six hooks it answers at are
`connect`, `sendmsg` and `bind`, for IPv4 and IPv6, so a quarantined workload
gets `EPERM` on its next outbound connection and on its next attempt to listen.

What the agent refuses to quarantine whatever a rule asks:

- the root of the cgroup hierarchy and the agent's own cgroup,
- `/init.scope` and the units of `containerd`, `docker`, `crio`, `podman`,
  `kubelet`, the agent, its warden, `sshd` and Teleport,
- a cgroup the agent could not place in the hierarchy, because an unidentified
  target is not a target,
- everything `protected_paths` and `protected_ids` add.

That first list is not configurable and configuration cannot shorten it: both
settings only widen the refusal. Cutting the container runtime off the network
would take every container on the node with it, and cutting `sshd` off would
take the operator's own way back in.

Two halves, and the difference matters to whoever reads the outcome.
**Arming** writes an entry the kernel reads, which refuses what the workload
opens *next*; **tearing down** walks the connection table and deletes the flows
it already holds. With `tear_down_flows: false` a quarantined workload can open
nothing new and keeps every connection it had, which is a containment that an
operator may read as complete and is not. A flow the agent could not attribute
to a cgroup is left open and counted separately, so an outcome saying `0 flows
torn down` is distinguishable from one saying nothing could be named.

The expiry is a kernel deadline on the boot clock rather than a timer in the
agent, so a quarantine outlives the agent dying and a workload is reachable
again when its window closes whether or not anything is running to release it.
`sweep_interval_secs` only tidies the map up; it is not what ends a quarantine.
A rule's own duration is clamped to `max_window_secs` rather than refused,
because a policy shipped from elsewhere must not be able to cut a workload off
for longer than the operator allowed.

A report-only quarantine arms the same entry without refusing anything and
tears nothing down: it counts what the enforcing one would have cut. The four
kernel counters (`refused`, `expired`, `observed`, `event_lost`) are exported on
`/metrics`, and every quarantine, refusal and release is written to the audit
log naming the rule, the cgroup and the outcome.
`/api/v1/ebpf/kernel-features` reports whether the capability is armed, the
default window, whether flows are torn down, and how many cgroups the fence
protects.

## What survives a restart

A response action is written down when it is taken, in `mitigations.redb`
beside the audit store (the directory is the one `audit.storage_path` names),
and read back when the agent starts. An action comes back for the time left on
its TTL rather than for its original TTL, and an action that expired or was
revoked while the agent was down is dropped on the way in. Each restored action
is written to the audit log with a detail line naming the restart and how much
of the TTL was left.

`max_ttl_secs` is re-applied to what comes back: an action written down under a
higher ceiling, with the ceiling since lowered, is dropped rather than
reinstalled. The configuration in force now is what decides, and nothing
reaches the data plane before the ceiling is checked.

**A throttle's token bucket is not restored.** The rate is reinstalled, the
credit the source had already spent against its bucket is not: the buckets live
in a kernel map that went with the old process, and there is no safe way to
reconstruct them. A throttled source therefore gets one bucket's worth of burst
across a restart. The alternative, starting a restored bucket empty, would
punish every source for a restart it did not cause, so the burst is the
deliberate choice. Containment that must not have that gap belongs in a
firewall rule, which the restart does not widen.

If the store cannot be opened or written, the agent logs it once and keeps
going: an action taken while the store is unavailable is in force until it
expires, and is lost if the agent restarts first.

## Example

```yaml
response:
  max_ttl_secs: 604800
```
