# Who Else Reads the Network on a Node

The agent is rarely the only thing on a node that sees packets. A capture
someone left running, a DHCP client, a CNI and a monitoring agent each hold a
packet socket or an eBPF program on the network path, and so would something
that has no business being there. The dashboard's node panel lists both, for
the node it describes, so that the question "what else is looking at this
host's traffic" has an answer on the screen rather than in a shell.

The panel opens from the fleet page by picking a host. Its last section, **Who
else reads the network here**, holds two lists read from that agent alone:
[packet sockets](../features/raw-sockets.md) and
[foreign eBPF programs](../features/foreign-programs.md). Neither list is
merged across the fleet, because a socket or a program is a fact about the node
it sits on. Both are read only, and nothing on the panel removes anything.

## Packet sockets

Each row is one socket, with what the agent knows of it:

- **Who holds it**: the executable and its process identifier, then the pod or
  the container when the process runs in one. A socket whose holder could not
  be resolved says so in words; that happens when the process exited between
  two readings or runs in a pid namespace the agent cannot see.
- **What it sees**: `raw` keeps the link-layer header and `dgram` strips it,
  then the protocol, then the interface. `any` means every interface on the
  node.
- **Its filter**: a socket with **no filter** receives every packet of its
  protocol and is drawn with a highlighted border, because it is the one that
  sees everything. A **classic filter** narrows what reaches the holder, and
  the number beside it is the length of the filter in instructions. A filter
  the agent was not allowed to read is called **not readable**.
- **Another network namespace**: the socket lives in a namespace other than the
  host's, typically a pod's, and sees only that namespace's traffic.

The sockets with no filter come first.

## Foreign eBPF programs

Each row is one program the agent did not load, on a place where it sees
traffic: its name (or its identifier when it has none), the place it is
attached, its position when the hook runs several programs (`#0` runs first),
and the processes that hold it open. A program with no holder is kept alive
only by a pin in the BPF filesystem or by the attachment itself, and the panel
says so rather than leaving the column empty.

Under the list, the panel counts the programs on the path that are the agent's
own. They are counted and never listed, since they are not the question the
panel answers.

## Reading it: the usual suspects

Most of what appears on a node is expected. The panel does not decide that for
you, because an executable path is something a process can choose: the agent
names what the kernel reports, and whether that process belongs on that node
is yours to judge. These are the holders a reader will meet most often.

| What you see | What it usually is |
|--------------|--------------------|
| `tcpdump` or `dumpcap` holding a `raw` socket on `any`, with no filter or a classic filter | A capture someone is running. It goes when the capture stops; a capture still there days later is worth a question. |
| `dhclient`, `systemd-networkd` or `NetworkManager` holding a `dgram` socket with a classic filter | A DHCP client, which needs a packet socket to talk before the interface has an address. It stays for the life of the lease. |
| `cilium-agent` holding programs on `tcx` or `netkit`, on every pod interface and on the uplinks | Cilium's datapath, present on every interface of a Cilium node. |
| `calico-node` holding `tc` programs | Calico in eBPF mode. |
| A program with no holder on a cgroup hook, named after a systemd unit's filter | `systemd` enforcing `IPAddressAllow=` or `IPAddressDeny=` on a unit. |
| `pmacct` or another flow collector holding a `raw` socket | A monitoring agent that samples traffic. Expected where it is deployed on purpose. |

Anything else is worth a look, and three things in particular:

- a socket with **no filter** held by a process nobody recognises, since it
  receives everything;
- a program placed **ahead of the agent's** on a hook the agent also uses, which
  sees, and may change or drop, packets before the agent does;
- a program kept only by a pin, with no process behind it, which survives the
  process that loaded it.

The agent raises an alert for each new packet socket and for each program put
ahead of its own, so the panel is where the alert is read in context rather
than where it is first noticed.

## When a list is missing

- **The agent does not read this inventory**: the
  [`network_inventory`](../configuration/network-inventory.md) block is turned
  off on that node.
- **This list could not be read from the agent**: the dashboard could not reach
  the agent, or the agent's build predates the inventory. The reason is shown
  under the message.
- **The last reading failed, this is the one before**: the agent read the list
  once and the latest attempt failed, typically for want of a privilege. The
  list shown is the previous reading, with the error beside it.

The time under the two lists is the older of the two readings, so the panel
never presents either as fresher than it is. A socket opened and closed between
two readings is never seen; the interval is `network_inventory.interval_secs`.
