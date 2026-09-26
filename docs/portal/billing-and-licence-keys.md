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

Choose a **Plan**, the **Agents** and the **Machine size**, then **Price this**.
The screen says how much more or less that costs against your current plan, per
month or per year. **Move to this plan** applies it at once, and the seller
charges or credits the difference for the rest of the current period straight
away.

The key your agents hold still carries the old plan. Replace it from
**Licences** afterwards so it admits the new one.

Some sellers cannot move a contract between monthly and annual billing. The
screen says so; to change the term, end the contract and subscribe again.

### Change the card

**Change the card** asks for your password, then opens the seller's own card
page. The card never passes through the portal.

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

**Licence keys** lists the key in force with the date it was issued, what it
admits, its fingerprint and the days left. Every act on this screen asks for
your password again, except revoking.

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
