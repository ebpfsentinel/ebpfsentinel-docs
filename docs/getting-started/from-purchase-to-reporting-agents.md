# From Purchase to Reporting Agents

> **Edition: Enterprise**

This page walks the whole path once, in the order the customer portal asks for
it: choose a tier, set up two-step verification, issue the licence key, register a
deployment, create its join secret, install the agents, and read the screen that
proves they are running. Every step is done alone, in the portal at
`https://portal.ebpfsentinel.io` and on your own machines; none of it waits on
anybody at our end.

Each screen named below sits under your organisation, at
`https://portal.ebpfsentinel.io/o/<your-organisation>/`, and is reached from the
navigation beside it. What every screen holds, and which roles open it, is in
[Finding Your Way Around the Portal](../portal/overview.md).

## Before you start

- An account on the portal. Signing up creates your organisation and makes you
  its **owner**, which is the role that can do every step below.
- Somebody else can do parts of it. An **administrator** can issue keys and run
  deployments but not buy; a **billing** member can buy and nothing else. Roles
  are set under **Members**, where picking a role changes nothing until you
  confirm it under the sentence saying what that role may do, and only an owner
  is offered the owner role. The portal only lists the sections your role can
  open; an address you were sent for one it cannot names the roles that hold it
  and the people in your organisation who can do it for you. The billing role
  also sees when the key runs out, on **Billing**, since renewing it is theirs.
- Signing up sends a confirmation mail, and the screen that says so names the
  address it went to; **Use another address** goes back to the form with what
  you typed. If it has not arrived, **Send the link
  again** on the screen that says it is on its way asks for another one, and so
  does the screen a dead link lands on. Every mail the portal sends you is
  written in the language the screen was in when you signed up; choosing
  another language in the header while signed in moves your mail to it too.
- If you were invited, follow the link in the invitation mail. Signed out, it
  names the organisation, who invited you and the role you will hold. **Create
  an account** from there asks for no organisation name and creates none: once
  you confirm your address, the confirmation mail brings you back to the
  invitation and you land inside the organisation that invited you. If you
  already have an account, sign in from the same screen instead.
- An invitation lapses on its own. **Members** lists the ones nobody has taken
  up yet with who sent each one and the day it lapses, and **Send again** mails
  it once more to the same address. The invitation screen names the sender and
  that date too, so somebody who waited too long knows whom to ask.
- Your own name and address are changed from your account, under **Details**.
  A new name takes effect at once. A new address asks for your password, then
  sends a link to that address: the account moves only when the link is opened,
  and until then you keep signing in with the current one. If your organisation
  signs in through its own identity provider, the address comes from there and
  is changed there.
- The organisation's name can be changed under **Settings** by an owner or an
  administrator. The address `/o/<your-organisation>/` stays as it was, because
  it is the one your colleagues already hold.
- An owner can close an organisation that never held a subscription and never
  registered a deployment, also under **Settings**: type its name back, re-type
  your password when asked, and it is gone for every member. A deployment that
  was retired still counts, because its history is what your agents were
  measured against. This is how an organisation created by mistake, for
  instance by signing up before accepting an invitation, is removed.
- The enterprise [prerequisites](prerequisites.md): a kernel of 6.9 or later with
  BTF, on every node you mean to protect.

## 1. Choose a tier

Open **Billing** and choose **Choose a plan**. Pick the tier, the number of
agents (one per machine you protect), the machine size band and the term, and
under **Purchase type** whether you buy as a **Business** or as an
**Individual**. The figure follows the form as you fill it in, and it is the
price published on the website. Prices exclude VAT. The purchase type changes
the terms, never the price: a business can give a VAT number, and an individual
has a fourteen-day withdrawal right, see
[Business or individual](../portal/billing-and-licence-keys.md#business-or-individual).

The term decides how the figure is written: per month on a monthly term, per
year on an annual one, never a mix of the two. Beside it, the price of one agent
a month is what you actually pay once every discount is taken, with the
published price struck through when a discount applies. Priced on an annual
term, the quote also says how much paying yearly saves against twelve monthly
payments. While a changed field is being priced the screen says so and the
checkout waits, so it never opens on a price for a different number of agents.

If your account has no two-step verification yet, the screen says so before you pay:
issuing the key afterwards asks for one (step 2), so arming it now means the key
is not held up once the payment lands. It does not stop you buying.

An organisation holds one subscription at a time. Reached with one already running,
the screen offers no form and sends you back to **Billing**, where **Move to
another plan** changes it; with an order still waiting for payment, it asks you
to finish that order at our reseller's checkout or cancel it first.

Under **How to pay**, a card is always offered. A business buying a year at a
time can also pay **By bank transfer, against an invoice** once the year is
large enough, see
[Paying by bank transfer](../portal/billing-and-licence-keys.md#paying-by-bank-transfer).

**Go to the checkout** takes you to our reseller's own page, where the
card is taken and the tax added; we never see the card. You come straight back
to a list headed **From payment to a first agent reporting**: the five steps on
this page that are left, each ticked from what the portal already holds and
each with a link to the screen where it is done; once a deployment is
registered, the step for a first agent reporting opens that deployment and its
checklist. The payment reads as waiting
until our reseller has reported it, usually within a minute; **Check again**
reads everything once more. The list is also reachable from your organisation's
**Overview** while anything on it is left, and goes away once the last step
is done. Once our reseller has reported the payment, the owners, administrators
and billing members of the organisation also receive a mail saying the subscription
is active and what is left to do, so nobody has to sit on the screen waiting
for it.

Once the subscription is running, **Billing** shows the day it renews. **Move to
another plan** reprices it from the same table, and moves it between monthly
and annual billing where our reseller allows that; where it does
not, the screen says so, and changing the term means stopping the subscription and
subscribing again on the other one. Our reseller's documents are listed on the
same page by date, and each one opens in a new tab.

Every paid tier can be bought here. Above a tier's self-serve fleet size the
same tier at the same price is agreed in writing instead, and the screen says
which side of that line your number of agents is on. Past the line it also says how to
ask:

- Write to the address shown on the screen. **Write the request** opens a
  message already carrying the organisation, the tier, the number of agents,
  the machine size, the term and, once you have priced exactly that number of agents, the
  price quoted.
- The agreement comes back by email within one business day.
- Once it is signed it is recorded against your organisation, and pricing the
  same number of agents here again opens the checkout to it. The buying itself stays with
  you.

## 2. Set up two-step verification

A licence key is not issued to an account held by a password alone. Open your
account, then **Two-step verification and passkeys**, and arm one of:

- **Authenticator**: an app on a device you hold. Add it by scanning the QR
  code with the app, or by typing the secret written out beside it, then type
  back the code it shows. Keep the recovery codes it prints: they are shown
  once, so copy them into your password manager or download them as a text
  file before you leave the screen.
- **Passkeys**: a passkey on this computer or phone, or a hardware key. It
  signs you in on its own.

Either one is enough.

Setting up or removing two-step verification, using a recovery code and adding or
removing a device each send a mail to the account it happened to. Issuing or
replacing a key mails every owner and administrator of the organisation, a
change of role mails the member whose role moved, an accepted invitation mails
the person who sent it, and closing an account sends one last mail to the
address it held. A mail you did not expect is the signal to open **Your
account** and end the sessions you do not recognise, see
[Signing In](../portal/signing-in.md). No mail from the portal carries a code,
a key or a link that signs you in.

## 3. Issue and verify the licence key

Open **Licence keys**, the screen headed **Licence keys**, and choose **Issue a
key**. If you have not signed in or confirmed your password in the last fifteen
minutes, the portal asks for it again first, see
[When the portal asks for your password again](../portal/signing-in.md#when-the-portal-asks-for-your-password-again);
it then signs a key from your subscription. If your account has no two-step verification
yet, the key is refused and the refusal links straight to the screen where you
arm one. Choose **Download the key**; the file
is named after your organisation, for example `ebpfsentinel-acme.lic`.

The key is a **fleet key**: one file for every node, bound to no machine, so a
node that is rebuilt or replaced keeps working with it. What it admits is shown
beside it, and explained in [License](../features/enterprise/license.md#keys-bought-from-the-portal).

Verify it before installing it. Under **Check this file yourself** the page
prints two commands: `sha256sum` against the fingerprint shown beside the key,
and `ebpfsentinel-license inspect` against the two published public keys. The
public keys are deliberately not served by the portal: take them from a
measurements release or from the enterprise release tarball, as described in
[Where the public keys come from](../features/enterprise/license.md#where-the-public-keys-come-from).

## 4. Register a deployment

Open **Deployments** and use **Register a deployment**. A deployment is the unit
your agents are counted in: one per cluster, site or environment you want to see
separately, for example `production` and `staging`. The name is yours and unique
within the organisation.

## 5. Create a join secret

Open the deployment and, under **Join secrets**, choose **Create a join secret**.
Past the fifteen minutes, the portal asks for your password again first. It
shows the secret **once**: only a
digest of it is kept, so copy it before choosing **I have copied it**.

The installation steps for your deployment shape are printed beside it, with
the portal's address filled in. The secret itself is left out of them on
purpose: every command reads it from a prompt that does not echo, so it ends up
in neither your shell history nor the process list.

A join secret only lets a machine join. Each agent that joins receives a
credential of its own, so revoking a join secret later stops new agents and
silences none of the ones already reporting. Several can be live at once, which
is how a rotation costs no downtime, and none of them expires.

## 6. Install the agents

The key and the join secret go to the agents one of three ways. In each, the
key is installed unchanged on every node and the join secret is read from a
Secret or a file, never from a value that is templated or committed.

| Shape | What to do | Reference |
|---|---|---|
| Helm | Create a Secret for the key and one for the join secret, then set `license.secretName`, `portal.enabled`, `portal.baseUrl` and `portal.joinSecret.secretName` | [Enterprise Deployment - Kubernetes (Helm)](../operations/deployment/enterprise.md#kubernetes-helm) |
| Operator | Create the same Secrets, then name them in `EnterpriseSettings` under `licenseSecretRef` and `spec.portal.joinSecretRef` | [Kubernetes Operator - Reporting to the vendor portal](../features/enterprise/kubernetes-operator.md#reporting-to-the-vendor-portal) |
| Host | Install the key at the configured `license_path`, write the join secret to a `0600` file, and point `enterprise.portal.join_secret_file` at it | [Enterprise Deployment - Bare metal](../operations/deployment/enterprise.md#bare-metal-systemd) and [Vendor portal reporting](../configuration/enterprise.md#vendor-portal-reporting) |

On a host, the `enterprise` block of `/etc/ebpfsentinel/config.yaml` then reads:

```yaml
enterprise:
  license_path: /etc/ebpfsentinel/license.key
  portal:
    enabled: true
    base_url: https://portal.ebpfsentinel.io
    join_secret_file: /etc/ebpfsentinel/portal-join-secret
```

Restart the agent after installing its first key: which enterprise features
are mounted is decided when the agent starts. A renewed key installed later over
the same file is picked up within a minute without a restart. Each agent joins under its host name unless
`agent_name` says otherwise, and joining again under the same name is the same
agent rather than a new one, so a node that loses its state is not counted
twice.

## 7. Optionally, send counters

Reporting in and sending counters are two decisions. Up to here an agent only
says it exists, which is what your subscription is measured against. To see
traffic, losses and whether the programs are loaded as graphs in the portal:

1. On the deployment, open **Telemetry for this deployment**, read what is sent
   and what never is, and choose **Turn telemetry on**.
2. Under **Ingest tokens**, choose **Issue an ingest token** and copy it. It is
   a third credential, neither the key nor the join secret.
3. Give it to the agents beside the join secret: `portal.telemetry.enabled` and
   `portal.ingestSecret.secretName` with Helm, `telemetryEnabled` and
   `ingestSecretRef` with the operator, or `telemetry_enabled` and
   `ingest_secret_file` on a host. See
   [Optional analytics](../configuration/enterprise.md#optional-analytics).

Turning telemetry off revokes the ingest tokens and leaves the agents counted.

On **Analytics**, health reads **No agent reporting** rather than a health
word until at least one agent has sent a reading, and while every deployment
collecting has stopped reporting. While any enrolled agent in a live deployment has
stopped reporting, it reads **Agents not reporting** rather than a health
word, with a link to the ones not reporting. Each deployment says whether its
telemetry is **Turned on** or **Turned off**. A retired deployment reads **Retired** and
nothing else, and each of the busiest agents carries its deployment in
brackets, so two nodes with the same name are two rows you can tell apart. The
only machine name the portal holds is the one each agent joined under.

## 8. Check the Usage screen

Open **Usage**: what you bought, what your key admits, and what is
actually running. It is the proof the steps above worked.

- **Your agents** counts the agents that reported in the last five minutes.
  Every node you installed should be there within one heartbeat.
- **Within your subscription** means the agents reporting fit what you bought.
  **Over your subscription** means they do not; buy more agents under **Billing**.
- Agents that joined and have not reported lately are listed as **not reporting**
  beside the count, not in it, so a rolling upgrade does not read as a breach.
- **What your licence key admits** is kept apart from the subscription. If the key
  admits fewer agents than you now pay for, replace it from **Licence keys** and
  install the new file.
- **Where they are** lists the agents per deployment. Open a deployment to see
  each agent under **Agents**, with its version and when it last reported.

If a node is missing, work through the checklist on the deployment, see
[When nothing reports](../portal/deployments-and-agents.md#when-nothing-reports).
The agent says why in its own log: a refused join secret
is an HTTP 401, a portal it cannot reach is retried with a backoff that grows to
fifteen minutes, and `GET /api/v1/license` on the agent shows whether the key
was accepted.

## See also

- [Finding Your Way Around the Portal](../portal/overview.md)
- [Signing In](../portal/signing-in.md)
- [Billing and Licence Keys](../portal/billing-and-licence-keys.md)
- [Single Sign-On and Provisioning](../portal/single-sign-on.md)
- [Members and Invitations](../portal/members-and-invitations.md)
- [Deployments and Agents](../portal/deployments-and-agents.md)
- [Analytics](../portal/analytics.md)
- [Audit Log and Activity](../portal/audit-log.md)
- [Your Data](../portal/your-data.md)
