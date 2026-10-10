# Signing In

> **Edition: Enterprise**

How you get into the customer portal, the two-step verification and passkeys that protect the way
in, and how to see and end everything signed in as you. Screens are named the
way the portal names them; where they sit is described in
[Finding Your Way Around the Portal](overview.md).

## Signing in

**Sign in** takes your address and your password. If your account holds an
authenticator, a second screen, **One more step**, asks for six digits from
your authenticator app or one of your recovery codes.

**Sign in with a passkey** on the same screen signs you in with a passkey alone:
the device verifies you before it signs anything, so no password and no code are
asked for afterwards. If the device refuses, the screen says so and the password
path is still there.

If your organisation signs in through its own identity provider, you use the
sign-in address the people who run it sent you instead, see
[Single Sign-On and Provisioning](single-sign-on.md).

## Forgotten password

**I have forgotten my password** opens **Reset your password**. Type your
address and press **Send the link**. The answer is the same whether or not the
address belongs to an account, so the screen cannot be used to find out who is a
customer. The link leads to **Choose a new password**; setting it ends every
session on the account, including any you did not open.

An account whose organisation signs in through its own identity provider has no
local password, apart from the owner who turned the provider on and anybody who
also belongs to another organisation. The same form mails that person the
address they sign in at instead of a link, which is also how a lost sign-in
address is found again.

## Two-step verification and passkeys

**Your account** links to **Two-step verification and passkeys**, which opens the screen
titled **Two-step verification** at `/account/security`. A licence key is only issued to
an account holding an authenticator or a passkey, so arm one before you need a
key.

### Authenticator

**Add an authenticator**, then scan the code with your authenticator app (or
type the secret into it) and type back the code it shows under **Confirm the
code**. From then on it is asked for at every password sign-in.

Arming it shows your **Recovery codes** once. Each works once, in place of a
code from the app. Keep them with **Copy the codes** or **Download as a text
file**, then press **I have kept them**: there is no way to read them back and
nobody at our end can send them to you. The screen shows how many are left and
warns when you are running low; **Print new recovery codes** replaces the whole
list, and every code on the old one stops working at once.

**Remove the authenticator** asks for your password again and voids the
recovery codes with it.

### Passkeys

A passkey is a security key, or a laptop or phone that holds one. Give it a
name you will recognise under **Name for this passkey**, press **Register a
passkey**, confirm your password if the portal asks for it again (see below),
and the browser then asks the device. Each
passkey is listed with its name, and can be removed.

A passkey does not turn on two-step verification for password sign-ins: nothing
prints recovery codes for a passkey, and one lost device would otherwise lock
you out.

### Your colleagues

**Members**, inside an organisation, shows beside each member either **Two-step
verification on** or **Password only - they cannot issue a licence key until
they set up two-step verification**, so an owner
knows before asking somebody to issue a key.

## Everything signed in as you

Sessions are on **Your account** itself, at `/account`, not on **Two-step
verification**. **Your account** lists under **Signed in** every browser currently
signed in as you: the device it runs on, when it signed in and, where one was recorded, the
address it came from. The portal records the address the network edge in front
of it reports; a session opened without one keeps none, and the screen says so
under the list rather than printing a blank.

**End this session** ends one. **Sign out everywhere else** ends every session
but the one you are using and changes nothing else: your password, your keys and
your deployments stay as they are. Anything you cannot account for should be
ended, and your password changed afterwards.

## When the portal asks for your password again

Some acts are only done by somebody who proved who they are in the last
**fifteen minutes**:

- on **Licence keys**: issuing, replacing or downloading a key, the offline bundle
  and the trial key;
- changing the card, on **Billing**;
- creating a join secret or issuing an ingest token, and erasing telemetry readings;
- on **Single sign-on**: saving the provider, checking a domain, adding a rule,
  turning the provider on, replacing the sign-in
  address and issuing a SCIM token;
- closing an organisation, from **Settings**;
- on your own account: changing your address, removing the authenticator,
  printing new recovery codes, adding or removing a passkey, and deleting the
  account.

Signing in counts as that proof. Within fifteen minutes of signing in, or of
the last time you confirmed, these acts go straight through and nothing is
asked. Past that, the screen opens **Confirm it is you** where you are, with a
line saying which act it is for: re-type your password and, if your account
holds an authenticator, a code from it or a recovery code. **Confirm** then
carries out the act you asked for; **Not now** leaves everything as it was.
Every page in this section that says an act "asks for your password again" or
sits "behind your password" means this prompt, and it only appears once the
fifteen minutes have run out.

An account that signs in through its organisation's own identity provider and
holds no password has none to re-type here. Do those acts within fifteen minutes of signing
in; past that, sign out and sign in again at your organisation's sign-in
address.

## See also

- [Audit Log and Activity](audit-log.md), where every sign-in, including refused
  ones, is recorded
- [Your Data](your-data.md)
