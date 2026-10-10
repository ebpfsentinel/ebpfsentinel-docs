# Analytics

> **Edition: Enterprise**

What your agents reported, what this month comes to against the volume your plan
includes, and how to erase what was sent. Everything here is on **Analytics**.
Everybody reads it; owners and administrators erase readings.

Analytics shows totals only. Your agents send counters, and packets, payloads,
addresses, process names and file paths stay on the machine that saw them.
Nothing arrives until telemetry is turned on for a deployment and its agents
hold an ingest token, see
[Deployments and Agents](deployments-and-agents.md#telemetry).

While no deployment has telemetry switched on, the screen says so first, above
the month, with **Turn it on for a deployment**, and the panels that would
only show zeros are folded under **Show the empty panels**.

## This month

**This month** sets what your agents **Sent** since the start of the month
against what your plan **Included**, pooled across the organisation: the number
of agents times the volume each one brings. It reads **Within the allowance**,
**Past the allowance** or **Not metered**.

**Projected** extrapolates the month from its pace so far, and says when it is
too early in the month to project anything. Past the included volume, the screen
estimates what the excess would cost. These are estimates from an incomplete
month, not an invoice: what a period costs is settled at its close, on our
reseller's own document. Nothing is ever refused: an estate past its allowance
keeps sending.

Every paid plan publishes its pooled volume. An organisation that has not
bought anything yet still has what arrives counted.
An order still waiting for its payment includes no volume either, and the screen
says the order is waiting rather than that nothing was bought.

## Reported

Choose a **Window** (the last 30, 90 or 365 days) and a **Deployment**, or **All
deployments**:

- **Reported**: agents seen, traffic, packets and alerts raised over the window.
- **Agent health**: whether your agents kept up and whether their programs are
  loaded. It reads **Healthy**, **Losing events**, **Programs missing**,
  **Agents not reporting** while an enrolled agent in a live deployment has
  stopped reporting, with a link to the ones not reporting, or **No agent
  reporting** until one has sent a reading. Below it are the events handled and
  lost, the actions taken, and the agents short of a program. Each kernel term
  carries one line saying what it is: the ring buffer is the queue the kernel
  hands events to the agent through, and a full one loses the next events; a
  tear-down is the kernel closing a connection the agent decided to cut; the
  verifier is the kernel's check on every program before it runs, and a
  rejected program inspects nothing.
- **Over the window**: traffic and alerts as a chart, with the busiest point.
- **Deployments**: each deployment with its telemetry **Turned on**, **Turned
  off**, **Not reporting** when it collects and has sent nothing, or
  **Retired**, and its last reading.
- **What was raised** and **Busiest agents**, the ten that sent the most
  traffic, each with its deployment in brackets.

The only machine name the portal holds is the one each agent joined under.

### How long readings are kept

Each reading is kept for the retention of the plan the organisation held when
it arrived: two hundred and seventy days on Critical, ninety days on Enterprise, thirty days
on Professional and without a subscription. Changing plan does not shorten or lengthen what was
already sent, because the retention travels with each reading. A window longer
than the retention shows what is still kept, so the 365-day window on a
thirty-day retention shows the last thirty days.

## Erase what was sent

**Erase what was sent** removes the readings your agents sent, and is offered
only while some are held, at any age the retention keeps. It cannot be
undone; the steps are in
[Your Data](your-data.md#erase-what-your-agents-sent). Erasing does not turn
telemetry off: a deployment that is collecting keeps collecting.

## See also

- [Deployments and Agents](deployments-and-agents.md)
- [Your Data](your-data.md)
