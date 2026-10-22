# MISP Instances

> **Edition: Enterprise.** Licence feature `threat-intel-platforms`.

MISP is the platform most CERT-connected teams in Europe actually run, and its
attributes are already the estate's own curation. The agent pulls them through
the MISP API, maps each attribute onto the matcher that can act on it, and
attributes every indicator to the event it came from, so a match leads back to
something an analyst can open.

## The agent side

```yaml
enterprise:
  intel:
    enabled: true
    marker_path: /var/lib/ebpfsentinel/intel-markers.json
    misp:
      - id: house-misp
        base_url: https://misp.internal.example
        key_file: /etc/ebpfsentinel/misp-key
        tags: ["tlp:amber", "type:OSINT"]
        distribution: [1, 2, 3]
        published_only: true
        interval_seconds: 1800
        max_indicators: 100000
        min_confidence: 30
```

`id` is what every marker, counter and indicator provenance is keyed on, so it
stays stable across restarts. `base_url` is the instance address without a
path. The API key is read from `key_file` on every request rather than held in
memory, so rotating the key heals the source without a restart, and an empty
file is reported as a misconfiguration rather than as an authentication
failure.

A filter left out of the configuration is not sent, which leaves the instance
applying its own default - the instance owner's decision rather than this
agent's.

| Filter | Effect |
|--------|--------|
| `tags` | Only attributes carrying one of these tags. Empty sends no tag filter |
| `distribution` | Only attributes at one of these distribution levels, 0 to 4. Empty sends none |
| `published_only` | Restricts the pull to published events |
| `min_confidence` | Compared against the confidence below, after the instance has answered |

## How the pull works

The search is `POST /attributes/restSearch`, which returns attributes rather
than whole events: an event may hold thousands of attributes, and asking for
events to reach them would download most of the instance to find the handful
that changed. Each page asks for 1000 attributes, up to 64 pages in one poll,
and the `timestamp` filter carries the resume marker so the next poll reads
what changed since the last one. The marker is held monotonic, so an instance
answering with an older timestamp cannot rewind the source.

Both answer shapes are read: a flat attribute list, and the event-wrapped form
where attributes sit under `Event.Attribute`.

## What an attribute becomes

<!-- BEGIN GENERATED INTEL MISP ATTRIBUTES -->

| MISP attribute type | Indicator kind |
|---------------------|----------------|
| `ip-src`, `ip-dst`, `ip`, `ip-src\|port`, `ip-dst\|port` | `ipv4`, `ipv6` |
| `domain`, `hostname` | `domain` |
| `domain\|ip` | `ipv4`, `ipv6`, `domain` |
| `url`, `uri` | `url` |
| `md5`, `sha1`, `sha256` | `file-hash` |
| `filename\|md5`, `filename\|sha1`, `filename\|sha256` | `file-hash` |
| `ja4`, `ja4-fingerprint` | `ja4` |

<!-- END GENERATED INTEL MISP ATTRIBUTES -->

A composite type carries two values in one string, and the half this engine can
act on is taken while the other half is not invented: `domain|ip` gives both,
`filename|md5` gives the hash, and `ip-dst|port` gives the address. Whether an
address is v4 or v6 is decided by reading it rather than by the type name.

`ja3-fingerprint-md5` is deliberately absent. The TLS path matches JA4, so a
JA3 hash stored in a JA4 list would be an indicator that can never fire, which
is worse than not importing it.

| Attribute field | What it becomes |
|-----------------|-----------------|
| `to_ids` | The confidence: 75 where the publisher marked the attribute fit for automatic detection, 30 where it is kept as context. MISP states no confidence per attribute, and this flag is the closest thing it does state |
| `timestamp` | The indicator's last-confirmed date, which the screen renders beside it. An attribute with no readable timestamp is counted as malformed rather than dated today |
| `event_id` | The provenance reference, stored as `event-<id>`, which is how a match leads back to the event |
| `Event.info` | The indicator's name, falling back to the attribute's category and then to its type |
| `Tag`, `category` | What the threat is about. The tags are read first, because a galaxy or taxonomy tag is what an analyst actually set while the category is a container the attribute was filed in |
| `deleted` | A soft-deleted attribute is counted as expired and stored nowhere |

## Checking it from the agent

```bash
curl -s -H "X-API-Key: $KEY" https://agent:8444/api/v1/intel/sources | jq '.sources[] | select(.platform == "misp")'
```

`indicators_held` is what this source currently accounts for, kept across a
failure, and `last_poll.ignored` counts by reason. Two of those reasons are
worth reading on a MISP source in particular: `below-confidence` is usually a
`min_confidence` above 30 filtering out everything not marked `to_ids`, and
`unsupported-object` is an attribute type this engine has no matcher for.

## What the other side needs

- **An automation key** with read access to the events this agent should see.
  Nothing here needs write access.
- **HTTPS.** Plain HTTP is refused before a socket exists unless the address is
  loopback, and no redirect is followed at all.
- **A sensible distribution model.** The filters above are the instance's own,
  so the fastest way to scope what an agent imports is a dedicated key and the
  event distribution the instance already enforces.

## What is not here

**Publication back to MISP is out of scope.** The agent creates no event, adds
no attribute and posts no sighting, and there is no configuration that would
turn that on. A detection this agent makes belongs to the estate that runs it;
writing it into a platform we do not own would put our vocabulary into somebody
else's record, and an operator who wants that has the alert stream, the SIEM
exporters and the MISP API in front of them.
