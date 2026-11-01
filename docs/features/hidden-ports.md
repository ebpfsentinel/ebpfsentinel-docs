# Hidden Ports

A rootkit that hides a backdoor's listening port does it by editing what the
kernel reports, not by giving the port up: the socket stays bound, and
`/proc/net/tcp`, `ss` and `netstat` leave it out. The bind table cannot be
edited the same way without breaking the network, so a port nobody lists still
refuses a second bind.

The agent asks the kernel twice and compares the answers: once for its
listings, and once by trying to bind each probed port. A port that refuses the
bind, twice, while no listing shows any socket on it is reported hidden.

## Benign Causes First

Most refused binds are ordinary, and each one the sweep explains is counted
under its reason rather than reported:

- **A listener**, including every member of a `SO_REUSEPORT` group: the port is
  listed, so the refusal is explained.
- **A connection in `TIME_WAIT`**: a closed TCP connection keeps its port for a
  minute or so, and it is listed in that state.
- **Another bound socket**, such as an outgoing connection that took the port
  as its local one, or a UDP socket that is not listening in any sense.
- **Connection churn**: a socket that came or went between the listing and the
  probe. The sweep reads everything twice, and a refusal the second reading
  does not repeat, or that the second listing explains, is counted as
  `unconfirmed` and never reported.
- **A namespace the sweep could not enter**: nothing in it was asked, so it is
  named with the reason and never reported clean.
- **A bind refused for another reason** than the port being in use, for
  instance a security module denying it: the port was not asked, and is
  counted as `unprobed`.

## How It Works

1. On an interval, five minutes by default, the sweep finds every network
   namespace on the node through `/proc`, one process in each.
2. In each namespace it reads the socket listings twice over: `/proc/net/tcp`,
   `tcp6`, `udp` and `udp6`, and a socket diagnostics dump of every state.
3. It tries to bind each probed port, TCP and UDP, on the IPv4 and IPv6
   wildcard addresses, with no reuse option, and closes the socket straight
   away. A bind refused because the address is in use is a refusal.
4. A refusal no listing entry on the same port and transport explains is read
   again: the listings and the bind. A refusal that survives both readings is
   reported hidden.
5. A hidden port the previous sweep did not report raises an alert, and is
   handed to the [host rules](host-rules.md) as `port.hidden`, carrying the
   wildcard address the bind was refused on, the port and the transport.

The probed ports are 1 to 1024 unless turned off, plus any listed in
`extra_ports`. In the rootless posture the sweep is made by the warden, which
holds the privileges to enter another namespace; otherwise the agent sweeps
from the host's `/proc` itself.

## The Alert

| Field | Value |
|-------|-------|
| Component | `hidden_port` |
| Rule | `port-hidden` |
| Severity | `high` |
| MITRE ATT&CK | T1014, Rootkit (defense evasion) |

The alert names the network namespace, the transport, the wildcard address the
refused bind was made on and the port.

## What This Is Not

This is a comparison of two readings of the same kernel, not a rootkit scanner.
There is no signature database and nothing is matched against a known rootkit.

- **A rootkit that hides consistently from both readings is missed.** One that
  also intercepts the bind, or that hides the socket from the bind table, leaves
  nothing to compare.
- **A port outside the probed list is never asked.** A backdoor on a high port
  is found only when that port is in `extra_ports`.
- **A socket bound to one address is found only where it blocks the
  wildcard.** On Linux a bind to `0.0.0.0` is refused by a listener on a single
  address of the same port, so a TCP or UDP socket on one address is found as
  well; one bound with `SO_REUSEADDR` beside a non-listening owner may not be.
- **A port hidden between two sweeps and gone before the next** is never seen.
  The sweep is a sample.

## Reading the Sweep

- REST: `/api/v1/ebpf/hidden-ports`, see the [REST API](../api-reference/rest-api.md#get-apiv1ebpfhidden-ports)
- CLI: `ebpfsentinel-agent ebpf hidden-ports`
- Configuration: [`hidden_checks`](../configuration/hidden-checks.md)
