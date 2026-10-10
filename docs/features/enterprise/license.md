# Enterprise License System

> **Edition: Enterprise**

## Overview

The enterprise license system gates feature activation at runtime using Ed25519 + ML-DSA-65 dual-signed license keys. A key bought from the customer portal is a fleet key: one file, installed unchanged on every node. Binding a key to one machine is the air-gapped activation path, for an estate that cannot reach the portal. The system also includes anti-tamper protections and cryptographic feature isolation.

Two kinds of key exist, and they differ in one field:

| Key | Where it comes from | `machine_fingerprint` | Installed on |
|---|---|---|---|
| Fleet key | **Licence keys** in the customer portal | absent | every node, the same file |
| Machine-bound key | The [air-gap activation workflow](#air-gap-activation-workflow) | the fingerprint of one machine | that machine only |

## License Key Format

**The format (Ed25519 + ML-DSA-65):**
- **Line 1:** Base64-encoded JSON payload (`LicenseInfo`)
- **Line 2:** Base64-encoded Ed25519 signature
- **Line 3:** Base64-encoded ML-DSA-65 signature

```json
{
  "org": "Acme Corp",
  "features": ["advanced-dlp", "ml-detection"],
  "issued_at": "2026-03-14T00:00:00Z",
  "expires_at": "2027-01-01T23:59:59Z",
  "max_agents": 50,
  "max_cores_per_agent": 32,
  "key_id": "afc51a12b85c000f"
}
```

`max_cores_per_agent` is optional. A license issued without it is read as
unlimited. `machine_fingerprint` is optional too: a fleet key carries none, and
a machine-bound key carries the SHA-256 fingerprint of the one machine it was
activated for.

`key_id` names the signing pair, as the first sixteen hex characters of
SHA-256 over its two public halves. An agent carries every pair still in use,
each under its id, so a key signed by a newer pair than the agent knows is
refused with that id named (upgrade the agent), and a rotation never forces a
fleet rebuild: the old pair stays built in beside the new one until the last
key it signed has expired. A key issued before keys carried an id has no
`key_id` and is checked against every built-in pair.

The dashboard and the Kubernetes operator verify keys the same way, each with
its own built-in set of pairs, so a key signed under a pair newer than either
of them is refused there with the same message until that component is
upgraded. The operator reads its key from its Secret again every five minutes
(`LICENSE_REFRESH_SECONDS`, thirty seconds at the least): a replaced, removed or
narrowed key makes it stand down and come back against the key that is there
now, so a renewal needs no manual restart. It grants the same fourteen-day
[grace window](#expiry-and-grace) as the agent, logging a warning that names the end of the window each
time it reads the key, and stands down when the window closes.

## Available Features

| Feature Flag | Description |
|-------------|-------------|
| `advanced-dlp` | Hyperscan DLP, custom patterns, block mode |
| `ml-detection` | ML-based anomaly detection |
| `multi-tenancy` | Namespace-scoped policy isolation |
| `siem-integration` | SIEM export connectors |
| `compliance-reports` | Automated compliance reporting |
| `high-availability` | Active-passive and active-active clustering |
| `multi-cluster` | Federated policy management |
| `advanced-rbac` | Per-domain/resource permissions |
| `air-gap` | Offline operation mode |
| `advanced-analytics` | Historical traffic analytics |
| `fleet-management` | Fleet agent management |
| `ai-llm-security` | AI/LLM traffic security |
| `tls-intelligence` | TLS threat intelligence & PQC compliance |
| `network-forensics` | Ring buffer capture & flow timeline |
| `automated-response` | Policy engine & SOAR webhook integration |
| `kubernetes-operator` | The Kubernetes operator, which refuses to start without it |

## Keys bought from the portal

A key issued from the customer portal is a **fleet key**. It carries the
organisation, the features the tier admits, the expiry, `max_agents` and the
per-node size band, and **no machine binding**: the payload has no
`machine_fingerprint` at all. The same file goes on every node of the estate,
and a node that is rebuilt, replaced or rescheduled onto another machine keeps
working with it. Replacing a node is not a licensing event.

The fleet size is carried by `max_agents` rather than by one key per machine.
It is a term of the subscription and not a lock: an agent verifies its key
offline and cannot see the other agents carrying the same file, so **no agent
refuses to start because the fleet grew past the count**. The licence agreement
gives 30 days to add the agents in the portal once the fleet has grown. The agent
reports the count at `GET /api/v1/license`, and the portal's **Usage** page
counts the agents actually reporting against it and against the subscription,
so an estate that has outgrown what it bought is visible there rather than on a
node that refused to start. The node size is different, see
[Host Size Band](#host-size-band): that ceiling is enforced on each host.

To get one:

1. Hold a paid subscription. A key with a subscription's terms is issued once
   our reseller reports the payment, so a subscription awaiting payment against
   an invoice has none yet. A purchase made as an individual gets its key once
   the fourteen-day withdrawal period has run, or at once if the waiver was
   ticked at checkout. The trial and the design partner key below are the two
   keys issued without a subscription.
2. Turn on two-step verification on your account, with an authenticator or a
   passkey. The portal refuses to issue a key to an account held by a password
   alone.
3. As an owner or an administrator of the organisation, open **Licence keys**
   and choose **Issue a key**. If you have not signed in or confirmed your password
   in the last fifteen minutes, the portal asks for it again first, see
   [When the portal asks for your password again](../../portal/signing-in.md#when-the-portal-asks-for-your-password-again).
4. Choose **Download the key**. The file is named after the organisation, for
   example `ebpfsentinel-acme.lic`.
5. Verify it before installing it, with the two commands the page prints under
   **Check this file yourself**: `sha256sum` against the fingerprint shown beside
   the key, and [`ebpfsentinel-license inspect`](#inspect-license) against the
   published public keys.

Installing it is covered per deployment shape in
[Enterprise Deployment](../../operations/deployment/enterprise.md), and the whole
path from purchase to machines reporting is walked in
[From purchase to reporting agents](../../getting-started/from-purchase-to-reporting-agents.md).

Replacing a key (**Replace this key**) signs a new one and stands the old one down
in the portal in the same step. Nothing reaches an agent from there: the new file
has to be installed over the old one, and the agent picks it up within a minute
without a restart (see [Renewal and reload](#renewal-and-reload)). An estate with no
route to the portal takes the **Offline bundle** from the same page instead, and
checks it with [`ebpfsentinel-license bundle`](#check-an-offline-bundle). The same
bundle is what an agent reads its [revocations](#revocation) from.

The same screen offers each organisation one **14-day Enterprise trial key**,
generated with no subscription and no card, and a design partner a key running
a year instead. Both are fleet keys carrying every Enterprise feature with no
`max_agents` and no `max_cores_per_agent` ceiling, and the agent treats them
like any other key, the [expiry window](#expiry-and-grace) included. See
[Enterprise trial](../../portal/billing-and-licence-keys.md#enterprise-trial).

## Host Size Band

A subscription is priced by the size of the node it covers, so a license can
carry a per-node CPU ceiling in `max_cores_per_agent` (0 or absent = no
ceiling). At load time the agent counts the CPUs the host is provisioned with
and refuses a license whose ceiling the machine exceeds:

```
host has 48 CPUs, license covers nodes up to 32 - move the agent to a smaller
node or upgrade the size band
```

The count is read from `/sys/devices/system/cpu/present`, falling back to
`online` and then to the process CPU budget. `present` is preferred because it
reports what the machine was provisioned with: CPUs taken offline at runtime
through hotplug do not shrink the node the agent is licensed for.

Refusal behaves like any other license failure - the agent keeps running and
keeps enforcing the open source datapath, with enterprise features disabled.
The ceiling lives inside the signed payload, so raising it invalidates both
signatures.

## Machine Fingerprint Binding

Fingerprint binding is the **air-gapped activation path**. A key bought from
the portal is not bound to any machine; a key produced by the
[air-gap activation workflow](#air-gap-activation-workflow) is bound to the one
machine that generated the request, through a SHA-256 fingerprint computed from:

- `/etc/machine-id` (or `/var/lib/dbus/machine-id`)
- CPU brand string (`/proc/cpuinfo`)
- Primary network interface MAC address

```bash
# Display fingerprint
ebpfsentinel-enterprise-agent fingerprint

# Write the fingerprint and its components to a JSON report
ebpfsentinel-enterprise-agent fingerprint --output fingerprint.json
```

That file is a report rather than an activation request: it carries no list of
features, so `activate` refuses it. The file that crosses an air gap is the one
`generate-request` writes, and every flag of the three agent commands is in the
[CLI reference](../../cli-reference/index.md#enterprise-agent-commands).

A key carrying a fingerprint is refused on any other machine. A key carrying
none, which is every key the portal issues, is accepted on any machine.

## Checking a License

These are the customer's tools. They take published public keys and never a
signing key, so they can be run anywhere a key or a bundle is received.


### Inspect License

```bash
ebpfsentinel-license inspect license.key \
  --public-key license-signing.pub \
  --pq-public-key license-signing-pq.pub
```

Output includes the pair that signed the key and both signature verification
results:

```
  Signing key:  afc51a12b85c000f
  Ed25519 sig:  VALID
  ML-DSA-65 sig: VALID
```

A key issued before keys carried an id reads `Signing key:  not named (issued
before keys carried an id)`.

Each key flag is optional on its own, and a signature with no key given is reported as `not verified` rather than checked. Pass both - a check that names only the classical key accepts a file carrying one valid signature and one forged, which is the case the second algorithm exists for.

**Exit code:** `inspect` exits non-zero if a signature was checked and did not verify, so it can gate a deployment script. A signature that was not checked at all does not fail the command; it is reported as unchecked.

### Where the public keys come from

The two `.pub` files are published, not served alongside the license. They are attached to every `measurements/v*` release and ship inside every enterprise release tarball, beside the `ebpfsentinel-license` binary itself.

Obtain them once, out of band, and keep them. A license delivered over a web session and a key delivered down that same session prove nothing together: whoever could tamper with one could tamper with the other. That is the whole reason the key does not travel with the document.

### Check an Offline Bundle

An estate with no route to the vendor receives its licenses as a single offline bundle: every key currently in force with its signed document, plus every revocation that can still change what the fleet runs.

```bash
ebpfsentinel-license bundle offline-bundle.json \
  --public-key license-signing.pub \
  --pq-public-key license-signing-pq.pub \
  --against /etc/ebpfsentinel/licences \
  --output-dir /etc/ebpfsentinel/licences.new
```

Both key flags are required here. A bundle crosses an air gap with no session behind it, so there is nothing else that could vouch for it.

For every key in the bundle the tool recomputes the SHA-256 of the signed document, checks it against the fingerprint the entry declares, verifies both signatures, and reads the terms out of the signed payload rather than out of the entry - a relabelled entry with a good signature is refused. The container itself is deliberately unsigned; each key inside is self-verifying.

| Flag | Effect |
|---|---|
| `--against <dir>` | Digests every readable file in the directory and reports any that the bundle lists as revoked |
| `--output-dir <dir>` | Writes each accepted key as `<fingerprint>.lic`, byte-identical to the signed source |

Every failure in the bundle is reported before the command aborts - an operator across an air gap gets one run. The exit code is non-zero if any key was refused or if a revoked file is still present on disk.

## Vendor Tools: Signing Keys and Licenses

`keygen` and `generate` are the vendor's tools. They need the private signing
keys, which are held by the vendor on a host with no inbound route, and a
customer never runs them: a key signed with any other pair is refused by every
agent, because the agent verifies against the published public keys. They are
documented here so that what the portal signs, and what a test license built
for a lab contains, can be read.

### Generate Keypair

```bash
ebpfsentinel-license keygen \
  --private-key license-signing.key \
  --public-key license-signing.pub \
  --pq-private-key license-signing-pq.key \
  --pq-public-key license-signing-pq.pub
```

This generates both an Ed25519 keypair and an ML-DSA-65 keypair. Both are required: licenses are post-quantum dual-signed and verified against both public keys. The command also prints the pair's key id (`Key id:`), which `generate` stamps into every key it signs and which names the directory the public halves are built in under.

### Generate License

```bash
# Dual-signed license (Ed25519 + ML-DSA-65)
ebpfsentinel-license generate \
  --signing-key license-signing.key \
  --pq-signing-key license-signing-pq.key \
  --org "Acme Corp" \
  --features advanced-dlp,ml-detection \
  --expires 2027-01-01 \
  --max-agents 50 \
  --max-cores-per-agent 32 \
  --fingerprint ca9240c0e28de960... \
  --output license.key
```

Both `--signing-key` and `--pq-signing-key` are required - every license is post-quantum dual-signed.

`--fingerprint` defaults to `*`, which produces a fleet key with no machine
binding, the same shape the portal issues.

## Air-Gap Activation Workflow

For environments without internet access:

```
[Air-gapped agent]                    [Connected workstation]

1. generate-request --features LIST \
     --output request.json
   (exports fingerprint + features)
                    ──── transfer ────►
                                       2. ebpfsentinel-license activate \
                                            --signing-key KEY \
                                            --pq-signing-key PQ_KEY \
                                            --request request.json \
                                            --org "Acme" \
                                            --expires 2027-01-01 \
                                            --output activation.key
                    ◄──── transfer ────
3. import-activation activation.key
   (validates + installs to /etc/ebpfsentinel/license.key)
```

The same round trip is walked command by command, with what each step writes and
what refuses it, in [Air-Gap Mode](airgap.md#license-activation-across-the-gap).

## Post-Quantum License Signing

ML-DSA-65 (FIPS 204) dual signing provides post-quantum resistance for license keys. Both an Ed25519 signature and an ML-DSA-65 signature are computed over the same JSON payload.

**Verification behavior:**

- Both the Ed25519 and ML-DSA-65 signatures must be valid for the license to be accepted. Failure of either signature - or a missing ML-DSA-65 signature - rejects the license.
- A two-line, Ed25519-only file is refused by the format itself: the reader expects three lines and stops there.

**Key storage:**

ML-DSA-65 keys are stored as 32-byte seed files. The full keypair is deterministically expanded from the seed at signing/verification time, keeping key material compact and consistent with the Ed25519 key file size.

**HKDF key derivation:**

The License-as-Computation-Parameter mechanism (AES-256-GCM encryption of the ML model file) derives keys from the Ed25519 signature bytes via HKDF. The ML-DSA-65 signature is not used for key derivation.

## Anti-Tamper Protections

### Binary Integrity Self-Check

Release builds verify their own `.text` section hash against a signed manifest at startup:

```bash
# Generate integrity manifest during CI build
ebpfsentinel-license integrity-hash \
  --binary target/release/ebpfsentinel-enterprise-agent \
  --signing-key release-signing.key \
  --output integrity.manifest
```

Integrity failure exits with code 2 (no fallback to OSS mode).

The manifest is signed with the **release** pair, never the licence pair: a
licence says what a customer bought, a manifest says what a binary is, and a
key that could sign one must not be able to vouch for the other. The release
public keys are compiled into the agent by the release pipeline, together with
any superseded pair still needed to read older manifests. A build carrying no
release key (a local `cargo build`) skips the integrity manifest with a warning
and refuses enterprise features whenever a signed measurements manifest is
present, because it has nothing to check either against.

### Distributed License Checks

License validation occurs at three independent points per feature:

1. **Startup** - the agent reads the key, verifies both signatures and decides
   which enterprise routers to mount. A feature the key does not carry is a
   router that was never registered, which is why an unlicensed path answers
   `404` rather than `403`.
2. **Every request** - the API asks the license again before running a handler
   on a route that a feature gates. Validity is computed from `expires_at` and
   the [grace window](#expiry-and-grace) at the moment it is asked, so the end
   of the grace window closes those routes on the day it happens rather than at
   the next restart.
3. **Periodic** - a background task wakes every fifteen minutes and writes an
   ERROR line when the key has run out, so an expiry is visible in the log
   before anyone calls the API. On the same tick it asks each active feature to
   re-check its entitlement, and that check is throttled to at most once an
   hour, so its effective interval is one hour and the fifteen-minute tick is
   what carries the expiry line.

   That periodic check is an expiry and feature check and nothing more: no
   signature is re-verified on that tick. Reading the key file again is a
   separate task, described in [Renewal and reload](#renewal-and-reload), and a
   replacement goes through the full verification, both signatures included,
   before it takes the place of the key in memory.

### License-as-Computation-Parameter

One asset ships encrypted: the ONNX model file the ML detectors load. It is
AES-256-GCM, with the key derived from the license signature via HKDF:

```
license_signature → HKDF(SHA-256, salt="ebpfsentinel-enterprise", info=feature_name) → AES-256-GCM key
```

Invalid license → decryption failure → the model does not load. Nothing else is
read through this path: pattern databases and configuration files are plain
files on disk, gated by whether their feature's router was mounted at all.

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  license_path: /etc/ebpfsentinel/license.key
  # Optional: an offline bundle whose revocations the agent honours.
  revocations_path: /etc/ebpfsentinel/offline-bundle.json
  # Where the agent records the latest time it has seen (default shown).
  license_clock_path: /var/lib/ebpfsentinel/license-clock
```

| Key | Default | Meaning |
|---|---|---|
| `license_path` | none | The key file. Re-read every minute, see [Renewal and reload](#renewal-and-reload) |
| `revocations_path` | none, or `revocations.json` beside the enrolment when the portal is enabled | An offline bundle (`ebpfsentinel.offline-bundle/1`) whose `revocations` list the agent checks the key against, and where the portal's heartbeat keeps the list. See [Revocation](#revocation) |
| `license_clock_path` | `/var/lib/ebpfsentinel/license-clock` | The high-water clock file. See [Expiry and grace](#expiry-and-grace) |

Or via CLI flag:

```bash
ebpfsentinel-enterprise-agent --license /path/to/license.key
```

Or via environment variable:

```bash
export EBPFSENTINEL_LICENSE=/path/to/license.key
```

## Expiry and grace

A key does not stop on its expiry date. For **14 days** after `expires_at` the
agent keeps every feature the key carries and says so: `GET /api/v1/license`
answers `in_grace: true` with the last day in `grace_until`, and the periodic
check logs the expiry. Once `grace_until` has passed the key is out of force
and the agent behaves as described under [Graceful Degradation](#graceful-degradation).

Expiry is judged against the latest time the agent has observed, not against
the wall clock alone. The agent writes that instant to `license_clock_path`
every minute and reads it back at startup, so setting a machine's clock back
does not extend a key, across restarts included. This is a ratchet rather than
a proof: a machine whose clock was set back before the agent ever ran, with no
clock file, starts from that clock. A clock file that cannot be written is
logged once and retried; it never stops the agent.

## Renewal and reload

The agent reads `license_path` (and the revocation list, when there is one) again every
minute. When either file has changed:

- **A valid replacement takes over in place.** The new key is verified in
  full, both signatures, the key id, the size band and the fingerprint
  included, and replaces the one in memory. Renewing is installing the new file
  over the old one; no restart is needed for the features that were already
  mounted.
- **A feature the old key did not carry is mounted at the next restart.**
  Which routers exist is decided at startup, so the agent logs which features
  are newly licensed and waits for a restart to serve them.
- **A replacement that is not in force is ignored.** A file holding an expired
  or refused key leaves the key already loaded in place, with a warning.
- **A file caught half written is retried** on the next tick rather than read
  as a refusal.

## Revocation

A key can be revoked before its expiry: issued in error, leaked, or belonging
to a subscription that ended early. The agent learns it from an offline bundle
at `revocations_path`, the same file the portal's **Offline bundle**
offers and [`ebpfsentinel-license bundle`](#check-an-offline-bundle) checks.
A key is revoked when the SHA-256 of its file appears in the bundle's
`revocations` list.

The list reaches the file by one of two roads:

- **An agent reporting to the portal** (`enterprise.portal.enabled: true`) is
  handed its organisation's revocation list in the answer to every heartbeat
  and writes it to `revocations_path`, or, when that is not set, to
  `revocations.json` beside the enrolment
  (`/var/lib/ebpfsentinel/portal/revocations.json` by default). A key revoked
  in the portal stops being honoured within one heartbeat and one reload, with
  nothing to copy. The agent only ever **adds** to the file: a revocation
  already there stays, whoever put it there, so an answer that left one off -
  an old backup of the portal, or anything able to answer in its place - can
  never hand a revoked key back. A file that is there and cannot be read is
  left alone rather than overwritten.
- **An air-gapped estate** copies the portal's **Offline bundle** to
  `revocations_path` by hand, and replaces it when a new one is exported. Both
  roads can share one file: the portal's list is added to a bundle carried
  across, and the bundle's keys are kept.

- **No list configured and no portal, or a path with no file yet**: nothing is revoked.
  A list that has not been delivered is not a revocation.
- **A file that is there and cannot be read as a bundle**: the key is refused.
  A list somebody tried to deliver and that does not parse could be the one
  naming this key.
- **A revoked key at startup** is refused and the agent runs in OSS mode. **A
  revocation delivered while running** closes the enterprise API within a
  minute, exactly as an expiry does. The datapath keeps running either way.

The bundle itself is not signed and does not need to be: a revocation can only
take features away, so a forged list can deny a feature and never grant one.

## Graceful Degradation

What happens at startup, when the agent decides what to run:

- Missing license: runs in OSS mode, every enterprise feature disabled
- Invalid signature: rejects the license and runs in OSS mode
- Signed by a pair this build does not carry: rejects the license, naming the key id, and runs in OSS mode
- Expired past its grace window: rejects the license and runs in OSS mode
- Revoked: rejects the license and runs in OSS mode
- Fingerprint mismatch, on a machine-bound key only: rejects the license with a clear error. A fleet key carries no fingerprint and is never refused for it
- Host larger than the licensed size band: rejects the license and runs in OSS mode

What happens when a license's grace window ends, or a revocation arrives, while
the agent is running:

- **The datapath keeps running.** The eBPF programs stay loaded and traffic is
  inspected and enforced exactly as before. An expiry is a commercial event, not
  a reason to stop protecting a network.
- **The enterprise API closes.** Every route a license feature gates answers
  `403` with the code `LICENSE_FEATURE_UNAVAILABLE`, naming the feature the key
  no longer covers.
- **`GET /api/v1/license` keeps answering**, along with `/metrics`, the kernel
  feature probe and the open source alert route, so an operator can read why the
  rest stopped.
- **Renewing takes effect within a minute.** Install the new key over the old
  one: it is read on the next reload tick and the routes that were mounted at
  startup open again. A feature the agent did not mount at startup needs a
  restart, see [Renewal and reload](#renewal-and-reload).

## REST API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/license` | viewer | none | Enterprise license status (200, or 402 when the license is absent or invalid). |

Returns license status (200 OK or 402 Payment Required):

```json
{
  "valid": true,
  "org": "Acme Corp",
  "features": ["advanced-dlp", "ml-detection"],
  "issued_at": "2026-03-14T00:00:00Z",
  "expires_at": "2027-01-01T23:59:59Z",
  "grace_until": "2027-01-15T23:59:59Z",
  "in_grace": false,
  "key_id": "afc51a12b85c000f",
  "max_agents": 50,
  "max_cores_per_agent": 32,
  "host_cores": 30,
  "machine_fingerprint": "*",
  "air_gap_enabled": false,
  "signed_payload": "eyJvcmciOiJBY21lIENvcnAiLCA...",
  "ed25519_signature": "MEUCIQDf4b1c07a9d5e4...",
  "ml_dsa_signature": "BEQCIGx2b1c07a9d5e4...",
  "measurement": "9f2c4d7e1b08a3560c9d4e8f2a17b3c5..."
}
```

`grace_until` is `expires_at` plus the 14-day grace window, and `in_grace` is
`true` between the two: every feature is still served, and a monitor should
alert on it. `key_id` names the signing pair, and is left out for a key issued
before keys carried an id.

`machine_fingerprint` is the fingerprint a machine-bound key was activated for,
and `*` for a fleet key, which is bound to no machine. `host_cores` is what this machine measured, reported next to the ceiling so a
fleet audit can see the headroom left before a resize takes a node out of band.
`max_cores_per_agent` is always sent, `0` meaning no ceiling; `host_cores` is
left out where the count could not be read.

The last four fields are what makes the answer worth more than a self-report.
`signed_payload` is the base64 of the exact `LicenseInfo` bytes that were
signed, with the two signatures over those same bytes beside it, so a reader
verifies the terms against the published public keys rather than believing the
fields above them. `measurement` is the SHA-256 of the agent's own binary,
where it could read one, which is what binds the key to a build the signed
measurements manifest already names. All four are left out when no signed key
is loaded, and `air_gap_enabled` is always sent.

`features` is the set the key carries **and** the agent still honours: an
expired or refused key answers `402` with an empty list rather than with the
features it used to grant.
