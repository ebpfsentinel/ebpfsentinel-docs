# Packet Sockets

An agent that filters the node's traffic in XDP and tc is not the only thing
that can read it. Any process holding `CAP_NET_RAW` can open an `AF_PACKET`
socket and receive a copy of every frame on an interface, before the firewall
and whatever it decides, and a classic BPF filter attached to that socket can
pick out the frames that matter to it, a magic packet included, without a
listening port anybody would see. That is how a passive backdoor waits.

The agent lists every packet socket open on the node, who holds it and what
filter is attached to it, and raises an alert for each one that appears.

## How It Works

1. On an interval, the agent walks `/proc` and reads each network namespace's
   packet sockets: the socket's type, the protocol it receives, the interface it
   is bound to and the user that opened it.
2. It asks the kernel's socket diagnostics for each namespace whether a filter
   is attached to each socket and how long that filter is.
3. It finds a process holding each socket through the file descriptors under
   `/proc/<pid>/fd`, and resolves the process to its executable, container and
   pod.
4. A socket the previous reading did not have raises an alert.

In the rootless posture the reading is made by the warden, which holds the
privileges to enter another namespace; otherwise the agent reads the host's
`/proc` itself.

## The Alert

| Field | Value |
|-------|-------|
| Component | `raw_socket` |
| Rule | `raw-socket-opened` |
| Severity | `high` when a classic filter is attached, `medium` otherwise |
| MITRE ATT&CK | T1205.002, Traffic Signaling: Socket Filters (defense evasion) |

The alert carries the process, its executable and, where it runs in one, its
container and pod, so it lands on the same workload views as every other
alert.

## What It Does Not See

- **The sockets open when the agent starts.** The first reading only primes the
  inventory: those sockets are listed, and none raises an alert, because the
  agent cannot tell they are new.
- **A socket opened and closed between two readings.** The inventory is a
  sample, every 30 seconds by default.
- **A filter the kernel withholds.** The filter is reported only to a reader
  holding `CAP_NET_ADMIN` over the socket's namespace; otherwise it is reported
  as `unknown`, never as absent.
- **A socket no process holds any more**, for instance one passed to a process
  that has since exited while the kernel keeps it open. It is listed without a
  process.

## Legitimate Holders

Packet sockets are ordinary. `tcpdump` and Wireshark open one per capture, a DHCP
client opens one to send before it has an address, and some CNIs and
monitoring agents keep one open for their lifetime. A socket held by one of
those is expected; the alert is there so that one held by something else is
seen.

## Reading the Inventory

- REST: [`GET /api/v1/ebpf/raw-sockets`](../api-reference/rest-api.md#get-apiv1ebpfraw-sockets)
- CLI: `ebpfsentinel-agent ebpf raw-sockets`
- Configuration: [`network_inventory`](../configuration/network-inventory.md)
