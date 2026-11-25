# The Agent and the Warden: What a Compromise Buys

This page answers one question for an operator deciding where the agent may run: if an attacker takes over the agent process, what can they do on the node, and what does each kernel feature and boot option take away from them. Every line that depends on the kernel says which condition it needs beside it, and every condition is answered for your own host by a command, not by a kernel version.

How programs are signed and how the warden refuses an unsigned load are described once, in the [Security Model](../architecture/security-model.md#signed-program-loaders); this page links there rather than repeating it.

## Two processes, two privilege levels

The shipped deployment (packages, compose, chart) splits the node's privileges between two processes ([BPF token delegation](../operations/deployment/bpf-token.md#the-warden-broker)):

- **The agent** parses every packet, every configuration file and every API request. It runs as its own unprivileged user (`ebpfsentinel` under systemd, `65534` in a container), in a user namespace it creates, with an empty capability bounding set on the host. It loads its eBPF programs through a BPF token scoped to the program, map and attach types its datapath uses, and nothing else.
- **The warden** parses no traffic and no configuration it did not read at start. It holds the host capabilities the datapath cannot do without (`CAP_SYS_ADMIN`, `CAP_NET_ADMIN`, `CAP_NET_RAW`, `CAP_SYS_PTRACE`, `CAP_BPF`, `CAP_PERFMON` and file-read capabilities, listed in `dist/ebpfsentinel-warden.service`), serves one uid on a Unix socket, and answers a short typed protocol: route programming, gratuitous ARP, conntrack teardown, capture sockets, the attach of programs that read the kernel. Under seccomp it is killed on `execve`, `ptrace`, `init_module`, `kexec_load`, `mount`, `unshare`, `keyctl`, `reboot` and the rest of the list in the warden's `confine.rs`, so a request cannot turn it into a shell or a module loader.

Integration suite `62-warden-broker-rpc.bats` checks on a VM that the agent is not host root and holds no host capability, that a peer with another uid is dropped unserved, and that a route the configuration does not name is refused with the routing table untouched.

## What the warden will do for the agent

The warden reads its policy once, from a file the agent binary writes from its configuration before the warden starts (`ebpfsentinel-agent warden-policy`), into a directory the agent cannot write. The agent never reads that file and has no request that changes it, so **a compromised agent cannot widen what its warden does for it**; a new family takes a restart of both. The families and their fences are in [What the warden answers](../operations/deployment/bpf-token.md#what-the-warden-answers):

| Family | Switched on by | Fenced to |
|---|---|---|
| `routing` | `routing.enabled` | the default route through each configured gateway |
| `neighbour` | load-balancer announce | the configured VIPs on the announce interface |
| `conntrack-restore` | high availability (enterprise) | |
| `runtime` | Docker or Podman awareness | those runtimes |
| `file-watch`, `write-refusal` | the file watch and its write refusal | the canary paths named |
| `uprobe` | DLP or the file watch | |
| `resolver` | the DNS allowlist | its listen address |
| `hidden-ports`, `hidden-processes` | the hidden checks | the probed ports |
| `package-inventory`, `network-inventory` | the inventories | |
| `extension` | an enterprise feature that needs one | the extensions named |

What every datapath needs (bpffs delegation, module BTF and capture descriptors, conntrack read and teardown, the executable behind a pid) belongs to no family and is answered on every host. Each such command and the reason it is unfenced is listed in the agent's `tests/integration/warden-commands.toml`. A compromised agent can therefore still kill established flows, read the conntrack table and open capture sockets up to the per-process ceiling: these are what the agent does on a healthy node, and fencing them would refuse a correct agent.

## What a compromised agent can still do, condition by condition

The rows add up: each holds where the conditions of the rows above it also hold. `/api/v1/ebpf/kernel-features` (blocks `bpf_prog_signing` and `bpf_lsm`) and `/api/v1/crypto/posture` (block `signing`) answer the first three rows for a running agent, and `ebpfsentinel-agent ebpf host-check` answers the BPF LSM as any user with nothing installed ([REST API](../api-reference/rest-api.md)).

| Condition on the host | A compromised agent can still | It can no longer | Answered by |
|---|---|---|---|
| The kernel floor, nothing more | Load any program of the types its token allows, its own included, including kprobes that read kernel memory; send the warden every unfenced command; read and write its own maps | Touch the host as root, change its warden policy, attach a raw tracepoint or uprobe through a program the warden holds to a target the warden did not compile in, run a command through the warden | suite 62 |
| The kernel verifies BPF program signatures, the BPF LSM not active | All of the row above: the agent's programs load signed, but nothing refuses an unsigned one | Nothing more than the row above. `signing.state` reads `verified_not_enforced` and `not_enforced_because` names the `lsm=` line that would change it | suite 156, [Program signatures](../kernel/requirements.md#program-signatures-a-kernel-build-not-a-version) |
| Signature verification **and** `bpf` in the `lsm=` boot list | Load the programs the release signed, in the shape the release built them; use the unfenced commands | Load a program of its own through its token: the warden's guard refuses every token load not signed against the keyring made from the release's certificate, whose private key was destroyed after the build. `signing.state` reads `enforced`. Another task can no longer detach the agent's links or write its maps (`lsm-bpf-guard`) | suites 157, 88, [the warden refuses an unsigned load](../architecture/security-model.md#the-warden-refuses-an-unsigned-load), [the BPF LSM at boot](../kernel/requirements.md#the-bpf-lsm-a-boot-parameter-not-a-version) |
| `lockdown=integrity` at boot | Everything of the row it is combined with: no program of ours is expected to be refused, since integrity only takes away writing to user memory, which none of them does | Nothing about eBPF it could do before; the level keeps root (and so a compromised warden) from loading an unsigned kernel module or writing kernel memory ([kernel_lockdown(7)](https://man7.org/linux/man-pages/man7/kernel_lockdown.7.html)) | not run by a suite yet: our gap |
| `lockdown=confidentiality` at boot | Run the programs listed as loading below | Read kernel memory from any eBPF program, signed or not, its own or ours, and the same holds for root and for the warden; the kernel's price is that our programs that read the kernel are refused too ([below](#lockdownconfidentiality)) | suite 158 |
| `kernel.unprivileged_bpf_disabled=2` (Ubuntu's default) | Everything it could before: its loads go through a token, which this setting does not concern | Nothing more: it stops other unprivileged processes on the node from loading socket filters, not the agent | suite 158 |

Where the warden attaches the guard, a capability of the token is no longer a capability of the attacker; where it cannot, the token's scope is the whole fence and kernel-reading program types are in it. That is why the condition is stated in every row rather than once at the top.

### Hardening a node, item by item

| Item | How | Effect on the agent | Effect on an attacker holding the agent |
|---|---|---|---|
| `bpf` in `lsm=` | the boot line `ebpfsentinel-agent ebpf host-check` prints, which keeps the modules already active ([which distributions boot with it](../operations/compatibility.md#the-bpf-lsm-at-boot)) | adds workload identity, write refusal, tamper guard and the guard on its own objects | with signature verification, no program of its own loads |
| A kernel that verifies BPF program signatures | a kernel build, probed at start ([requirements](../kernel/requirements.md#program-signatures-a-kernel-build-not-a-version)) | loads through the loaders signed at build | with `bpf` in `lsm=`, no program of its own loads |
| `lockdown=confidentiality` | boot parameter | loses every program in the refused list below: the XDP firewall (the agent runs degraded and says so), process attribution, workload identity and the guards on its own objects; the guard on program loads still loads | no kernel memory read through eBPF, whatever it loads |
| `lockdown=integrity` | boot parameter | expected to keep every program | root on the node cannot load an unsigned module |
| `kernel.unprivileged_bpf_disabled=2` | sysctl | expected none: token loads are untouched | none on the agent; other unprivileged processes lose `bpf()` |

## lockdown=confidentiality

At `confidentiality` the kernel withdraws `bpf_probe_read_kernel` and `bpf_probe_read_kernel_str` from every program type, and the verifier refuses a whole program that can reach a helper it no longer offers, whatever the branch does at run time. Every program of ours that reads a kernel structure, directly or through the shared pid-namespace helper, is refused. The agent starts regardless and reports each refused program as not loaded in `GET /api/v1/ebpf/status` and in `ebpfsentinel_ebpf_program_status`; `cat /sys/kernel/security/lockdown` shows the level in brackets.

<!-- BEGIN GENERATED LOCKDOWN PROGRAMS -->

Confirmed on a kernel booted with `lockdown=confidentiality` by the agent's lockdown suite on 2026-11-25. 15 of the 31 programs are expected to be refused. The list is `tests/integration/lockdown-programs.toml` in the agent's repository; the agent's lockdown suite (`158-lockdown-confidentiality.bats`) reads the same file.

| Program | Under `lockdown=confidentiality` | Why | What you go without there |
|---------|----------------------------------|-----|---------------------------|
| `xdp-firewall` | Refused | Reads the conntrack state of an nf_conn with bpf_probe_read_kernel | The XDP firewall, the IPS blacklist and the DDoS auto-block in the kernel; the agent runs in degraded mode for them |
| `tc-conntrack` | Refused | Reads nf_conn fields with bpf_probe_read_kernel | The connection table read from the kernel's conntrack |
| `cgroup-attribution` | Refused | Numbers the task in its pid namespace through current_pid_tgid, which reads the task with bpf_probe_read_kernel | The process and container a socket belongs to on alerts and flows |
| `cgroup-workload-firewall` | Refused | bpf_probe_read_kernel on the task, and current_pid_tgid | Workload identity rules (which executables may reach the network) |
| `tracepoint-process` | Refused | bpf_probe_read_kernel on the task and the binary's path, and current_pid_tgid | The process table and every alert field read from it |
| `tracepoint-signal` | Refused | current_pid_tgid | The signal sent from the kernel at the next syscall of a process a rule kills |
| `tracepoint-drop-reason` | Refused | Reads the sk_buff at kfree_skb with bpf_probe_read_kernel | The kernel's drop reasons on GET /api/v1/ebpf/drop-reasons |
| `tracepoint-tcp-health` | Refused | Reads the socket at the TCP tracepoints with bpf_probe_read_kernel | Retransmission and reset counts per connection |
| `uprobe-crypto` | Refused | current_pid_tgid | The inventory of processes calling a TLS library |
| `uprobe-dlp` | Refused | Its kTLS kprobes read the socket with bpf_probe_read_kernel, and the uprobes call current_pid_tgid | DLP on decrypted TLS payloads |
| `lsm-exec-network` | Refused | bpf_probe_read_kernel on the task and the file, and current_pid_tgid | The executable a connection came from |
| `lsm-exec-digest` | Refused | bpf_probe_read_kernel on the inode | The executable's digest in the process table |
| `lsm-write-refusal` | Refused | bpf_probe_read_kernel and bpf_probe_read_kernel_str on the path, and current_pid_tgid | Writes refused in the kernel to protected paths |
| `lsm-tamper-guard` | Refused | bpf_probe_read_kernel and bpf_probe_read_kernel_str on the path, and current_pid_tgid | The refusal of writes to the agent's own files and of signals to its processes |
| `lsm-bpf-guard` | Refused | bpf_probe_read_kernel on the map and link a bpf() call names | The refusal of writes to the agent's maps and detaches of its links by another task |
| `xdp-firewall-reject` | Loads, but never attempted while `xdp-firewall` is refused | Parses and forges packets only | REJECT answers, since the firewall that installs it is refused |
| `xdp-ratelimit` | Loads | Packet parsing and per-CPU maps only | Nothing |
| `xdp-ratelimit-syncookie` | Loads | Packet parsing and the syncookie helpers only | Nothing |
| `xdp-loadbalancer` | Loads | Packet parsing and map lookups only | Nothing |
| `xdp-vip-announcer` | Loads, but never attempted while `xdp-firewall` is refused | Answers ARP and neighbour solicitations from a map | The VIP announcer, since the firewall chain that installs it is refused |
| `xdp-pass` | Loads | Returns XDP_PASS | Nothing |
| `tc-ids` | Loads | Packet parsing and kfuncs only | Nothing |
| `tc-threatintel` | Loads | Packet parsing and map lookups only | Nothing |
| `tc-dns` | Loads | Packet parsing and ring buffers only | Nothing |
| `tc-nat-ingress` | Loads | Packet rewriting and its own reverse tables only | Nothing |
| `tc-nat-egress` | Loads | Packet rewriting and its own reverse tables only | Nothing |
| `tc-scrub` | Loads | Packet rewriting only | Nothing |
| `tc-qos` | Loads | Classification and timestamps only | Nothing |
| `cgroup-clusterip` | Loads | Rewrites the connect address from a map | Nothing |
| `cgroup-connect-redirect` | Loads | Rewrites the connect address from a map | Nothing |
| `lsm-bpf-load-guard` | Loads | Reads the load attributes through the hook's arguments with no helper | Nothing |

<!-- END GENERATED LOCKDOWN PROGRAMS -->

Whether to boot at this level is a trade the page cannot make for you: it closes the read of kernel memory to everyone, our programs included, and the firewall and process attribution go with it. `lockdown=integrity` keeps them.

## What no agent design survives

These are limits, not conditions: no setting above changes them.

- **A compromised warden is root on the node.** It holds `CAP_SYS_ADMIN` and the other capabilities listed above; seccomp takes away `execve`, module loading and mounts, but a process with those capabilities and arbitrary code can still reconfigure the network, read other processes' memory through `/proc` where `CAP_SYS_PTRACE` allows it, and load eBPF through its own `bpf()` calls. The warden's defence is its size and what it parses: no traffic, no API, one served uid, a policy read once. How far a warden compromise reaches beyond that is not measured by a suite: our gap.
- **Physical or console access** to the node, or to its disk at rest, is outside what a process on that node can see or refuse.
- **A kernel module** runs with the kernel's own privileges and can unhook any LSM and any eBPF program. Lockdown at either level refuses an unsigned one ([kernel_lockdown(7)](https://man7.org/linux/man-pages/man7/kernel_lockdown.7.html)); a signed module the distribution ships is trusted by the kernel and by us.
- **A reboot without the BPF LSM** drops every guard that rests on it: the next boot has no guard on program loads, no guard on the agent's objects and no tamper guard, and the agent says so in `/api/v1/crypto/posture` (`not_enforced_because`) and `/api/v1/ebpf/kernel-features`. Suite 88 runs that state with `bpf` masked out and checks the agent alerts on a detach it can no longer refuse; whoever controls the boot line controls this, and the alert is the only answer.

## Checking a host

```bash
ebpfsentinel-agent ebpf host-check          # BPF LSM and the lsm= line to set, as any user
cat /sys/kernel/security/lockdown           # the lockdown level, in brackets
sysctl kernel.unprivileged_bpf_disabled
curl -s localhost:8080/api/v1/crypto/posture | jq .signing
curl -s localhost:8080/api/v1/ebpf/kernel-features | jq '{bpf_prog_signing, bpf_lsm}'
curl -s localhost:8080/api/v1/ebpf/status | jq '.programs[] | select(.loaded == false)'
```
