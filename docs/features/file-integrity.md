# File Integrity

**Edition:** the watch, its baselines and the watched paths are open source; profiles and the comparison across a fleet are Enterprise.

## What it answers

Which file on this host changed, how, and which process changed it. The agent
holds a fanotify notification group over whole filesystems, reads every changed
path again once the change has settled, and compares it with what it held the
last time: content digest, size, permission bits, owner, extended attributes and
the kind of entry. A difference on a path named under
[`file_watch.paths`](../configuration/file-watch.md#watched-paths) is a
`watched-path-changed` alert naming the file, what differs and the writer with
its executable, container and pod where they resolve. A difference on one of
the agent's own files, its binary, its configuration, its eBPF objects or its
baseline store, is an alert whatever the configuration names.

Every settled change is also what the [host rules](host-rules.md#file-intentions)
read as a file intention, and what the [mass encryption](mass-encryption.md)
verdict reads its signals off.

In the Enterprise edition a host names the kind of system it is, `debian`,
`rhel`, `alpine`, `talos` or `kubernetes-node`, and a profile delivered through
the [content channel](enterprise/content-channel.md) watches the paths that kind
of system keeps its accounts, privilege, boot and services in. Across a fleet,
the dashboard finds what most nodes hold alike at a path and a node first seen
holding something else raises `watched-path-unexpected`; see
[file drift across the fleet](enterprise/fleet-management.md#file-drift-across-the-fleet).

## What it costs

Hashing is the cost. Every changed regular file is read once, up to
`max_hash_bytes` (16 MiB by default), and the reader hashes at most 64 MiB per
request, so a burst of large writes is read over several seconds rather than
stalling the watch. A file larger than the cap keeps no digest and is compared
by size and modification time, with the reason it was not hashed. Baselines
are kept on disk, at most `max_baselines` (500,000 by default), so they survive
a restart, and a path seen once the store is full is counted in
`ebpfsentinel_file_baselines_refused_total` rather than silently skipped.

The kernel queues changes until they are read; a queue that fills loses changes,
and the agent counts every overflow in
`ebpfsentinel_file_change_overflows_total` rather than reporting a quiet host.

## What it needs

Marking a whole filesystem needs `CAP_SYS_ADMIN` and naming the directory a
change happened in needs `CAP_DAC_READ_SEARCH`; a rootless agent asks the
[warden](../operations/deployment/bpf-token.md) for both and changes nothing in
its own privilege. A container's root is an overlay, which cannot be watched:
the filesystem beneath it is named instead, and the table of
[filesystems that refuse](../configuration/file-watch.md#filesystems-that-refuse)
says what to name for each. No kernel condition beyond the 6.12 floor applies.

## What it is not

- **Not a prevention.** The watch is told about a change once it is on disk and
  cannot hold a write back. What acts before a write lands is the
  [write refusal](write-refusal.md), a separate capability with its own kernel
  condition.
- **Not an attestation.** It compares a host with what that host held before,
  and in the Enterprise edition with what the rest of the fleet holds. It does
  not measure boot, sign a state or prove to a third party that a file is the
  one a vendor shipped; that is IMA and a TPM, which the extended attribute
  digests it compares can carry but which it does not replace.
- **Not a file scanner.** It reads what changed, never the whole tree on a
  schedule, and it judges no content as malicious: a difference is reported as
  a difference.

The full reference, every field, every filesystem that refuses and every alert,
is [File Watch Configuration](../configuration/file-watch.md).
