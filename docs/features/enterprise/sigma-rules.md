# Sigma Rules

> **Edition: Enterprise** · licence feature `sigma-rules`

## Overview

Sigma is the format a security team writes a detection in when it wants the
detection to outlive the tool it was first written for. The agent compiles a
declared subset of it into its own connection rules, and refuses every rule
outside that subset by name: the refusal says which field, modifier or part of
the condition stopped it, so a rule never loads meaning something other than
what its author wrote.

The subset is the one the agent observes. The agent has no log to read: it
sees connections, keyed in the kernel on one port and decided in userspace on
the addresses either side and on the domain the destination was resolved from,
and it sees the processes a Linux host starts. So a rule over the
`network_connection` or `firewall` category, written on those fields, compiles
into a connection rule; a rule over `process_creation` on Linux, written on the
executable, its command line and its parent, compiles into a
[host rule](../../configuration/host-rules.md); a rule over a registry key, a
user name or a DNS query is refused, because nothing here could fire it.

Compiled connection rules alert. They join the IDS rules the configuration
already carries, are reported as imported rules on the alert (with the rule's
references and tags), and are matched in userspace on the connection, so they
hold no kernel slot. Compiled process rules join the host rules in shadow:
they record what they would have matched and alert nothing until an operator
promotes them, as every rule the agent did not write itself. A process rule
whose identifier is already a host rule refuses the whole import, and the rules
running stay as they were.

## Configuration

```yaml
enterprise:
  sigma:
    enabled: true
    rules:
      - /etc/ebpfsentinel/sigma
    max_refused_share: 0.5
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `false` | Off reads nothing. On with no path is refused at startup. |
| `rules` | `[]` | Rule files, or directories read for `.yml` and `.yaml` files at any depth, in name order. At most 64 paths, 20000 files, 1 MiB per file. |
| `max_refused_share` | `0.5` | The share of the rules read that may be refused, from 0 to 1, taken over every file together. Above it, the import is refused. |

A file may hold several rules as YAML documents separated by `---`. A document
that does not parse costs that rule, refused under the field `yaml`, and not
the rest of the file. Two rules carrying the same `id` refuse the second.

### Startup and reload

The rule files are compiled before the datapath is built. An import that is
refused at startup, whether for a path that cannot be read or for a share of
refusals above `max_refused_share`, stops the agent: an operator who asked for
these rules learns it then, not from a detection that did not fire.

On a reload (SIGHUP or a change to the configuration file) the rule files are
read and compiled again, so a rule edited in place is picked up. An import
refused on a reload refuses the reload, and the rules already running stay. The
`enterprise.sigma` section itself, like every enterprise section, is read at
startup.

With the section enabled and a licence that does not carry `sigma-rules`, the
agent starts, logs that no Sigma rule is loaded, and loads none.

## Checking rules before deploying them

```bash
ebpfsentinel-enterprise-agent sigma check /path/to/rules
ebpfsentinel-enterprise-agent sigma check --json /path/to/rules
ebpfsentinel-enterprise-agent --config /etc/ebpfsentinel/config.yaml sigma check
```

`sigma check` compiles exactly as the agent does, without starting it, and
prints every refusal with its file, its document number, the rule's `id`, the
field and the reason, then the totals and the refusals counted by field. With
no path it reads the paths of `enterprise.sigma.rules` in the configuration
file. It exits non-zero when a path cannot be read or when the share of
refused rules is above `max_refused_share` (or `0.5` when the paths are given
on the command line), which is exactly when the agent would refuse them.

At startup the agent logs the first 50 refusals one by one and counts the
rest; `sigma check` lists them all.

## What compiles

A rule compiles when:

- it carries an `id` (letters, digits, `-` and `_`) and a `title`;
- its `logsource.category` is `network_connection` or `firewall`;
- its condition joins named selections with `and`, `or`, `not` and
  parentheses, and `not` excludes addresses only;
- every branch of the condition names a port on exactly one side, because the
  classifier keys on one port;
- it becomes at most 64 native rules once its branches, protocols and ports
  are multiplied out.

A rule `sigma-<id>` is created for each, suffixed `-<n>` when the rule becomes
several native rules.

```yaml
title: SSH to the internet
id: 6f5c3a9e-0000-4000-8000-000000000001
level: high
logsource:
  category: network_connection
detection:
  selection:
    DestinationPort: 22
    Protocol: tcp
  internal:
    DestinationIp|cidr:
      - 10.0.0.0/8
      - 192.168.0.0/16
  condition: selection and not internal
```

## Field table

Generated from the compiler's own list, so a field that changes support
changes here in the same release.

<!-- BEGIN GENERATED SIGMA FIELDS -->

| Field or construct | Support | What it means here |
|---|---|---|
| `id` | Compiled | Required. Names the rule `sigma-<id>`, with `-<n>` when it becomes several native rules. |
| `title` | Compiled | Becomes the rule description. |
| `level` | Compiled | `informational` and `low` are low, `medium`, `high` and `critical` keep their name. Absent is medium. |
| `references` | Compiled | Carried on the alert as `url,<reference>`. |
| `tags` | Compiled | Carried on the alert as `tag,<tag>`. |
| `logsource.category` | Compiled | `network_connection` or `firewall` become connection rules; `process_creation` becomes a host rule over the process starts the agent observes, loaded in shadow. Any other category reads a log the agent does not have and is refused. |
| `detection` | Compiled | Named selections, each a map of fields or a list of maps, and a `condition`. |
| `condition` | Compiled | Selection names joined by `and`, `or`, `not` and parentheses. |
| `DestinationPort` | Compiled | Also `dst_port`. One port or a list, at most 16. A rule names a port on exactly one side, because the classifier keys on one. |
| `SourcePort` | Compiled | Also `src_port`. Same rules as the destination port. |
| `DestinationIp` | Compiled | Also `dst_ip`. An address, or a network with `\|cidr`. Under `not`, the addresses the rule excludes. |
| `SourceIp` | Compiled | Also `src_ip`. Same rules as the destination address. |
| `Protocol` | Compiled | `tcp`, `udp` or `icmp`, or their numbers. Absent is all three. |
| `DestinationHostname` | Compiled | Matched against the domains the destination address was resolved from, case-insensitively, with `*` and `?` as wildcards. |
| `\|cidr` | Compiled | On an address field. |
| `\|startswith` | Compiled | On the host name, and on an IPv4 address when the prefix ends on a whole octet, such as `10.` or `192.168.`. |
| `\|endswith` | Compiled | On the host name. |
| `\|contains` | Compiled | On the host name. |
| `\|re` | Compiled | On the host name. The expression is compiled case-insensitively and bounded in size. |
| `Image, CommandLine, ParentImage` | Compiled | In a `process_creation` rule: the executable, its command line and its parent's executable, compared case-insensitively. In a connection rule they are refused, because the classifier does not see the process. |
| `\|startswith, \|endswith, \|contains, \|re on a process field` | Compiled | Anchored as the modifier says; `\|re` keeps the case sensitivity Sigma gives it. |
| `logsource.product on process_creation` | Compiled | `linux` or absent. Another platform names processes the agent does not observe, and the rule is refused rather than loaded to never match. |
| `status, description, author, date, modified, falsepositives, license, related, fields` | Accepted, changes nothing | Metadata. Read by people, not by the compiler. |
| `logsource.product, logsource.service` | Accepted, changes nothing | Name the sensor the rule was written for. The category decides what the rule reads. |
| `Initiated` | Accepted, decided more broadly | The rule also fires on a connection to the same port the host did not open, because the classifier sees the packet and not which side opened it. |
| `not in a process_creation rule` | Refused | A host rule has no negated pattern, and dropping the exclusion would fire where the author said it must not. |
| `One field constrained twice in one branch` | Refused | A host rule holds one matcher per field. |
| `User, ParentCommandLine, ProcessId, OriginalFileName, Hashes` | Refused | A process start here carries the numeric uid and no parent command line, file metadata or hash. |
| `DestinationPortName, SourceHostname, SourceIsIpv6, DestinationIsIpv6` | Refused | Not decided on a connection here. |
| `logsource.category: dns` | Refused | The agent matches the domain on the connection it resolved to, not on the query. Write the rule over `network_connection` with `DestinationHostname`. |
| `\|all, \|base64, \|base64offset, \|windash, \|cased, \|exists, \|expand, \|fieldref, \|lt, \|lte, \|gt, \|gte` | Refused | A modifier outside the subset refuses the rule and is named in the refusal. |
| `keywords` | Refused | A selection that is a list of plain values searches a whole log line, which a connection does not have. |
| `1 of, all of` | Refused | Write the selections out with `or` and `and`. |
| `\| count(), near, timeframe` | Refused | Aggregations need state across events. |
| `correlation, action, filter` | Refused | Correlation rules, collection actions and filter documents change other rules, and the subset compiles one rule at a time. |

<!-- END GENERATED SIGMA FIELDS -->

## Limits

- Nothing outside the network categories compiles. A rule set written mostly
  for endpoints is mostly refused, and `max_refused_share` is what decides
  whether that refuses the import.
- `Initiated` widens: the rule also fires on a connection to the same port the
  host did not open.
- A host name is matched against the domains the agent saw the destination
  address resolved from. A connection made to an address without a lookup the
  agent observed carries no host name and does not match a host name rule.
