# Reachable Vulnerabilities

**Licence feature:** `fleet-management`.

## What it answers

Which of the findings your own scanner listed name a package this host runs,
listens with and lets the outside reach. A scanner report, CycloneDX, SPDX,
Trivy, Grype or Harbor JSON, is handed to the agent; each finding is joined
with the packages the agent read installed on the host, and each joined
installation is given six facts read off the host at the moment the report is
asked for: whether a live process `runs` a program of the package, whether one
has it `mapped`, whether that process `listens`, whether its socket
`received_traffic`, whether it is `reachable_from_outside` through the packet
firewall, and whether the policy has it `blocked_by_policy`. Each fact is
`yes`, `no` or `not_read`, with the sentence naming what it was read off.

The findings are then put in order without a score. Each takes a standing, from
`exposed_and_used` down to `not_mapped`, and each position carries the reasons
that placed it, so a report of a thousand findings shrinking to the dozen that
face outside can be defended line by line in a review. Every five minutes the
facts are read again and what moved, a library a new release now loads, a port
that opened, a policy that stopped blocking, is listed as drift. An evidence
pack for PCI DSS 4.0, NIS2, DORA and ISO/IEC 27001 separates what the scanner
asserted from what the agent observed.

The dashboard's **Vulnerabilities** screen counts the findings per standing for
every report the estate holds, and a provider reselling under the partner
agreement reads the same counts across the tenants its session serves.

## What it costs

A report is at most 64 MiB and 200,000 findings, kept on disk beside the
fleet's SBOMs and read again at start; findings past the cap and duplicates are
counted, never dropped silently, and a record that cannot become a finding is
listed with its reason. The facts are re-read for every held report every five
minutes, off the same package inventory and socket table the agent already
keeps, and at most 4,096 changes are kept per report.

## What it needs

- **Your scanner.** The agent ships no vulnerability database and fetches no
  feed. Distributions backport fixes without moving the upstream version, so
  matching versions against an advisory feed is wrong in both directions unless
  the distribution trackers are read and refreshed daily, which is a scanner's
  whole job; the reasoning is in
  [Installed Packages](../installed-packages.md#why-there-is-no-vulnerability-database).
- **The package inventory**, which reads the `dpkg`, `rpm` and `apk`
  databases of the host and of every container on it, and the modules each
  running Go program says it was built from. A finding in an
  ecosystem the inventory does not read, npm or PyPI for instance, is listed as
  `ecosystem_not_read` rather than joined.
- **The socket hooks**, for the four socket facts. Where they are not attached
  those facts are `not_read`, never `no`, and the finding ranks above what is
  known to be quiet.
- No kernel condition beyond the 6.12 floor.

## What it is not

- **Not a scanner.** It computes no severity and no fixed version; both are the
  scanner's words, carried unchanged.
- **Not proof of exploitability.** A standing orders findings by what the host
  shows a way to; it never says a flaw can be exploited, and the screen says so
  above its counts.
- **Not attribution to a library call.** A library mapped into a process is
  reached only through that process, and the report cannot tell which library
  made a call.

The full reference, every field, every reason and every route, is
[Importing your scanner's report](fleet-management.md#importing-your-scanners-report)
in Fleet Management.
