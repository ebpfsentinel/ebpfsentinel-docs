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
