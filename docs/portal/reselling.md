# Reselling eBPFsentinel

> **Edition: Enterprise, bought by a provider for its customers**

A managed service provider runs the agent for its customers, sells the paid
layer on under its own name, or both. This page walks the arrangement from the
provider's side: how each customer gets an organisation of its own, what the
partner price is and how it is asked for, who invoices whom, what the provider
agreement says, and what happens to a customer's keys when the relationship
ends.

The open source agent needs none of this. It is governed by the AGPL-3.0 alone,
for a provider as for anyone else: you may run it for as many customers as you
like with no standing and no agreement with us, as long as you meet the AGPL's
own conditions.

## One organisation per customer

Every customer you serve gets its own organisation in the portal, with its own
name, its own licence key, its own agents and its own monthly allowance. You
open it from **Your organisations**, and the steps, who may take them and how
either side ends the arrangement are in
[Accounts held by a provider](billing-and-licence-keys.md#accounts-held-by-a-provider).

What follows from that shape:

- **One key per customer.** A key names the customer's organisation and covers
  the nodes bought for it. It never runs on another customer's nodes, nor on
  yours, and there is no key for a whole portfolio.
- **You hold the bill, not the account.** The subscription is opened from your
  side, charged to you, and its volume band is taken across every agent your
  organisation holds. The customer's own people run their organisation and
  read **Billed through a provider** on its **Billing** screen.
- **Paying for an organisation gives you no reading of it.** Your people reach a
  customer's records only through the memberships that customer granted them,
  and it can end those without telling us, see
  [Members and Invitations](members-and-invitations.md).
- **Your own estate is not part of the portfolio.** Nodes you run for yourself
  are bought in your own organisation, at the published price, like anybody
  else's.

## The partner price

The partner price is the published partner discount, taken after the volume
band, see [How the price is counted](billing-and-licence-keys.md#how-the-price-is-counted).
Holding several organisations does not earn it by itself: it is granted to a
named organisation, by a person at our end who reads who the provider is and
what it resells, and it comes with the provider agreement described below.

You ask for it from your own organisation's **Billing** screen, where the
**Partner price** panel appears once your organisation holds at least one
customer organisation:

1. Below two customer organisations, the panel says how many you hold and from
   how many the partner price can be asked for. Nothing can be sent yet.
2. From two, an owner or a billing member writes under **Who your customers
   are** what you resell and to whom, at most 2,000 characters, and presses
   **Ask for the partner price**. Other members read where the request stands
   but cannot send it.
3. The panel then says the day you asked and how many customer organisations
   you held that day, and shows what you wrote. The answer comes in writing to
   the owners of your organisation. Asking changes no price until that answer
   is recorded.
4. While the request waits, **Withdraw the request** takes it back, and you may
   ask again afterwards. A second request cannot be sent while one is waiting.
5. Once the grant is recorded, the panel says since which day you buy at the
   partner price, and the request is closed in the same step.

The discounts in force when a subscription is opened stay with it: a
subscription opened before the grant keeps its price until it is changed, and
one opened at the partner price keeps it if standing later ends.

## A partner invitation

When we have agreed in writing that your company resells eBPFsentinel before
it has an account, the agreement reaches you as a link, written for your
company's domain. It replaces the request above: nothing to ask for.

1. The link opens **A partner invitation**: the company it was written for,
   who can take it up (anybody with an address at that domain) and **The link
   works until** its last day.
2. Create an account with an address at that domain, or sign in if you
   already have one. Once your address is confirmed, **Take this invitation
   up** lists the organisations you own; choose the one that resells. An
   organisation comes in through one invitation.
3. That organisation manages customer organisations from the start. Its
   **Billing** screen says how many it holds and from how many the partner
   price applies, and the partner price is put in force automatically the day
   it holds a second customer organisation.

A link works once, and only until its date, which is at most 90 days after it
was written. A link we withdraw, one already taken up, or one past its date
opens a page saying it can no longer be taken up. The portal keeps only a
digest of the link, never the link itself, and an invitation nobody took up is
erased 30 days after its link stopped working.

## Who invoices whom

Three sales and one licence chain appear in the arrangement, and none of them
is ours to invoice:

- **Our reseller sells to you.** You buy each subscription in your portfolio at
  its checkout. As merchant of record it is your seller: it takes the payment,
  adds the tax due, issues the invoice and handles any refund, see
  [Who sells to you](billing-and-licence-keys.md#who-sells-to-you).
- **You sell to your customer**, under your own terms, in your own name, on your
  own invoices, and you charge and account for the tax on your sales. Neither
  our reseller nor we take part in that sale or invoice your customers.
- **You set your prices freely.** Price, margin and commercial terms are yours
  alone; any price we publish is the price of our own sales.
- **The licence runs one level deep**: from us to you, from you to your customer.
  Your customer may not resell further, and you may not appoint another provider
  in your place.

## The provider agreement in plain words

`EULA-MSSP.md` is the Managed Service Provider Licence Agreement, shipped in
every enterprise release beside its French version, `EULA-MSSP.fr.md`, which
prevails in France. The website's
[provider terms](https://ebpfsentinel.io/legal/partner) summarise it, and where
a summary and the agreement differ, the agreement prevails. In short:

- **What it grants.** While your standing is in force, the right to resell and
  sublicense the paid layer to each managed customer on the nodes its key
  covers, and to install, run, configure, upgrade and administer it on their
  behalf, including inside a managed service you sell under your own name. On
  those nodes the AGPL obligations on the agent are lifted for you and for that
  customer. A trial key lifts none and may not be resold.
- **What you pass on.** Before a customer uses the paid layer, it accepts terms
  of yours carrying at least the nine clauses section 5 lists: licensed and not
  sold, limited to its own nodes, no circumvention, its statutory rights stated
  as unaffected, what the agent sends described faithfully, export law, third
  party licences, what an expiry costs, and our right to enforce the core
  restrictions directly. You keep the proof of that acceptance while the
  customer uses the software and five years after. Toward a consumer you are
  the professional supplier and carry the consumer obligations.
- **What you answer for.** Your customers' use of their keys, a leaked key you
  learn of, and the commitments you made in your own service. You are an
  independent business: you give no commitment in our name, and we give none in
  yours.
- **Adding nodes.** When a customer's fleet outgrows its key, add the nodes to
  that customer's subscription within 30 days.
- **Ending the agreement.** Either side, with three months' written notice, or
  for a serious breach left uncured 30 days after a written notice. A
  subscription already open keeps its price for the period it was opened for.

## Handing a customer back

A customer can leave its provider and keep its estate, which is why it holds its
own key in its own organisation rather than a share of yours.

- **Either side ends the link, at any time, without asking us**, with **End the
  arrangement** on the customer's **Billing** screen. It removes nobody from the
  customer's organisation: a membership your people hold there is ended by the
  customer, by its own act.
- **The licence stays valid, the agents stay enrolled**, and the month already
  metered is untouched. What changes is who the next subscription is billed to:
  the customer opens one from its own organisation, or through another provider
  who then holds it.

## What happens to the keys when the relationship ends

Nothing. No key is revoked because a link or the provider agreement ends
(`EULA-MSSP.md`, section 13). A key already issued stays valid for the period
that was paid for, so that no customer loses protection over a commercial
disagreement, and that period serves as the transition:

- you may keep running the software for the customers concerned, but not resell
  it to new ones once your standing has ended;
- the customer takes a licence from us directly, or through another provider,
  before the period runs out, and on its request before that day the period is
  extended rather than let it lose the paid layer over a handover;
- if the period does run out, the agent falls back to the open source feature
  set and keeps protecting traffic, as it does for any expired subscription, see
  [Licence keys](billing-and-licence-keys.md#licences).
