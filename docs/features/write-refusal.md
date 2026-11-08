# Write Refusal

**Edition:** the refusal is open source; putting a refusal held in `shadow` in force without a restart is Enterprise.

## What it answers

Whether the kernel lets the next write-open happen. The other host
capabilities report a write once it is on disk; this one decides before a byte
is written. A BPF LSM program on `file_open` and `path_truncate` counts each
writer's write-opens under the paths it watches, and the kernel refuses with
`EACCES`:

- under a **data path**, from the open reaching the threshold (100 in a
  60-second window by default) until the window ends, because a backup, a build
  or a database legitimately writes hundreds of files a minute there;
- under a **system path**, at the first write by an executable not named in
  `system_writers`, because `/etc`, a package-owned binary or a unit file is
  written by a few known programs and nothing else.

A path in neither list is never refused. The refusal reads no signal and
reaches no verdict, which is what makes it fast and what makes it blunt: the
[mass encryption](mass-encryption.md) verdict beside it is the careful reading
and acts once files are written, the refusal is the count and acts before.

<video controls preload="none" poster="/media/write-refused.avif" src="/media/write-refused.mp4" width="100%">
  <track kind="captions" srclang="en" label="English" src="/media/write-refused.vtt" default />
</video>

Recorded on Linux 7.0 by the integration lane, on a host booted with `bpf` in
`lsm=`. A host without it takes the fallback described under
[What it needs](#what-it-needs), and `ebpfsentinel-agent ebpf host-check`
answers for yours.

## What it costs

**A bound is not zero.** A run loses the files it writes before the threshold,
`threshold - 1` per writer and window, and a run spread over more writers than
the count follows loses that many per writer; `count_by: cgroup` narrows it for
a run that forks.

**A refusal can stop a legitimate write.** A tool writing more than the
threshold in one window under a data path is refused like a run, and a package
upgrade writing under `/etc` through a shell is refused unless its writers are
named. That is why the refusal ships in `shadow`: it counts every writer that
would have been refused, under its workload, and refuses nothing. The reading
is served at `GET /api/v1/host-rules/write-refusal`, and `enforce` is a
decision taken on it. The Enterprise edition takes that decision without a
restart through `POST /api/v1/host-rules/write-refusal/promote`, which names
the reading it was made on and is refused with `409` when the reading has
started again since. The paths are the customer's choice: none is watched by
default, and the refusal is off until `enabled` is set or, in the Enterprise
edition, until a system profile is given `refuse_writes: true`, which names the
profile's paths and expected writers and still starts in `shadow`.

**It fails open.** The hooks are links the agent holds and never pins, so an
agent that stops, crashes or is killed takes them with it and the node is
writable at once. A write the program cannot attribute, or a new writer
arriving with the counter table full, is let through and counted.

Counters are published under
`ebpfsentinel_packets_total{interface="WRITE_REFUSAL_METRICS", action}`: `checked`, `watched`, `refused`, `would_refuse`, `unresolved`, `table_full`, `event_lost` and `expected`.

## What it needs

**The BPF LSM active at boot.** That is the `lsm=` kernel command line, which
not every distribution or host provider sets, and not a kernel version: a
recent kernel without `bpf` in that list loads nothing here.
`ebpfsentinel-agent ebpf host-check` answers for your own host, and the
`write_refusal` block of `GET /api/v1/ebpf/kernel-features` says which route
refuses and why the other did not load.

Where the BPF LSM is not active, `route: auto` falls back to a fanotify
permission group that marks inodes rather than filesystems, at most 4,096 of
them, refuses with `EPERM`, costs about 24 microseconds on every open of a
marked inode and answers inside a 20-millisecond budget. It needs
`CAP_SYS_ADMIN`, which the rootless agent asks the warden for. Where neither
route can run the agent starts anyway, says so, and the mass encryption
detection and its stop are what remain: the node keeps a defence and loses
more files to it.

## What it is not

- **Not a guarantee that no file is lost.** The threshold is the number of
  files a run may still write; a system path refuses at the first write, a
  data path does not.
- **Not a judgement of content.** It counts write-opens, not files and not
  encrypted bytes: one file reopened a hundred times counts a hundred, and a
  run writing slowly under the threshold is not refused.
- **Not on by default.** It ships off, in `shadow` once turned on, with no
  path watched, and enforcing is the customer's decision, taken on what `shadow` read of their
  own hosts.
- **Not an access control system.** It holds no policy per user or per file
  and replaces neither permissions, SELinux nor AppArmor; it refuses volume
  and unexpected writers on the paths it is given.

Every field, both routes in full and the `shadow` reading are in
[File Watch Configuration](../configuration/file-watch.md#write-refusal).
