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
| decisive | `canary_touched` | A decoy file nobody has a reason to open was written |
| decisive | `header_mismatch` | A file's leading bytes no longer match what its name says it is |
| strong | `crypto_rate` | The run calls encryption primitives at a rate no ordinary program does |
| strong | `ransom_note` | The same new file name appeared in many directories |
| strong | `mass_rename` | Many files were renamed to one new extension |
| strong | `replace_sequence` | Files were read, written anew and the originals removed, one after another |
| supporting | `distinct_rewrites` | 100 distinct files rewritten within a minute |
| supporting | `entropy_rise` | 20 files rewritten from ordinary content to near-random content within a minute |
| prior | `backup_destroyed` | Snapshots or backups were removed; it raises nothing on its own |

A verdict is reached by one decisive signal, by two strong signals, or by one
strong signal and two supporting signals, counted by kind, within a minute, for
one run. A prior signal is reported beside the verdict and never counts toward
it. One run raises one verdict, and raises again only once its signals have all
left the window.

The run is the process doing the writing, climbed through its ancestors while
they execute the same file, so a program that forks forty workers is one run
and not forty, and the alert is raised against the process that started them.

## What this agent reads

This agent reads `distinct_rewrites` and `entropy_rise`. Every other signal in
the table is named in each verdict as not read by this agent, so a verdict
never reads as the whole of the engine when part of it is absent, and a signal
this host cannot read removes the combinations that need it rather than the
verdict.

Both signals come from the [file watch](../configuration/file-watch.md) and need
the [process table](../configuration/process-table.md) to name the writer, so the verdict is
reached only on paths the file watch covers, with `process_table.enabled` on.

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

## The alert

| Field | Value |
|-------|-------|
| component | `mass_encryption` |
| rule | `mass-encryption` |
| severity | critical |
| process | the run's first process and its executable, with its ancestry |

The message lists each signal that agreed, the process that produced it and its
evidence, then each signal not read on this host and why.
