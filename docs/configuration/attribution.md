# Socket Attribution Configuration

Socket attribution records the task behind a socket at the moment the kernel first sees the socket used, so a flow can name the workload that opened it. Six cgroup programs do the recording - `connect4`, `connect6`, `post_bind4`, `post_bind6`, `sendmsg4` and `sendmsg6` - and a seventh, a `sock_ops` program, joins that record to the five-tuple of the connection once the kernel has established it. All seven only observe: nothing here drops, rewrites or delays a packet.

## Configuration

```yaml
attribution:
  enabled: true
  cgroup_root: /sys/fs/cgroup
  max_sockets: 65536
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Attach the cgroup socket hooks and size the socket table for them |
| `cgroup_root` | string | `/sys/fs/cgroup` | Absolute path of the cgroup v2 directory the hooks attach to |
| `max_sockets` | u32 | `65536` | Capacity of the socket table, in entries |

`max_sockets` is accepted between `1024` and `1048576`. Below the floor the table is too small to be honest about a node of any size; above the ceiling it is a memory decision that belongs in a deployment review rather than in a default.

## What the bound costs

The socket table is an LRU map: a node that opens more concurrent sockets than `max_sockets` evicts the coldest entry rather than refusing the newest. Attribution therefore degrades to absent on the oldest sockets instead of failing on the newest ones. The memory is locked whether the slots are used or not, which is why the bound exists at all - roughly 48 bytes per slot, so the default table is about 3 MB.

Turning `enabled` off sizes the table down to a single idle slot rather than leaving it allocated, so a deployment that does not want attribution pays nothing for it.

An entry is usable for twelve hours after the hook wrote it. A socket cookie is unique for the life of the socket and is not reused while it lives, so the window is not what makes the join correct; it is what stops an entry that outlived its socket from naming a process for a cookie the kernel has since handed to another socket. Past the window a flow carries no workload rather than a stale one.

## What the join adds

The six socket hooks name a task; they do not know where the connection went. `connect` is called before a source port exists and `post_bind` knows no peer, so neither has a full five-tuple to record. The `sock_ops` program runs when the kernel has established a TCP connection, reads the tuple off the kernel's own socket, and writes it against the task the socket hooks recorded for that socket cookie.

That is what lets a DLP alert about an encrypted write name a destination. The library probe sees plaintext and a thread and no socket at all; the join gives the thread a socket the kernel vouches for. The alert says which of the two it got:

| `flow_source` | What it means |
|---|---|
| `kernel_socket` | The tuple was read off the established socket of this thread. |
| `task_socket_correlation` | No joined socket was usable, so the tuple is the one this thread was last seen writing through, inside a window of one call frame. It is a correlation and the alert says so. |

A flow with neither carries no socket rather than a guessed one.

The join writes nothing for a socket whose opener is unknown: a socket opened before the hooks attached, or by a task outside the cgroup, has no recorded task, and attributing it to whatever thread completed the handshake would be an invention. The handshake completes in a softirq that belongs to no task, which is exactly why the task is read from the cookie rather than from whoever is running.

A kernel may refuse the `sock_ops` program its socket cookie while taking every other hook, the helper and the program type being a pair the kernel decides on. The agent then attaches the six socket hooks without it and says so: the status is `attached` with six hooks and a reason naming the refusal, every socket is still named, and an established flow is matched to its socket by five-tuple, so the workload arrives with `flow` as its source. The condition and how to read it off a host are in [kernel requirements](../kernel/requirements.md).

A joined socket stays usable for as long as the task record that opened it, twelve hours, rather than for the correlation window: a TLS connection lives minutes or hours, and ageing it on one call frame would throw away the destination of every long-lived connection on the node.

## When nothing attaches

The attach is degradable by design. A kernel or a host that refuses the cgroup programs leaves the agent running with no workload on its flows, logs the reason once at startup, and reports it:

```bash
ebpfsentinel-agent ebpf kernel-features
```

The `Socket attribution` section of that output says whether the hooks attached, which cgroup they were asked for, which hooks took, whether the warden created the links, and the reason where nothing did. A partial set is reported as not attached: half the hooks would make an absent workload mean two different things with nothing on the wire to tell them apart, so a failure on any one hook detaches the others.

In the rootless posture the agent has dropped the capability the attach needs and the hierarchy it can see is not the host's, so the warden resolves the path and creates the links. The warden attaches socket hooks and only socket hooks: a device, sysctl or setsockopt cgroup program cannot be requested through it, and a path outside `/sys/fs/cgroup` is refused before anything is opened.

## Minimum kernel

Kernel 6.9, the agent's floor, carries every hook this section attaches. Nothing above the floor is required, and nothing here is probed for a version: what matters is whether the attach succeeded on this host, which is what `kernel-features` answers.

## Counters

The hooks export per-CPU counters under `ebpfsentinel_packets_total{interface="ATTRIBUTION_METRICS"}`, one series per `action` label: `connect`, `post_bind`, `sendmsg` and `sock_ops` for the hook that wrote a record - the four names rather than seven, because an address family is not worth a series of its own - `no_cookie` where the kernel returned no socket cookie so there was no key to record against, and `insert_failed` for an insert the map refused. The table is an LRU and evicts rather than refusing, so a non-zero `insert_failed` is the kernel saying something other than capacity went wrong.
