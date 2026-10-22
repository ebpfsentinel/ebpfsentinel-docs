# Threat Intelligence Platforms

> **Edition: Enterprise**

## Overview

An estate that already pays for intelligence has it somewhere: a TAXII 2.1
collection at a national CERT, a MISP instance the team curates, or both. The
agent matches on addresses, domains, URLs and JA4 fingerprints in the datapath,
so the only thing standing between a feed and enforcement is the import.

This feature is that import. Each configured collection or instance is a source
with its own interval, its own bound, its own counters and its own resume
marker, polled on a schedule, mapped onto the matcher that can act on it, and
reported per poll in terms of what was taken and what was refused.

Nothing is fetched on request. A poll happens on the interval the configuration
sets, and the two routes below read what the last poll did: a route that forced
a fetch would be a way to make this agent reach a third party on a stranger's
schedule.

## What an Indicator Reaches

<!-- BEGIN GENERATED INTEL OBJECTS -->

| STIX object | Indicator kind | What matches it |
|-------------|----------------|-----------------|
| `ipv4-addr` | `ipv4` | Address-keyed threat intelligence map, matched in the TC path (`threat-intel-map`) |
| `ipv6-addr` | `ipv6` | Address-keyed threat intelligence map, matched in the TC path (`threat-intel-map`) |
| `domain-name` | `domain` | DNS blocklist, matched on every query the capture path reads (`dns-blocklist`) |
| `url` | `url` | L7 URL rules, matched on every request the L7 path parses (`l7-url-rules`) |
| `file` | `file-hash` | Nothing. Counted and reported, stored in no matcher |
| `x-ja4` | `ja4` | JA4 fingerprint list, matched by the TLS intelligence engine (`tls-fingerprints`) |

An indicator type the engine cannot act on is reported as not actionable at import rather than stored as if it were doing something: `file-hash` is counted per poll, named on the screen and in `GET /api/v1/intel/indicators`, and matched by nothing.

<!-- END GENERATED INTEL OBJECTS -->

The table is generated from the agent's own mapping, and the same mapping
answers `GET /api/v1/intel/indicators`, so the screen, this page and the engine
cannot disagree about what a count covers.

## What a Source Carries

Every imported indicator keeps three things it arrived with, and they are what
the threat listing already renders for the shipped JA4 entries:

| Field | What it holds |
|-------|---------------|
| Source | The identifier the configuration gave the collection or the instance, never a guess at the upstream publisher |
| Last confirmed | When the platform last stood behind it, taken from the object's own timestamp |
| Kind | Which of the kinds above it is, which decides the matcher it went to |

A MISP attribute additionally carries its event identifier, so a match leads
back to the event an analyst can read rather than to a bare value.

An indicator that cannot account for all three is not imported: it is counted
as malformed in the poll's report. That is the same rule the shipped
fingerprints are held to, and it is the reason a count on this screen can be
quoted.

## Polling

| Setting | Default | Bounds |
|---------|---------|--------|
| Interval per source | 900 s | 60 s to 86400 s, clamped rather than refused |
| Indicators imported per source | 100000 | Whatever the configuration sets. It is a bound on what this source has imported since the agent started, and past it an indicator is refused and reported as capped rather than displacing one already in a matcher |
| Minimum confidence per source | 0 | 0 to 100, compared against the platform's own figure |
| Pages per poll | 64 | TAXII reads 500 objects a page, MISP 1000 attributes |

A source that fails keeps the indicators it already imported. Its interval is
stretched up to eight times while it keeps failing, and a credential this agent
re-reads from a file means a rotation heals the source without a restart.

## The REST Surface

License feature: `threat-intel-platforms`. Mounted only where the configuration
carries an enabled `intel` block, so an agent with the feature and no block
serves neither route.

| Method | Path | Role | Grant | License feature | Description |
|--------|------|------|-------|-----------------|-------------|
| `GET` | `/api/v1/intel/sources` | viewer | `threatintel:read` | threat-intel-platforms | One entry per configured source: platform, interval, last attempt, last success, next attempt, consecutive failures, last error, indicators held, resume markers, and what the last poll took and refused. |
| `GET` | `/api/v1/intel/indicators` | viewer | `threatintel:read` | threat-intel-platforms | Counts by kind and by source, the supported-object table above, and the kinds that reach no matcher with the sentence that says so. |

Both are read-only and neither starts a poll.

## Configuration

The block, the fields and every refusal are in
[enterprise configuration](../../configuration/enterprise.md#threat-intelligence-platforms).
The working configuration for each platform, and what it needs on the other
side, is on its own page:

- [TAXII 2.1 collections](../../integrations/taxii.md)
- [MISP instances](../../integrations/misp.md)

## What This Is Not

- **Not a replacement for the content channel.** The channel delivers what we
  curate and sign; this reads what the estate already subscribes to. An estate
  can run both, and the provenance on every row says which is which.
- **Not a writer.** Nothing is published back to a platform, and there is no
  route that would. Publishing to MISP would make the agent a writer to a
  system it does not own.
- **Not a file scanner.** A hash is read, counted and reported, and matched by
  nothing: this agent sees packets.
- **Not an outbound exception.** A poll is the agent reaching a host the
  configuration names. Under air-gap enforcement the purpose is permitted and
  the destination still has to be allowed.
