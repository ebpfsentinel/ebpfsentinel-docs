# Billing and Licence Keys

> **Edition: Enterprise**

Everything about the contract after it is bought: changing it, paying for it,
ending it, the seller's documents, and the licence key that comes from it. Buying
the first contract and issuing the first key are walked in
[From Purchase to Reporting Agents](../getting-started/from-purchase-to-reporting-agents.md).
**Billing** is opened by owners and billing members; **Licences** by owners and
administrators.

## Who sells to you

You buy from a seller of record, a company that is the legal seller on your
purchase. It takes the payment, adds the VAT due in your country at its own
checkout, and issues every invoice. The portal holds your contract and a
reference to the seller's documents; it renders none of its own and never sees
your card.

That is also why the legal name, the billing address and the VAT number printed
on an invoice are entered at the seller's checkout rather than in the portal.
**Settings** has a **Billing details** panel saying so, with a link to the
seller's documents.

## Billing

**Your subscription** shows the plan, whether it is **Running**, **Awaiting
payment** or **Ended**, who is buying, and the **Dates**: when it started, when it
renews, and whether an end was requested. **Licence key** beside it shows the
date the key in your estate stops being accepted.

### Move to another plan

Choose a **Plan**, the **Agents** and the **Machine size**. As soon as the form
differs from your current plan, the screen prices it and says how much more or
less that costs against your current plan, per month or per year, with the price
of one agent a month on what you would pay. **Move to this plan** applies it at once, and the seller
charges or credits the difference for the rest of the current period straight
away.

The key your agents hold still carries the old plan. Replace it from
**Licences** afterwards so it admits the new one.

Some sellers cannot move a contract between monthly and annual billing. The
screen says so; to change the term, end the contract and subscribe again.

### Change the card

**Change the card** opens the seller's own card page. If you have not signed in
or confirmed your password in the last fifteen minutes, it asks for your
password first, see
[When the portal asks for your password again](signing-in.md#when-the-portal-asks-for-your-password-again).
The card never passes through the portal.

### End the subscription

**End this subscription**, then **End it**. The screen says the day the contract
ends, which is the close of the period you have paid for, and the day the key in
your estate stops working, which is the date signed into it. Until the seller
reports the end, the subscription keeps running and nothing more is charged
after it.

An order that was never paid is not a contract yet: **Withdraw this order**,
then **Withdraw it**. Nothing was charged.

### Documents

**Documents** lists what the seller issued, one per payment, each opening the
seller's own copy in a new tab. A document appears a few minutes after the
seller reports the payment it covers, so a payment made moments ago may not be
listed yet.

## Licences

**Licences** in the navigation opens the screen headed **Licence keys**. It
lists the key in force with the date it was issued, what it admits, its
fingerprint and the days left. Every act on this screen but revoking needs you
to have signed in or confirmed your password in the last fifteen minutes; past
that, it asks for your password again before going through, see
[When the portal asks for your password again](signing-in.md#when-the-portal-asks-for-your-password-again).

A key runs to the end of the period the seller last reported paid, plus seven
days of grace so a late payment never stops your estate on the day. The date
comes from the payment, not from the moment the key was signed, so replacing a
key keeps the same date, and a key asked for after a renewal carries the new
period.

- **Issue a key** signs a key from the paid contract. It is refused to an account
  holding no second factor, see [Signing In](signing-in.md).
- **Download the key** saves the file, named after your organisation.
- **Replace this key**, then **Replace it**, signs a replacement and stands the
  old one down. Machines running on the old file keep running on it until its own
  date, but it is no longer the key your contract stands behind: install the new
  file on every machine.
- **Stop trusting this key**, then **Revoke it**, with a reason. It cannot be
  undone, and nothing reaches machines already running on the file: they keep
  running on it until you replace it or it expires. The offline bundle lists it
  as revoked, so an estate checking the bundle can refuse it.

Owners and administrators are mailed when a key is issued or replaced, and
thirty, fourteen and three days before it runs out.

### Enterprise trial

An organisation with no contract and no key in force is offered **Try
Enterprise for 14 days** on **Licences**, with no card. The organisation's
overview and the plan choice under **Billing** offer it too, with **Start the
trial** leading to **Licences**. Once a contract exists, paid or still waiting
for its payment, the trial is no longer offered: the contract's own key is the
next step. **Generate the trial key** signs
one Enterprise key carrying every Enterprise feature, with no agent ceiling and
no per-node size ceiling. It asks what a paid key asks: a second factor on your
account and a password confirmed in the last fifteen minutes. **Download the
trial key** saves the file, and it is installed like any other key.

There is one trial per organisation. Asking again hands back the same key,
including once it has expired, so it never becomes fourteen days at a time. The
trial button on the website leads to the portal's `/trial` address: signed in,
it opens **Licences** in your default organisation; without an account, it
opens the sign-up form first.

The trial key runs fourteen days from the moment it is generated. The portal
adds none of the seven days of grace a paid key carries, because there is no
payment to wait for. On the machines, the agent applies its fourteen-day grace
window after expiry to every key, the trial included, see
[Expiry and grace](../features/enterprise/license.md#expiry-and-grace): every
Enterprise feature keeps working and the licence status says it is in grace, so
the trial gives four weeks of Enterprise in all. Once the grace has passed, the agent runs on the open source feature set and keeps protecting
traffic. Buying a contract and issuing a key from it is what carries the estate
on.

### Design partner key

An organisation we have agreed to take on as a design partner is owed a year
rather than fourteen days, on the same terms as the trial key otherwise. If the
organisation has not taken its trial yet, **Generate the trial key** signs the
year directly. If it already holds the fourteen-day key, **Licences** shows **Your
design partner key is waiting**, and **Generate the design partner key**
replaces the fourteen days with the year, once: install the new file in place of
the old one. Either way the key is listed as **Enterprise design partner key**
and runs 365 days from the moment it is generated.

### Revocations reach connected agents on their own

An agent enrolled with the portal receives your organisation's revocation list
in the answer to every heartbeat and adds it to its local revocation file, which
it reads again every minute. A key you revoke here stops being honoured across
that fleet one heartbeat and one minute later, with nothing to copy (see
[Revocation](../features/enterprise/license.md#revocation)). The list only ever grows on the agent: leaving the portal
never hands a revoked key back.

### Offline bundle

An estate with no route back to the portal uses **Offline bundle**: **Download
the bundle** saves one file carrying every key in force, each with its
fingerprint, and every revocation that can still change what your fleet runs.
Read it with `ebpfsentinel-license bundle`; each key inside is verified against
the public key compiled into the agent, see
[License](../features/enterprise/license.md).

## See also

- [Finding Your Way Around the Portal](overview.md)
- [Your Data](your-data.md), for why a subscription must end before an account
  can be deleted
