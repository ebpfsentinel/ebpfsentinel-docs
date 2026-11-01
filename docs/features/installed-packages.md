# Installed Packages

The agent reads what the package managers say is installed, in the host's
own filesystem root and in the root of every container on the node, and what
every running Go program says it was built from, and answers both on one
route. It reads the databases the package managers keep and
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

## Go programs

A Go program built by Go 1.18 or later carries its own list of the modules it
was linked from, in a section of the executable named `.go.buildinfo`: the
toolchain version, the main package, the main module and every dependency
with its version, and what a `replace` directive put in a module's place. A
static Go binary copied into an image belongs to no package, so this list is
the only statement about what is inside it.

Every running executable is looked at once per file, however many processes
run it, and only its section headers and that one section are read: no
executable is run, and nothing in it but the build information is opened.
Each Go executable is listed with the root of the lowest process running it,
its path inside that root, and up to sixteen of the processes running it.

The section is read by the warden on a rootless agent and handed back as
bytes; the agent parses it as untrusted input. Not read, each with the
reason, so a program left out is never mistaken for one with no modules:

- a section larger than 1 MiB;
- a binary built before Go 1.18, which writes its build information in a
  form that points elsewhere in the program instead of carrying it inline;
- a section that is truncated or not text where text is expected.

One reading reads at most 12 MiB of sections across all executables, and
counts how many Go programs it left beyond that. A program that is not
running is not listed: the list is of what runs, not of every file on disk.

## Loaded files

A package that is installed and mapped into no process runs nowhere, and a
library loaded by forty processes is one fact rather than forty. Every file a
live process maps executable, its program and each shared library, is read
from `/proc/<pid>/maps` and joined to the package owning that path in the
same process's root, on a second route:
`/api/v1/surface/loaded`.

Each file is listed once per root however many processes map it, with up to
sixteen of those processes and how many there are in all. A file unlinked
since it was mapped, the old library an upgrade replaced on disk while a
process still runs it, is marked deleted, and the package named is the one
owning the path now. A file no database lists, a binary copied in by hand or
a process whose root was not read, carries no owner rather than a guess. On a
merged `/usr` system a database writing `/lib/x86_64-linux-gnu/libc.so.6` and
a process mapping `/usr/lib/x86_64-linux-gnu/libc.so.6` name one file.

`/proc/<pid>/maps` is readable only by a process allowed to trace the one it
describes, so on a rootless agent the warden reads it and hands back the
device, inode and path of each executable mapping and nothing else. Each
process is stamped with its start time and virtual size, both readable
without tracing it: a process whose stamp has not moved since the last
reading is not read again, while a `dlopen`, an `exec` or a reused pid moves
it. The reading says how many processes it listed, how many it read again
and how many it could not read, so a process left out is never mistaken for
one mapping nothing. One reading lists at most 65,536 processes and 65,536
files, and says how many it left beyond either.

## Listening sockets and what is behind them

A package matters most where it answers the network. A third route,
`/api/v1/surface/listening`, takes every socket of the
[listening sockets](listening-sockets.md) table and puts beside it the
packages owning a file its process maps, each package once, and the files that
process maps which no database in its root lists. Three facts sit next to
them, read from the same places as the listeners route rather than inferred:

- **the traffic it took**, the TCP connections accepted since the socket
  hooks attached, and its class: used, unused, unmeasured for UDP, closed by
  policy or loopback only;
- **who may reach it**: `anywhere` when the packet firewall lets any source
  through, `private_only` when every source it lets through lies in a
  private, carrier-grade or link-local range, `blocked` when it lets none, and
  `loopback` for a socket bound to the loopback address only;
- **the sources let through**, when only some are.

A process whose mappings were not read says so, and its lists are then unknown
rather than empty. A server mapping a library no package owns is named with
that file, so a binary copied in by hand is visible behind the port it opens.

## The surface of this host

`/api/v1/surface`, and `ebpfsentinel-agent surface` with no subcommand, answer
in one reading what the three routes above answer in detail:

- **what is installed**: the roots read and not read, the packages their
  databases list, and the running Go programs;
- **what runs**: the processes listed and not read, the files they map, how
  many of the installed packages own at least one of those files and how many
  own none, the mapped files no package owns and those unlinked since;
- **what listens**: the sockets, how many took traffic, how many took none
  and how many are UDP and not measured;
- **what is reachable**: the listeners some source off the private ranges
  may reach, those only private sources may reach, those bound to the
  loopback, and each reachable listener with the packages behind it;
- **what the policy already blocks**: the listeners the packet firewall drops
  every packet for, each with the packages behind it.

A package installed and mapped by no live process is not on the path of any
packet the node accepts today, and a package behind a listener nothing may
reach is not either. The answer carries counts and lists, never a
vulnerability, a severity, a score or an order of importance: matching the
packages against an advisory feed is the work of the scanner already reading
the distribution's own backports, and this route gives it the part of the
inventory that is running and reachable.

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
- **Language package managers.** A Python wheel or a Node module is not in
  any of these databases. A Go program is read from its own build
  information while it runs, as above.
- **What no database lists.** A file copied into an image by hand, or a
  binary built in place, belongs to no package.

A database larger than 256 MiB, or one that changes while it is read, is
reported unreadable with the reason, and a node with more than 1024 roots
reads the first 1024 and says how many it left.

## Cost

A database is read whole once. On every later reading it is looked at, its
device, inode, size and modification time, and read again only if one of them
moved, so a node where nothing is installed between two readings costs a few
`stat` calls a root. The build information of running Go programs is read again on
every reading, since a process may have started or been replaced. The mapped
files of a process are read again only when its stamp moved, and joining every
mapped file to its owner takes about 5 ms for a thousand processes against
sixteen thousand packaged files, most of it building the index of owners.

## Turning it off

```yaml
package_inventory:
  enabled: false
```

The route then answers `reading: false`. See
[Package Inventory Configuration](../configuration/package-inventory.md).
