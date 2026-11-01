# Installed Packages

The agent reads what the package managers say is installed, in the host's
own filesystem root and in the root of every container on the node, and
answers it on one route. It reads the databases the package managers keep and
runs none of them: no `dpkg`, `rpm` or `apk` binary is executed, inside a
container or outside it.

## What is read

| Manager | Database | What a package carries |
|---------|----------|------------------------|
| dpkg | `/var/lib/dpkg/status`, and `/var/lib/dpkg/info/<name>.list` for each package | Name, version, architecture, state and the files it owns |
| rpm | `rpmdb.sqlite` under `/usr/lib/sysimage/rpm` or `/var/lib/rpm` | Name, version with its epoch, architecture and the files it owns |
| apk | `/lib/apk/db/installed` or `/usr/lib/apk/db/installed` | Name, version, architecture and the files it owns |

A dpkg package that is installed or waiting on triggers reads `installed`; one
dpkg has started and not finished installing or configuring reads `partial`.
A package removed with its configuration files left behind is not installed
and is not listed. An rpm database's `gpg-pubkey` entries are keys, not
packages, and are skipped.

The version is the one the database writes, epoch included where rpm carries
one, and nothing is compared, ranked or looked up against any advisory: the
answer is a list of what is there, and what a version means is left to
whoever reads it.

## Roots

Every process on the node has a filesystem root, and the roots are told apart
by the directory they resolve to, so one container with forty processes is
read once. Each root is named:

- `host` for the root of the process with pid 1 in the host's pid namespace;
- `container` with its id and runtime, when the process's cgroup names one,
  the way the [container resolver](../configuration/container.md) reads it;
- `other` for a root no runtime names, a `chroot` or a sandbox.

A file is opened inside the root it belongs to and resolution never leaves it:
a symbolic link in a container that points at `/etc` lands on the container's
`/etc`, not the host's. A rootless agent asks the warden to open the file and
reads the bytes it hands back; only the database files above can be asked for.

## What is not read

- **rpm's older formats.** A root whose rpm database is still Berkeley DB
  (`/var/lib/rpm/Packages`) or ndb (`Packages.db`) carries an entry for it
  with the reason it was not read, so an empty list never stands for a root
  nobody read.
- **An uncommitted write.** An rpm database in the middle of a transaction
  keeps its last pages in `rpmdb.sqlite-wal`; that file is not read, so the
  answer is the database as of its last checkpoint.
- **Language package managers.** A Python wheel, a Node module or a Go binary
  is not in any of these databases.
- **What no database lists.** A file copied into an image by hand, or a
  binary built in place, belongs to no package.

A database larger than 256 MiB, or one that changes while it is read, is
reported unreadable with the reason, and a node with more than 1024 roots
reads the first 1024 and says how many it left.

## Cost

A database is read whole once. On every later reading it is looked at, its
device, inode, size and modification time, and read again only if one of them
moved, so a node where nothing is installed between two readings costs a few
`stat` calls a root.

## Turning it off

```yaml
package_inventory:
  enabled: false
```

The route then answers `reading: false`. See
[Package Inventory Configuration](../configuration/package-inventory.md).
