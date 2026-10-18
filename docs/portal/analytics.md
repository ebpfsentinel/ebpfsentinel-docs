# Analytics

> **Edition: any plan, including open source**

What your agents reported, read over a window you choose. Everything here is on
**Analytics**, and everybody in the organisation reads it. What this month
comes to against the volume your plan includes is on **Billing**, see
[Billing and Licence Keys](billing-and-licence-keys.md#analytics-sent-this-month);
erasing what a deployment sent is on its telemetry screen, see
[Deployments and Agents](deployments-and-agents.md#erase-what-a-deployment-sent).

Analytics comes with any plan and costs nothing extra today: switch it on for a
deployment and the screens fill. What the hosted add-on will cost once it is
something you buy is published on the website, per agent, with its own included
volume and retention per plan.

Analytics shows totals only. Your agents send counters, and packets, payloads,
addresses, process names and file paths stay on the machine that saw them. The
one thing derived from an address that leaves is the country an alert's source
resolved to, as two letters, resolved on your machine.
Nothing arrives until telemetry is turned on for a deployment and its agents
hold an ingest token, see
[Deployments and Agents](deployments-and-agents.md#telemetry).

While no deployment has telemetry switched on, the screen says so first, with
**Turn it on for a deployment**, and the views that would only show zeros are
folded under **Show the empty panels**.

## The window at a glance

Choose a **Window** (the last 30, 90 or 365 days) and a **Deployment**, or **All
deployments**. Every view below reads the same choice, and the screen keeps the
same width whichever view is open.

Six tiles sum the window up: **health**, **alerts raised**, **attacks
detected**, **actions taken**, **events lost** (as a share of the events
handled, with the count under it) and **agents reporting**, as so many of the
agents enrolled. Health reads **Healthy**, **Losing events**, **Programs
missing**, **Agents not reporting** while an enrolled agent in a live
deployment has stopped reporting, or **No agent reporting** until one has sent
a reading.

When something is wrong, **Needs attention** says what under the tiles, each
line a link to the view that shows it: programs the kernel refused to load, a
retired deployment still reporting, enrolled agents that stopped reporting, a
deployment that filled a map, a feed late to refresh, a deployment collecting
and sending nothing. Nothing is listed there that is merely worth reading, and
the strip is absent when nothing is wrong.

Below them, four views: **Posture**, **Activity**, **Health and capacity** and
**Feeds**. A term the screen uses without spelling out carries an (i) beside
it: hover it, focus it or tap it for one sentence saying what it means, and
press Escape to close it.

The only machine name the portal holds is the one each agent joined under.
A machine is counted once in anything that is a state rather than a count,
under what its latest reading in the window said: a machine moved from generic
to driver mode on the way to an upgrade is one machine in driver mode on the new
build.

## Posture

What runs where, as the machines last reported it.

### Deployments

Each deployment with its telemetry **Turned on**, **Turned off**, **Not
reporting** when it collects and has sent nothing, **Programs missing** in red
when one of its machines refused a program or is short of one, **Retired**, or
**Retired, still reporting** when machines stood down still send, and its last
reading.

### Which defences run where

Each eBPF program as a row, each deployment as a column, as every machine last
listed them:

- **Loaded on all N machines** when every machine that listed its programs has
  it loaded;
- **Loaded on N of M** when only some do;
- **Refused on N of M** when the configuration asked for it and the kernel
  refused it on at least one machine, the only cell in red. The agent's log on
  that machine names the program and the reason the kernel gave;
- **Off** when no machine of the deployment listed it. An agent lists only the
  programs its configuration asks for, so this is a choice made in that
  deployment's configuration, not a fault.

A deployment whose agents sent readings and no list has no column, and the
screen counts them: their build predates the list, or the organisation agreed to
a list of collected fields that did not include it yet.

### Datapath and builds

Per deployment, how many agents attached their XDP programs in **Driver** mode
(inside the network driver, the fastest place), **Generic**, **Network card**
or **Mixed** (different places on different interfaces), with **Fast path** or
**Slower path** beside it. Generic enforces the same rules but copies every
packet before the program sees it, which costs processor under load, and the
screen says so with the number of agents concerned. **Builds running** lists
the build each agent last reported, most common first. No build is called old:
the portal does not know which release you mean to run.

Under them, the threat feeds your agents hold, each marked when it is stale,
with a link to **Feeds**.

## Activity

What happened over the window.

- **Reported**: agents seen, enrolled and licensed, traffic, packets and alerts
  raised.
- **Over the window**: traffic and alerts as charts on a dated axis, alerts
  stacked by severity. Hover a column to read it.
- **What was raised**: one bar per component that raised something, loudest
  first, split by severity, with its trend beside the count.
- **What was stopped**: what the agents detected as an attack, by kind (SYN,
  UDP amplification, ICMP, RST, FIN, ACK and volumetric floods), beside what
  they stopped: packets dropped or rate limited and flows killed in the
  datapath, then addresses blocked, automated responses taken and domains
  refused on reputation. The two sides are read together rather than added up,
  since one blocked address can stop a million packets.
- **Where it comes from**: alerts by the country of their source address, as
  each agent's [GeoIP](../configuration/geoip.md) database placed it, with each
  country's share of the whole and a trend for the countries that sent the
  most. A source behind a proxy or a VPN is counted where it came out. Alerts no
  country could be given read **Not resolved**; when that is every alert, the
  screen says it is what an agent without a GeoIP database reports.

## Health and capacity

Whether the agents kept up, and how much room they had left.

### Agent health

The events handled and lost, the actions taken, and the agents short of a
program. The ring buffer is the queue the kernel hands events to the agent
through, and a full one loses the next events; a tear-down is the kernel
closing a connection the agent decided to cut; the verifier is the kernel's
check on every program before it runs, and a rejected program inspects nothing.

### Room left

The most processor and memory any agent used over the window, and how full its
fullest eBPF map got, then a table with one row per deployment: its agents, the
processor and memory at their peak, its fullest map, the events it lost, its
last reading and its state. Peaks rather than averages, because the hour a map
filled is the hour that matters. An eBPF map is a fixed-size table the agent
keeps in the kernel: once one is full, new flows and events no longer fit and
go unseen. A map past 80 % reads **Filling**, where a burst puts events at
risk, and past 95 % **Full**, where they are being lost; the screen says how
many agents reached the first mark and to give their maps more room in the
agent configuration. **Fullest map over the window** draws the trend against
the whole, with both marks named. An agent that does not measure map fill reads
**Not measured**, never as an empty map.

### Busiest agents

The agents that sent the most traffic, one row each: the agent, its
deployment, its version, its traffic, its processor and memory at their peak,
its fullest map and its last reading.

Both tables sort on any column: press its heading once to sort, again to turn
the order round. Figures sort largest first, names from A.

## Feeds

One table, a row per list your agents hold: the **Feed**, the **Indicators
held**, the **Matches** over the window beside a small trend of them, how many
**Deployments** hold it, when it was **Last fetched** and its **State**. A
public list is named after itself; every list you added yourself is summed into
**Your own lists**.

Last fetched reads as a time ago, measured at the end of the window, and the
exact time shows on hover. A list not fetched for over a day by then is
**Stale**, and its last fetch turns amber. A list holding indicators that
matched nothing over the window reads **No match in this window**. An agent
that cannot say a list's size or when it was fetched reads **Not reported**
rather than zero.

## How long readings are kept

Each reading is kept for the retention of the plan the organisation held when
it arrived: two hundred and seventy days on Critical, ninety days on Enterprise, thirty days
on Professional and without a subscription. Changing plan does not shorten or lengthen what was
already sent, because the retention travels with each reading. A window longer
than the retention shows what is still kept, so the 365-day window on a
thirty-day retention shows the last thirty days.

## See also

- [Deployments and Agents](deployments-and-agents.md)
- [Billing and Licence Keys](billing-and-licence-keys.md)
- [Your Data](your-data.md)
