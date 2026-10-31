# Listening Sockets

A port scan from outside says that something answers on a port. It does not
say what bound it, as which user, in which container, or whether that was meant:
a debug server left on `0.0.0.0`, a database a chart exposed on every address
when it was supposed to listen on loopback, a sidecar nobody listed. The node
knows all of that the moment the socket is bound, and the agent records it
there.

The agent keeps one row per socket the node accepts traffic on, with the
process that bound it and the workload that process belongs to, and lists them
widest exposure first. Each row is then read against the two other halves of an
exposure: which sources the packet firewall lets through to it, and whether
anybody connected. A socket open to every address that nobody has used since
the agent started is the one to close first.

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

## Allowed and Observed

**Allowed** is read from the packet firewall's rules as they are loaded, by
priority, for the listener's protocol, port and address. The first rule that
decides every packet bound for the socket - no source, MAC, alias, connection
state, flag, ICMP, DSCP, VLAN, schedule, group, tenant or interface narrowing -
settles it: `allow` and `log` let traffic through, `deny` and `reject` close
it. A narrower `allow` before that point opens the socket to its sources, which
are listed. A narrower `deny` is not read as closing anything, because some
traffic may still pass it. With no deciding rule the default policy settles it.
A firewall that is disabled or in alert mode closes nothing. A deny on one
address does not close a socket bound on every address, since the others still
reach it. Every doubt resolves to open: the reading may say a socket is exposed
when a rule it cannot reason about closes it, never the reverse. Workload rules
decide at `connect()` and `bind()` rather than on the packet, and are not read
here.

**Observed** is a count the socket hooks keep in the kernel: every TCP
handshake the node completes as the server is counted against the local address
and port it arrived on, with the time of the last one. A socket bound on every
address takes the count of every address on its port. UDP has no handshake, so
a UDP socket carries no count rather than a zero.

| Class | Meaning |
|-------|---------|
| `exposed_used` | Reachable, and connections were accepted on it |
| `exposed_unused` | Reachable, and no connection since the hooks attached |
| `exposed_unmeasured` | Reachable UDP: what reaches it is not counted |
| `closed_by_policy` | The packet firewall lets nothing off the node through |
| `loopback_only` | Bound on loopback, reached from the namespace itself |

A row closed by policy may still show accepted connections: they were taken
before the rule was loaded, or came over loopback, which the packet firewall
does not see. The count starts when the hooks attach and is held in a table of
fixed size, so on a node with more listening addresses than it holds the
coldest are evicted and read as unused.

## What It Does Not See

- **Sockets bound before the hooks attached.** The table is filled by the
  `bind()` call itself, so a server that was already listening when the agent
  started is not listed until it binds again. Restart the agent before the
  services on a node, or restart the service, to have it listed.
- **Anything when the hooks are not attached.** The inventory then answers
  `reading: false`: the node's listeners are unknown, which is not the same as
  having none. Why the attach failed is in
  [`GET /api/v1/ebpf/kernel-features`](../api-reference/rest-api.md#get-apiv1ebpfkernel-features).
- **Filtering outside the agent.** A cloud security group, a network policy
  of the cluster's network plugin or an nftables rule in front of the node is
  not read: the class says what this agent's firewall lets through.
- **Protocols other than TCP and UDP**, such as SCTP or a raw socket. Packet
  sockets are listed on [Packet Sockets](raw-sockets.md).

## Reading the Inventory

- REST: [`GET /api/v1/exposure/listeners`](../api-reference/rest-api.md#get-apiv1exposurelisteners)
- CLI: `ebpfsentinel-agent exposure listeners`
- Configuration: the socket attribution hooks, [`attribution`](../configuration/attribution.md)
- Enterprise: the same inventory is served by the enterprise agent, joined to
  each workload's SBOM, and read across the fleet on the dashboard's
  **Exposure** screen, which also compares the estate with any day of the last
  456 - see [Fleet management](enterprise/fleet-management.md#what-a-component-listens-on)
