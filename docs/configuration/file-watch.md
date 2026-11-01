# File Watch Configuration

The file watch reports every change to the files of whole filesystems and the
process that made it: a file created, written and closed, its attributes
changed, moved out of or into a directory, or deleted. It is off by default.

Nothing here enforces anything: the watch only reads.

## Configuration

```yaml
file_watch:
  enabled: true
  filesystems:
    - /
    - /var/lib/containerd
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Open the watch |
| `filesystems` | list of paths | `["/"]` | One absolute path per filesystem to watch, at most 64 |

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

## Metrics

| Metric | Labels | Meaning |
|--------|--------|---------|
| `ebpfsentinel_file_changes_total` | `kind` | Changes seen, by kind: `created`, `written`, `attributes_changed`, `moved_out`, `moved_in`, `deleted` |
| `ebpfsentinel_file_change_overflows_total` | - | Times changes were lost because the kernel's queue was full |
| `ebpfsentinel_file_watch_filesystems` | - | Paths whose filesystem is watched |
| `ebpfsentinel_file_watch_filesystems_refused` | - | Paths whose filesystem could not be watched |
