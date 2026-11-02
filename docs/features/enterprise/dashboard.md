# Dashboard UI

> **Edition: Enterprise**

## Overview

The dashboard is a web console for a fleet of agents: it authenticates an
operator, discovers the agents in scope and proxies every read and every change
to them. It is a separate product from the agent, with its own image, its own
configuration file and its own release:

| Piece | What it is |
|-------|------------|
| `dashboard-server` | Axum service. OIDC login with PKCE, EdDSA JWT sessions on a rotating JWKS, an optional ClickHouse history store, and a YAML configuration hot-reloaded on change |
| Web client | Angular single-page application, served as static assets by the same process, in English, French and German |
| Image | `ghcr.io/ebpfsentinel/ebpfsentinel-dashboard`, multi-arch (`linux/amd64`, `linux/arm64`), tagged with the release version and cosign-signed |
| Helm chart | `oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-dashboard`, published and signed with the image |

It is stateless and multi-tenant: tenant scope is enforced on the server for
every proxied call rather than in the browser, and agents whose licence does not
carry a feature are filtered out at discovery, so an operator is not shown a
screen that would answer 404.

## What it covers

The console has a screen for the agent's own surface and one for each enterprise
feature that has something to show:

| Area | Screens |
|------|---------|
| Overview and triage | Overview, alerts list and alert detail, [cases, response times and suppressions](cases.md), search, [hunting](hunting.md), MITRE view, topology, [service map](../l7-firewall.md#across-the-fleet), flow analytics, custom dashboards |
| Fleet | Fleet overview, containers and [file drift](fleet-management.md#file-drift-across-the-fleet) |
| Rules | Firewall, IDS, IPS, DLP, L7 firewall, staged rules, rate limits, NAT, connection tracking, zones, aliases, interface groups, VLANs, routing, load balancer, QoS, DDoS, GeoIP, DNS intelligence, threat intelligence |
| Enterprise features | Analytics, SIEM export, compliance, forensics and [investigation of one workload](network-forensics.md#from-the-console), automated response and its SOAR endpoints, ML detection, TLS intelligence, JA4, post-quantum TLS, L7 inspection, L7 policies, L7 enrichment, packet capture, alerting |
| Administration | Profile, auditor tokens, audit and licence |

Configuration screens lock themselves on an agent reporting
`management.operator_managed: true`, so an agent driven by the
[Kubernetes operator](kubernetes-operator.md) is read-only in the console and the
two cannot drift.

## The incident graph

Two screens draw an incident as a graph rather than a list, with one model and
two layouts: the lineage left to right, and the relationships by force.

- **Investigation graph**, opened from a context freeze, under the
  `network-forensics` licence feature. Its nodes are the findings, flows,
  processes and resolved names the freeze copied out, drawn around one node
  and bounded by a node budget and a depth; a node says how many neighbours
  were left out, and a graph cut short says so rather than passing for the
  whole. The row of intents above it highlights what a host rule would name,
  and the detail drawer shows only the panels a source in the freeze filled.
  On a process, **Prevalence in your estate** counts the machines of the
  tenant running that executable now, naming the nodes that could not answer.
  What the graph is built from, its budgets and every panel are in
  [The investigation graph](network-forensics.md#the-investigation-graph).
- **Estate graph**, under the `multi-cluster` licence feature, read
  from the management cluster, for one writer encrypting other hosts' shares. Its nodes are
  hosts: the origin where the writer runs and every host it wrote to, each
  with how long its shares were written to at most. The response it carries
  acts on the origin alone, starts in shadow and is put in force from the
  screen on the reading shown; a writer no member is registered at is named by
  its address and no order is made against it. See
  [Encryption Across the Estate](multicluster.md#encryption-across-the-estate).

What the graph does not draw is stated where it would be looked for: no file
digest, sandbox verdict or malware family, because nothing in a freeze
carries one, no prevalence across other customers' estates, and no thread
injected into another process, which this agent does not trace.

## Accessibility

The console targets WCAG 2.2 Level AA, and the end-to-end suite runs axe-core
against six of its routes in both themes. See
[Dashboard Accessibility](../../operations/dashboard-accessibility.md).

## Configuration

The server reads one YAML file, validates it before use and keeps the previous
configuration when a reload fails validation. Every field, along with the
air-gapped and MSSP variants, is documented in
[Dashboard configuration](../../configuration/dashboard.md).

## Using the API directly

Nothing in the console is privileged: it reads the same endpoints an operator
can. For scripting, or to build a view the console does not have, use the REST
API with the Swagger UI (`http://localhost:8080/swagger-ui/` on the open source
agent, `http://localhost:8444/swagger-ui/` on the enterprise agent), or build
Grafana dashboards from the Prometheus metrics.

## REST API

The dashboard mounts no endpoint on the agent. There is no `dashboard` license
feature and no route belongs to it: the console is a separate service that reads
the endpoints listed in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md) and serves its
own surface rather than adding to the agent's.
