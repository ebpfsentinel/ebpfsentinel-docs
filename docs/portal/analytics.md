# Analytics

> **Edition: Enterprise**

What your agents reported, what this month comes to against the volume your plan
includes, and how to erase what was sent. Everything here is on **Analytics**.
Everybody reads it; owners and administrators erase readings.

Analytics shows totals only. Your agents send counters, and packets, payloads,
addresses, process names and file paths stay on the machine that saw them. The
one thing derived from an address that leaves is the country an alert's source
resolved to, as two letters, resolved on your machine.
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
- **Busiest agents**: the ten that sent the most traffic, each with its
  deployment in brackets, its processor and memory at their peak and how full
  its fullest eBPF map got.

The only machine name the portal holds is the one each agent joined under.

A machine is counted once in anything that is a state rather than a count,
under what its latest reading in the window said: a machine moved from generic
to driver mode on the way to an upgrade is one machine in driver mode on the new
build.

### Room left

The most processor and memory any agent used over the window, and how full its
fullest eBPF map got, then the same per deployment with its typical agent (the
median machine) beside its fullest one. Peaks rather than averages, because the
hour a map filled is the hour that matters. An eBPF map is a fixed-size table
the agent keeps in the kernel: once one is full, new flows and events no longer
fit and go unseen. A map past 80 % reads **Filling**, where a burst puts events
at risk, and past 95 % **Full**, where they are being lost; the screen says how
many agents reached the first mark and to give their maps more room in the
agent configuration. **Fullest map over the window** draws the trend with both
marks dashed. An agent that does not measure map fill reads **Not measured**,
never as an empty map.

### Datapath and builds

Per deployment, how many agents attached their XDP programs in **Driver** mode
(inside the network driver, the fastest place), **Generic**, **Network card**
or **Mixed** (different places on different interfaces), with **Fast path** or
**Slower path** beside it. Generic enforces the same rules but copies every
packet before the program sees it, which costs processor under load, and the
screen says so with the number of agents concerned. **Builds running** lists
the build each agent last reported, most common first. No build is called old:
the portal does not know which release you mean to run.

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

### What was raised

Alerts as a matrix: the components that raised something as rows, the
severities as columns with critical first, and totals on both margins. A cell is
darker the larger its share of everything raised. Under it, one small trend for
each of the six components that raised the most.

### Threat feeds

One line per list your agents hold: its size, when it was last fetched, the
matches over the window and how many deployments hold it, with a trend where it
matched. A public list is named after itself; every list you added yourself is
summed into **Your own lists**. A list not fetched for over a day is marked
**Stale**, and a list holding indicators that matched nothing over the window is
marked **No match** with a sentence saying it spends memory for nothing, unless
the window is too short to judge. An agent that cannot say a list's size or when
it was fetched leaves that part blank rather than reporting zero.

### What was stopped

What the agents detected as an attack, by kind (SYN, UDP amplification, ICMP,
RST, FIN, ACK and volumetric floods), beside what they stopped: packets dropped
or rate limited and flows killed in the datapath, then addresses blocked,
automated responses taken and domains refused on reputation. The two sides are
read together rather than added up, since one blocked address can stop a million
packets.

### Where it comes from

Alerts by the country of their source address, as each agent's
[GeoIP](../configuration/geoip.md) database placed it, with each country's share
of the whole and a trend for the countries that sent the most. A source behind a
proxy or a VPN is counted where it came out. Alerts no country could be given
read **Not resolved**; when that is every alert, the screen says it is what an
agent without a GeoIP database reports.

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
