# File Watch Configuration

The file watch reports every change to the files of whole filesystems and the
process that made it: a file created, written and closed, its attributes
changed, moved out of or into a directory, or deleted. Every changed path is
then read again and compared with what it was the last time. It is off by
default.

Nothing here enforces anything: the watch only reads.

## Detection, not prevention

The watch is a fanotify notification group, never a permission group, so it is
told about a change once the change has happened and cannot hold a write back.
A change is reported after it is on disk, and what follows it - an alert, a
[host rule](../features/host-rules.md), or in the Enterprise edition a response
that stops the writing process or cuts its workload off the network - acts on
the writer afterwards. None of it undoes the write or claims to have prevented
it. Refusing a write before it lands is a separate capability with its own
kernel condition, the BPF LSM, configured under
[`write_refusal`](#write-refusal) and described there; the watch itself never
refuses anything.

## Configuration

```yaml
file_watch:
  enabled: true
  filesystems:
    - /
    - /var/lib/containerd
  max_hash_bytes: 16777216
  max_baselines: 500000
  paths:
    - /etc/ssh
    - /etc/shadow
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Open the watch |
| `filesystems` | list of paths | `["/"]` | One absolute path per filesystem to watch, at most 64 |
| `max_hash_bytes` | integer | `16777216` (16 MiB) | A regular file larger than this is not hashed; at most 67108864 (64 MiB) |
| `max_baselines` | integer | `500000` | Baselines kept at most, at least 1 |
| `paths` | list of paths | `[]` | Files or directories watched for any difference, at most 1024; see [Watched paths](#watched-paths) |
| `canaries.enabled` | bool | `false` | Plant canary files and report any open of one; see [Canary files](#canary-files) |
| `canaries.directories` | list of paths | `/home`, `/root`, `/srv`, `/var/www`, `/opt`, `/mnt`, `/media` | Absolute directories a canary is planted into |
| `canaries.names` | list of names | `0000-archive.docx`, `zzzz-archive.xlsx` | Names planted into each directory, no slash; at most 512 canaries in all |
| `mass_encryption.mode` | `shadow` or `enforce` | `shadow` | Whether a [mass encryption](../features/mass-encryption.md) verdict is counted or raises the alert; see [Mass encryption](#mass-encryption) |
| `mass_encryption.stop` | bool | `false` | Kill the run a verdict in force names, the process that reached it and every process it started; needs `mode: enforce`, `response.kill_process.enabled` and `process_table.enabled` |
| `canaries.exempt` | list of paths | backup tools and scanners, see below | Executables, by full path, whose opens of a canary are not a signal |
| `write_refusal.enabled` | bool | `false` | Load the [write refusal](#write-refusal); independent of `enabled` |
| `write_refusal.mode` | `shadow` or `enforce` | `shadow` | Count what would be refused, or refuse it |
| `write_refusal.paths` | list of paths | `[]` | Data paths: absolute directories or files counted against `threshold`, everything beneath a directory included; at most 256 with `system_paths`, never `/` |
| `write_refusal.system_paths` | list of paths | `[]` | System paths: absolute directories or files where the first write-open by an executable not in `system_writers` is refused; a path named in both lists is a system path |
| `write_refusal.system_writers` | list of paths | `[]` | Absolute paths of the executables expected to write under the system paths, at most 256 |
| `write_refusal.threshold` | integer | `100` | Under a data path, the write-open inside the window that is refused first, at least 1 |
| `write_refusal.window_secs` | integer | `60` | The window the count runs over, 1 to 3600 seconds |
| `write_refusal.count_by` | `process` or `cgroup` | `process` | Count each process alone, or a container or unit as one writer |

Each path stands for the whole filesystem it lives on: naming `/etc` watches
every file of the filesystem holding `/etc`. Two paths on one filesystem watch
it once.

## Who holds the watch

Marking a whole filesystem needs `CAP_SYS_ADMIN`, and naming the directory a
change happened in needs `CAP_DAC_READ_SEARCH`. A rootless agent holds neither,
so it asks the [warden](../operations/deployment/bpf-token.md) on a control
connection of its own, and the paths are read in the warden's mount namespace.
An agent holding both capabilities opens the watch itself.

When the warden restarts, the watch ends with its connection and the agent
opens it again on the next connection, within thirty seconds.

## Filesystems that refuse

A path whose filesystem cannot be watched is logged at startup with the reason,
counted in `ebpfsentinel_file_watch_filesystems_refused`, and costs nothing
else: the other paths are still watched.

| Filesystem | What happens | What to name instead |
|------------|--------------|----------------------|
| overlayfs (a container's root) | Refused: an overlay cannot report a file handle | The filesystem beneath it, where the container's upper directory lives, such as `/var/lib/containerd` or `/var/lib/docker`. A container's writes are reported there, under the upper directory, with the writer's host process ID |
| a btrfs subvolume | Refused | The top level of the btrfs filesystem |
| a filesystem with no handle support (`proc`, `sysfs`, some FUSE) | Refused | Nothing: these hold no files to watch |
| a path that does not exist | Refused | |

## What is reported

Each change carries the process ID of the writer, the directory it happened in
and the name of the entry, and the device and inode of the entry when it still
exists. A rename inside one filesystem is reported once with both names,
through the kernel's `FAN_RENAME` event, introduced in Linux 5.17 and observed
on 7.0. Where a filesystem's mark refuses it, the agent watches that path
without it, logs a warning naming the path, and a rename there reads as a
disappearance at the old name and an appearance at the new one. A change in a directory that was removed before it could be named is
counted with the reason it could not be.

The kernel queues changes until they are read. When the queue fills, changes
are lost, the agent logs it, and `ebpfsentinel_file_change_overflows_total`
counts it.

## Baselines

A path's baseline is what it named the last time it was read: its kind, size,
modification time, permission bits, owner and group, the SHA-256 of a regular
file's content, the target of a link, and the name and SHA-256 of each
extended attribute (an SELinux label, an IMA signature, a capability set). The
values themselves never leave the reader, only their digests.

The same read gives a regular file its sampled entropy: the Shannon entropy,
in bits per byte, of the first 64 KiB the hash reads, or of the whole file when
it is shorter. It is a number derived from the bytes the way the hash is, it
costs no second read, and it is never compared as a drift. It is what lets the
[mass encryption](../features/mass-encryption.md) verdict see a file
go from ordinary content to near-random content. Being a sample, it misses an
encryption that leaves the first 64 KiB untouched, and a file that was already
compressed cannot rise at all.

The same read also hands back a regular file's first four bytes, where a format
writes its signature, so the verdict can tell a file named `.pdf` that no longer
starts with `%PDF`. Those four bytes travel with the reading and are never
stored in the baseline.

The first reading of a path is kept and raises nothing. Every later one is
compared with it and replaces it, and each difference is logged with the path,
the path as the writer sees it, the writer's process ID and executable, and
counted in `ebpfsentinel_file_drifts_total`:

| `what` | Meaning |
|--------|---------|
| `content` | The content hash, or the target of a link, differs. For a file too large to hash, its size or modification time differs |
| `content_unverified` | The file was hashed before and can no longer be, so whether it changed is not known |
| `mode` | Permission, set-id or sticky bits differ |
| `owner` | Owner or group differs |
| `extended_attributes` | An extended attribute was added, removed or changed |
| `type_changed` | The path names another kind of entry, such as a link where a file was |
| `disappeared` | Nothing is at the path any more; its baseline is forgotten |
| `unreadable` | The path can no longer be read; its baseline is kept |

What could not be read is said, never recorded as empty: a file the reader
cannot open, or larger than `max_hash_bytes`, is kept with no hash and the
reason, never with the hash of nothing. Its size and time are compared
instead. A move compares nothing across the two names: a log rotated away
reads as the old path disappearing, and the new file at that path is a first
sight.

Baselines are kept in `file_baselines.redb`, beside the agent's other stores
under the audit `storage_path` directory, so they survive a restart. Once the
store holds `max_baselines` entries a newly seen path gets none and is counted
in `ebpfsentinel_file_baselines_refused_total`; a disappeared path frees its
entry. If the store cannot be opened the watch is not opened, and the agent
says so at startup.

Hashing is the cost: the reader hashes at most 64 MiB per request and leaves
the rest for the next, so a burst of large writes is read over several seconds
rather than stalling the watch.

## The agent's own files

Whatever `filesystems` names, the agent watches its own files: the executable
it runs from, the configuration file it was started with, every eBPF object in
its program directory, and `file_baselines.redb` itself. The filesystem holding
each is opened beside the configured ones, each file is read and kept as soon
as the watch is open, and their baselines are kept even once the store holds
`max_baselines` entries. In a container the binary and the objects live in the
image's filesystem, as the agent sees it; where that filesystem refuses a
watch, the refusal is logged like any other and those files go unwatched.

A difference another process leaves on one of them is an alert, not only a log
line, and no rule needs to ask for it. The agent's own writes are not: it keeps
the baseline store open and writes it continuously, so a content difference on
the store counts only when another process wrote the file, while a change of
mode, owner, extended attributes or kind, or the file disappearing, counts on
every file whoever made it.

| Rule | File |
|------|------|
| `agent-binary-changed` | The agent's executable |
| `agent-configuration-changed` | The configuration file |
| `agent-program-changed` | An eBPF object in the program directory |
| `agent-baseline-store-changed` | `file_baselines.redb` |

| Field | Value |
|-------|-------|
| Component | `agent_files` |
| Severity | `high` |
| MITRE ATT&CK | T1562.001, Impair Defenses: Disable or Modify Tools (defense evasion) |

The alert names the file, what differs, and the writer with its executable,
container and pod where they resolve. When the watch is opened again after a
gap, a warden restart for instance, the files are read again and a difference
found then is an alert whose writer is not known. The first opening after the
agent starts only learns: an upgrade replaces the binary and the objects while
the agent is stopped, so a difference then is logged and kept as the new
baseline.

## Watched paths

Every path under `paths` is watched for any difference, whichever process makes
it, without a rule asking for it. A path names a file, or a directory and
everything beneath it. Each is absolute, at most 4096 bytes, never `/` itself,
with no trailing slash and no `.` or `..` component, and at most 1024 are
named.

The filesystem holding each path is opened beside the configured ones, so
naming `/etc/ssh` is enough even when `filesystems` names only `/var/lib/containerd`.
A path named exactly is read as soon as the watch is open and kept even once
the store holds `max_baselines` entries, so its first change is compared rather
than learned; what lies beneath a watched directory is kept as it is seen, like
any other file.

| Rule | When |
|------|------|
| `watched-path-changed` | A file under a watched path differs from its baseline |
| `watched-path-appeared` | A file arrived under a watched path where none was known |
| `watched-path-unexpected` | A file seen for the first time on this node differs from what the fleet expects at its path; see [Across a fleet](#across-a-fleet) |

| Field | Value |
|-------|-------|
| Component | `file_integrity` |
| Severity | `medium` |
| MITRE ATT&CK | T1565.001, Data Manipulation: Stored Data Manipulation (impact) |

The alert names the file, the watched path covering it, where that path was
declared (`configuration`, or the profile that named it), what differs and the
writer, with its executable, container and pod where they resolve. The agent's
own writes raise nothing, and a change to one of the agent's own files raises
the alert of the section above rather than this one. When the watch is opened
again after a gap, each named path is read again and a difference found then
is an alert whose writer is not known; the first reading of a path only learns.

## Profiles

The Enterprise edition adds profiles: named lists of paths, delivered through
the [content channel](../features/enterprise/content-channel.md) in the
`file-profiles` set, so an estate names the kind of host it runs rather than
listing every path a distribution keeps its accounts, its privilege, its boot
and its services in.

```yaml
enterprise:
  file_watch:
    profiles: [debian, kubernetes-node]
    exclude: [/boot]
```

| Profile | What it watches |
|---------|-----------------|
| `debian` | Debian and Ubuntu: accounts, sudo, SSH, PAM, cron, systemd units, the dynamic loader, APT sources and keys, the boot partition |
| `rhel` | Red Hat Enterprise Linux, Rocky, Alma and Fedora: accounts, sudo, SSH, PAM, cron, systemd units, the dynamic loader, repositories and their keys, the SELinux mode, the boot partition |
| `alpine` | Alpine: accounts, doas and sudo, SSH, cron and periodic jobs, OpenRC services and local start scripts, APK repositories and keys |
| `talos` | Talos Linux: the machine state and the Kubernetes, container runtime and kubelet configuration and credentials, the only writable places on the node |
| `kubernetes-node` | Any Kubernetes node: static pod manifests, the kubelet's configuration and credentials, the container runtime's configuration, the CNI configuration and plugins |

Each path a profile names is added to `paths` and watched through that
profile, which the alert names as where the path was declared; a path both
declared and delivered keeps `configuration`. A delivered path an estate does
not want is named in `exclude`, exactly as the profile writes it. A profile
the set in force does not carry is logged and skipped.

The set is followed while the agent runs: when it moves, through the channel,
an import, a rollback or a pin, the watch opens again on the new paths within
a minute, and each newly named path is learned on that first reading. A set
that does not verify or does not parse is refused whole and the paths in force
stay as they were. Together the paths are at most 1024; past that, the rest
are logged and not watched.

A profile also names the executables expected to write under its paths: the
package manager, the account and password tools, `crontab`, `ssh-keygen` and
the service manager, and the kubelet on a Kubernetes node. With
`refuse_writes: true` the profiles' paths become
[system paths](#two-regimes) of the write refusal and those executables its
expected writers, beside whatever `write_refusal` already names; the refusal is
turned on if it was off, in the mode `write_refusal.mode` sets, `shadow`
unless changed. No profile names a shell. Together with the configured paths
they are at most 256 paths and 256 writers; past that, the rest are logged
and refuse nothing.

```yaml
enterprise:
  file_watch:
    profiles: [debian]
    refuse_writes: true
```

## Across a fleet

The Enterprise edition compares a node with the rest of its fleet. Each node
lists the fingerprint of the files it keeps beneath its watched paths, the
dashboard finds where the nodes disagree and what more than half of them hold
alike, and saves that as an expected state; see
[file drift across the fleet](../features/enterprise/fleet-management.md#file-drift-across-the-fleet).

```yaml
enterprise:
  file_watch:
    profiles: [debian]
    expected_baselines: /etc/ebpfsentinel/expected-baselines.json
```

The file is the document the dashboard saves: a `baselines` list, one entry
per path with its kind, content digest or link target, mode, owner, group and
extended attribute digests, and `truncated`. It is read at startup and
followed every minute while the agent runs. A file larger than 64 MiB, that
does not parse, or that is marked `truncated` is refused whole and logged, and
the expected state in force stays as it was; removing the file empties it.

The expected state only changes what a first sight does. A path this node has
never kept is compared against the fleet's fingerprint at that path, and a
difference is a `watched-path-unexpected` alert naming what differs, then
kept as the node's baseline like any first reading. A path the node already
keeps is compared with its own baseline, as before, and a path the fleet does
not name is learned.

## Canary files

With `canaries.enabled` on, the watch plants each name of `canaries.names` into
each directory of `canaries.directories`, marks every one for any open or read,
whatever the access mode, and hands each open to
[mass encryption](../features/mass-encryption.md#canary-files) as a decisive
signal. Each directory is added to the filesystems watched, since a canary is
only planted on a filesystem the watch covers.

A canary is a small text file of fixed content saying what it is, created by
the watch's holder with mode `0644`. A name already taken is kept only when it
holds exactly that content, so a file of the operator's own is never adopted.
A directory absent on the host, one on a read-only filesystem and one the
holder may not write to are each reported once with the reason and skipped;
the warden holds no `CAP_DAC_OVERRIDE`, so it seeds only directories its own
user can write to. A canary deleted or renamed away is planted again at once,
and every canary is planted again each time the watch is opened.

```yaml
file_watch:
  enabled: true
  canaries:
    enabled: true
    directories: [/srv, /home]
    names: [0000-archive.docx, zzzz-archive.xlsx]
    exempt: [/usr/bin/restic, /usr/bin/rsync]
```

The default exempt list is `/usr/bin/restic`, `/usr/bin/rclone`,
`/usr/bin/kopia`, `/usr/bin/rsync`, `/usr/bin/tar`, `/usr/sbin/bacula-fd`,
`/usr/sbin/bareos-fd`, `/usr/bin/clamscan` and `/usr/sbin/clamd`. An exempt
entry replaces the list rather than adding to it, so name every tool that
walks these directories on purpose: a backup job left off it fires on every
run.

## Mass encryption

Every settled change is also read by the
[mass encryption](../features/mass-encryption.md) verdict, which needs no
setting of its own to run:

```yaml
file_watch:
  enabled: true
  mass_encryption:
    mode: shadow
```

In `shadow`, the default, a verdict reached is counted under its workload and
read at `GET /api/v1/host-rules/mass-encryption` or with
`ebpfsentinel-agent host-rules mass-encryption`, and raises no alert. In
`enforce` it raises the `mass_encryption` alert. Changing the mode takes a
restart. The backups-destroyed signal reads command lines, so it is read only
where `process_table.capture_command_line` is on.

With `stop: true` a verdict in force also kills the run it names, as
described in [Stopping the run](../features/mass-encryption.md#stopping-the-run).
The agent refuses to start with `stop` set unless the mode is `enforce`, the
signal program is armed (`response.kill_process.enabled`) and the process
table is on (`process_table.enabled`), because those are what a run is found
and killed through:

```yaml
file_watch:
  enabled: true
  mass_encryption:
    mode: enforce
    stop: true
response:
  kill_process:
    enabled: true
process_table:
  enabled: true
```

## Write refusal

The write refusal is a BPF LSM program on two kernel hooks, `file_open` for a
file opened for writing and `path_truncate` for a truncation by path. It counts
each writer's write-opens under the watched directories inside a window, and
from the one reaching the threshold until the window ends, the kernel refuses
each with `EACCES` before a byte is written. A refused creation still leaves
the file's name behind, empty, because the kernel creates the inode before it
decides the open; no content reaches it:

```yaml
file_watch:
  write_refusal:
    enabled: true
    mode: shadow
    paths:
      - /srv/data
      - /home
    threshold: 100
    window_secs: 60
    count_by: process
```

### Two regimes

A watched path is in one of two regimes, declared once by the list naming it,
and a path in neither list is never refused.

- **Data paths** (`paths`) refuse at the threshold, because mass writes there
  are legitimate: a backup, a build or a database writes hundreds of files a
  minute, and what the threshold separates is that from a run.
- **System paths** (`system_paths`) refuse at the first unexpected write,
  because `/etc`, a package-owned binary or a unit file is written by a few
  known executables and by nothing else. The writer is named by the
  executable its process runs, read off the task's memory map as a (device,
  inode) pair, and an executable listed in `system_writers` writes there
  freely, counted as `expected`. A kernel thread, which runs no executable,
  is let through and counted the same way; a process whose executable cannot
  be read is let through and counted as `unresolved`.

```yaml
file_watch:
  write_refusal:
    enabled: true
    mode: shadow
    paths:
      - /srv/data
    system_paths:
      - /etc/ssh
      - /etc/sudoers
      - /etc/systemd/system
    system_writers:
      - /usr/bin/dpkg
      - /usr/bin/systemctl
      - /usr/lib/systemd/systemd
```

A script writes as its interpreter, so a shell or a Python named in
`system_writers` would let every script write; name the binaries that write,
and read what `shadow` reports of a package upgrade, whose maintainer scripts
write under `/etc` through a shell, before turning `enforce` on. An executable
is followed by its file, so an upgrade that replaces it is picked up within
thirty seconds, like a watched path created after start.

### What it costs

**What it costs is stated with it.** A run loses the files it writes before
the threshold, `threshold - 1` per writer and window, and a run that spreads
its writes over more writers than the count follows loses that many per
writer, which is what `count_by: cgroup` narrows for a run that forks. A legitimate tool writing
more than the threshold under a watched directory in one window is refused
too, which is why the mode ships as `shadow`: read
`would_refuse` against the host's own work before turning `enforce` on. The
count is of write-opens and not of files, so one file reopened a hundred times
counts a hundred.

**It needs the BPF LSM active at boot**, which `lsm=` on the kernel command
line decides and which not every distribution or host provider sets. Where it
is not active, the program is not loaded, the agent starts anyway in either
mode, the reason is logged and reported in the `write_refusal` block of
`GET /api/v1/ebpf/kernel-features` and by `ebpfsentinel-agent ebpf host-check`,
and the [mass encryption](../features/mass-encryption.md) detection beside it
still detects the run and, with `stop` on, kills it: the node keeps a defence,
and loses more files to it.

**It fails open.** The two hooks are links the agent holds and never pins, so
an agent that stops, crashes or is killed takes them with it and nothing is
refused afterwards. A write the program cannot attribute, a path deeper than
sixteen directories below a watched one, or a new writer arriving with the
counter map full at 16,384 writers is let through and counted. The agent's own
writes are never counted.

A directory that does not exist yet is left out with a warning and picked up
within thirty seconds of being created; the watched set and the expired counts
are refreshed on the same tick. Changing anything here takes a restart.

Counters are published under
`ebpfsentinel_packets_total{interface="WRITE_REFUSAL_METRICS", action}`: `checked`, `watched`, `refused`, `would_refuse`, `unresolved`, `table_full`, `event_lost` and `expected`. A writer reaching the threshold raises one alert per window
under the component `mass_encryption` and the rule `write-refusal`, naming the
process, the file, the watched directory and the count, with the mitigation
`refused` in `enforce`.

## Host rules

Every settled change is also handed to the [host rules](../features/host-rules.md#file-intentions)
as one of the five file intentions, named the way its writer sees it and
carrying the writer and its ancestry from the process table. This needs the
process table on (`process_table.enabled`), which is where the rules live;
with it off the file watch still keeps baselines and reports drift, and the
file intentions are evaluated by nothing.

## Metrics

| Metric | Labels | Meaning |
|--------|--------|---------|
| `ebpfsentinel_file_changes_total` | `kind` | Changes seen, by kind: `created`, `written`, `attributes_changed`, `moved_out`, `moved_in`, `deleted` |
| `ebpfsentinel_file_change_overflows_total` | - | Times changes were lost because the kernel's queue was full |
| `ebpfsentinel_file_watch_filesystems` | - | Configured paths whose filesystem is watched |
| `ebpfsentinel_file_watch_filesystems_refused` | - | Configured paths whose filesystem could not be watched |
| `ebpfsentinel_file_drifts_total` | `what` | Differences between a baseline and a new reading |
| `ebpfsentinel_file_baselines` | - | Baselines kept |
| `ebpfsentinel_file_baselines_refused_total` | - | Paths that got no baseline because the store was full |
