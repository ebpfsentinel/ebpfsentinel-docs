# Listening Sockets

A port scan from outside says that something answers on a port. It does not
say what bound it, as which user, in which container, or whether that was meant:
a debug server left on `0.0.0.0`, a database a chart exposed on every address
when it was supposed to listen on loopback, a sidecar nobody listed. The node
knows all of that the moment the socket is bound, and the agent records it
there.

The agent keeps one row per socket the node accepts traffic on, with the
process that bound it and the workload that process belongs to, and lists them
widest exposure first.

## How It Works

1. The socket attribution hooks fire in the `bind()` of the task that takes a
   local address, IPv4 and IPv6, and write the socket's address, port and
   protocol beside the task's identity: process, user and cgroup.
2. A TCP socket is marked as listening when `listen()` is called on it. A TCP
   socket that connects out instead is a client that bound first, and it leaves
   the table at that moment.
3. Closing the socket removes its row, so the table is what is bound now
   rather than what was bound once.
4. When the inventory is read, each row is resolved to the executable,
   container, pod and systemd unit of its process, through the same resolver
   that names the workload on a flow.

A UDP socket accepts datagrams as soon as it is bound, so every bound UDP
socket is listed. A TCP socket is listed once it listens.

## Scope

| Scope | Bound address | Reached from |
|-------|---------------|--------------|
| `all_addresses` | `0.0.0.0` or `::` | every address of the network namespace |
| `address` | one address of an interface | whatever routes to that address |
| `loopback` | `127.0.0.0/8` or `::1` | the namespace itself |

The list is ordered by scope, then protocol, then port, so a socket open on
every address comes first. A server that spreads its accept over
`SO_REUSEPORT` holds several sockets on one address and port; they are one row,
with the number of sockets and the earliest bind.

## What It Does Not See

- **Sockets bound before the hooks attached.** The table is filled by the
  `bind()` call itself, so a server that was already listening when the agent
  started is not listed until it binds again. Restart the agent before the
  services on a node, or restart the service, to have it listed.
- **Anything when the hooks are not attached.** The inventory then answers
  `reading: false`: the node's listeners are unknown, which is not the same as
  having none. Why the attach failed is in
  [`GET /api/v1/ebpf/kernel-features`](../api-reference/rest-api.md#get-apiv1ebpfkernel-features).
- **Whether anything reaches the socket.** A row says that the node accepts
  traffic on that address and port. Whether a firewall rule in front of it
  closes it, or whether any traffic arrived, is a different reading.
- **Protocols other than TCP and UDP**, such as SCTP or a raw socket. Packet
  sockets are listed on [Packet Sockets](raw-sockets.md).

## Reading the Inventory

- REST: [`GET /api/v1/exposure/listeners`](../api-reference/rest-api.md#get-apiv1exposurelisteners)
- CLI: `ebpfsentinel-agent exposure listeners`
- Configuration: the socket attribution hooks, [`attribution`](../configuration/attribution.md)
