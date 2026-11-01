# File Watch Configuration

The file watch reports every change to the files of whole filesystems and the
process that made it: a file created, written and closed, its attributes
changed, moved out of or into a directory, or deleted. Every changed path is
then read again and compared with what it was the last time. It is off by
default.

Nothing here enforces anything: the watch only reads.

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
exists. A change in a directory that was removed before it could be named is
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
