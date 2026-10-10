# Billing and Licence Keys

> **Edition: Enterprise**

Everything about the subscription after it is bought: changing it, paying for it,
ending it, our reseller's documents, and the licence key that comes from it. Buying
the first subscription and issuing the first key are walked in
[From Purchase to Reporting Agents](../getting-started/from-purchase-to-reporting-agents.md).
**Billing** is opened by owners and billing members; **Licence keys** by owners and
administrators.

## Who sells to you

You buy from our reseller, a company that is the legal seller on your
purchase. It takes the payment, adds the VAT due in your country at its own
checkout, and issues every invoice. The portal holds your subscription and a
reference to our reseller's documents; it renders none of its own and never sees
your card.

That is also why the legal name, the billing address and the VAT number printed
on an invoice are entered at our reseller's checkout rather than in the portal.
**Settings** has a **Billing details** panel saying so, with a link to our
reseller's documents.

## Business or individual

**Purchase type** on **Choose a plan** asks whether you buy as a **Business** or
as an **Individual**. It changes the terms of the sale, never the price.

- A **Business** can give a **VAT number**. It is checked against the EU
  registry when you buy, and what the registry answered that day is kept with
  the subscription. Declaring a business without a number, or with one the
  registry rejects, changes nothing about the tax: VAT is added at the checkout
  as it would be for anybody else.
- An **Individual** has a fourteen-day right to withdraw from the purchase.
  A licence key cannot be taken back once it is issued, so the key comes after
  those fourteen days have run. To start straight away, tick **Start straight
  away and give up the fourteen-day withdrawal right** before paying: the key
  can then be issued as soon as the payment is reported. Only an individual
  purchase carries that box.

Prices exclude VAT in both cases. It is added at our reseller's checkout at the
rate of your country.

## Paying by bank transfer

Under **How to pay**, **By card, at our reseller's checkout** is always offered.
**By bank transfer, against an invoice** is offered as well when all three hold:

- the purchase is a **Business** one;
- the subscription is billed a year at a time;
- the year comes to 10,000 EUR or more before tax, or a written agreement on
  this organisation admits it.

Choosing it asks for the **Company named on the invoice**, where to **Send the
invoice to** (usually your accounts payable mailbox), the billing address, and
optionally a **Purchase order number** printed on the invoice so your accounts
team can match it. **Issue the invoice** has our reseller send it straight
away, payable by bank transfer within thirty days; the bank details are on the
invoice.

Until the transfer arrives the subscription reads **Awaiting payment**, no
licence key can be issued from it, and **Choose a plan** asks you to pay that
invoice or cancel the order before choosing another plan. Once our reseller
reports the transfer, the subscription reads **Running** and the key can be
issued. The invoice is issued and the transfer collected by our reseller; we
never handle the money.

## How the price is counted

The price is the one published on the website, worked out the same way at every
fleet size. Beside the figure, the screen names every discount it took:

- **Volume discount**: the larger the number of agents, the lower the band and
  the price of each one. The band is taken on the agents being bought, or, when
  a provider holds the account (see below), on every agent held by the
  organisation paying for it, and the screen says so: **The volume band was
  taken across N agents, which is everything held by the organisation paying
  for this one.** A fleet is never banded below its own size.
- **Partner discount**: the published partner discount, taken after the volume
  band, for an organisation we have agreed to treat as a partner. It is granted
  by us after an exchange in writing, never by the product itself, and holding
  several organisations does not earn it.
- **Annual discount**: paying a year at a time takes the published annual
  discount off twelve monthly payments, and the quote says how much that saves.

**Published price before discounts** shows what one agent costs before any of
them. The discounts in force when a subscription is opened are kept with it: a
provider taking on another customer does not reprice the subscriptions it
already holds, and a partner standing withdrawn later leaves each subscription
at its price until that subscription is changed.

## Billing

**Your subscription** shows the plan, whether it is **Running**, **Awaiting
payment** or **Ended**, who is buying, and the **Dates**: when it started, when it
renews, and whether an end was requested. **Licence key** beside it shows the
date the key on your agents stops being accepted.

### Move to another plan

Choose a **Plan**, the **Agents** and the **Machine size**. As soon as the form
differs from your current plan, the screen prices it and says how much more or
less that costs against your current plan, per month or per year, with the price
of one agent a month on what you would pay. **Move to this plan** applies it at once, and our reseller
charges or credits the difference for the rest of the current period straight
away.

The key your agents hold still carries the old plan. Replace it from
**Licence keys** afterwards so it admits the new one.

Our reseller cannot always move a subscription between monthly and annual billing. The
screen says so; to change the term, end the subscription and subscribe again.

### Change the card

**Change the card** opens our reseller's own card page. If you have not signed in
or confirmed your password in the last fifteen minutes, it asks for your
password first, see
[When the portal asks for your password again](signing-in.md#when-the-portal-asks-for-your-password-again).
The card never passes through the portal.

### End the subscription

**End this subscription**, then **End it**. The screen says the day the subscription
ends, which is the close of the period you have paid for, and the day the key on
your agents stops working, which is the date signed into it. Until our reseller
reports the end, the subscription keeps running and nothing more is charged
after it.

An order that was never paid is not a subscription yet: **Cancel this order**,
then **Cancel it**. Nothing was charged.

### An order left unpaid

If you left our reseller's checkout before paying, the order waits for its
payment. **Continue to the checkout**, on **Billing** or on the subscribe screen,
takes you back to the same checkout rather than starting a second order. An order
raised on an invoice has no checkout to go back to: it is paid by bank transfer.

Until the payment lands, **Usage**, **Analytics**, **Licence keys** and the
licence panel on **Billing** all say the order is waiting for payment, with the
agents on it. It entitles you to nothing yet, and no key exists: one is issued
from **Licence keys** once the payment lands.

### Documents

**Documents** lists what our reseller issued, one per payment, each opening our
reseller's own copy in a new tab. A document appears a few minutes after our
reseller reports the payment it covers, so a payment made moments ago may not be
listed yet.

## Accounts held by a provider

A provider that runs agents for its customers can open one organisation per
customer and pay for it. On **Your organisations**, **For providers: open an
account for a customer whose agents you run** asks for the **Customer's name**
and **Open the account** creates the organisation, with you as its first owner
and your organisation as the one holding it. Opening one is open to the owners
and administrators of the provider's organisation.

The organisation stays the customer's: their name, their licence key, their
agents and their monthly allowance, and they sign in at an address of their
own. The only thing the provider holds is the bill: the subscription is opened
from the provider's side, by somebody who manages billing in the provider's own
organisation, it is charged to the provider, and its volume band is taken across
everything the provider holds. The customer's own people run the organisation
but cannot open its subscription.

On the customer's **Billing**, **Somebody else holds this account** names the
provider. An owner on either side, the provider's or the customer's own, ends
the arrangement there with **End the arrangement**, then **Yes, end it**: the licence stays valid, the agents stay enrolled and the
month already metered is untouched. What changes is who the next subscription
is billed to.

## Licences

**Licence keys** in the navigation opens the screen headed **Licence keys**. It
lists the active key with the date it was issued, what it admits, its
fingerprint and the days left. Every act on this screen but revoking needs you
to have signed in or confirmed your password in the last fifteen minutes; past
that, it asks for your password again before going through, see
[When the portal asks for your password again](signing-in.md#when-the-portal-asks-for-your-password-again).

A key runs to the end of the period our reseller last reported paid, plus seven
days of grace so a late payment never stops your agents on the day. The date
comes from the payment, not from the moment the key was signed, so replacing a
key keeps the same date, and a key asked for after a renewal carries the new
period.

- **Issue a key** signs a key from the paid subscription. It is refused to an account
  without two-step verification, an authenticator or a passkey, see
  [Signing In](signing-in.md), and, on an individual purchase, until the
  withdrawal period has run unless it was given up, see
  [Business or individual](#business-or-individual).
- **Download the key** saves the file, named after your organisation.
- **Replace this key**, then **Replace it**, signs a replacement and stands the
  old one down. Machines running on the old file keep running on it until its own
  date, but it is no longer the key your subscription stands behind: install the new
  file on every machine.
- **Stop trusting this key**, then **Revoke it**, with a reason. It cannot be
  undone, and nothing reaches machines already running on the file: they keep
  running on it until you replace it or it expires. The offline bundle lists it
  as revoked, so agents checking the bundle can refuse it.

Owners and administrators are mailed when a key is issued or replaced, and
thirty, fourteen and three days before it runs out.

### Enterprise trial

An organisation with no subscription and no active key is offered **Try
Enterprise for 14 days** on **Licence keys**, with no card. The organisation's
overview and the plan choice under **Billing** offer it too, with **Start the
trial** leading to **Licence keys**. Once a subscription exists, paid or still waiting
for its payment, the trial is no longer offered: the subscription's own key is the
next step. **Generate the trial key** signs
one Enterprise key carrying every Enterprise feature, with no agent ceiling and
no per-node size ceiling. It asks what a paid key asks: two-step verification on your
account and a password confirmed in the last fifteen minutes. **Download the
trial key** saves the file, and it is installed like any other key.

There is one trial per organisation. Asking again hands back the same key,
including once it has expired, so it never becomes fourteen days at a time. The
trial button on the website leads to the portal's `/trial` address: signed in,
it opens **Licence keys** in your default organisation; without an account, it
opens the sign-up form first.

The trial key runs fourteen days from the moment it is generated. The portal
adds none of the seven days of grace a paid key carries, because there is no
payment to wait for. On the machines, the agent applies its fourteen-day grace
window after expiry to every key, the trial included, see
[Expiry and grace](../features/enterprise/license.md#expiry-and-grace): every
Enterprise feature keeps working and the licence status says it is in grace, so
the trial gives four weeks of Enterprise in all. Once the grace has passed, the agent runs on the open source feature set and keeps protecting
traffic. Buying a subscription and issuing a key from it is what carries your agents
on.

### Design partner key

An organisation we have agreed to take on as a design partner is owed a year
rather than fourteen days, on the same terms as the trial key otherwise. If the
organisation has not taken its trial yet, **Generate the trial key** signs the
year directly. If it already holds the fourteen-day key, **Licence keys** shows **Your
design partner key is waiting**, and **Generate the design partner key**
replaces the fourteen days with the year, once: install the new file in place of
the old one. Either way the key is listed as **Enterprise design partner key**
and runs 365 days from the moment it is generated.

### Revocations reach connected agents on their own

An agent enrolled with the portal receives your organisation's revocation list
in the answer to every heartbeat and adds it to its local revocation file, which
it reads again every minute. A key you revoke here stops being honoured across
your agents one heartbeat and one minute later, with nothing to copy (see
[Revocation](../features/enterprise/license.md#revocation)). The list only ever grows on the agent: leaving the portal
never hands a revoked key back.

### Offline bundle

Agents with no route back to the portal uses **Offline bundle**: **Download
the bundle** saves one file carrying every active key, each with its
fingerprint, and every revocation that can still change what your agents run.
Read it with `ebpfsentinel-license bundle`; each key inside is verified against
the public key compiled into the agent, see
[License](../features/enterprise/license.md).

## See also

- [Finding Your Way Around the Portal](overview.md)
- [Your Data](your-data.md), for why a subscription must end before an account
  can be deleted
