# Proof for Regulated Estates

> **Edition: Critical**

## Overview

An entity under NIS2 or DORA is asked to show, not to state: that its controls
held on a given day, that the software in front of its nodes is the software
its vendor shipped, that the record it shows an auditor was not edited
afterwards, and, after an incident, a notification on time. Four licence
features answer those questions. Each states what it proves and where its proof
stops, because a control evidence pack that overstates itself fails the first
auditor who reads it closely.

| Feature | Where it runs | What it gives an auditor |
|---|---|---|
| `regulatory-notification` | the console | A NIS2 or DORA notification draft built from a case |
| `control-assurance` | the console, asking the agents | A dated record that each stated control held |
| `runtime-attestation` | the agent | Whether a node runs the bytes the release signed |
| `sealed-audit` | the console | Hourly seals showing whether the console's record was edited after the fact |

Everything stays on the customer's infrastructure. Nothing in this page reaches
the vendor, a CSIRT or a regulator on its own.

## Notification drafts

The console's `/api/v1/{tenant}/cases/{case_id}/notification?regime=nis2|dora` builds
the draft of a notification from what a [case](cases.md) holds: the first
observation, the affected assets, the acts recorded and their times, the
deadlines (NIS2 article 23: early warning at 24 hours, notification at 72
hours; DORA article 19: initial notification 4 hours after classification as
major, passed as `classified_at`). The fields only the entity can answer
(impact, cross-border effect, cause) are left marked as such.

It is **a draft, never a submission and never a verdict**: it does not decide
that an incident is significant, it does not reach any authority, and its
author remains the entity. The [incident evidence pack](../../compliance/incident-notification.md)
is the record it is built from.

## Proven controls

A tenant states its controls in the console configuration: a packet described
by its addresses, port and protocol, and the verdict expected of it
(`stopped` or `passes`), on every node or on named ones.

```yaml
tenants:
  - id: acme
    controls:
      - id: ssh-from-outside
        name: SSH from outside is refused
        packet: { src_ip: 198.51.100.7, dst_ip: 10.0.0.5, dst_port: 22, protocol: tcp }
        expect: stopped
        nodes: []
```

On every sample the console asks each node to trace that packet through the
rules it has loaded (`POST /api/v1/trace` on the agent). **No packet is sent**:
the trace walks the loaded rules, so a control is exercised without touching
production traffic. Each verdict is appended to a hash chain an auditor can
recompute, and the console's `/api/v1/{tenant}/controls/proof.json?from&to` downloads
the stretch of chain covering a period.

The chain **shows tampering; it does not prevent it**. A trace proves what the
loaded rules decide for that packet, not that every path to the node passes
through them.

## Attested nodes

`GET /api/v1/attestation/runtime` on the enterprise agent measures, on each
call, its own executable through `/proc/self/exe` and every file in the program
directory it loads kernel objects from, and looks each SHA-256 up in the
release measurements manifest. That manifest is dual-signed (Ed25519 and
ML-DSA-65) by the release key, never by a licence key, and both signatures are
verified on each reading. The verdict is `attested`, `deviates` (naming every
file the release did not ship) or `unverifiable` (no trusted manifest, with the
reason). The console's **Runtime attestation** screen reads every node of a
tenant and lists a node it could not ask rather than dropping it.

The files are measured on disk when asked, so a file swapped and swapped back
between two readings is not seen. A listed file proves where it came from, not
that it is configured soundly.

## Sealed record

Every hour the console seals the window just closed, per tenant: a SHA-256 of
the audit trail entries (actor, action, resource, source address), one of the
case events, and the head of the control chain, linked to the seal before.
Read again, each window **holds**, **differs** (an entry was changed, added or
removed since, and the screen names which record moved) or is **no longer held
whole**, in which case the seal stands on its own.

```yaml
sealing:
  timestamp_authority: https://freetsa.org/tsr   # null: no timestamp
```

Where an RFC 3161 authority is configured, each seal is timestamped by it. The
request **carries the seal's hash and nothing else**: no tenant, no event, no
name. The token downloads per seal (`/api/v1/{tenant}/audit/seals/{seq}/token.tsr`)
and the seals of a period with the chain that links them as a proof file
(`/api/v1/{tenant}/audit/seals/proof.json?from&to`). An auditor checks a token
against the authority's certificate:

```bash
openssl ts -verify -digest <seal hash> -in token.tsr -CAfile tsa-ca.pem
```

The seal is **tamper-evident, not tamper-proof**: it shows a record edited
after the fact, it does not prevent the edit. Without a timestamp authority the
seals rest on the console alone, and someone holding the history store could
rebuild the whole chain; the authority's token is what pins a seal to a time
outside the customer's reach. Two console replicas writing to one history store
would both seal each tenant and the chain would read as broken, so the sealing
console runs as one replica.

### Write-once copy under Object Lock

A seal in the history store can be rewritten by whoever holds the store. To
keep a copy nobody can rewrite, point the console at an S3 bucket created with
Object Lock enabled (AWS, Scaleway, OVHcloud, MinIO, Ceph):

```yaml
sealing:
  object_lock:
    endpoint: https://s3.fr-par.scw.cloud
    region: fr-par
    bucket: acme-sealed-record
    prefix: console
    path_style: false              # true for MinIO and Ceph
    access_key_id_file: /etc/dashboard/secrets/seal-copy-access-key
    secret_access_key_file: /etc/dashboard/secrets/seal-copy-secret-key
    mode: compliance               # or governance
    retain_days: 2557              # 1 to 36500
```

As each seal closes, the console writes it once to
`{prefix}/{tenant}/{seq}.json` with its timestamp token, a retention date
`retain_days` ahead and the lock mode. The object carries the tenant, the
seal's digests, counts and links, and the token; **never an audit entry or a
case event**. Under `compliance` nobody, the bucket's root account included,
can delete the copy or shorten its retention before it ends; under
`governance` an account granted `s3:BypassGovernanceRetention` still can. The
key pair needs `s3:PutObject` and `s3:PutObjectRetention` on the prefix and
nothing else.

A copy the bucket refused (no Object Lock on the bucket, a wrong key, the
endpoint out of reach) leaves the seal kept in the history store, and the seal
says why on the screen and in the proof file. The copy is **tamper-proof only
within its retention and only for what was copied**: a seal written before the
bucket was configured, or one the bucket refused, has no copy. An auditor
compares the bucket's objects with the proof file; a seal whose hash differs
from its copy was rewritten in the store.

The seals,
the controls and the trail are read by the roles holding `ViewAudit`: tenant
admin, admin and auditor.

## Licensing

Each capability is its own licence feature, carried by the Critical tier, so a
key sold before them grants none of them. The console reads the features from
the tenant's agents: a tenant none of whose agents carries the feature gets a
`403` naming it, and the console screens say so rather than showing an empty
record. See [License](license.md).
