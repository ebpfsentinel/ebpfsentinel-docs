# Deployments and Agents

> **Edition: Enterprise**

A deployment is what your agents are counted in: register one per cluster, site
or account, whichever you count your agents in. Everything here is on
**Deployments**. Everybody reads it; owners and administrators change it. The
first deployment is walked once in
[From Purchase to Reporting Agents](../getting-started/from-purchase-to-reporting-agents.md#4-register-a-deployment).

## Deployments

**Register a deployment** asks for a **Name** you will recognise in a list, such
as Production or eu-west-1, and **Register it** creates it. Two deployments in
service cannot share a name.

Each deployment in the list says how many of its agents are reporting, the day
it was registered, and whether it is **In service** or **Retired**.

**Retire it**, then **Yes, retire it**, closes the deployment: every join secret
created for it is revoked and nothing new can join it. Agents already reporting
keep reporting, and keep counting against what you bought, until they are
removed or stop. A retired deployment can still have its telemetry turned off
and its readings erased; nothing on it can be turned back on.

## Join secrets

An agent presents a join secret once and receives a credential of its own in
exchange. Under **Join secrets** on the deployment:

- **Create a join secret** asks for your password again and shows the secret
  once: copy it, then **I have copied it**. Only a digest of it is kept.
- Several secrets can be live at a time, so a rotation costs no downtime:
  create the new one, roll it out, then revoke the old one.
- **Revoke** stops a secret admitting anything new. Agents that already joined
  with it keep reporting on their own credential.

Each secret says when it was created and when an agent last joined with it.

## Agents

Under **Agents**, each agent the deployment admitted is listed under the name it
joined with, its version, and when it was last heard from. It reads
**Reporting**, or **Not reporting** once five minutes have gone by without a
report; it reads **Reporting** again as soon as it reports.

**Remove this agent**, then **Remove it**, for a machine you have taken out of
service: its credential stops working and it leaves the count at once. An agent
that presents a live join secret again comes back under the same name, so
removing one that is still installed only holds until it rejoins.

## When nothing reports

The deployment page carries a checklist, to go through in this order:

1. Each agent reaches the portal address over HTTPS on port 443, through your
   proxy if it has one.
2. The join secret it holds is one listed as live, pasted whole.
3. The portal connection is turned on, and the agent was restarted or the chart
   upgraded since.
4. The agent's own log says why: `kubectl -n ebpfsentinel logs
   daemonset/ebpfsentinel-enterprise`, or `journalctl -u ebpfsentinel-enterprise`
   on a host. A refused join secret is an HTTP 401.
5. An agent counts as not reporting after five minutes without a report, and
   counts again as soon as it reports.

## Telemetry

**Telemetry for this deployment** opens the deployment's telemetry switch. It is
off until somebody turns it on, one deployment at a time, and the screen lists
everything a deployment sends while it is on and everything it never sends.

- **Turn telemetry on** agrees to that list as it stands that day. If the list
  changes later, nothing new is sent until somebody turns telemetry off and on
  again to agree to the new one.
- **Issue an ingest token** asks for your password again and shows the token
  once. It is a third credential, neither the licence key nor the join secret:
  revoking it stops metrics arriving and nothing else. Several can be live at
  once, and each says when it last wrote.
- **Revoke** beside an ingest token stops it writing.
- **Turn telemetry off** stops the sending and revokes every ingest token of
  the deployment in the same moment. What was already sent stays until you
  erase it from [Analytics](analytics.md#erase-what-was-sent).

Where each token goes in the agent's configuration is in
[Optionally, send counters](../getting-started/from-purchase-to-reporting-agents.md#7-optionally-send-counters).

## See also

- [Analytics](analytics.md)
- [Finding Your Way Around the Portal](overview.md)
- [Your Data](your-data.md)
