# Audit Log and Activity

> **Edition: Enterprise**

The portal records every act on an organisation and on an account, including
what was refused. You read it back in two places, as pages and as a file.
Reading either records nothing: nobody is told that you looked.

## The organisation's log

**Audit log**, inside the organisation, is everything that happened to it. Owners
and administrators open it, because it names colleagues. Each line names the
person, the moment, whether it **Succeeded** or was **Refused**, and, where
one was recorded, the address the request came from. An act on a deployment
names the deployment it was done in. A line whose author has since left the
organisation names no author.

A refusal that has only one possible cause says it under the line: configuring
the identity provider is refused when its discovery document cannot be read,
and the line names the provider address that was tried; proving a domain is
refused when the TXT record is not found yet. A refused sign-in has several
causes and the log keeps none of them, so it says only that it was refused.

The acts are grouped under **What happened**:

- Accounts and sign-ins
- Organisation and members
- Subscription
- Licence keys
- Deployments, agents and telemetry
- Single sign-on and directory
- Done by our support at your request

The last group is what our support ran because you or a colleague asked, such as
a password recovery or an invitation sent again. Those lines are written by the
portal, not by a person at our end.

What belongs to one person rather than to the organisation - a password changed,
two-step verification set up, a session ended, a refused sign-in - is never written
here, so the organisation's filter does not offer it. Each person reads those in
their own activity, below.

## Your own activity

**Your account** links to **Everything done with your account**: every sign-in,
including refused ones, and everything you did, across every organisation you
belong to. It needs nothing beyond being signed in. If a line was not you,
change your password and set up two-step verification, see
[Signing In](signing-in.md).

## Filtering

Both logs take the same filters:

- **What happened**: one of the groups above, or **Everything**.
- **Result**: **Succeeded**, **Refused**, or **Either**.
- **From** and **To (included)**: a window of days. The second day is included
  in full.

The newest lines come first; **Show more** reads further back.

## The file

**Download as a file** saves a CSV file of the lines under the current filter,
newest first. The screen says how many lines a file holds at most; narrow the
window to go further back.

## See also

- [Finding Your Way Around the Portal](overview.md)
- [Your Data](your-data.md)
