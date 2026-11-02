# Mass Encryption

The agent recognises one run encrypting many files by signals that agree, never
by one of them alone. A backup rewrites many files, an archiver writes content
with no structure, a build renames in bulk: each signal has an innocent cause,
and what has none is several of them from one run in one minute. When they
agree, the agent raises one alert, `mass_encryption`, naming the run, every
signal that agreed with its evidence, and every signal this host could not
read.

This is detection, and where it is told to, a stop. The alert says mass
encryption was detected; with the stop on, a second alert says the run was
stopped and how many files it had written by then. Neither undoes a file or
restores one: the files written before the run died are lost, and the stop
bounds how many, it does not prevent the first of them.

## The verdict

Each signal carries a weight:

| Weight | Signal | What it says |
|--------|--------|--------------|
| decisive | `canary_touched` | A canary file nobody has a reason to open was opened or read |
| decisive | `header_mismatch` | A file's leading bytes no longer match what its name says it is |
| strong | `crypto_rate` | The run calls encryption primitives at a rate no ordinary program does |
| strong | `ransom_note` | The same new file name appeared in many directories |
| strong | `mass_rename` | Many files were renamed to one new extension |
| strong | `replace_sequence` | Files were read, written anew and the originals removed, one after another |
| supporting | `distinct_rewrites` | 100 distinct files rewritten within a minute |
| supporting | `entropy_rise` | 20 files rewritten from ordinary content to near-random content within a minute |
| prior | `backup_destroyed` | Snapshots or backups were destroyed; it raises nothing on its own and lowers what a later run needs |

A verdict is reached by one decisive signal, by two strong signals, or by one
strong signal and two supporting signals, counted by kind, within a minute, for
one run. A prior never reaches a verdict by itself: held for the run, it lowers
the rule to one strong signal, or to two supporting signals, and it is reported
in the verdict beside them. One run raises one verdict, and raises again only
once its signals have all left the window.

The run is the process doing the writing, climbed through its ancestors while
they execute the same file, so a program that forks forty workers is one run
and not forty, and the alert is raised against the process that started them.

## A run written by another host

On a file server, the files are rewritten by the file service, not by the
run: Samba's `smbd`, or the kernel's own SMB and NFS servers, write each file
for a client on another host. The file service is therefore never the run.
A change it makes counts against the client it served, which is a run of its
own, never added to a run of this host's and never added to another client's:
Samba forks one process per client, so each of those processes is one client,
and the climb through ancestors described above is not made for them.

The client is named by the address of the one connection that process holds
on port 445, 139 or 2049, read off `/proc`, and the alert carries that address
as its source. The kernel's servers hold no socket a process can be read for,
and a process serving several addresses at once names none of them, so there
the verdict says the writes came from a client on another host whose address
was not read; every signal is still counted, against that one service thread.

Two things change for such a run. The encryption calls of a file service are
not counted, because they are the service encrypting its own transport for
every client, not the client encrypting files. And a verdict against a client
never stops anything on this host, whatever `stop` says: killing the file
service would end every client's session and leave the run, which is on the
client's host, running. What the server's alert gives is the address to act
on. The client's own agent, where there is one, sees its writes leave as
[writes to other hosts' shares](#writes-to-other-hosts-shares).

## What this agent reads

This agent reads every signal in the table: `backup_destroyed`,
`canary_touched`, `crypto_rate`, `distinct_rewrites`, `entropy_rise`,
`header_mismatch`, `mass_rename`, `replace_sequence` and `ransom_note`. A
signal this host cannot read is named in each verdict with the reason, so a
verdict never reads as the whole of the engine when part of it is absent, and
a signal this host cannot read removes the combinations that need it rather
than the verdict.

All but `backup_destroyed` and `crypto_rate` come from the [file watch](../configuration/file-watch.md) and need
the [process table](../configuration/process-table.md) to name the writer, so the verdict is
reached only on paths the file watch covers, with `process_table.enabled` on.
`backup_destroyed` is read from the command lines the process table captures,
so it needs `process_table.capture_command_line` on as well; with it off, every
verdict names the prior as unavailable and says which setting would give it.

### Distinct rewrites

Every settled write, creation or file moved into a watched directory counts once
per path toward its run. A file rewritten twice is one file.

### Entropy rise

When the file watch hashes a regular file it also measures, from the same bytes,
the Shannon entropy of its first 64 KiB, or of the whole file when it is
shorter: a number in bits per byte, as far from the content as the hash is. A
file whose previous reading was below 7.0 bits per byte and whose new reading is
at or above 7.9 has gone from ordinary content to content indistinguishable from
random.

What sampling costs is stated rather than hidden. A run that encrypts only the
end of each file, or encrypts in intermittent blocks to go faster, can leave the
first 64 KiB untouched and the entropy flat. A file that was already compressed
or encrypted cannot rise. A file seen for the first time has nothing to rise
from. That is why this signal only supports a verdict.

### Header mismatch

The same read hands back each rewritten file's first four bytes, where a format
writes its signature, and they are set against what the file's extension names:
a `.docx` that is neither a ZIP archive nor an encrypted Office file, a `.pdf`
that does not start with `%PDF`, a `.jpg` with no JPEG marker. Ten such files
from one run within a minute are decisive on their own, because legitimate
software does not leave a file named `.docx` that is not one, and because a run
that encrypts only the start of each file breaks the signature first.

| Extensions | Expected start |
|------------|----------------|
| `zip`, `jar`, `apk`, `epub`, `odt`, `ods`, `odp`, `odg` | a ZIP archive |
| `docx`, `xlsx`, `pptx`, `docm`, `xlsm`, `pptm` | a ZIP archive, or an OLE compound file when password-protected |
| `doc`, `xls`, `ppt`, `msg` | an OLE compound file |
| `pdf` | `%PDF` |
| `png`, `jpg`, `jpeg`, `gif`, `tif`, `tiff`, `bmp`, `psd`, `webp` | the image format's signature |
| `wav`, `avi`, `flac`, `ogg`, `oga`, `ogv`, `opus` | the audio or video container's signature |
| `gz`, `tgz`, `bz2`, `tbz2`, `xz`, `txz`, `zst`, `7z`, `rar` | the compressor's signature |
| `sqlite`, `sqlite3`, `rtf` | `SQLite format`, `{\rtf` |

Left out on purpose, because their start is not fixed: MP3 (an ID3 tag or a
bare frame), MP4 and MOV (the signature sits at the fifth byte), plain text,
CSV, JSON, XML and HTML (no signature at all), and `.db`, which a dozen engines
share. Never counted: a file shorter than four bytes, a file whose first four
bytes are zeros (space reserved by a download or torrent client and not yet
written), an Office owner file (`~$report.docx`), a name with no extension, and
a name whose extension the table does not cover, such as `report.pdf.locked`,
which is what a rename to a new extension is for.

### Mass rename

A rename the kernel reports with both names counts toward its run when it gives
the file a new extension: fifty distinct files renamed to one new extension by
one run within a minute are a strong signal. It is what a run that encrypts in
place leaves behind, and it survives a run whose encryption no sampled read can
see, because the name changes whatever the content does.

What a build, an editor, a download or log rotation renames is not counted: the
extension must differ from the old one, the old name must not be hidden, neither
the old nor the new extension may be one a file carries while it is written or
once it is set aside (`tmp`, `temp`, `part`, `partial`, `swp`, `crdownload`,
`download`, `new`, `lock`, `bak`, `old`, `orig`), nor one a package manager
installs a file under or sets an edited one aside under (`dpkg-new`,
`dpkg-tmp`, `dpkg-dist`, `dpkg-old`, `dpkg-bak`, `ucf-new`, `ucf-dist`,
`ucf-old`, `rpmnew`, `rpmsave`, `rpmorig`, `pacnew`, `pacsave`, `apk-new`),
the old extension may not carry the `;` an RPM transaction appends, and the new
extension may not be a number or the old one followed by a date or a number,
which is what log rotation appends (`app.log.1`, `app.log-20261101`). A run spreading its renames
over more than eight new extensions in one window is not that shape, and what
it adds past the eighth is not counted.

Rename reporting is the kernel's `FAN_RENAME`, introduced in Linux 5.17 and
observed on 7.0, below the agent's floor and so present on every kernel it
runs on. A filesystem whose mark refuses it is logged at startup, and on it a
rename reads as a disappearance and an appearance, which this signal does not
count.

### Replace sequence

A run that does not encrypt in place reads each file, writes what it read into
a new file beside it, and then renames that file over the original or deletes
the original. Twenty distinct files replaced that way by one run within a
minute are a strong signal. Volume does not tell that apart from a backup or a
package upgrade, so the shape is what is counted, on two facts the file watch
reads:

- **Written now.** The replacement's modification time is within five minutes
  of the reading. `rsync -a`, `cp -p`, a package manager and an archive
  extraction leave the time their source carried, and a run writing what it
  just read does not.
- **Of the original's size.** The replacement is at least as large as the
  original and larger by at most 1 MiB, which is what writing back what was
  read, with a header, padding or a wrapped key, produces. An empty original is
  never counted.

Two shapes are matched. A file renamed over a known file of its directory, from
any name, hidden temporaries included. And a new file whose name is the
original's plus one extension, `report.docx.locked` beside `report.docx`, with
the original then deleted: the two halves are matched in whichever order they
are read, since the file watch settles a batch of paths in no fixed order, and
each run holds at most 1,024 unmatched halves of each kind.

What it costs is stated rather than hidden. The read itself is not observed: a
read event on a whole filesystem would cost every open on the host, so the size
stands for it. A tool that rewrites a tree's files in place under new names,
with fresh times and sizes that barely move, matches the shape, which is why
the signal is strong and never decisive alone. A rename of a file onto a new
extension without a deletion is the mass rename signal and not this one, so one
behaviour never counts twice.

### Ransom note

A run leaves a note in every directory it walks, under one name. One new file
name created in forty distinct directories by one run within a minute is a
strong signal. Nothing of the file is read, only that it was created and in
which directory, so the signal costs nothing and carries no privacy question.
A note is written for a person to open, so only a name under an extension a
person opens is counted: `txt`, `html`, `htm`, `hta`, `rtf`, `md`, `url`,
`png`, `jpg`, `jpeg` and `bmp`. A message catalogue a package installs into
every locale directory, or a `Kconfig` a checkout writes into every directory
of a kernel tree, is never one.
The count is of directories rather than files, since the same name written
twice into one directory is still one directory.

Some legitimate software scatters one name widely too, and those names are
never counted, compared without regard to case: version control placeholders
(`.gitkeep`, `.gitignore`), Python packaging (`__init__.py`, `METADATA`,
`RECORD`, `py.typed`), JavaScript packages (`package.json`, `index.js`,
`README.md`, `LICENSE`), other toolchains (`Cargo.toml`, `go.mod`, `pom.xml`,
`Makefile`, `CMakeLists.txt`, `BUILD.bazel`, `meson.build`) and file managers
(`.DS_Store`, `.directory`, `Thumbs.db`, `desktop.ini`), media libraries
(`cover.jpg`, `folder.jpg`, `poster.jpg`, `fanart.jpg`), column stores writing
one layout per data part (`columns.txt`, `checksums.txt`, `count.txt`,
`default_compression_codec.txt`, `metadata_version.txt`) and generated
documentation (`index.html`, `index.htm`). A tool outside that
list writing one name into forty watched directories in a minute raises the
signal, which is why it is strong and never decisive alone. Each run follows at
most 256 names at once, dropping the one least recently seen, so a build
creating thousands of distinct names does not push a note out of the count.

### Canary files

A canary is a file planted into a data directory under a name no legitimate
process has a reason to open, watched for any open or read whatever the access
mode. A run walking the directory to encrypt it opens the canary along with
everything else, and one open is a decisive signal on its own, so wherever a
canary sits the verdict follows from the first file of it the run touches. A
canary deleted or renamed away by another process counts as touched too, and
is planted again.

Canaries are off by default, because planting writes files into the operator's
own directories; `file_watch.canaries` in the
[file watch](../configuration/file-watch.md#canary-files) turns them on. The
default plants two names into each of `/home`, `/root`, `/srv`, `/var/www`,
`/opt`, `/mnt` and `/media`: `0000-archive.docx`, which sorts before almost
every other name, and `zzzz-archive.xlsx`, which sorts after, so a run walking
a directory in name order meets a canary first or last, under extensions a run
sets out to encrypt. A directory absent on the host is reported and skipped.

Placement is where the value is. A canary in a directory nobody walks catches
nothing, and one in a directory a backup or a scanner walks fires each time it
runs, which is what the exempt list is for: backup tools and virus scanners,
matched by the executable's full path, so a copy of one elsewhere is not
exempt. An open by a process the process table cannot name is logged and
raises no verdict, since there is no run to name.

What a canary does not see: it is created by the watch's holder with mode
`0644`, so a process running as another user that asks to open it for writing
only is refused by the kernel before the open, and nothing is reported; a run
that encrypts a file reads it first, and that read is reported. A run that
skips files by name or by size can skip a canary too.

### Encryption calls

A run that encrypts files through the system's crypto library calls its
encryption entry point once or more for every file it writes. The agent puts
one uprobe on each of these symbols, in every copy of the library that a
running process maps or that the host keeps in its library directories:

| Library | Entry point |
|---------|-------------|
| `libcrypto` (OpenSSL) | `EVP_EncryptUpdate` |
| `libgcrypt` | `gcry_cipher_encrypt` |
| `libsodium` | `crypto_secretstream_xchacha20poly1305_push`, `crypto_aead_xchacha20poly1305_ietf_encrypt` |

The probe counts calls per process and reads nothing else: no argument, no
key, no buffer. That is structural, the program holding a counter and no
pointer to read through. Each second the agent hands every process's new calls
to its run, and the signal is raised when a run makes 200 calls and rewrites 20
files in the watched paths within a minute. Calls with no files beside them are
a TLS server or a backup tool encrypting a stream, and raise nothing; files
with no calls beside them are the other signals' business.

The count is by process and not by connection, so a program that serves TLS
and also rewrites files is counted on both. TLS goes through `libssl`, which
calls `EVP_EncryptUpdate` too, which is why the rewrites are what makes the
signal and the calls alone never do.

What this does not see: a binary that carries its own cipher, statically
linked or written in a language that brings its own (Go, most Rust), calls
none of these symbols. Such a run reaches a verdict on the other signals or
not at all; this one is strong rather than decisive for that reason. A library
in a container started after the agent is probed within thirty seconds of the
first process that maps it. The program is `uprobe-crypto`; with it absent,
or with no library found to probe, every verdict names `crypto_rate` as
unavailable and says why.

### Backups destroyed

A run that means to be paid removes what would restore the files before it
encrypts them. The agent reads each command line the process table captures
and recognises these, by the executable that ran rather than by what the
command line calls itself:

| Command | What it destroys |
|---------|------------------|
| `btrfs subvolume delete`, abbreviations included | A btrfs subvolume or snapshot |
| `zfs destroy` | A zfs dataset or snapshot |
| `restic forget`, `restic prune` | restic snapshots |
| `borg delete`, `borg prune`, `borg rdelete`, `borg repo-delete` | borg archives or a repository |
| `borgmatic delete`, `rdelete`, `repo-delete` | borgmatic archives or a repository |
| `snapper delete` | snapper snapshots |
| `timeshift --delete`, `--delete-all` | timeshift snapshots |
| `systemctl stop`, `disable` or `mask` of a backup unit | A unit whose name contains `backup`, `restic`, `borg`, `kopia`, `duplicity`, `duplicati`, `rsnapshot`, `bacula`, `bareos`, `urbackup`, `amanda`, `veeam`, `snapper`, `timeshift`, `sanoid`, `syncoid` or `zfs-auto-snapshot` |
| `crontab -r` | A crontab, whatever it held: its content is not read |

Every one of them is also an administrator pruning snapshots on a Tuesday, so
it is a prior and never a verdict. The command encrypts nothing, so the prior
is held for whoever ran it: the process that started the command, climbed past
the shells a command line passes through, so `sh -c "zfs destroy ..."` run by
a program counts for that program, and a command typed in a login shell counts
for that session. Any run started below that process within ten minutes then
reaches a verdict on one strong signal, or on two supporting ones, and the
verdict quotes the command line. A command started directly by the init
process belongs to no run and holds no prior, which is what a backup unit's
own scheduled prune looks like. A backup program itself (`restic`, `rustic`,
`borg`, `borgmatic`, `kopia`, `duplicity`), named by its executable or by the
program its command line starts, inherits no prior from its ancestors: the
`borg create` a backup job runs right after its own `borg prune` writes its
repository under the same session, and that is the job doing its work.

A command that is renamed, statically linked under another name or replaced by
a direct call to the kernel is not recognised: this is a list of the tools a
run reaches for, not a description of every way to remove a file.

## Shadow first

The verdict starts in shadow. In shadow it is evaluated exactly as it would be
enforced, and a verdict reached is counted under the workload that reached it
and kept among the last sixteen, with its message, instead of raising the
alert. The count is read at `GET /api/v1/host-rules/mass-encryption` and with
`ebpfsentinel-agent host-rules mass-encryption`, which name the mode, the
verdicts per workload and the most recent ones. Once a host has run its own
week of backups, upgrades and maintenance with nothing counted, setting
`file_watch.mass_encryption.mode` to `enforce` in the
[file watch](../configuration/file-watch.md#mass-encryption) raises the alert
from then on. The thresholds are the same in both modes: shadow changes what a
verdict does, never when one is reached.

With Enterprise's ML detection the four counts a legitimate job can reach -
distinct rewrites, entropy rises, renames to one new extension and
replacements - are read per executable against a threshold learned from what
that executable does, held between half and four times the shipped one. The
decisive signals are never learned, the verdict is still this engine's, and a
threshold that drifts far from where it was first learned is reported:
[mass encryption thresholds](enterprise/ml-detection.md#mass-encryption-thresholds).

## Stopping the run

With `file_watch.mass_encryption.stop` on and the verdict in force, a verdict
against a run of this host kills the run it names rather than one process of it: the process the
signals were attributed to and every process it started, read off the process
table, each sent `SIGKILL` through the signal program at once. An encryptor
that forks one worker per directory is stopped whole, workers included, and a
process the run started outside its lineage, through a service manager or a
scheduler, is not part of it.

Two seconds after the signals, a second alert follows the verdict's, under the
same rule:

| Field | Value |
|-------|-------|
| mitigation status | `stopped` when every process of the run is gone, `partially_stopped` when some survived, `not_stopped` when none was reached |
| message | the files written before the run was stopped, how many of its processes are gone and how long after the verdict, then any process that survived and why, then the verdict's own message |

The file count is the number of distinct files the run was seen writing,
renaming or creating under the file watch by the time the alert was written. It
is read off the watch rather than off the disk, and the watch reads changed
paths back in batches, so against a run writing at full speed it is a floor:
the files lost are more, as the measurements below show.

**How long it takes, and what it costs.** On the test lane, a guest running
kernel 7.0, `tests/perf/08-mass-encryption-kill-latency.bats` encrypted a tree
of 2,000 small documents in twenty directories at full speed, five times with a
single process and five times with one forking a worker per directory:

| Run | Verdict to last process gone | Files the alert counted | Files lost on disk | Outcome |
|-----|------------------------------|-------------------------|--------------------|---------|
| Single process | 101 to 105 ms | 34 to 87 | 128 to 249 | `stopped` in five runs of five |
| A worker per directory | 103 to 109 ms where a worker was still running | 21 to 175 | 1,711 to 2,000 | `partially_stopped` in two runs, `not_stopped` in three |

The single process is stopped every time, after a tenth or less of the tree.
Twenty workers writing in parallel finished the whole tree before the verdict
in three runs of five, and most of it in the other two: each document is
small, the verdict waits on the watch reading the changed paths back, and by
then there was nothing, or little, left to kill. That is the bound this
feature gives, not a promise about the first files: what a run loses is what
it writes between its first rewrite and the verdict, plus the tenth of a
second the signal takes, and a run fast enough to finish inside that interval
is reported as such rather than as stopped.

## Refusing the next write

The verdict and the stop act once the files are written. The
[write refusal](../configuration/file-watch.md#write-refusal)
acts before: it counts each writer's write-opens under the watched directories
and the kernel refuses the one reaching the threshold, and every one after it
in the window, before a byte is written. It reads no signal and reaches no
verdict, so it is blunt where the verdict is careful: a run past the count is
refused whatever it writes, and so is a legitimate tool, which is why it ships
in `shadow`.

It moves the bound and does not remove it. A run still loses the files it
writes before the threshold, per writer. It needs the BPF LSM active at boot,
which is the `lsm=` boot parameter and not a kernel version, and
`ebpfsentinel-agent ebpf host-check` answers for your own host; without it a
fanotify permission group refuses on a bounded set of paths, and where neither
can run the refusal is not loaded and the detection and the stop above are what
remain. It fails open: an agent that is gone refuses nothing, and the node is
writable the moment it stops.

## What does not raise it

The thresholds above were measured against the work a host does every day,
replayed through the same engine with the command lines and process trees each
tool produces, and none of it reaches a verdict:

| Workload | Why it stays quiet |
|----------|--------------------|
| `rsync -a` of a tree, first copy and update | Files keep their source's time, so nothing is written now; its hidden temporaries are not renames to a new extension |
| `tar` extracting an archive | New files with their archived times and content as it was |
| A package upgrade (`apt`, `dpkg`, `rpm`) | Files are installed under a package manager's own suffix and renamed into place; the encryption a download calls writes no existing file |
| `git checkout` between branches | Files are written anew and renamed over, with content that keeps its structure |
| `updatedb` | One database file rewritten |
| Log rotation and compression | Rotated names carry a number or a date; compressed logs are new files, not rewrites |
| A media encoder | New files written once |
| Database compaction (SQLite, PostgreSQL, ClickHouse) | Few files, or parts whose layout files are on the scattered list |
| A backup job pruning and then backing up | The prune is a prior held for the session, and the backup program inherits none |
| An administrator pruning snapshots | A prior and nothing more |

Two cases are known to reach a verdict and are kept that way. A session that
destroys snapshots and then, within ten minutes, copies a tree with `rsync -r`
without `-t`, which writes every file fresh, reaches one on the replace
sequence and the prior: the same shape a run deleting backups and then
encrypting leaves, and nothing in the files tells them apart. And a backup
program run through an interpreter is recognised by the program its command
line starts, which the process table only knows where command lines are
captured.

## The alert

| Field | Value |
|-------|-------|
| component | `mass_encryption` |
| rule | `mass-encryption` |
| severity | critical |
| process | the run's first process and its executable, with its ancestry |

The message lists each signal that agreed, the process that produced it and its
evidence, then each signal not read on this host and why.

## Writes to other hosts' shares

A run encrypting files over the network leaves the host it runs on untouched:
the workstation mounts the shares it can reach and rewrites them from where it
sits, so every signal above fires, if anywhere, on the file server, and the
workstation's own disk shows nothing. What changes on the workstation is where
its writes go. With `share_writes` turned on, the agent follows the writes this
host pushes over SMB and raises one alert, `share_writes`, when one process
writes to several file servers this host has never written to before, within a
few minutes.

The reading is taken off the flow records of the connection table: a TCP flow
towards port 445 or 139, the bytes the local side sent being what it wrote, and
the process behind the flow named through the
[socket attribution](../configuration/attribution.md). It reads no file and no
SMB message content, so the alert says where the writes went, how much and by
which process, and says that its reading is **degraded**: volume, server count
and timing only, with no SMB operation and no content read. It does not say the
files were encrypted. An SMB 3 session that seals its messages hides every
operation behind a transform header, and this reading is the same with or
without it, which is why the alert says so on every firing rather than letting
a cleartext lab suggest it saw more.

Bytes are only in the connection table when the kernel counts them, so turning
`share_writes` (or flow export) on sets `net.netfilter.nf_conntrack_acct` to `1`
on the host. The agent never sets it back, and a connection opened before it
was set carries no byte count. On a host whose kernel has no
`/proc/net/nf_conntrack`, the table is read through `conntrack -L`, by the
warden when the agent runs rootless, so `conntrack-tools` must be installed
there. A window belongs to one process: several programs, each writing to a
single new server, are several writers and raise nothing.

The history of servers is learned, never written by hand. Every server this
host writes to during the learning period, a week by default, is ordinary, and
a server first seen later joins the history once the window it was seen in has
closed. A backup server that reaches every share every night is quiet from the
first night after learning, and a host that gains one new server at a time
never adds up to an alert. The learning period starts at the first write the
agent sees, and the history is held in memory, so an agent restart learns
again: a run that starts during learning is taken as ordinary.

| Field | Value |
|-------|-------|
| component | `share_writes` |
| rule | `share-writes-to-new-peers` |
| severity | high |
| MITRE ATT&CK | T1021.002, Remote Services: SMB/Windows Admin Shares |
| process | the process behind the writes where the node named it, otherwise the host |
| destination | the server that received the most |

The message lists every new server with the bytes it received. The thresholds
are in [Share Writes Configuration](../configuration/share-writes.md). This is
detection: by the time the alert is raised, the writes it counts have landed.

## What the network cannot tell you

Three limits hold for every reading of encryption over the network, on this
agent and across an estate, and none of them is lifted by configuration.

- **A remote writer has no process tree here.** A flow carries no local
  process on the far side, so a file server names the client it served by its
  address, and the run is counted against that client rather than against the
  file service. The process behind the writes is known only where the writing
  host runs an agent of its own and names it in its `share_writes` alert.
- **An encrypted SMB session hides what it does.** An SMB 3 session that seals
  its messages carries no readable operation, so the signal degrades to
  volume, server count and timing. The `share_writes` alert says it is
  degraded on every firing, and a demonstration on a cleartext lane does not
  stand for more.
- **A host with no agent is invisible as a source.** The receiving hosts still
  fire, each naming the writer by its address, but nothing reports the writer's
  own side, and across an estate a writer at an address no member is
  registered at has no origin and no response is made against it (see
  [encryption across the estate](enterprise/multicluster.md#encryption-across-the-estate)).
