# Mass Encryption

The agent recognises one run encrypting many files by signals that agree, never
by one of them alone. A backup rewrites many files, an archiver writes content
with no structure, a build renames in bulk: each signal has an innocent cause,
and what has none is several of them from one run in one minute. When they
agree, the agent raises one alert, `mass_encryption`, naming the run, every
signal that agreed with its evidence, and every signal this host could not
read.

This is detection. The alert says mass encryption was detected; it does not
undo a file, it does not restore one, and it is not a promise that no file is
lost.

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

## What this agent reads

This agent reads `backup_destroyed`, `canary_touched`, `distinct_rewrites`,
`entropy_rise`, `header_mismatch`, `mass_rename`, `replace_sequence` and
`ransom_note`. Every other signal in
the table is named in each verdict as not read by this agent, so a verdict
never reads as the whole of the engine when part of it is absent, and a signal
this host cannot read removes the combinations that need it rather than the
verdict.

All but `backup_destroyed` come from the [file watch](../configuration/file-watch.md) and need
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
`download`, `new`, `lock`, `bak`, `old`, `orig`), and the new extension may not
be a number, which is what log rotation appends. A run spreading its renames
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
The count is of directories rather than files, since the same name written
twice into one directory is still one directory.

Some legitimate software scatters one name widely too, and those names are
never counted, compared without regard to case: version control placeholders
(`.gitkeep`, `.gitignore`), Python packaging (`__init__.py`, `METADATA`,
`RECORD`, `py.typed`), JavaScript packages (`package.json`, `index.js`,
`README.md`, `LICENSE`), other toolchains (`Cargo.toml`, `go.mod`, `pom.xml`,
`Makefile`, `CMakeLists.txt`, `BUILD.bazel`, `meson.build`) and file managers
(`.DS_Store`, `.directory`, `Thumbs.db`, `desktop.ini`). A tool outside that
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
own scheduled prune looks like.

A command that is renamed, statically linked under another name or replaced by
a direct call to the kernel is not recognised: this is a list of the tools a
run reaches for, not a description of every way to remove a file.

## The alert

| Field | Value |
|-------|-------|
| component | `mass_encryption` |
| rule | `mass-encryption` |
| severity | critical |
| process | the run's first process and its executable, with its ancestry |

The message lists each signal that agreed, the process that produced it and its
evidence, then each signal not read on this host and why.
