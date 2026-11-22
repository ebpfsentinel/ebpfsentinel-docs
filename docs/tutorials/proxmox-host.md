# Watch a Proxmox host and its guests

One Proxmox VE host, one sitting. At the end of it, the agent runs on the
hypervisor, every container (CT) and every virtual machine (VM) is listed
under the name you gave it in Proxmox, a CT is refused a port by a rule
naming its hostname, and a VM's traffic is inspected, and dropped where you
say so, on its own tap device.

Like the [Docker host](./docker-host.md) tutorial, this runs on **your** host
rather than in the [lab](./index.md#the-lab). There is no recording: where
output is shown it is the shape the commands print, and yours will differ in
every name and address.

Allow about an hour.

## Before you start

- **Kernel 6.12 or later, with BTF.** Proxmox VE 9 runs a 6.14 kernel; on
  Proxmox VE 8, install and boot the opt-in `proxmox-kernel-6.14` first. Check
  with `uname -r` and `ls /sys/kernel/btf/vmlinux`; the package refuses to
  install on a host that has neither.
- One CT and one VM you can stop and start. Below they are CT `101`, hostname
  `ct-web`, and VM `201`, name `vm-db`.
- A second machine on the same network, to send traffic from.

## 1. Install the agent on the hypervisor

Proxmox VE is Debian, so the agent comes from the release's apt repository
and runs as two systemd units, as the [native packages](../operations/deployment/packages.md)
page describes:

```bash
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.gpg \
  | tee /etc/apt/keyrings/ebpfsentinel.gpg > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/ebpfsentinel.gpg] https://ebpfsentinel.github.io/ebpfsentinel-release/apt stable main" \
  | tee /etc/apt/sources.list.d/ebpfsentinel.list
apt-get update && apt-get install ebpfsentinel
```

Start from the Proxmox [host profile](../getting-started/profiles.md) rather
than from the reference configuration:

```bash
cp /usr/share/ebpfsentinel/profiles/proxmox-host.yaml /etc/ebpfsentinel/config.yaml
```

The profile names `vmbr0`, the bridge a stock install puts the management
address on. If yours differs, change `agent.interfaces` and the zone's
`interfaces` to it (`ip -o link show` lists them). Everything else stays as
shipped: the firewall is in `alert` mode, because on most installs the
cluster and storage traffic shares the bridge with the guests, and a drop
there takes a quorum with it.

```bash
systemctl enable --now ebpfsentinel-warden ebpfsentinel
journalctl -u ebpfsentinel -u ebpfsentinel-warden -f
```

Nothing has to be listed for the guests. The agent reads the two directories
Proxmox keeps them in, which the defaults already name:

```yaml
container:
  lxc:
    proxmox_dir: /etc/pve/lxc            # one <vmid>.conf per CT
  guests:
    proxmox_dir: /etc/pve/qemu-server    # one <vmid>.conf per VM
```

## 2. Every guest under its Proxmox name

Start the CT and the VM, then ask the agent what it sees:

```bash
ebpfsentinel-agent status
ebpfsentinel-agent ebpf guests
```

`status` reports `lxc on` on its `Containers` line. `ebpf guests` lists each
VM by the tap Proxmox made for it, `tap<vmid>i<n>`, with the name, the VMID
and the tags from `/etc/pve/qemu-server/<vmid>.conf`:

```text
Guests on this host: 1 named, 0 unnamed

INTERFACE  KIND  ATTACHED  GUEST   ID   SOURCE   TAGS  PROTECTED
tap201i0   tap   yes       vm-db   201  proxmox  -     network
```

A VM started after the agent is listed from its first boot: the agent
follows the links the kernel creates and reads the VM's file again every
five seconds, so a guest renamed in the web interface is renamed here too.

A CT is a set of processes in a cgroup of the host, so it shows up in the
process table rather than in the guest list. Find one of its processes and
read the container the agent filed it under:

```bash
pct exec 101 -- sleep 60 &
ebpfsentinel-agent processes list
ebpfsentinel-agent processes show <pid of that sleep> -o json
```

The `container` block carries runtime `lxc`, id `101`, the CT's `hostname` as
its name and its `ostype` as its image, with `proxmox.vmid` and one
`proxmox.tag` per tag as labels. Every alert from that CT carries the same.

## 3. A CT refused a port by its hostname

A CT's sockets are the host's sockets, so the workload firewall decides
them at `connect()`, before a packet exists. Name the CT by its hostname, or
by its number, `container: "101"`, which is the same CT:

```yaml
firewall:
  rules:
    - id: ct-web-no-smtp
      priority: 10
      action: deny
      protocol: tcp
      dst_port: 25
      workload:
        container: ct-web
        mode: observe
```

Workload rules need their hooks loaded, so restart the agent the first time
(`systemctl restart ebpfsentinel`); later edits are a reload
(`ebpfsentinel-agent config reload`). Then try from inside the CT:

```bash
pct exec 101 -- sh -c 'echo QUIT | nc -w 3 <a mail server> 25'
ebpfsentinel-agent firewall workload
```

In `observe` the connection goes through and the rule's `DENIALS` count
rises. Once it has counted only what you meant it to, change `mode` to
`enforce` and reload: the same command now fails with `Operation not
permitted`, inside the CT, and the count keeps rising.

## 4. A VM's traffic, decided on its tap

A VM runs its own kernel. None of its processes or sockets is on the host,
so a firewall rule naming a VM as a workload is refused at load, with that
reason: there is no `connect()` of the guest's for the host to refuse. What
the host does see is every frame the VM sends and receives on its tap, and
an IDS rule scoped to the guest is decided there:

```yaml
ids:
  enabled: true
  rules:
    - id: vm-db-no-rdp-out
      description: "RDP leaving vm-db"
      severity: high
      protocol: tcp
      dst_port: 3389
      mode: alert
      workload:
        guest: vm-db
```

Reload, and from inside the VM open a connection to port 3389 of any
machine. The alert names the rule and the guest:

```bash
ebpfsentinel-agent alerts list
```

The same connection from another VM, or from a CT, does not fire it: the
rule lives on `tap201i0` and nowhere else. Change the rule's `mode` to
`block`, reload, and the VM's SYN is dropped on its tap before it reaches
the bridge. `guest: "201"`, the VMID, names the same VM.

## What this does not do

- **A VM's processes.** Process attribution and data loss prevention need an
  agent inside the VM, and `ebpf guests` says so for every guest in its
  `PROTECTED` column. Install the agent in the guest for those.
- **A workload firewall rule naming a VM.** Refused at load, as in step 4: a
  VM is named by IDS rules only, and alone, never beside a `container` or a
  `unit`.
- **A VM's tap that no file names.** Listed as `unnamed` with the reason,
  never given a made-up name, and matched by no `guest` rule until a record
  names it.
- **A cluster's other nodes.** Each node runs its own agent, reading its own
  `/etc/pve/lxc` and `/etc/pve/qemu-server`; a guest migrated to another node
  is named there by that node's agent.

## Where to go next

- [Container awareness](../features/container-awareness.md#lxc-enricher) - the LXC enricher and the hypervisor guests, in full.
- [IDS workload scope](../configuration/ids.md#guests) - what a rule naming a guest may and may not carry.
- [Workload firewall rules](../configuration/workload-firewall.md) - the rule language a CT is named in.
- [From observation to a deny-by-default policy](./first-policy-from-observation.md) - a learning window on the hypervisor, turned into a policy.
