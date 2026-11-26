# Automation and the Organisation's Security Policy

> **Edition: any plan, including open source**

Two things an owner sets once and then leaves to run: an automation token, so
your own pipeline rotates join secrets and reads the audit log without anybody
signing in, and the organisation's security policy, which decides who may
enter the organisation and from which networks. The second applies to the
first, so they are on one page.

## Automation tokens

**Automation tokens**, inside the organisation, lists every token minted for
it. Owners and administrators open it, because a token does what they can do on
**Deployments**.

### Creating one

**Create an automation token** asks for two things:

- a **Name**, up to 80 characters, after the pipeline that will hold it. Several
  tokens are live at once, and the name is how you tell which one to revoke
  after a leak;
- how long it is **Valid for**: 30 days, 90 days, 180 days or one year. Every
  token runs out; one year is the longest.

**Create the token** asks for your password again (see
[When the portal asks for your password again](signing-in.md#when-the-portal-asks-for-your-password-again))
and shows the secret once. Copy it into your pipeline's secret store then:
only a fingerprint of it is kept, so it cannot be shown again. The same screen
shows the **Base address for your pipeline**, which is your portal address
followed by `/automation/v1`, and the header to send the token in:

```text
Authorization: Bearer <the token>
```

### What a token can do

A token carries no role of its own. It acts for the person who created it, and
every call is checked against what that person may do at that moment, so it is
as wide as their role and no wider:

- listing, creating and revoking join secrets needs a role that manages
  deployments, owner or administrator;
- reading the audit log needs a role that may read it on the screen, owner or
  administrator.

Somebody demoted to **Billing** or **Member**, or removed from the
organisation, stops every token they created at once: nothing has to be
revoked by hand. The token also stays under the organisation's security policy
(below), weighed by the way its creator's session was opened.

Each row says when the token was created, when it expires, when a pipeline last
used it, and whether it is **Active**, **Expired** or **Revoked**.

### Revoking one

**Revoke** stops a token at once. The row stays, with the date it was revoked,
because when a pipeline stopped being able to rotate is the first question
asked about a secret that was not rotated. Revoking a token that is already
revoked answers `404`. Creating and revoking a token are both recorded in the
[audit log](audit-log.md).

## The `/automation/v1` routes

Every route below is relative to your portal address and needs the
`Authorization` header. The organisation is the one the token was created in:
no path names an organisation.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/automation/v1/environments/{environment}/enrolment-tokens` | Lists every join secret of one deployment, newest first. |
| `POST` | `/automation/v1/environments/{environment}/enrolment-tokens` | Creates a join secret for one deployment and answers `201` with it, once. |
| `POST` | `/automation/v1/enrolment-tokens/{enrolment}/revocation` | Revokes a join secret and answers `204`. |
| `GET` | `/automation/v1/audit` | Reads the organisation's audit log, oldest first. |

`{environment}` is the identifier of a deployment and `{enrolment}` the
identifier of a join secret, both as the listing returns them. An identifier
that names nothing in your organisation answers `404`.

### Rotating a join secret

The body of the create call is optional, and so is each of its two fields:

```json
{ "valid_for_days": 30, "agent_limit": 50 }
```

`valid_for_days` is between 1 and 365, `agent_limit` the number of machines that
may join with it, between 1 and 10000. Without either, the secret never runs out
and admits any number of machines, which is what a deployment manifest wants.
The answer carries the record and a `secret` field, shown once.

A rotation is three calls, with no downtime because several secrets can be live
at once: create the new secret, roll it out to your manifests, then revoke the
old one once its `last_used_at` stops moving. Agents that already joined keep
reporting on their own credential; see [Join secrets](deployments-and-agents.md#join-secrets).

```bash
curl -fsS -X POST -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/json' -d '{"valid_for_days": 30}' \
  "https://portal.example.com/automation/v1/environments/${DEPLOYMENT}/enrolment-tokens"
```

### Pulling the audit log

`GET /automation/v1/audit` hands the organisation's log to your own security
tooling. It is pulled, never pushed: the portal does not call an address you
type in. It takes two query parameters and refuses any other:

- `limit`, how many lines, 50 by default and 200 at most;
- `cursor`, where to continue from, being the `next` of the previous answer.

The answer is:

```json
{
  "entries": [ ... ],
  "next": "an opaque position",
  "horizon": "2026-11-26T10:41:00Z"
}
```

`entries` are oldest first, shaped as the [audit log](audit-log.md) screen reads
them. `next` is where to continue from; it stays the same when nothing new
arrived, and is absent only while the log is empty and no cursor was sent.
`horizon` is the moment the answer stopped short of: the newest minute is held
back until it has settled and comes in a later answer, so following the log
with `next` never skips a line. Store `next` after each answer and send it back
on the next poll.

### What a refused call answers

Every refusal carries a JSON body with an English `error` and a stable `code`:

| Status | `code` | Why |
|---|---|---|
| `401` | `invalid_credentials` | The header is missing or malformed, or the token is unknown, revoked or expired. Which of these it was is not said, because that is what a scanner asks. Create a new token. |
| `403` | `forbidden` | The token is valid, but the person who created it is no longer a member, or no longer holds the role the call needs, or holds no second factor the organisation requires. |
| `403` | `organisation_refuses_network` | The call came from outside the networks the organisation allows. Allow the network your pipeline runs from, or run it from an allowed one. |
| `403` | `organisation_requires_passkey` | The organisation requires a passkey and the token was created from a session that was not opened with one. Create a new token after signing in with a passkey. |
| `403` | `organisation_requires_single_sign_on` | The organisation requires its identity provider and the token was created from a session that was not opened through it. Create a new token after signing in through single sign-on. |
| `404` | `not_found` | The deployment or join secret is not one of this organisation's. |
| `429` | `throttled` | The pipeline called too often. Wait for the number of seconds in `Retry-After`. |

A `401` is fixed by a new token. A `403` is fixed on the account the token acts
for, or on where the pipeline runs, and the token itself stays good.

## The organisation's security policy

**Settings**, inside the organisation, holds **Who may enter, and from where**.
Owners and administrators open it there; only an owner changes it, and **Save**
asks for the password again. It applies to
every member, the owner included, on every page that names the organisation,
from the next page anybody opens. Somebody it does not admit stays a member and
is told what to set up to get back in.

It asks three things.

**Require two-step verification.** A member who signs in with a password cannot
open anything in the organisation until they hold an authenticator app or a
passkey (see [Two-step verification and passkeys](signing-in.md#two-step-verification-and-passkeys)).
People who sign in through your identity provider are not asked again here:
your provider decides their second step.

**How everybody signs in**, one of three:

- **Any way their account allows**: a password, with a second factor if
  required above, a passkey or your identity provider.
- **A passkey**: a session opened with a password is held at the door until its
  holder signs in again with a passkey.
- **Your identity provider**: only sessions opened through the organisation's
  [single sign-on](single-sign-on.md) are let in. While no provider is in force
  the requirement lapses, so turning a broken provider off lets everybody back
  in.

Your own session must already meet the way you choose, or saving it is refused.
An automation token is weighed by the way the session that created it was
opened.

**Allowed networks.** One per line, an address or a network in CIDR form, such
as `203.0.113.0/24` or `2001:db8::/32`, up to 32. Sessions and automation
tokens from anywhere else are refused. Agents are not affected, since a
deployment reports from wherever it runs. Leave the box empty to allow any
network. An address with bits set past its prefix, such as `10.1.2.3/8`, is
refused rather than rounded, and so is a network covering every address. The
list must include the network you are on now, or saving it is refused.

Every change is recorded in the [audit log](audit-log.md).

### Locked out by your own rules

An owner the allowed networks or the required way of signing in hold at the
door is not locked out for good. The screen that holds them offers **Ask for
these restrictions to be lifted**, which asks for the password again. Then:

1. Nothing changes for **72 hours**, and every owner is emailed the date it
   takes effect.
2. Until then, **Settings** shows the lift to any owner who can still get in,
   with **Cancel the lift**. If nobody in your organisation asked for it,
   cancel it and change your password.
3. Once the 72 hours have passed, the allowed networks and the required way of
   signing in are lifted. Saving the policy again sets them again.

A required two-step verification is never part of a lift: setting one up is in
the member's own hands. Asking again while a lift is waiting answers with the
lift already recorded. Asking and cancelling are both recorded in the audit log.

The wait is long enough that every owner reads the mail across a weekend and a
timezone, so a stolen owner password cannot use it quietly, and short enough
that an owner who locked themselves out by mistake is back within the week
without writing to anyone.

## See also

- [Deployments and Agents](deployments-and-agents.md)
- [Audit Log and Activity](audit-log.md)
- [Signing In and Two-Step Verification](signing-in.md)
- [Single Sign-On and Provisioning](single-sign-on.md)
