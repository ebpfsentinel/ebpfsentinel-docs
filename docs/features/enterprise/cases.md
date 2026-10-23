# Cases

> **Edition: Enterprise** - a screen of the [dashboard](dashboard.md), kept in its
> ClickHouse history store.

## Overview

An alert says one thing happened. An incident is several of them, judged
together by somebody who owns the outcome. A case is that judgement written
down: the alerts it holds, who holds it, how far along it is, how bad it was
found to be, and a timeline of every act on it in the order it happened.

The queue and the case are one surface. Opening a case takes its alerts out of
the unhandled rows, each alert names the case holding it, and an analyst can
hide the alerts already in a case to see only what nobody has picked up.

## Opening a case

From the alerts queue, pick alerts and open a case over them. From one alert,
open a case around it, or add it to a case already being worked. The grouping
records why these alerts were put together:

| Grouping | Meaning |
|----------|---------|
| `selection` | The alerts an analyst picked by hand |
| `host` | One agent |
| `address` | One remote address |
| `workload` | One container or process |
| `mitre_chain` | Steps of one MITRE ATT&CK chain |

An alert belongs to at most one case. Opening or adding an alert another case
already holds is refused with 409 and names that case, so two analysts never
work the same alert under two titles without knowing it.

Limits: a title or an owner is at most 200 characters, a note at most 4000, a
request adds at most 100 alerts, and a case holds at most 500.

## Working a case

| Field | Values |
|-------|--------|
| Status | `open`, `investigating`, `contained`, `closed` |
| Severity | `low`, `medium`, `high`, `critical` |
| Owner | An operator's identity, or nobody |

A change records only the fields that actually moved, so the timeline carries
no entry for a status set to the status it already had. Notes are appended,
never edited.

## Evidence

Collecting evidence asks each agent behind the case's alerts for the context
freezes and packet captures it holds about them, and records them on the case:
an outcome and event count for a freeze, and for a capture its SHA-256, its
position in the capture chain and its chain tag, so the file downloaded later
can be checked against what the case recorded. Collection reads; it starts no
capture. See [Network forensics](network-forensics.md).

## Evidence pack

The evidence pack reads one case against the two deadlines an incident
notification is written to, 24 and 72 hours after the first observation. The
first observation is the earliest alert the case holds, and both marks are
always shown: a mark by which nothing was known or done is listed as empty
rather than left out, since an empty interval is part of what a notification
has to say.

For each mark the pack lists the alerts observed, the acts recorded on the
case and the evidence attached before it. Beside the marks it lists the
assets involved (agents, workloads, addresses), the flows the alerts name with
when each was first and last seen, every act with who did it, and every freeze
and capture with its digest and chain position. Each line names the record it
was read from, `alert:`, `case_event:`, `freeze:` or `capture:`, so any figure
can be traced back to the alert or the log row behind it.

What the case does not hold is listed under gaps rather than left for the
reader to notice: no alert, no owner, no evidence, an alert with no evidence
or no flow, an alert observed before the 24 hour mark but added after it, a
case opened after a deadline, a deadline passed with nothing recorded, a
capture that cannot be verified and a freeze that failed.

The pack is computed from the case log and never from the clock: its `as_of`
is the latest moment the case's records name, so reading the same case twice
gives the same pack. It is evidence a CRA or NIS2 notification can be written
from. It is not the notification, and it does not make anyone compliant.

### Export

The pack screen downloads the pack as a PDF to file beside a notification and
as JSON for a tool. The JSON file is the pack as the API answers it. The PDF
lays out the same content on A4 pages, every line with the record it was read
from, every capture with its SHA-256 and audit chain position, and states the
SHA-256 of the JSON export of the same pack, so the document a person reads
can be checked against the file a tool holds.

Both are generated from the pack alone. The PDF carries no creation date and
its document identifier is the case and the `as_of` moment, so two exports of
the same case log are the same file, byte for byte, and a digest taken of one
holds for the other.

## Response times

The **Response times** screen, reached from the cases list, reads two figures
over the cases first observed in the window picked at the top of the screen:
the mean time to acknowledge and the mean time to resolve, each with its
median and the number of cases it was taken over. Every case counted is listed
below them with its own two times, and the case screen states both for the
case in hand. Nothing is stored for them: they are read from the timestamps
the case log already holds, on every request.

The clocks are written on the screen, because the same two words mean
different things from one product to the next:

| Clock | What it is |
|-------|------------|
| Start | The first observation: the earliest `occurred_at` of any alert the case was ever given, including one taken out of it since. A case that never held an alert has no start and is not counted. |
| Acknowledged | The first act saying somebody took the case: an owner set, or the status moved past open. Opening a case or adding a note is not one. |
| Resolved | The closure the case stands at: the last move to closed, on a case that is closed now. Contained does not stop the clock, and a reopened case is unresolved again until it is closed once more. |
| Still running | A case not yet acknowledged or not yet resolved is counted apart, as pending, and never averaged in. An act recorded before the alert it answers counts as zero rather than as a negative duration. |

A case belongs to a window when its first observation falls inside it, the
start included and the end excluded, so two adjacent windows never count one
case twice. A figure over no stopped clock reads as none measured, never as
zero.

## Storage

The case log is one append-only ClickHouse table, `case_events`, with one row
per change. A case's state is folded from its rows on every read, so the
timeline shown is the log itself rather than a history kept beside a current
value. Nothing updates or deletes a row, and the nightly retention purge does
not reach this table: how long a case is kept is the operator's decision.

Without a history store there is nowhere to keep a case, and every case route
answers 503 with `history_disabled`; the alerts queue keeps working, with its
case column empty and the alert screen offering no case to open.

## Access

Every role in a tenant reads its cases. Opening, changing, annotating and
collecting evidence need the analyst role or above. Cases never cross a tenant:
a case identifier from another tenant reads as 404.

## REST API

The routes are served by `dashboard-server`, not by the agent, and are listed
with the rest of the server's surface in
[Dashboard configuration](../../configuration/dashboard.md#route-surface).
