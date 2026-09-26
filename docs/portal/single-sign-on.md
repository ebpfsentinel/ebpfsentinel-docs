# Single Sign-On and Provisioning

> **Edition: Enterprise**

Your colleagues can sign in to the customer portal through your own identity
provider, and your directory can add and remove them. The portal speaks
**OpenID Connect** for sign-in and **SCIM 2.0** for provisioning; SAML is not
offered. Everything below is on **Single sign-on**, which owners and
administrators open inside the organisation.

## 1. The provider

Register the portal as a client in your identity provider. On **Provider**:

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

A provider only signs in people whose address is on a domain you have proved is
yours. Type it under **Domain** and press **Claim domain**; the screen shows the
record to **Publish this TXT record**, with **Copy the name** and **Copy the
value**. Once it is published, **Check now** (behind your password) looks it up.
Publishing can take a while to spread. A proved domain belongs to one
organisation only. **Withdraw** removes a claim.

## 3. Groups and roles

Have your provider put the person's groups in a claim of the ID token, then under
**Groups and roles** press **Add a rule** to say what a group grants here. The
rules are read at every sign-in, so somebody removed from a group loses the role
the next time they sign in rather than at the next configuration change.

**Try it** asks what a set of groups would be granted without changing anything:
type the groups separated by commas and press **Preview**; the answer names the
role **Granted** and the **Matched rule**, or says the default role applies.

A directory never makes or unmakes an owner. An owner is made by another owner,
from **People**.

## 4. Putting it in force

Until **Put the provider in force** is done, nobody signs in through it. The
panel shows what it will cost before you press **Put in force**: the **Local
passwords that will be removed**, the **Sessions that will end**, and the
**Passwords kept for other organisations**, with the version of the
consequences notice you are agreeing to. People covered by the provider lose
their local password, so no way in survives their provider revoking them.
**Stand down** takes the provider out of force. Both ask for your password.

## 5. The sign-in address

Once the provider is in force, your colleagues sign in at the **Sign-in
address** shown on the screen, `https://portal.ebpfsentinel.io/s/<handle>`. The
handle is random and names your organisation nowhere, so nobody finds it by
guessing. Send it to your colleagues.

**Replace this address** (behind your password) stops the old one working
immediately; everybody then needs the new one. Somebody who lost it gets it back
through **I have forgotten my password** on the sign-in screen, which mails it
to them.

## 6. Directory provisioning

**Directory provisioning** issues the secret your directory writes people into
the organisation with. Press **Issue a secret**, copy it now (it is shown once;
only a digest is kept), and give your directory the **Base address for your
directory**, which ends in `/scim/v2`, with the secret as a bearer token.

Users and Groups are supported, with filters, paging and `PATCH`. A user your
directory marks inactive loses every session rather than being deleted.
**Withdraw** stops provisioning with that secret without touching sign-in.
Several secrets can be live at once, so a rotation costs no downtime.

## On your own account

**Your account** links to **Identity providers you sign in through**, which lists
the directories that can sign in as you, when each was linked and when it was
last seen. It changes nothing.

## See also

- [Signing In](signing-in.md)
- [Audit Log and Activity](audit-log.md), which records every federated sign-in
  and every refusal with its reason
