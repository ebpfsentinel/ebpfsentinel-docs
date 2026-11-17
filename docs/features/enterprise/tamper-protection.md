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

There are two ways to sign one, and both keys are yours: the console signs it
when a tenant administrator asks, with a reason, and a key pair kept offline
signs it when the console cannot. The vendor holds no stop key, and neither
the customer portal nor anything else we run can issue one.

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

## Per platform

Stopping an agent has three answers, and only the second one needs the BPF
LSM: the datapath keeps enforcing after the process is gone (open source), the
kernel refuses the stop unless it is signed (this edition, BPF LSM), and a
stop nobody signed is raised (this edition, no LSM needed).

| | Host with systemd | Docker or Compose | Kubernetes |
|---|---|---|---|
| Open source, no LSM needed | XDP, TC and cgroup links stay pinned and enforcing through a kill ([Enforcement After the Agent Exits](../../operations/enforcement-after-exit.md)); the units refuse `systemctl stop` and restart the agent on any exit but the stop command's ([Binary deployment](../../operations/deployment/binary.md#stopping-the-agent)); the next start logs how the last run ended | Same pinned links; `restart: always` brings the agent back on every exit; the next start logs a signalled end | Same pinned links; the kubelet restarts the container |
| This edition, needs `bpf` in `lsm=` | The kernel refuses a kill, a trace, an unpin, `cgroup.kill` and `cgroup.freeze` aimed at the agent or its warden, root included, until a signed stop opens its window | The same refusals from inside the host; a stop through the Docker socket is not a signal the kernel is asked about | The same refusals on each node |
| This edition, no LSM needed | Silence raised by the console, the federation and the HA peer when the agent goes quiet without a signed stop; a masked or edited unit is an alert | Same silence alerts | The API server refuses deleting, narrowing or scaling away the agents except by named service accounts; a removed `DaemonSet` is written again; a pod lost without a drain and a container restarted without the signed stop exit are events, metrics and alerts |
| What no agent stops | Root rebooting into a kernel command line without `bpf` in `lsm=`, a kernel module, physical access | Root stopping the container through the Docker socket, then the same three | A cluster administrator acting as one of the named service accounts, or removing the admission policy itself (put back and raised), then the same three on each node |

`ebpfsentinel-agent ebpf host-check` answers the LSM question for one host;
`/api/v1/ebpf/kernel-features` answers it per node under `tamper_protection`,
and the console shows it across the fleet.

## Configuration

```yaml
enterprise:
  tamper_protection:
    enabled: true
    stop_keys:
      - issuer: break-glass
        public_key: /etc/ebpfsentinel/stop-signing.pub
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
| `stop_keys` | empty | The key pairs allowed to sign a stop, each with the `issuer` it is trusted for. Empty, no stop is admitted until the agent restarts with one, and the agent warns at every start |
| `stop_keys[].issuer` | required | `dashboard` for the console's pair, `break-glass` for the pair kept offline. An entry without it is refused at load |
| `node_name` | node or host name | The name a stop must carry for this node |
| `protected_directories` | the link pin directory | Directories whose entries cannot be unlinked or renamed |
| `protected_files` | none | Files held themselves, beside the configuration and the licence the agent started with |
| `cgroup_root` | `/sys/fs/cgroup` | Where the unified cgroup hierarchy is mounted; empty leaves the cgroup undecided |
| `stop_record_path` | `/var/lib/ebpfsentinel/stop-record.json` | Where an admitted stop is recorded, so the next start and the console tell it from a silent one |

The stop keys are configuration, never the document's claim. A stop names its
issuer, and only the pairs listed here for that issuer are tried: a key listed
for `dashboard` never admits a document claiming `break-glass`, nor the reverse,
and a document whose issuer has no key here is refused as such. Both issuers
are the customer's own keys; the vendor holds no stop key and no portal issues
one.

`GET /api/v1/agent/tamper` lists the pairs the agent trusts under
`trusted_issuers`, each by issuer and fingerprint (the SHA-256 of both public
halves), never the key, so a console knows before offering a stop whether this
agent would admit one from it. The same answer carries `node`, the name a stop
must be issued for, so the console signs for the node the agent checks against
rather than for a name it guessed.

A configuration written before issuers existed lists its pairs without
`issuer`, and the agent refuses to load it until each entry names one. Every
pair signed with `stop-authorise` until then is a break-glass pair: add
`issuer: break-glass` to each existing entry.

## Stopping a protected agent

### From the console

The usual way. A tenant administrator opens the fleet, picks the agent and
gives a reason and a lifetime of one to fifteen minutes; a sign-in older than
five minutes is sent to sign in again first, and a tenant that asks for a
second administrator waits for one to approve. The console signs a document
naming the agent's node, `issuer: dashboard`, who asked and why, posts it to
the agent and says what the agent answered. The stop is written to the audit
trail and the tenant's notifications. The console offers a stop only where
the agent lists the console's pair under `trusted_issuers`, and says why
everywhere else.

The console's pair is generated once with `dashboard-server stop-keygen`,
its private half given to the console under `tamper.stop_signing` and its
public half listed on each agent with `issuer: dashboard`
([Dashboard configuration](../../configuration/dashboard.md#tamper-optional)).
Without it, the console signs no stop and says so where one would be offered.

### Break-glass, when the console cannot

Keep a second pair offline, the way any break-glass key is kept, and use it
only when the console does not answer, or when the agent is not one the
console reaches (a host outside every tenant, a network the console cannot
see). It is listed on each agent with `issuer: break-glass`:

```bash
ebpfsentinel-license keygen \
  --private-key stop-signing.key --public-key stop-signing.pub \
  --pq-private-key stop-signing-pq.key --pq-public-key stop-signing-pq.pub
```

Sign a stop for one node, then hand it to the agent on that node:

```bash
ebpfsentinel-license stop-authorise --node worker-3 --minutes 5 \
  --issuer break-glass --requested-by "on-call" --reason "kernel upgrade" \
  --signing-key stop-signing.key --pq-signing-key stop-signing-pq.key \
  --output stop.auth

ebpfsentinel-enterprise-agent stop --authorisation stop.auth
```

`--issuer` defaults to `break-glass`. A break-glass stop is recorded and
raised exactly like a console one, under its own issuer, so the fleet tells
afterwards which way each stop came.

### What the agent checks

`stop` posts the document to `POST /api/v1/agent/stop` on the local agent. The
agent refuses it when it is malformed, of a schema it does not read, not signed
by a pair listed for the issuer it names, for another node, issued ahead of its clock by more than
two minutes, valid for longer than fifteen minutes, expired, or already used.
Admitted, it opens the kernel's window for sixty seconds, writes the stop record,
raises a `tamper-stop-admitted` alert and exits with status `79`, which the
service unit treats as final while it restarts the agent on any other exit. The
run record names the stop as signed, by whom and for whom, so the next start
and the console tell it from a bare stop on an unprotected agent. A refusal
answers `403` and raises a `tamper-stop-refused` alert naming the reason.

The route is not licence-gated. A licence that lapses under a protected agent
leaves the kernel's refusal in place until the next start, and the signed stop
is the way through it; refusing it for want of a licence would leave a node
that nobody can stop in order.

In a container there is no service unit to honour status `79`: the runtime
restarts on any exit, and the agent cannot keep itself down. There an
admitted stop answers `armed` instead of `stopping`, the agent keeps running,
and the container has to be stopped (`docker stop`, `docker compose stop`)
while the kernel's sixty-second window is open; that stop is recorded as the
signed one. Docker itself cannot be prevented from stopping a container, so
on Docker the protection refuses kills and unpins from inside the host but
not a stop through the Docker socket, which is raised at the next start as a
signalled end (see [Docker](../../operations/deployment/docker.md#docker-cannot-prevent-a-stop)).

The window closes on its own: a stop whose shutdown hangs does not become an
open door. A trace stays refused even inside the window, since a stop never
needs the agent's memory.

## On Kubernetes

On a node, the kernel refuses the stop. On a cluster, an administrator stops
every agent at once without reaching a node: deleting the agent `DaemonSet`,
emptying its `nodeSelector`, scaling the operator to zero so nothing puts it
back. With the operator's tamper protection on, the API server refuses those
too.

```yaml
# values of the ebpfsentinel-operator chart
tamperProtection:
  enabled: true
  engine: native            # or kyverno
  allowedServiceAccounts:
    - ops/break-glass
```

The operator writes a `ValidatingAdmissionPolicy` and its binding, named
`ebpfsentinel-tamper-protection`, that refuse to everyone but the service
accounts named, the operator's own and the two controllers that finish a
delete one of them was allowed (the garbage collector and the namespace
controller):

| Refused | On |
|---|---|
| Delete | the agent `DaemonSet`, its configuration Secret and `ServiceAccount`, the `EbpfSentinelAgent`, the operator `Deployment` and licence Secret, the operator's namespace and every namespace holding an agent |
| Scale to zero | the operator `Deployment`, through `kubectl scale` or an edit |
| Edit of `nodeSelector`, `tolerations` or `affinity` | the agent `DaemonSet` and the operator `Deployment` |
| Edit | the configuration Secret and `ServiceAccount` of an agent, the licence Secret |
| Removal of the `ebpfsentinel.io/tamper-protected` label | any object carrying it |

Cluster-admin is refused like anyone else: the policy names who may, not who
may not. The refusal names the protection, so the person refused knows which
account to use. The native policy needs Kubernetes 1.30 or later and nothing
installed beside it. `engine: kyverno` writes no native policy and renders
the same rules as a Kyverno `ClusterPolicy` instead, for an estate whose
admission already runs through Kyverno; that variant holds the release
namespace and those listed in `tamperProtection.namespaces` from deletion,
since a chart cannot see where the agents live.

The protection needs the licence to carry `tamper-protection`. Asked for
without it, the operator logs that nothing is refused and writes no policy.

What the operator reports, whichever engine refuses:

| Event on the agent resource | Raised when |
|---|---|
| `AgentWorkloadRecreated` | The agent `DaemonSet` was gone though the operator had written it, and was written again: deleted by a named account, removed under the API server from etcd, or deleted with the protection off |
| `AgentPodLostWithoutDrain` | A node held an agent pod on the last pass and holds none now, nothing was rolled in between, and the node is still schedulable and not being removed. A drain cordons the node first, so it is not raised |
| `AgentStoppedWithoutAuthorisation` | An agent container ended on anything but the exit a signed stop ends with (79) and the kubelet restarted it; the note names the pod, the exit and the last attempt the agent refused |
| `TamperPolicyRestored` | The policy or its binding was deleted or edited outside the operator, and the operator put it back |

Each is also a counter the
[operator alert rules](../../operations/operator-monitoring.md#the-alerts)
page on.

What it does not cover:

- Admission is never asked about its own objects, so an administrator can
  delete the policy or its binding. The operator puts both back within thirty
  seconds and raises `TamperPolicyRestored`: possible, never silent. Under
  the Kyverno engine, the Kyverno policy is as exposed as any other.
- Whoever reaches etcd or the API server's own flags is past admission. The
  operator writes the `DaemonSet` again and says so.
- An edit of the image or the command of the agent `DaemonSet` is not refused;
  the operator writes the `DaemonSet` back to what the resource asks on its
  next pass.
- Uninstalling, or turning the protection off again, is done as one of the
  named accounts ([Uninstalling](kubernetes-operator.md#uninstalling)).

### Stopping one node's agent

A `DaemonSet` puts the agent back on every node, so on Kubernetes an admitted
stop is followed by the operator taking the node out of the `DaemonSet`. The
signed document goes on the agent resource:

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EbpfSentinelAgent
metadata:
  name: edge
  namespace: security
spec:
  stoppedNodes:
    - node: worker-3
      nonce: 0193f2c4-6a1e-7b2d-9c4f-1e2d3c4b5a69
      envelope: |
        eyJzY2hlbWEiOiJlYnBmc2VudGluZWwuc3RvcC92MSIs...
        ...
        ...
```

The operator verifies the document against the same stop keys the agent
renders from `EnterpriseSettings.spec.tamperProtection.stopKeys`, hands it to
the agent pod on that node and, once the agent admits it, records it under
`status.stoppedNodes` (node, issuer, who asked, why, `stopping` or `armed`,
when) and keeps the `DaemonSet` off that node until the entry is removed.
Removing the entry gives the node back. An entry that does not verify, names
another node than its document, expired before it reached the agent, or that
the agent refused, is taken back out of the spec with an `AgentStopRefused`
event; an admitted one raises `AgentStopAdmitted`.

The console does this itself for an agent the operator runs: it signs the
document, writes the entry on the agent resource of the tenant's cluster,
lists the nodes kept off, and gives one back on request from the same role.
Under the operator's tamper protection only named service accounts change
`spec.stoppedNodes`, so the console's account must be in
`tamperProtection.allowedServiceAccounts`. A break-glass stop on Kubernetes
is the same entry written with `kubectl` by one of those accounts.

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
| `agent-stopped-without-authorisation` | An agent fell silent and no signed stop preceded it (raised by whoever watches it, see below) |

Each refusal names the process that tried, so the alert answers who as well as
what.

## Silence

An agent killed in a way its own guard cannot refuse - a host without the BPF
LSM, a power cut, a node removed under it - cannot say so itself. Whatever
watches it says it instead. Each protected agent publishes what it knows on
`GET /api/v1/agent/tamper` (role `viewer`, grant `config:read`): whether it is protected, the last stop it admitted
(when, through which issuer, at whose request) and the last attempt it refused.
A watcher reads that answer while the agent is up, so when the agent goes quiet
the last refused attempt is already in hand.

| Who watches | Raises | When |
|---|---|---|
| The dashboard | `agent_stopped_without_authorisation` on the fleet stream and an `agent-stopped-without-authorisation` alert on the tenant's alert stream | An agent stops answering and neither its last notice nor a `tamper-stop-admitted` alert heard on its stream accounts for the silence |
| The federation receiver | `agent-stopped-without-authorisation` on the federated alert stream | A cluster member's heartbeat stops and the last one carried no stop |
| An HA peer | The same rule on the peer's own alert pipeline | A peer's heartbeat stops with no signed stop in its last answer |
| The operator | `AgentStoppedWithoutAuthorisation` event and `ebpfsentinel_operator_agent_stopped_without_authorisation_total` | An agent container ended on anything but the exit a signed stop ends with (79) and was restarted; a pod lost without a drain carries the last refused attempt too |

A stop is taken to account for a silence when it was admitted no more than five
minutes before the agent was last heard. Every raise names when the agent was
last seen and the last attempt it refused, if any. The guard's refusals and an
HA peer's raise travel the agent's alert pipeline, so response playbooks, SIEM
export and the tenant views see them like any other alert; the federation
receiver stores and streams its raise beside the alerts its members send; the
dashboard's reaches the tenant's alert view and fleet stream, and is filed as a
critical notification in the tenant's inbox, mailed to the tenant's
`notification_recipients` when the dashboard has a mail server. A silence is
never folded into an earlier one: two stops are two notifications.

The fleet-wide view is this edition's. The open source agent keeps a record of
how each run ended and, on the next start, logs a run that ended on a signal
rather than on a signed stop, so a single host still tells its own story.

## Limits

- A licence lost while the agent runs leaves the protection in place until the
  next start, which then runs unprotected.
- The agent's own maps and links are covered by the guard from the open
  source core, which reads their identifiers again half a second after each
  object is loaded (see [Foreign programs](../foreign-programs.md)); an object
  is unguarded for that half second.
- On a host without the BPF LSM nothing is refused, and the node reports itself
  unprotected rather than claiming otherwise.
