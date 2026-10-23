# Investigating From an Alert to a Workload

An alert names a process, a container and a pod, an address on each end and
the agent that raised it. Each of those is a page in the dashboard, and each
page reads as one line of what happened to that entity, newest first, every
moment linking to the other entities it names. An investigation is a walk
along those links rather than a set of filters retyped on five screens.

This page walks one investigation end to end: an SSH brute force against a
pod, from the alert to the workload that answered it, and from there to the
host it runs on and the other workloads that host carries. The screenshots
are taken from the dashboard's standalone mode
(`dashboard-server --standalone`), which serves fixture data and needs no
agent, so every step can be repeated on a laptop.

## 1. The alert names its workload

The alert detail carries a **Workload** row beside the container identity:
the executable, its process identifier, the pod and the namespace. Pressing
it opens a menu whose first entry is the workload's page.

![An alert detail with its workload row](/img/entity-alert.png)

The row is there only where the agent attributed the flow to a process. A
flow the node forwarded on behalf of somebody else has no local process, and
the row then says so in words rather than staying blank: there is nothing to
pivot to, and the address on each end is the only lead.

What the alert does **not** carry is the parent process. The workload is the
process that held the socket; the chain that started it lives in the agent's
process tree and is not copied into every alert.

## 2. The workload page reads as a timeline

A workload is named `namespace/pod` when it runs in Kubernetes, and by its
container, its systemd unit or its executable otherwise. Its page lists every
alert attributed to it in the window, each one linking back to the alert it
came from and to the other entities it names: the host that raised it, the
address on each end.

![A workload's timeline](/img/entity-workload.png)

A workload records alerts only. Flows, DNS answers, TLS fingerprints and
policy decisions are recorded per host and per address, and configuration
changes per host, so the workload page offers no filter for them rather than
an empty one.

## 3. The host shows what else it carries

Following the host link opens the agent's own page. Its timeline mixes every
section the host records, and each moment names the workload it was
attributed to, so the other pods on the same node - the ingress controller,
an unnamed container - are one link away.

![The neighbouring host's timeline](/img/entity-host.png)

The banners above the line are the page being honest about what it read.
Without a history store, the dashboard reads only the alerts the agents still
hold, and every other section says it could not be read and why, rather than
showing nothing and letting that read as "nothing happened". With a history
store configured, the same sections are read from it, and a section an agent
did not answer for names that agent.

## What each page reads

| Page | Named by | Sections |
|------|----------|----------|
| Host | Agent identifier | Alerts, flows, DNS, TLS, policy, configuration |
| Address | IPv4 or IPv6 address | Alerts, flows, DNS, TLS, policy |
| Workload | `namespace/pod`, container, unit or executable | Alerts |
| Domain | Domain name | Alerts |

The window is the page's own time range (one hour to thirty days, or a custom
range), and older moments are read a page at a time. The same reading is
available to scripts through `GET /api/v1/{tenant}/entities/{kind}/{value}`,
described in the [dashboard configuration](../configuration/dashboard.md).
