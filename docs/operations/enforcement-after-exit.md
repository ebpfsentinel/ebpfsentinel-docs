# Enforcement After the Agent Exits

A firewall that stops enforcing the moment its process dies hands an attacker
a short recipe: kill the agent, then do what the rules refused. The agent's
XDP, TC and cgroup links are therefore pinned on the host bpffs. The kernel
keeps a pinned link attached, running the program it was given and reading the
maps that program reads, whatever happens to the process that made it.

## What survives

| Hook | Survives the process | Notes |
|------|---------------------|-------|
| XDP on each interface | Yes | With its tail-call program arrays, which are pinned too: the kernel empties an array no descriptor and no pin holds |
| TC (TCX ingress and egress) | Yes | The whole chain, in its order |
| netkit primary and peer | Yes | |
| cgroup hooks (attribution, workload firewall) | Yes | |
| uprobes (DLP, crypto inventory) | No | Owned by their descriptor; they observe, they do not enforce |
| Connect redirect and cluster address resolution | No | They steer connections to a listener of the agent's own, which is gone with it |
| LSM programs | No | Their own lifecycle; see the tamper protection of the Enterprise edition |

A stopped, crashed or killed agent (SIGKILL included) leaves the surviving
hooks enforcing the last rules it wrote. What needs the process stops with it:
alerts, ring-buffer readers, rule updates, feed refreshes, expiry of timed
blocks. The datapath keeps refusing what it refused; nothing new is learned.

## Where the pins live

`/sys/fs/bpf/ebpfsentinel-links/`, one file per link, or the directory named
by `EBPFSENTINEL_LINK_PIN_DIR`.

- **Agent with its own privileges** (systemd unit, package): the agent pins
  directly.
- **Rootless agent beside the warden** (Docker, Kubernetes, BPF token
  deployments): the agent's bpffs lives inside its own mount namespace and
  goes with it, so it hands each link to the warden, which pins it on the
  host bpffs. The warden only pins BPF links and program arrays; any other
  descriptor is refused.
- **Docker**: both compose files bind the host `/sys/fs/bpf` into the warden.
  `docker stop`, `docker rm` and `docker compose down` leave the pins.
- **Kubernetes**: the warden container mounts the node's `/sys/fs/bpf` through
  the DaemonSet's hostPath. Deleting or restarting the pod leaves the pins.
  With `daemonset.bpfToken.bpffsEmptyDir=true` (nested runtimes such as kind
  or minikube) there is no node bpffs behind the mount and the links go with
  the pod.

## A restart adopts, it does not attach again

At start the agent opens every pinned link. Each attach claims the link it
would have created, so no hook is attached twice. The claimed link keeps
running the previous program, on the previous maps and their rules, while the
new process loads and writes its own rules; once they are written each link is
swapped onto the new program in one `BPF_LINK_UPDATE`. The hook is never empty
and never runs a program whose maps are still blank. A pinned link no attach
claims is a hook the new configuration no longer wants, and it is removed.

## Exit policy

```yaml
agent:
  on_exit: keep        # keep (default) or detach
```

`keep` leaves the pins on a graceful exit too. `detach` removes them on a
graceful exit, so `systemctl stop` takes the hooks off; a crash or a kill
keeps them either way, since a process that is killed runs no exit path.

## Taking the hooks off

```bash
ebpfsentinel-agent uninstall              # or ebpfsentinel-enterprise-agent uninstall
```

Removes every link pin, through the warden when `EBPFSENTINEL_WARDEN_SOCK` (or
`--warden-sock`) names one, directly otherwise, and the map pins with them. A
running agent keeps its own descriptors and its hooks until it stops; once it
has, nothing is left attached. This is the one command that removes the pins.

In Kubernetes, run it in the agent's pod before deleting the DaemonSet:

```bash
kubectl -n ebpfsentinel exec ds/ebpfsentinel -c agent -- ebpfsentinel-agent uninstall
```

With Docker, from the agent container before `docker compose down`:

```bash
docker exec ebpfsentinel ebpfsentinel-agent uninstall
```

## What this does not cover

A pin is a file on the host bpffs. Root on the node can remove it, and a
reboot clears the bpffs. Refusing those to everybody but a signed stop is the
Enterprise tamper protection, which rests on the BPF LSM.
