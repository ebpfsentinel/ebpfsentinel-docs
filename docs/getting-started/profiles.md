# Host Profiles

Three complete configurations ship with the agent, one per host it is most
often put on: a home router, a single k3s node and a Proxmox hypervisor. Each is
a document to copy over `/etc/ebpfsentinel/config.yaml`, not an example to adapt
line by line. The decisions are already taken, the reasoning is in the comments,
and what has to change is named at the top of the file: the interface names, and
on the home router the LAN prefix.

| Profile | Host | What it is set up to do |
|---------|------|-------------------------|
| `home-router.yaml` | A box with a provider interface and a house interface | Route and masquerade for the LAN, accept from outside only what was asked for, and watch what the house dials |
| `k3s-node.yaml` | One node carrying the control plane and the workloads | Name the workload behind every flow, and catch what reaches the node from outside the cluster |
| `proxmox-host.yaml` | A hypervisor with a guest bridge and a management address | Watch the bridge rather than each tap device, and tie a flow back to the guest that opened it |

## Where they are

| Install | Path |
|---------|------|
| Package (`.deb` / `.rpm`) | `/usr/share/ebpfsentinel/profiles/` |
| Release tarball | `/usr/local/share/ebpfsentinel/profiles/` after `install.sh` |
| NixOS | `services.ebpfsentinel.profile = "home-router";` |
| Source tree | `config/profiles/` |

```bash
sudo cp /usr/share/ebpfsentinel/profiles/home-router.yaml /etc/ebpfsentinel/config.yaml
ip -o link show | awk -F': ' '{print $2}'        # the interface names to put in it
sudo $EDITOR /etc/ebpfsentinel/config.yaml
sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel
```

Each profile is parsed in CI by the same parser the agent uses, so a key renamed
in the agent breaks the profile in the build rather than on somebody's router.

## What they have in common

**Detection is on, enforcement waits.** Every profile enables the firewall, the
IDS, connection tracking and DNS, and every one of them starts in alert mode.
This is not timidity: the rule that fires on a particular network is the one
nobody can predict from here, and a box that cuts the household, the kubelet or
a cluster quorum off on its first evening is a box that gets uninstalled before
it has shown anything. Read what fired, then switch the mode.

**The API stays on loopback.** `bind_address: "127.0.0.1"` in all three. Moving
it takes a certificate and a decision, see [TLS](../configuration/tls.md).

**Nothing is enabled that the host cannot feed.** The k3s profile turns the
Docker enricher off because a k3s node has containerd and no Docker socket; the
Proxmox profile attaches to the bridge rather than to tap devices, so a guest
booted after the agent is covered without reattaching anything.

## A profile is where learning mode starts

Alert mode is only useful if something reads the alerts back. That is what
[learning mode](../features/learning-mode.md) is for, and the profiles are
written to hand over to it: the k3s profile enables `learning` outright, and on
the other two it is one key away.

```bash
# Watch an ordinary day, then read back what the host actually dialled
sudo ebpfsentinel-agent learning start --duration 86400
sudo ebpfsentinel-agent learning policy > /tmp/learned.yaml
```

Every generated rule comes out in observe mode, so applying the result refuses
nothing while you decide what should have been there. Once the generated policy
and the profile agree with each other, switching `firewall.mode` and `ids.mode`
to `block` is a change whose consequences you have already seen.

## When not to use one

A profile is a starting point for a host that looks like the one it describes.
Two interfaces that are not a WAN and a LAN, a node with a CNI the k3s profile
does not assume, a hypervisor with separate storage and management NICs: in each
case start from the profile nearest the host, read the comments, and change what
the comments say they assumed. The [configuration
reference](../configuration/overview.md) documents every key any of them sets.

Next: [Quickstart](quickstart.md) for the first rules of your own.
