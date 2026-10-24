# Finding Your Way Around the Portal

> **Edition: any plan, including open source**

The customer portal at `https://portal.ebpfsentinel.io` is where you buy, issue
licence keys, register deployments and watch your agents report. This page names
every screen the way the navigation does, so the rest of the portal pages can
point at them by name. The whole path from a first payment to a first agent
reporting is walked once in
[From Purchase to Reporting Agents](../getting-started/from-purchase-to-reporting-agents.md).

## Your organisations

Signing in lands on **Your organisations** at `/organisations`. Each organisation
you belong to is one row carrying:

- **Agents**: the agents reporting against the agents enrolled, and how many
  deployments there are. An agent still reporting into a retired deployment is
  counted and named.
- **Licence key**: **Not issued**, **Active**, **Expiring soon** or **Expired**,
  with the days left.
- **Analytics this month**: the share of the pooled allowance the month has spent,
  or **Not metered** where the tier publishes no allowance.

Under the name, an organisation that signs in through its own identity provider
shows **Your people sign in at** and the address to give them; any other shows
the address it is reached at once signed in. A provider's own organisation
carries **Holds N accounts**, which opens the panel where it opens accounts for
its customers, and an account a provider holds carries **Billed to** and the
provider's name, or **Billed to another organisation** where you are not in it.

The rows needing attention come first, with the alphabet as the tie-break,
and a sentence above the list says how many they are and why (no agent is
reporting, some agents stopped reporting, the key has expired, the key runs
out soon, the month is past its allowance). If those
figures cannot be read, every organisation is still listed and opens as usual.

From any screen, **Ctrl K** (or **Cmd K** on a Mac) opens the organisation
switcher in the header. It lists the ones you opened most recently first,
matches what you type with or without accents, and opens the chosen
organisation on its **Overview**, because your role there may be a different
one.

One row is marked **Default**: the organisation a plain sign-in opens on.
**Make default** on another row moves it. A provider running agents for its
customers opens an organisation per customer from the same page, see
[Accounts held by a provider](billing-and-licence-keys.md#accounts-held-by-a-provider).

## Inside an organisation

Every organisation screen sits under `/o/<your-organisation>/`, and the
organisation's own address opens its **Overview**. The bar above it has six
entries, and only lists what your role opens: **Overview**, **Billing**,
**Licence keys**, **Deployments**, which holds **Deployments**, **Usage** and
**Downloads**,
**Analytics**, and **Organisation**, which holds **Members**, **Single
sign-on**, **Audit log** and **Settings**. An entry holding more than one screen
shows them in a second row once it is open. The four roles are owner,
administrator, billing and member; a member reads and changes nothing:

| Entry | Section | What it holds | Who opens it |
|---|---|---|---|
| Overview | **Overview** | Where the subscription, the key and the agents stand today; each panel opens the screen it summarises. While anything is left between paying and a first agent reporting, a line above the panels says how many of the five steps are left, and **Finish setting up** opens the list **From payment to a first agent reporting**. | Everybody |
| Billing | **Billing** | The subscription, the licence key's date, our reseller's documents, changing the plan or the card, ending the subscription, and what the analytics sent this month come to against the allowance. See [Billing and Licence Keys](billing-and-licence-keys.md). | Owners and billing members |
| Licence keys | **Licence keys** | The screen headed **Licence keys**: issuing, downloading, replacing and revoking the key, the offline bundle, and the 14-day Enterprise trial key. See [Billing and Licence Keys](billing-and-licence-keys.md#licences). | Owners and administrators |
| Deployments | **Deployments** | Deployments, their join secrets, their agents, their telemetry switch and erasing what each one sent. See [Deployments and Agents](deployments-and-agents.md). | Everybody reads it; owners and administrators change it |
| Deployments | **Usage** | What you bought, what the key admits and what is running. **What your licence key admits** sets the key's ceiling beside the subscription's, because a plan change replaces nothing: when the key admits fewer agents than the subscription pays for, the screen says your own agents will refuse ones already paid for, with **Replace the key** for owners and administrators. An order waiting for payment is named with the agents on it and counts toward nothing until it is paid. | Everybody |
| Deployments | **Downloads** | Every published release your licence lets you run, newest first, with the one to install marked **Recommended**: each file linked to the release that publishes it with its SHA-256 beside it, and a block to copy that downloads the files, checks the signed checksum list with `cosign verify-blob` and then checks each file against it, plus a `cosign verify` line per image. A product your key does not carry is named under the release rather than left out, with **Change plan** for owners and billing members. Nothing is served by the portal itself: every file comes from the release. | Everybody |
| Analytics | **Analytics** | The counters your agents send once telemetry is on, read over a window in four views: **Posture**, **Activity**, **Health and capacity** and **Feeds**. See [Analytics](analytics.md). | Everybody |
| Organisation | **Members** | Members, their roles, whether each one has two-step verification, and the invitations nobody has taken up yet. See [Members and Invitations](members-and-invitations.md). | Everybody reads it; owners and administrators change it |
| Organisation | **Single sign-on** | Your own identity provider and directory provisioning. See [Single Sign-On and Provisioning](single-sign-on.md). | Owners and administrators |
| Organisation | **Audit log** | Everything done to the organisation. See [Audit Log and Activity](audit-log.md). | Owners and administrators |
| Organisation | **Settings** | The organisation's name, where the billing details live, and closing the organisation. | Owners and administrators |

An address you were sent for a section your role does not open says which roles
hold it and names the people in the organisation who can do it for you.

**Members** shows, for every member, either **Two-step verification on** or **Password
only - they cannot issue a licence key until they set up two-step verification**, so an owner can see who would be refused
before asking them to issue a key.

**Settings** carries a **Billing details** panel. The legal name, the billing
address and the VAT number printed on an invoice are entered at our reseller's
checkout when the subscription is bought: our reseller issues the invoice, so it is
our reseller who holds them. The panel says so and links to our reseller's
documents rather than holding a second copy that could disagree.

## Your account

The menu in the header opens **Your account** at `/account`: your name and
address under **Details**, your password, and every browser signed in as you
under **Signed in**. Three links lead further:

- **Two-step verification and passkeys**, which opens the screen headed **Two-step
  verification** at `/account/security`: see [Signing In](signing-in.md).
- **Everything done with your account**: your own activity, see
  [Audit Log and Activity](audit-log.md).
- **Take a copy of your data, or delete your account**: see
  [Your Data](your-data.md).

One line above every account screen leads back: **Back to your organisation**
returns to the organisation you came from, and on the three screens below the
account **Your account** beside it returns to `/account`.

## System status

`/system` answers whether the portal's own dependencies are up: **Accounts and
billing**, **Database schema** and **Metrics and analytics**, with the moment it
checked. It reads **All systems operational**, **Degraded** or **Outage**, and
names what is impaired. Analytics is marked optional: when it is down the
graphs are missing, and your subscription, your keys and your agent count are
not affected. If the page itself does not answer, the status of our
infrastructure is published outside the portal.

## See also

- [From Purchase to Reporting Agents](../getting-started/from-purchase-to-reporting-agents.md)
- [Members and Invitations](members-and-invitations.md)
- [Deployments and Agents](deployments-and-agents.md)
- [Analytics](analytics.md)
- [License](../features/enterprise/license.md)
