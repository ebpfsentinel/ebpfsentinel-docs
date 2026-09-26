# Finding Your Way Around the Portal

> **Edition: Enterprise**

The customer portal at `https://portal.ebpfsentinel.io` is where you buy, issue
licence keys, register deployments and watch your agents report. This page names
every screen the way the navigation does, so the rest of the portal pages can
point at them by name. The whole path from a first payment to a first agent
reporting is walked once in
[From Purchase to Reporting Agents](../getting-started/from-purchase-to-reporting-agents.md).

## Your organisations

Signing in lands on **Your organisations** at `/organisations`. Each organisation
you belong to is one row carrying:

- **Fleet**: the agents reporting against the agents enrolled, and how many
  deployments there are. A machine still reporting into a stood-down deployment is
  counted and named.
- **Licence key**: **Not issued**, **In force**, **Running out** or **Expired**,
  with the days left.
- **Analytics this month**: the share of the pooled allowance the month has spent,
  or **Not metered** where the tier publishes no allowance.

The rows needing something done come first, with the alphabet as the tie-break,
and a sentence above the list says how many they are and why (no agent is
reporting, the key runs out soon, the month is past its allowance). If those
figures cannot be read, every organisation is still listed and opens as usual.

From any screen, **Ctrl K** (or **Cmd K** on a Mac) opens the organisation
switcher in the header. It lists the ones you opened most recently first,
matches what you type with or without accents, and opens the chosen
organisation on its **Overview**, because your role there may be a different
one.

## Inside an organisation

Every organisation screen sits under `/o/<your-organisation>/`. The navigation
beside it only lists the sections your role opens. The four roles are owner,
administrator, billing and member; a member reads and changes nothing:

| Section | What it holds | Who opens it |
|---|---|---|
| **Overview** | Where the contract, the key and the fleet stand today; each panel opens the screen it summarises. While anything is left between paying and a first agent reporting, the five-step list **From payment to a first agent reporting** sits here too. | Everybody |
| **People** | Members, their roles, whether each one holds a second factor, and the invitations nobody has taken up yet. | Everybody reads it; owners and administrators change it |
| **Billing** | The subscription, the licence key's date, the seller's documents, changing the plan or the card, ending the contract. See [Billing and Licence Keys](billing-and-licence-keys.md). | Owners and billing members |
| **Licences** | Issuing, downloading, replacing and revoking the key, and the offline bundle. | Owners and administrators |
| **Deployments** | Deployments, their join secrets, their machines and their telemetry switch. | Everybody reads it; owners and administrators change it |
| **Entitlement** | What you bought, what the key admits and what is running. | Everybody |
| **Analytics** | The counters your agents send once telemetry is on, and the month against the allowance. | Everybody reads it; owners and administrators erase readings |
| **Audit log** | Everything done to the organisation. See [Audit Log and Activity](audit-log.md). | Owners and administrators |
| **Single sign-on** | Your own identity provider and directory provisioning. See [Single Sign-On and Provisioning](single-sign-on.md). | Owners and administrators |
| **Settings** | The organisation's name, where the billing details live, and closing the organisation. | Owners and administrators |

An address you were sent for a section your role does not open says which roles
hold it and names the people in the organisation who can do it for you.

**People** shows, for every member, either **Second factor on** or **Password
only - no key can be issued to them**, so an owner can see who would be refused
before asking them to issue a key.

**Settings** carries a **Billing details** panel. The legal name, the billing
address and the VAT number printed on an invoice are entered at the seller's
checkout when the contract is bought: the seller issues the invoice, so it is
the seller who holds them. The panel says so and links to the seller's
documents rather than holding a second copy that could disagree.

## Your account

The menu in the header opens **Your account** at `/account`: your name and
address under **Details**, your password, and every browser signed in as you
under **Signed in**. Three links lead further:

- **Second factors and passkeys**: see [Signing In](signing-in.md).
- **Everything done with your account**: your own activity, see
  [Audit Log and Activity](audit-log.md).
- **Take a copy of your data, or delete your account**: see
  [Your Data](your-data.md).

Every one of those screens carries **Back to your account**, and the account
itself carries **Back to your organisation**, which returns to the organisation
you came from.

## System status

`/system` answers whether the portal's own dependencies are up: **Accounts and
billing**, **Database schema** and **Metrics and analytics**, with the moment it
checked. It reads **All systems operational**, **Degraded** or **Outage**, and
names what is impaired. Analytics is marked optional: when it is down the
graphs are missing, and your contract, your keys and your estate's count are
not affected. If the page itself does not answer, the status of our
infrastructure is published outside the portal.

## See also

- [From Purchase to Reporting Agents](../getting-started/from-purchase-to-reporting-agents.md)
- [License](../features/enterprise/license.md)
