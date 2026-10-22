# TAXII 2.1 Collections

> **Edition: Enterprise.** Licence feature `threat-intel-platforms`.

The agent is a TAXII 2.1 client. It discovers the collections a credential can
read, polls each one on its own interval, resumes from where it stopped across
restarts, and reports per poll what it took and what it refused.

## The agent side

```yaml
enterprise:
  intel:
    enabled: true
    marker_path: /var/lib/ebpfsentinel/intel-markers.json
    taxii:
      - id: cert-eu
        discovery_url: https://taxii.cert.example/taxii2/
        collections: []
        auth: basic
        username: ebpfsentinel
        secret_file: /etc/ebpfsentinel/taxii-cert-eu
        interval_seconds: 900
        max_indicators: 100000
        min_confidence: 50
```

`id` is what every marker, counter and indicator provenance is keyed on, so it
is stable across restarts: renaming it re-reads the collection from the start.
`collections` empty is every collection discovery says this credential can
read; naming them polls those and ignores the rest.

`marker_path` is one small file holding the resume marker per collection. It
belongs on the same persistent volume as the rest of the agent's state: losing
it costs a full re-read, which the server pays for as much as this agent does.

Credentials are read from files rather than written into the configuration, so
a credential is not in the file an operator pastes into a ticket and a rotation
is a file write rather than a restart. `auth` is one of `none`, `basic` or
`bearer`, which are the schemes the standard defines; anything else is refused
at boot, and a scheme other than `none` with no `secret_file` is refused too.

## What is polled, and how often

| Behaviour | What the agent does |
|-----------|---------------------|
| Discovery | `GET` on the discovery URL, then the API roots and their collections, each poll, so a collection added upstream is picked up without a restart |
| Pagination | 500 objects a page, up to 64 pages in one poll; what is left waits for the next one |
| Resume | `added_after` set to the marker the collection last served, held monotonic so a server answering with an older timestamp cannot rewind the collection |
| Interval | `interval_seconds`, held between 60 and 86400 |
| Failure | The interval is stretched up to eight times while polls keep failing, and the indicators already imported are kept |

A collection that disappears upstream stops contributing, keeps what it already
imported, and says so on the screen and in `GET /api/v1/intel/sources`.

## What is read out of a bundle

Only a STIX `indicator` is imported, because an indicator is the object that
claims something is malicious. An observable served on its own is counted as
`no-claim` and stored nowhere: nothing in a bare `ipv4-addr` says the address
is hostile, and holding it would invent a claim the publisher did not make. The
context objects a bundle carries alongside - an identity, a marking definition,
a malware or a relationship - are skipped without being counted, because
counting them as refusals would bury the refusals an operator can act on.

The objects an indicator's pattern may name, and the matcher each one reaches,
are these.

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

A pattern is read rather than guessed at. The accepted subset is one or more
observation expressions joined by `OR`, each holding comparisons joined by
`OR`, each comparison an exact `=` or an `IN` over a tuple of values. These are
the properties a comparison may name.

<!-- BEGIN GENERATED INTEL STIX PROPERTIES -->

| Pattern property | Indicator kind |
|------------------|----------------|
| `ipv4-addr:value` | `ipv4` |
| `ipv6-addr:value` | `ipv6` |
| `domain-name:value` | `domain` |
| `url:value` | `url` |
| `file:hashes.md5`, `file:hashes.sha-1`, `file:hashes.sha1`, `file:hashes.sha-256`, `file:hashes.sha256` | `file-hash` |
| `x-ja4:value`, `x-ja4-fingerprint:value`, `network-traffic:extensions.ja4-ext.ja4` | `ja4` |

<!-- END GENERATED INTEL STIX PROPERTIES -->

Everything outside that subset is refused with the pattern quoted in the poll's
report, never approximated:

```text
[ipv4-addr:value = '198.51.100.7' AND network-traffic:dst_port = 443]
```

That pattern constrains one object by two properties, so neither comparison on
its own is the indicator: taking the address out of it would store something
the publisher did not claim. The same holds for a qualifier such as `WITHIN`,
`REPEATS` or `START`, which bounds when the pattern holds, and for observations
joined by `AND` or `FOLLOWEDBY`, which describe a sequence.

The JA4 extension has no registered STIX object. The three spellings seen in
the wild are read, and the table above names them.

## Checking it from the agent

```bash
curl -s -H "X-API-Key: $KEY" https://agent:8444/api/v1/intel/sources | jq '.sources[] | {source_id, last_success, consecutive_failures, indicators_held, taken: .last_poll.taken}'
```

A source with `consecutive_failures` above zero and a non-null `last_error` is
the first thing to read: the error is what the server or the transport said.
`last_poll.ignored` counts by reason and `last_poll.details` keeps the refused
patterns, bounded at 64 per poll and flagged as truncated past that, which is
where a collection serving patterns this agent will not evaluate becomes
visible rather than quietly contributing nothing.

| Reason | What it means |
|--------|---------------|
| `no-claim` | The object is an observable on its own, with no indicator claiming it is malicious |
| `pattern-not-evaluable` | The patterning is outside the subset above, and the pattern is quoted in `details` |
| `unsupported-object` | The object type is not one the importer reads |
| `not-actionable` | The type is understood and no matcher in this agent can act on it |
| `expired` | The source marked the indicator as no longer valid |
| `below-confidence` | The confidence is under this source's `min_confidence` |
| `malformed` | The value is not a well formed value of its kind |
| `capped` | This source's `max_indicators` was reached before the object was read |

```bash
curl -s -H "X-API-Key: $KEY" https://agent:8444/api/v1/intel/indicators | jq '{by_kind, not_actionable}'
```

## What the other side needs

- **TAXII 2.1**, not 2.0 or 1.x. Every request asks for and sends
  `application/taxii+json;version=2.1`, and reads the 2.1 shapes: the API roots
  of the discovery document, a collection list, and an envelope paged by `more`
  and `next`. A 2.0 server answers something else, and the poll reports that
  rather than guessing.
- **HTTPS.** Plain HTTP is refused before a socket exists unless the address is
  loopback, and no redirect is followed at all: a `302` is the far end choosing
  the next address for us.
- **A read credential** scoped to the collections this agent should see.
  Nothing this agent does needs write access to a collection.
- **A clock.** `added_after` is the server's own timestamp, so a server whose
  clock jumps backwards serves objects this agent has already read, which costs
  bandwidth and changes nothing.

## What is not here

Nothing is published back. There is no route and no configuration that would
post an object, a sighting or an opinion to a collection, because that would
make the agent a writer to a platform it does not own.
