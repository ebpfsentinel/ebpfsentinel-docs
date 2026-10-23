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

Two figures are read from the cases, the time to acknowledge and the time to
resolve, and a false positive can set its kind aside until a date, so the
queue gets shorter instead of raising the same alert again an hour later.

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

## Suppressions

Marking an alert a false positive is a judgement on that alert. What made it
noisy usually raises the next one too, so the same press offers to suppress
it for a while: the alert screen opens a short form naming the four things a
suppression can match, each with the value this alert carries.

| Field | What it matches |
|-------|-----------------|
| Rule | The rule identifier that raised the alert. |
| Source | The source address. |
| Destination | The destination address. |
| Workload | The workload the alert was attributed to: `namespace/pod` for a pod, otherwise the container, the systemd unit or the executable. |

The rule and the source are ticked by default; any combination may be picked,
and an alert is suppressed only when every picked field matches. The expiry
is required, one, seven, thirty or ninety days out, and the server refuses one
in the past or more than ninety days away, so no suppression outlives the
reason it was made. A note of at most 1000 characters is optional. The alert
is marked first and the suppression recorded after, so a mark the agent
refuses never leaves an unjudged alert hidden; **Mark this alert only** keeps
the old single gesture.

Nothing is dropped. The alerts queue leaves suppressed alerts out by default
and counts them on a button that shows them again, each with a badge, and the
alert screen says which suppression sets the alert aside and until when. A
suppression is matched in the browser against the alerts the agents already
returned, so it changes what the queue shows and never what an agent detects,
records or exports.

The **Suppressions** screen lists every suppression of the tenant, the ones
in force first and the soonest to lapse on top, with what it matches, its
end, who made it and the note. One that lapses within 24 hours is marked
expiring, and both that screen and the alerts queue say so a day ahead, so
the alerts it held back coming back into the queue surprise nobody. A
suppression can be lifted before its expiry; a lifted or expired one stays in
the list as the record of what was decided. A tenant holds at most 500
suppressions in force at once.

## What a case is not

A case holds the alerts this product raised, on the agents this console
reaches. It is not an orchestration platform: no playbook runs from a case, no
ticket is opened in another system, and the queue does not span the other
security products you own. Where that is the need, the
[response webhooks](automated-response.md) start someone else's playbook, and
the case stays the record of what was found here.

## Storage

The case log is one append-only ClickHouse table, `case_events`, with one row
per change. A case's state is folded from its rows on every read, so the
timeline shown is the log itself rather than a history kept beside a current
value. Nothing updates or deletes a row, and the nightly retention purge does
not reach this table: how long a case is kept is the operator's decision.

Suppressions are kept the same way, in `suppression_events`: one row when a
suppression is made and one when it is lifted, with expiry read from the
timestamp it carries rather than written by a job. The retention purge does
not reach this table either.

Without a history store there is nowhere to keep a case, and every case and
suppression route answers 503 with `history_disabled`; the alerts queue keeps
working, with its case column empty, the alert screen offering no case to
open, and the false-positive press marking the alert alone.

## Access

Every role in a tenant reads its cases and its suppressions. Opening,
changing, annotating and collecting evidence, and making or lifting a
suppression, need the analyst role or above. Neither crosses a tenant: an
identifier from another tenant reads as 404.

## REST API

The routes are served by `dashboard-server`, not by the agent, and are listed
with the rest of the server's surface in
[Dashboard configuration](../../configuration/dashboard.md#route-surface).
