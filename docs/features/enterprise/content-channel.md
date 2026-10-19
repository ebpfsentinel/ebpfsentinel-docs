# Content Channel

> **Edition: Enterprise**

## Overview

A subscription does not only unlock code: it delivers content. Detection rules,
data patterns, client fingerprints, provider definitions and trained models all
change faster than a release does, and an estate that upgrades once a quarter
should still be detecting what appeared last week.

The channel delivers five typed content sets in one versioned bundle, each set
carrying its own version, its own provenance and the oldest agent version that
can read it. Every bundle is signed, and the agent verifies the signature before
a single file is applied, because content that arrives over the wire and changes
what the agent matches on is a remote code path in all but name.

Content is included with every paid plan from Professional upward. It is not an
add-on, there is no per-set price, and there is no metered unit: the only thing
the channel measures is what was fetched and when.

## What the Channel Delivers

| Set | Identifier | What it carries |
|-----|-----------|-----------------|
| IDS rules | `ids-rules` | Signature patterns the intrusion detection engine matches, with severity and classification |
| DLP patterns | `dlp-patterns` | Regular expressions and validators for structured secrets and personal data |
| JA4 fingerprints | `ja4-fingerprints` | Known client and server TLS fingerprints, with the software each one belongs to |
| AI providers | `ai-providers` | Hostnames, API shapes and model names of AI services, for the AI security module |
| ML models | `ml-models` | Trained detector weights for the machine learning module |

A set the licence does not entitle is not served, and a set this build is too
old to read is skipped rather than applied: the agent keeps what it already has
and says so. Nothing in the bundle is executable and nothing in it is a
configuration change: a bundle can never turn a module on, change an
enforcement mode, or name a destination the agent will talk to.

## Bundle Layout

A bundle is a directory, which is also what the tarball expands to:

```text
ebpfsentinel-content-<bundle version>/
├── content-manifest.json
├── content-manifest.sig
└── content/
    ├── ids-rules/rules.json
    ├── dlp-patterns/patterns.json
    ├── ja4-fingerprints/fingerprints.json
    ├── ai-providers/providers.json
    └── ml-models/<model>.bin
```

Three rules hold the layout together and each one is enforced rather than
documented:

1. Every file under `content/` is listed in the manifest, and every file the
   manifest lists exists under `content/`. A bundle where the two disagree in
   either direction is refused whole.
2. A set's files live under `content/<set identifier>/` and nowhere else. A path
   that is absolute, that climbs with `..`, that carries a backslash or that
   names a different set is refused before anything is read.
3. The signature covers `content-manifest.json` byte for byte, and the manifest
   covers every file by SHA-256. There is no per-file signature to get out of
   step with the manifest, and no file outside the manifest's reach.

## The Manifest

```json
{
  "schema": "ebpfsentinel.content/v1",
  "bundle_version": 142,
  "published_at": "2026-10-19T09:00:00Z",
  "sets": [
    {
      "kind": "ids-rules",
      "version": 118,
      "published_at": "2026-10-18T22:14:00Z",
      "minimum_agent_version": "1.4.0",
      "entries": 1842,
      "provenance": {
        "origin": "ebpfsentinel-research",
        "licence": "CC-BY-4.0",
        "revision": "9f2c1ab"
      },
      "files": [
        {
          "path": "content/ids-rules/rules.json",
          "sha256": "4f1c8a0e2d7b6594a3c1e8f0b2d4a6c8e0f2a4b6c8d0e2f4a6b8c0d2e4f60718",
          "bytes": 482913
        }
      ]
    }
  ]
}
```

| Field | Meaning |
|-------|---------|
| `schema` | `ebpfsentinel.content/v1`. A build that does not know the schema refuses the bundle rather than guessing which fields it recognises. |
| `bundle_version` | Monotonic counter for the bundle as a whole. An agent holding a higher one refuses a lower one. |
| `published_at` | When the bundle was cut, RFC 3339 in UTC. Shown to an operator, never used as a freshness gate on its own. |
| `sets[].kind` | One of the five identifiers above. A kind this build does not know is ignored, so adding a sixth set does not break an older agent. A kind appearing twice refuses the bundle. |
| `sets[].version` | Monotonic counter for that set alone. Sets move at their own pace, which is the point of versioning them separately. |
| `sets[].minimum_agent_version` | The oldest agent that can read this set, `major.minor.patch`. An older agent skips the set and keeps the version it has. |
| `sets[].entries` | How many rules, patterns, fingerprints, providers or models the set holds. An operator's number, not a checksum. |
| `sets[].provenance` | Where the content came from: `origin`, `licence`, `revision`, and an optional `note`. Published so a regulated estate can say what it is matching on and under what terms. |
| `sets[].files` | Every file in the set, with its path, its SHA-256 and its length in bytes. |

Unknown fields anywhere in the manifest are refused rather than ignored, so a
field somebody meant to be read cannot be silently dropped by a typo.

## The Signature

`content-manifest.sig` holds three base64 lines and nothing else:

```text
<the manifest bytes>
<Ed25519 signature>
<ML-DSA-65 signature>
```

Both signatures cover the same bytes, and both must verify. Ed25519 is what
verifies today; ML-DSA-65 is a post-quantum signature carried beside it so a
bundle signed now is still verifiable when the first one is no longer trusted.
This is the same envelope the measurements manifest and the offline licence
bundle use, verified by the same code in the same crate, because a second
implementation is a key that verifies in one place and not the other.

The public halves of the content signing pair are published in the release
repository under `policy/keys`, attached to every release and installed into
every Enterprise tarball. They are compiled into the agent at build time, so an
agent with no route to anywhere still verifies, and the keys never travel beside
the document they verify. The portal serves bundles and signs nothing.

### Verifying a Bundle by Hand

The agent's own check is one command and needs no network:

```bash
ebpfsentinel-enterprise-agent content import \
  --bundle /var/lib/ebpfsentinel/content/incoming \
  --verify-only
```

```text
Bundle version 142 verified; nothing was changed
```

Both signatures, the manifest, every digest and every length are checked before
that line is printed, and a refusal names what was wrong rather than saying the
bundle is invalid. Without `--verify-only` the same run applies what it verified
and says what happened to each set:

```text
Bundle version 142 verified
ids-rules: applied version 118
dlp-patterns: applied version 64
ja4-fingerprints: left alone (agent_too_old)
ai-providers: left alone (already_in_force)
ml-models: applied version 7
```

The licence tool verifies the same bundle without running an agent, and it is
the same library doing the checking:

```bash
ebpfsentinel-license verify-content \
  --bundle         ./ebpfsentinel-content-142 \
  --public-key     content-signing-ed25519.pub \
  --pq-public-key  content-signing-mldsa.pub
```

To do it with nothing but `openssl`, `base64` and `python3`:

```bash
cd ebpfsentinel-content-142

# 1. The signature file's first line is the manifest that was signed.
head -n 1 content-manifest.sig | base64 -d > signed-manifest.json
cmp signed-manifest.json content-manifest.json   # must be identical

# 2. The published key is a raw Ed25519 public key rather than a PEM file, so
#    wrap it: the twelve-byte prefix is the SPKI header for Ed25519 and is the
#    same for every key of that type.
{
  echo "-----BEGIN PUBLIC KEY-----"
  printf 'MCowBQYDK2VwAyEA%s\n' "$(cat content-signing-ed25519.pub)"
  echo "-----END PUBLIC KEY-----"
} > content-signing-ed25519.pem

# 3. The second line is the Ed25519 signature over those bytes.
sed -n '2p' content-manifest.sig | base64 -d > manifest.ed25519.sig
openssl pkeyutl -verify \
  -pubin -inkey content-signing-ed25519.pem \
  -rawin -in content-manifest.json \
  -sigfile manifest.ed25519.sig

# 4. Every file the manifest lists hashes to what the manifest says.
python3 - <<'PY'
import hashlib, json, pathlib
manifest = json.loads(pathlib.Path("content-manifest.json").read_text())
for content_set in manifest["sets"]:
    for entry in content_set["files"]:
        data = pathlib.Path(entry["path"]).read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        state = "OK" if digest == entry["sha256"] and len(data) == entry["bytes"] else "MISMATCH"
        print(f"{state} {entry['path']}")
PY
```

Step 4 is not optional ceremony: the signature covers the manifest, and the
manifest is what covers the files. Checking the signature and not the digests
proves the list was not altered and says nothing about what is beside it. The
agent checks both directions, and so should a hand check - a file listed and
absent, and a file present and unlisted.

The ML-DSA-65 signature has no `openssl` equivalent on most distributions yet,
which is why `verify-content` or the agent's own `--verify-only` run is the
check that covers both, and why a hand check with `openssl` alone is half of
one. Every bundle also carries `content-manifest.cosign.bundle`, a keyless
signature over the same manifest bytes, for an estate that already verifies our
releases with `cosign`:

```bash
cosign verify-blob \
  --bundle content-manifest.cosign.bundle \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/ebpfsentinel/.*/publish-content\.yml@.*$' \
  content-manifest.json
```

That one needs a network, a transparency log and a clock you trust, which is
exactly why it is not what the agent relies on.

## The Four Refusals

Verification is a gate, not a report. Each refusal is counted under its own
label and raises an alert, and in every case the content already on disk stays
exactly as it was.

| Refusal | Label | When |
|---------|-------|------|
| Unsigned or unverifiable bundle | `signature_invalid` | `content-manifest.sig` is missing, malformed, or either signature fails against the compiled-in keys |
| Identity outside the allow-list | `unknown_signing_key` | The envelope verifies against no key this build trusts, which is what a bundle signed by somebody else looks like |
| Manifest and contents disagree | `contents_mismatch` | A listed file is missing, a file under `content/` is unlisted, a digest differs, or a length differs |
| A set moving backwards | `version_regression` | The bundle version or any set version is lower than the one already applied |

Three more refusals exist for the same reason and are counted the same way:
`unsupported_schema` for a schema this build does not know, `malformed_manifest`
for a manifest that is not the document it claims to be, and `unsafe_path` for a
file path that tries to leave the bundle.

## How the Agent Fetches

The agent fetches from the portal and from nowhere else. There is no
configurable content URL, because a content source somebody can point somewhere
else is the whole attack.

```yaml
enterprise:
  content:
    enabled: true
    interval_seconds: 21600
    directory: /var/lib/ebpfsentinel/content
```

The portal address and the per-agent credential come from the
`enterprise.portal` section: the content channel is the same relationship as the
heartbeat and does not open a second one. The interval is clamped to the same
floor and ceiling the portal reporting uses, and the first fetch of each cycle
is spread over a share of the interval using a stable hash of the agent's own
identifier, so a cluster restarting in lockstep does not land on one second.

A fetch that fails changes nothing: the current content stays applied, a counter
rises under the reason that failed, an alert fires, and the next attempt waits
on a backoff that grows to fifteen minutes. A refusal that is not worth
retrying, such as a bundle this build cannot read, waits the full backoff rather
than hammering the portal for a document that will not improve.

A verified set is applied atomically and one set at a time. Each set is written
into a new directory beside the live one and swapped in by rename, so there is
no moment when half a rule file is in force. The previous version of each set is
kept, so a rollback is one command and needs no redeploy:

```bash
ebpfsentinel-enterprise-agent content rollback --set ids-rules
```

The agent reports what it holds in its own status, which is also what the portal
shows the customer:

```bash
ebpfsentinel-enterprise-agent content status
```

```text
Content
=======
Directory:      /var/lib/ebpfsentinel/content
Bundle version: 142
ids-rules: version 118 published 2026-10-18T22:14:00Z (1842 entries, rollback to 117)
dlp-patterns: version 64 published 2026-10-17T11:02:00Z (312 entries, rollback to 63)
ja4-fingerprints: version 91 published 2026-10-18T22:14:00Z (8104 entries, rollback to 90)
ai-providers: version 22 published 2026-10-11T08:40:00Z (48 entries, rollback to none kept)
ml-models: version 7 published 2026-10-11T08:40:00Z (3 entries, rollback to 6)
```

The same figures are served over the API at `GET /api/v1/content/status`, which
is what a dashboard reads, and the portal shows the customer the other side of
the same question: which versions are published, and how much of their own
estate is on them.

## Across an Air Gap

An air-gapped estate gets the same content through the same verification path.
The content channel's outbound purpose is refused in air-gap mode, exactly as
portal reporting is, and the bundle arrives as a file somebody carries:

```bash
# Outside the enclave, signed in by a member of the organisation. The export
# needs a recent authentication, and it is recorded in the audit log.
curl -b portal-session.txt \
  -o ebpfsentinel-content-142.json \
  https://portal.ebpfsentinel.io/api/v1/organisations/$ORG/content/bundle

# Inside the enclave. The same command the online channel runs underneath, and
# it takes either the exported file or an unpacked bundle directory.
ebpfsentinel-enterprise-agent content import \
  --bundle ebpfsentinel-content-142.json
```

The export is the bundle rather than a rendering of it: the signature file
verbatim, and every file of the bundle with its bytes, which is what makes the
import on the other side the same verification rather than a second one. Nothing
is re-signed to cross the gap, and the portal has no key with which it could be.

The import runs the same verification the online fetch runs, against the same
compiled-in keys, with the same four refusals. There is one verification path
and two transports, which is the only way the offline estate can be told its
content is as trustworthy as anybody else's.

What the gap costs is the lag, and the honest figure is this: content applied
offline is as old as the last bundle somebody carried in. A bundle fetched from
the portal the day it is published and imported the same day is a day behind an
online estate; a bundle carried in monthly is a month behind, and during that
month the agent is matching on content that does not know about anything
published since. The agent does not pretend otherwise: the age of each set is in
its status and in the air-gap freshness check, and a set older than the
configured ceiling raises the same staleness alert the threat intelligence
feeds do.

## The API

The three routes are mounted only where the configuration carries an enabled
`content` block, and all three work on this machine's own content directory. None
of them takes a URL: the address and the credential come from the `portal` block,
and a route that accepted an address would be a way to hand an agent a bundle
from somewhere nobody signed.

| Method | Path | Role | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/content/status` | viewer | The versions in force, with each set's publication date, entry count and rollback target, and the number of consecutive fetch failures. |
| `POST` | `/api/v1/content/import` | operator | Verify a bundle in a local directory and put it in force. Takes `{ "bundle_dir": "...", "verify_only": false }`. |
| `POST` | `/api/v1/content/rollback` | operator | Put one set back to the version it replaced. Takes `{ "set": "ids-rules" }`. |

A refused bundle answers `400` and changes nothing on the machine. A verified one
answers `200` and says what became of each set, because a bundle is five
decisions rather than one: sets that were applied, and sets left alone because
this build is too old to read them or because what is in force is already as new.

The same three are what the command line runs underneath, so an air-gapped
estate that exposes no API still has every one of them.

## What the Portal Shows

A customer with an entitled subscription sees, per environment, which sets their
plan entitles, the version of each one, and when each was last published. Those
numbers come from the bundle manifest the portal serves rather than from a
second table, so a figure on the screen and a figure in a signed manifest cannot
drift apart.

A subscription that is closed is served nothing: not a stale bundle, not a
manifest, not a list of versions. The channel answers a closed subscription the
way it answers an unknown credential.

## Related

- [Air-Gap Mode](./airgap.md) for the enclave workflow and the licence crossing it
- [License Management](./license.md) for how entitlement is read
- [Fleet Management](./fleet-management.md) for the portal relationship the channel shares
