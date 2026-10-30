# Hunting

> **Edition: Enterprise** - a screen of the [dashboard](dashboard.md), read from
> its ClickHouse history store.

## Overview

Entity pages and [cases](cases.md) answer the questions the product expected.
Hunting answers the others: a short query over the tenant's alerts, forensic
events and flows, run on the server inside the same tenant scope as every other
screen. An analyst never reaches ClickHouse directly and never needs to.

A hunt is never trusted to scope itself. The language has no word for a tenant,
so no query can name one; the server binds the tenant of the session ahead of
the query's own condition, in parentheses, and every value a query carries
travels as a bound parameter rather than as SQL text. Each run is audited with
its author, its query and its outcome.

## The language

```text
query := "from" source ["where" expr] ["count" "by" field {"," field}] ["limit" number]
expr  := and {"or" and}
and   := unary {"and" unary}
unary := "not" unary | "(" expr ")" | field test
test  := ("=" | "!=" | "<" | "<=" | ">" | ">=") value
       | "in" "(" value {"," value} ")"
       | "contains" string | "startswith" string | "within" string
```

Three sources can be read:

| Source | What it holds |
|--------|---------------|
| `alerts` | Every alert the agents raised |
| `forensic` | Forensic events and context freezes |
| `flows` | Flow records |

| Field | Kind | Sources |
|-------|------|---------|
| `agent`, `src_ip`, `dst_ip`, `src_port`, `dst_port`, `protocol` | text, address or port | all three |
| `cluster`, `payload` | text | `alerts`, `forensic` |
| `severity`, `component`, `rule_id`, `src_country`, `mitre_tactic`, `mitre_technique` | text | `alerts` |
| `event_type` | text | `forensic` |
| `bytes`, `packets` | number, both directions summed | `flows` |

Ordering comparisons apply to numbers only. `within` takes an address range,
`"10.0.0.0/8"` or `"fd00::/8"`, and applies to the two address fields.
`contains` and `startswith` apply to text. A field a source does not carry is
refused rather than read as empty.

```text
from alerts where severity in ("high", "critical") and not src_ip within "10.0.0.0/8"
from flows where dst_port = 22 and bytes > 1000000 count by src_ip, dst_ip
from forensic where event_type = "exec" and payload contains "curl" limit 100
```

Without `count by`, a hunt answers the matching rows, newest first. With it,
the hunt answers one row per combination of the named fields with its count,
largest first.

## Limits

| Limit | Value |
|-------|-------|
| Query length | 2000 characters |
| Conditions | 32 |
| Nesting depth | 16 |
| Values in one `in` | 100 |
| Length of one string | 512 characters |
| Fields in `count by` | 3 |
| Rows answered | 500 by default, at most 10000 through `limit` |
| Window | required, at most 31 days |
| Execution time | 10 seconds, enforced by ClickHouse itself |
| Hunts in flight | 2 per operator |
| Exports | 1 per operator every 10 seconds |

A limit reached is a refusal that names it, never a silent truncation: a query
the parser rejects answers 400 with the reason and the position in the query,
which the screen draws under the line it points at. A third hunt while two are
running answers 429 `busy`, an export too soon after the last one answers 429
`rate_limited`, and a hunt past its time answers 504 `timeout`. An answer that
filled its row limit says it was truncated.

## Results

Rows are drawn as a table whose agents and addresses open their
[entity page](../../operations/entity-investigation.md). Picking alerts in the
answer opens a case over them, so a hunt ends in an investigation rather than in
a spreadsheet. The answer can still be downloaded as CSV or JSON: the export
runs the same query under the same limits, so a file never holds more than the
analyst was shown, and it is audited apart from the run.

## Saved and scheduled hunts

A query worth keeping is saved under a name, at most 80 characters, and is
shared with everyone in the tenant who may hunt. The library holds at most 100
hunts per tenant. Picking a saved hunt fills the query box with it; saving again
changes that hunt, and **Save as new** keeps a second one.

A saved hunt runs by hand, or by itself every 1, 6 or 24 hours. The scheduler
checks every five minutes which hunts are due and runs each one over the time
since its last run, so two runs never read the same rows twice. A scheduled run
goes through the same parser, tenant binding and limits as a hunt typed on the
screen, and is audited under the scheduler with the hunt's author beside it.
What it found, or why it was refused, is recorded on the hunt and shown on its
row. When it returns rows, the tenant's notification inbox gets one entry
naming the hunt, the count and the window, which is what turns a question into
detection content the tenant wrote itself.

A hunt changed or removed while it was running keeps what it had: the result
answered a query nobody keeps any more and is not written back.

## Access

Running, exporting and keeping hunts takes the analyst role or above. Every run,
export, save, change and removal is written to the audit log.

## Storage

Hunting reads the history store and saved hunts live in it, so without one the
routes answer 503 with `{"reason":"history_store_disabled"}` and the scheduler
runs nothing. See [Dashboard configuration](../../configuration/dashboard.md).

## REST API

| Route | What it does |
|-------|--------------|
| `POST /api/v1/{tenant}/hunts/query` | Run a hunt over `from` and `to` |
| `POST /api/v1/{tenant}/hunts/export` | The same hunt as a CSV or JSON file |
| `GET /api/v1/{tenant}/hunts/saved` | The tenant's saved hunts, by name |
| `POST /api/v1/{tenant}/hunts/saved` | Save a hunt |
| `PUT /api/v1/{tenant}/hunts/saved/{hunt_id}` | Change a saved hunt |
| `DELETE /api/v1/{tenant}/hunts/saved/{hunt_id}` | Remove a saved hunt |

Every route is described in the dashboard's own route table in
[Dashboard configuration](../../configuration/dashboard.md#route-surface).
