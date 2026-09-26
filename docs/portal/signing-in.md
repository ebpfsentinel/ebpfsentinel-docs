# Signing In

> **Edition: Enterprise**

How you get into the customer portal, the second factors that protect the way
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
sign-in address your administrators sent you instead, see
[Single Sign-On and Provisioning](single-sign-on.md).

## Forgotten password

**I have forgotten my password** opens **Reset your password**. Type your
address and press **Send the link**. The answer is the same whether or not the
address belongs to an account, so the screen cannot be used to find out who is a
customer. The link leads to **Choose a new password**; setting it ends every
session on the account, including any you did not open.

An account whose organisation signs in through its own identity provider has no
local password. The same form mails that person the address they sign in at
instead of a link, which is also how a lost sign-in address is found again.

## Second factors and passkeys

**Your account** links to **Second factors and passkeys**. A licence key is only
issued to an account holding an authenticator or a passkey, so arm one before
you need a key.

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
name you will recognise under **Name for this device**, press **Register a
passkey** and confirm your password; the browser then asks the device. Each
passkey is listed with its name, and can be removed.

A passkey does not turn on the second factor for password sign-ins: nothing
prints recovery codes for a passkey, and one lost device would otherwise lock
you out.

### Your colleagues

**People**, inside an organisation, shows beside each member either **Second
factor on** or **Password only - no key can be issued to them**, so an owner
knows before asking somebody to issue a key.

## Everything signed in as you

**Your account** lists under **Signed in** every browser currently signed in as
you: the device it runs on, when it signed in and, where one was recorded, the
address it came from. The portal records the address the network edge in front
of it reports; a session opened without one keeps none, and the screen says so
under the list rather than printing a blank.

**End this session** ends one. **Sign out everywhere else** ends every session
but the one you are using and changes nothing else: your password, your keys and
your deployments stay as they are. Anything you cannot account for should be
ended, and your password changed afterwards.

## See also

- [Audit Log and Activity](audit-log.md), where every sign-in, including refused
  ones, is recorded
- [Your Data](your-data.md)
