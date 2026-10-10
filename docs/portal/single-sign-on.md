# Single Sign-On and Provisioning

> **Edition: Enterprise**

Your colleagues can sign in to the customer portal through your own identity
provider, and your directory can add and remove them. The portal speaks
**OpenID Connect** for sign-in and **SCIM 2.0** for provisioning. Everything
below is on **Single sign-on**, which owners and administrators open inside the
organisation, as five numbered steps taken in order; the steps that need a
saved provider are drawn from the first visit and open once it is saved, and
nothing changes for anybody before the fourth. An administrator can prepare
every step, but only an owner can take the fourth.

## 1. The provider

Register the portal as a client in your identity provider. On **Identity
provider (OpenID Connect)**:

- **Issuer**: the address the discovery document sits under, for example
  `https://login.example.com`. It is read when you save, and the
  **Authorisation endpoint**, **Token endpoint** and **Key set** shown below it
  are the provider's own.
- **Client identifier** and **Client secret**: what your provider issued. The
  secret is stored sealed and never shown again; leave it empty later to keep the
  one already stored.
- **Default role**: what somebody arriving with no matching group is granted.

Register the **Redirect address to register with your provider** shown on the
screen (it ends in `/auth/sso/callback`) with your provider, and let the client
ask for the scopes `openid`, `email` and `profile`. **Save provider** asks for
your password.

The issuer must be `https`. The portal follows no redirect when it reads it and
refuses an issuer that resolves to a private, loopback or link-local address.

## 2. Domains

A provider only signs in people whose address is on a domain you have verified is
yours. Type it under **Domain** and press **Claim domain**; the screen shows the
record to **Publish this TXT record**, with **Copy the name** and **Copy the
value**. Once it is published, **Check now** (behind your password) looks it up.
Publishing can take a while to spread. A verified domain belongs to one
organisation only. **Remove** gives a claim up.

## 3. Groups and roles

Have your provider put the person's groups in a claim of the ID token and type
that claim's name under **Groups claim**; leave it empty if your provider sends
no groups. Then under **Groups and roles** press **Add a rule** to say what a
group grants here, and **Save mapping**.

The first rule that matches wins, in the order you wrote them, so put the rule
for the most privileged group first. Somebody whose groups match no rule
arrives on the **Default role** chosen with the provider. The rules are read at
every sign-in, so somebody removed from a group loses the role the next time
they sign in rather than at the next configuration change.

**Try it** asks what a set of groups would be granted without changing anything:
type the groups separated by commas and press **Preview**; the answer names the
role granted and the rule that matched, or says the default role applies.

A directory never makes or unmakes an owner. An owner is made by another owner,
from **Members**.

## 4. Turning it on

Until **Turn the provider on** is done, nobody signs in through it. Only an
owner can do it, and only an owner who still holds a password here: that owner
keeps it, so somebody can still get in when the provider is unreachable, and it
is deliberately the person who decided to depend on the provider. The panel
says what is still missing (a saved provider, a verified domain, an owner, a
password) and **Turn on** stays closed until nothing is.

The panel also shows what turning it on will do before you press **Turn on**:
the local passwords to remove, the sessions to end and the passwords kept for
other organisations, with the version of the consequences notice you are
agreeing to. Everybody else in the organisation loses their local password and
is signed out of every device, so no way in survives their provider revoking
them. Somebody who also belongs to another organisation keeps their password,
because removing it would lock them out of somewhere this decision does not
reach. **Turn on** asks for your password again, see
[When the portal asks for your password again](signing-in.md#when-the-portal-asks-for-your-password-again).

**Turn off**, open to owners and administrators, turns the provider off and
does not ask for your password. It is meant for an outage and gives nobody a
password back: while the provider is off, only people who still hold a password
here can sign in, the owner who turned it on among them, and everybody else
signs in again once it is turned back on. The sign-in address and the domains
are kept for that moment.

## The sign-in address

Once the provider is on, your colleagues sign in at the **Sign-in
address** shown on the screen, `https://portal.ebpfsentinel.io/s/<handle>`. The
handle is random and names your organisation nowhere, so nobody finds it by
guessing. Send it to your colleagues.

**Replace this address** (behind your password) stops the old one working
immediately; everybody then needs the new one. Somebody who lost it gets it back
through **I have forgotten my password** on the sign-in screen, which mails it
to them.

## 5. Directory provisioning

The step **Directory provisioning (SCIM 2.0)** is on the screen before a
provider exists and says what it does; its link opens once the provider is
saved, and a SCIM token can be issued once it is on. That page issues the token your directory writes people into
the organisation with. Press **Issue a SCIM token**, copy it now (it is shown once;
only a digest is kept), and give your directory the **Base address for your
directory**, which ends in `/scim/v2`, with the token as its bearer token.

Users and Groups are supported, with filters, paging and `PATCH`. A user your
directory marks inactive loses every session rather than being deleted.
**Revoke** stops provisioning with that token without touching sign-in.
Several tokens can be live at once, so a rotation costs no downtime.

## On your own account

**Your account** links to **Identity providers you sign in through**, which lists
the directories that can sign in as you, when each was linked and when it was
last seen. It changes nothing.

## See also

- [Signing In](signing-in.md)
- [Audit Log and Activity](audit-log.md), which records every federated sign-in
  and every refusal with its reason
