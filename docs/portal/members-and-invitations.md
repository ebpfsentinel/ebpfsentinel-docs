# Members and Invitations

> **Edition: Enterprise**

Who is in an organisation, what each person may do there, and how somebody new
gets in. Everything here is on **Members**, under **Organisation**. Everybody
reads it; owners and administrators change it.

## Roles

Every member holds one of four roles:

| Role | What it may do |
|---|---|
| **Owner** | Everything, including billing, closing the organisation and making other owners. |
| **Administrator** | Runs the agents: members, deployments and licence keys. Cannot see the card or close the organisation. |
| **Billing** | Pays: the subscription, our reseller's documents and the payment method. Nothing operational, and no licence key. |
| **Member** | Reads the organisation, its members and the figures of its agents. Changes nothing. |

Only an owner makes an owner, whether by changing a role or through an
invitation. An administrator cannot promote anybody, themselves included, to
owner, and cannot change an owner's role.

Whoever creates an organisation is its first owner.

## Members

Each member is one row with their role and either **Two-step verification on**
or **Password only - they cannot issue a licence key until they set up two-step
verification**, so you can see who would be refused before asking them to issue
a key.

- **Change a role**: pick the new role in the row, then **Change the role** to
  confirm, or **Keep it as it is**. Making somebody an owner says that they then
  hold everything you hold, including changing your own role or removing you.
- **Remove a member**: **Remove**, then **Remove for good**. They lose access at
  once; their account itself is untouched.

**The last owner stays an owner.** The organisation's only owner cannot be
removed and their role cannot be changed, because an organisation nobody can
administer is one whose subscription nobody can end. Make somebody else an owner
first.

## Invitations

Type the **Email address**, choose the **Role** and press **Send the
invitation**. The invitation lets somebody in the moment they follow its link,
signed in with the address it was sent to. Somebody without an account signs up
from the link: that sign-up creates no organisation of its own, and once the
address is confirmed they land in the one that invited them.

An invitation lapses on its own seven days after it was sent; the list shows the
day it **lapses on**. Until then:

- **Send again** mails a fresh link and lapses the previous one, which is what
  to do when the first mail went astray or ran out.
- **Revoke** withdraws it, and the link stops working.

Where the organisation signs in through its own identity provider, people
usually arrive through that provider rather than through an invitation, at the
role your group rules grant, see
[Single Sign-On and Provisioning](single-sign-on.md#3-groups-and-roles).

## Your default organisation

An account can belong to several organisations. **Your organisations** marks one
of them **Default**: it is the organisation a plain sign-in opens on. **Make
default** on another row moves it there. Whoever signs up gets the organisation
they create as their default.

## See also

- [Finding Your Way Around the Portal](overview.md)
- [Audit Log and Activity](audit-log.md), where every change of role, removal and
  invitation is recorded
