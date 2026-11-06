# Kubernetes Operator

> **Edition: Enterprise**

## Overview

The operator manages eBPFsentinel agents through the Kubernetes API. It
reconciles one `EbpfSentinelAgent` resource and thirty-six policy resources into
a running agent DaemonSet, so a cluster's whole security configuration is
declarative and reviewable in the same place as the rest of its manifests.

It ships as its own binary and one image,
`ghcr.io/ebpfsentinel/ebpfsentinel-operator`, built and signed by the same
release pipeline as the agent. The image carries every kind, the agent's 21
open source policy kinds and the 15 enterprise ones alike; the licence decides
which of them are reconciled. It is tagged with the release version and
cosign-signed, the same way the
[agent images](../../operations/deployment/docker.md) are, and it needs a
licence to start.

## Licence

The operator does not start without an Enterprise licence carrying the
`kubernetes-operator` feature. It reads the licence from a Secret in its own
namespace - `ebpfsentinel-license`, key `license`, unless the chart's
`license.existingSecret` and `license.secretKey` name another - and verifies
both signatures, Ed25519 and ML-DSA-65, against the issuer's keys built into
the binary, exactly as the [enterprise agent](license.md) does.

A missing Secret, a document that does not verify, an expired one or one that
does not carry the feature all have the same outcome: the operator logs the
reason and exits before any controller starts, the agent controller included,
and Kubernetes restarts it until a licence that admits it is there. The Secret
is read again every five minutes (`LICENSE_REFRESH_SECONDS`, thirty seconds at
the least), so a licence that expires, is withdrawn or stops carrying the
feature makes a running operator stand down the same way. Agents already
deployed keep running; nothing reconciles them until the licence is back.

## How a policy reaches an agent

The agent's configuration document is its only complete configuration channel and
its REST API is a narrow per-item overlay, so the operator does not push policies
over REST. It reads every policy resource whose `spec.target` selects an agent,
folds them into one document, writes that document into a Secret named
`<agent>-config` and mounts it at `/etc/ebpfsentinel/config.yaml`.

The document goes into a Secret rather than a ConfigMap because the agent's own
format takes API keys, the API-key salt, SMTP and feed credentials and
object-store keys as literal values. No policy carries a credential inline: each
names a Secret, and the operator either resolves the value into the document or
mounts the file at `/etc/ebpfsentinel/secrets/<secret>/<key>`, read-only and
unreadable by the group.

A checksum of the rendered document is annotated on the pod template, so editing
a policy rolls the DaemonSet. Each running agent is additionally asked to reload,
and that ask is best effort: a pod that refuses is logged and the reconcile
carries on, because the rollout the checksum triggers applies the document
anyway. An enterprise agent refuses every time - it applies its configuration
once, at startup, and mounts no reload route - so on an enterprise DaemonSet the
rollout is the whole of how a policy lands.

## What the operator says on a resource

Every policy resource carries a `Ready` condition, saying whether every agent
it selects runs it, and a `Conflicted` condition naming each value an agent
dropped in favour of another resource's. An agent resource carries the
same two, about its rollout and about the policies it folded in, and a
`ConfigDrift` condition saying whether every agent runs the configuration
document the operator rendered: `False` when all do, `True` when one runs
another document or had its policy changed through its own API, `Unknown`
when an agent did not say. Each node's answer is under
`status.agentStatuses[].config`, as `state` (`InSync`, `Drifted` or
`Unknown`) and a one-sentence `reason`. What each case means and what to do
about it is in
[Rolling an upgrade out](../../operations/upgrade-rollout.md#what-drift-means).

Beside the conditions, the operator files Kubernetes events on the resource
itself, where `kubectl describe` already looks. A condition says where the
resource stands; an event keeps the order in which it got there. An event is
filed on a change and not on every pass, read off the status the resource
carried before the pass, so a restart or a new leader does not repeat them.

| Reason | Type | When |
|---|---|---|
| `Accepted` | Normal | a new generation of the resource was read and acted on |
| `Programmed` | Normal | every agent the resource selects now runs it |
| `Degraded` | Warning | the resource was running everywhere and no longer is; the note carries the `Ready` reason and message |
| `Unselected` | Warning | no agent in the namespace selects the resource |
| `Refused` | Warning | a value the resource sets was dropped for another resource's; the note names both and which one runs |
| `Released` | Normal | an agent resource being deleted had its DaemonSet removed and is free to go |
| `ReconcileFailed` | Warning | a pass failed and will be retried; repeats fold into one event series |
| `NotLicensed` | Warning | an enterprise kind the licence does not carry |
| `Drifted` | Warning | an agent resource's `ConfigDrift` condition turned `True`; the note names the nodes and why |

```bash
kubectl describe firewallpolicy edge-baseline
kubectl get events --field-selector involvedObject.name=edge-baseline
```

### Running a second tag on some nodes

`spec.image.canary` on an agent resource pins another tag to named nodes,
ahead of `spec.image.tag` or behind it:

```yaml
spec:
  image:
    tag: "1.3.0"
    canary:
      tag: "1.4.0"
      nodes: [edge-01]
```

The operator runs those nodes from a DaemonSet of their own,
`<name>-agent-canary`, with the same pod template and the canary's tag, and
keeps them off the main DaemonSet. A node named that the agent is not
scheduled on runs nothing more than it did; a canary with no node or no tag is
no canary, and the canary DaemonSet is removed. Each node's
`status.agentStatuses[]` entry carries the `version` its agent reports, so the
two tracks can be read side by side. This is the field the dashboard writes
when it rolls a release out; see
[Rolling an upgrade out](../../operations/upgrade-rollout.md).

### What each node agent sees of its pods

A node agent sees the links its chain is attached to and nothing else, so a
pod on the host network, a link kind the attach mode leaves alone or traffic
wrapped in a tunnel on the uplink is something the agent on that node does
not see. Each agent judges this per pod and serves the verdict at
[`GET /api/v1/ebpf/coverage`](../../api-reference/rest-api.md#get-apiv1ebpfcoverage);
the operator reads it on every status poll and writes a summary per node
under `status.agentStatuses[].coverage` on the agent resource:

| Field | Meaning |
|---|---|
| `uncovered` | pods on the node the agent sees in no traffic class |
| `partial` | pods seen in some classes and not in others |
| `full` | pods seen in every class the agent judges |
| `gaps` | up to twenty pods that are not fully seen, as `namespace/name: class (gap), ...` |

The block is absent, rather than zeroed, for a node whose agent answered no
inventory: an agent running outside Kubernetes, or one that did not answer
the poll. Loopback is never seen by a node agent, since it does not leave
the pod, so it is listed as a gap without lowering a pod below `full`.

```bash
kubectl get ebpfsentinelagent agent -o jsonpath='{.status.agentStatuses[*].coverage}'
```

The dashboard's **Pod coverage** screen, under the fleet section, reads the
same verdicts from every agent of the tenant: the pods nothing is seen of
first, the namespaces ranked by their worst pod, the traffic class not seen
and the agent's reason beside it, and the nodes that did not answer named
so the counts are read against them.

## Resources

| Group | Kinds |
|-------|-------|
| The agent itself | `EbpfSentinelAgent` |
| Open source policies | 21 kinds: `AlertPolicy`, `AliasSet`, `ConnectionTrackingConfig`, `DDoSProtection`, `DLPPolicy`, `DNSPolicy`, `FirewallPolicy`, `GeoIPConfig`, `IDSPolicy`, `IPSPolicy`, `InterfaceGroup`, `L7FirewallPolicy`, `LoadBalancerConfig`, `NATPolicy`, `PacketCapture`, `QoSPolicy`, `RateLimitPolicy`, `ResponsePolicy`, `RoutingPolicy`, `ThreatIntelFeed`, `ZonePolicy` |
| Enterprise policies | 15 kinds: `AISecurityPolicy`, `AirGapBundle`, `AnalyticsConfig`, `BehavioralDetection`, `ComplianceReport`, `EnterpriseSettings`, `FederationPolicy`, `FleetConfig`, `ForensicsPolicy`, `HACluster`, `MLDetection`, `RBACConfig`, `SIEMExport`, `TLSIntelligence`, `TenantPolicy` |

One example per kind ships with the operator repository under `config/samples`.

Each enterprise kind is watched only when the licence carries the feature it
needs, so a kind the licence does not admit is left unreconciled rather than
half-applied, and no chart value can turn one on. `EnterpriseSettings` is the one exception: it is where
the licence is named, so it is reconciled without a feature check.

## Installing

The chart is published with every release, next to the agent's, and carries the
release version:

```bash
kubectl create namespace ebpfsentinel
kubectl -n ebpfsentinel create secret generic ebpfsentinel-license \
    --from-file=license=license.key
helm install ebpfsentinel-operator oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-operator \
    --namespace ebpfsentinel --version <version> \
    --set license.existingSecret=ebpfsentinel-license
```

Releases are listed on the
[releases page](https://github.com/ebpfsentinel/ebpfsentinel-release/releases).

The chart configures the operator and nothing about an agent: every agent-side
setting, open source and enterprise alike, is a custom resource.

### Reconciling some namespaces only

By default the operator reconciles across the cluster under a ClusterRole,
which lets it read every Secret in the cluster. `watchNamespaces` narrows it:

```bash
helm install ebpfsentinel-operator oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-operator \
    --namespace ebpfsentinel --version <version> \
    --set license.existingSecret=ebpfsentinel-license \
    --set 'watchNamespaces={ebpfsentinel,edge}'
```

The operator then watches those namespaces and no other, and the chart grants
it a Role in each instead of the ClusterRole, plus one Role in its own
namespace that reads the licence Secret and the agent token Secret by name and
nothing beside them. A resource in any other namespace is left alone. Each
namespace listed must exist before the chart is installed.

Narrowed, the operator holds no cluster grant to hand on, so an agent whose
Kubernetes settings read across the cluster - the pod enricher,
`networkPolicy` in `observe` or `enforce`, `clusterIp` - reports
`ClusterReads` False with the name of the `ClusterRole` it could not write,
which an administrator then grants out of band.

### Refused at admission

A resource's own schema refuses what it can see in one object. The chart
also registers a validating admission webhook, served by every operator
replica, which refuses at `kubectl apply` what needs the rest of the cluster
to be known, rather than leaving it to a condition on the resource's status:

- an enterprise kind the licence does not cover, naming the feature it needs;
- a Secret a policy names that does not exist, or that has no key by the
  name the policy reads;
- a value another policy of the same kind already sets differently on some
  of the same agents, naming that policy;
- a `LoadBalancerConfig` address pool that overlaps a pool of another policy,
  or takes a name another one already uses.

A refusal names every reason at once. When the webhook could not read what
it needed, a Secret or the policies beside the incoming one, it admits the
resource with a warning saying so, and the reconciler reports the outcome on
the resource as it always has. A delete is never sent to the webhook, so a
resource can always be taken away, whatever else is wrong with it.

`webhook.failurePolicy` decides what the API server does when no replica
answers within `webhook.timeoutSeconds`. It is `Ignore` by default: every
check made at admission is made again by the reconciler, so an unreachable
operator delays a refusal instead of stopping every change to a policy.
`Fail` makes the webhook a gate, at the price of refusing every create and
update of a policy resource while the operator is down.

The chart issues the serving certificate and its authority itself, keeps them
in the Secret `<release>-webhook-tls` and reuses them on every upgrade;
deleting that Secret and upgrading issues a new pair, and the pods roll to
read it. A certificate issued elsewhere, by cert-manager for one, is served
instead through `webhook.tls.existingSecret` and `webhook.tls.caBundle`. With
`watchNamespaces` set, the webhook is registered for those namespaces only.
`webhook.enabled=false` removes it.

### Running more than one replica

Replicas elect a leader through a `Lease` in the operator's namespace
(chart value `leaderElection.enabled`, on by default). Only the replica
holding it reconciles, and a standby reports itself as such rather than as
a fault: `/readyz` answers `503` with the body `standby`, `200` with
`leading` on the leader, and `ebpfsentinel_operator_leader` is `0` on a
standby and `1` on the leader. The lease lasts 15 seconds and is renewed
every 5; a standby asks for it every 2, so an unplanned handover takes at
most 17 seconds, and a leader that loses the lease exits and comes back as a
standby rather than carrying on beside its successor.

The leader is also the only replica that grants the VIP speaker role of a
`LoadBalancerConfig` whose `vipAnnounce.role` is `elected`. The speaker it
chose is recorded in a `Lease` named `<policy>-vip-speaker` beside the
policy, so a new leader renews the same speaker instead of choosing again,
and a speaker's 30-second grant outlasts the handover, so a leader failover
leaves the addresses answered. The policy's `status.speaker` says who is
speaking, or that the role is fenced until a lost speaker's grant lapses;
[Elected speaker](../../configuration/loadbalancer.md#elected-speaker) gives
the timings.

The leader alone also gives Services of type `LoadBalancer` an address from
the pools a `LoadBalancerConfig` declares, so no address is handed out twice;
[Services of type LoadBalancer](../../configuration/loadbalancer.md#services-of-type-loadbalancer)
covers pools, annotations, conditions and release. The chart values
`serviceLoadBalancer.enabled` (on by default) and
`serviceLoadBalancer.claimUnclassed` (off by default) decide which Services
it claims, and the operator's role grants it Services, their status and
EndpointSlices for that purpose.

Every replica serves `/metrics` on its health port, `8081`. What each
series means, the alerts the chart ships on them and the switches that turn
on a `ServiceMonitor`, a `PrometheusRule` and a Grafana dashboard are on
[Monitoring the operator](../../operations/operator-monitoring.md).

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_operator_reconcile_total` | Counter | `controller`, `result` | Reconciliation passes, `result` being `success` or `error` |
| `ebpfsentinel_operator_reconcile_errors_total` | Counter | `controller` | Passes that failed and will be retried |
| `ebpfsentinel_operator_reconcile_duration_seconds` | Histogram | `controller`, `result` | How long a pass took |
| `ebpfsentinel_operator_reconcile_in_flight` | Gauge | `controller` | Passes running now |
| `ebpfsentinel_operator_objects` | Gauge | `kind`, `namespace`, `ready` | Resources of each kind by their `Ready` condition: `true`, `false` or `unknown` |
| `ebpfsentinel_operator_leader` | Gauge | - | 1 on the replica that reconciles, 0 on a standby |
| `ebpfsentinel_operator_vip_elected_policies` | Gauge | `namespace` | Load balancer policies whose speaker the operator elects |
| `ebpfsentinel_operator_vip_speaking_policies` | Gauge | `namespace` | Of those, the ones with an agent answering for their VIPs |
| `ebpfsentinel_operator_vip_speaker_handovers_total` | Counter | `namespace`, `policy` | Times the speaker role went to a different agent |
| `ebpfsentinel_operator_lb_pool_addresses` | Gauge | `namespace` | Addresses in the accepted Service address pools |
| `ebpfsentinel_operator_lb_allocated_addresses` | Gauge | `namespace` | Of those, the ones held by a Service |
| `ebpfsentinel_operator_lb_pending_services` | Gauge | `namespace` | Services of type LoadBalancer claimed and given no address |
| `ebpfsentinel_operator_bgp_sessions` | Gauge | `namespace`, `state` | BGP sessions of the selected agents, by state, `Unknown` for an agent that could not be read |

### BGP announcement

A `LoadBalancerConfig` whose `vipAnnounce` carries a `bgp` block announces
its VIPs over BGP as well as over ARP. The agent drives BIRD 2, a routing
daemon run beside it, rather than speaking BGP itself, and the operator runs
that daemon when the agent resource names its image. No BIRD image is
published under this project's name, so the image is required and has no
default: use the one your estate already trusts.

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EbpfSentinelAgent
spec:
  bgpDaemon:
    repository: registry.example.com/bird
    tag: "2.17"
---
apiVersion: ebpfsentinel.io/v1
kind: LoadBalancerConfig
spec:
  vipAnnounce:
    role: elected
    interface: eth0
    vips:
      - name: web
        address: 192.0.2.10
    bgp:
      localAsn: 64512
      peers:
        - name: tor1
          address: 10.0.0.1
          asn: 64513
          passwordSecretRef:
            name: tor-md5
            key: password
```

With `bgpDaemon` set, each agent pod gains a `bird` container that starts on
a two-line base configuration from the agent's configuration Secret, binds
the BGP port and drops to the agent's user, and shares an `emptyDir` at
`/run/bird` with the agent for the control socket and the configuration the
agent writes. A peer password names a Secret and reaches the agent as a
mounted file, never as a value in the rendered document.

Every 10 seconds the leader reads each selected agent's sessions and writes
them to the policy's `status.bgp`, one row per pod and peer with the state,
since when, and the last error; an agent that could not be read is one row
in state `Unknown` saying why. The status is written only when it changed.
[BGP announcement](../../configuration/loadbalancer.md#bgp-announcement)
covers what the agent asks of BIRD, and
[Bare-Metal Load Balancer](bare-metal-load-balancer.md) puts pools,
announcement and failover together.

### Workload rules by name

A `FirewallPolicy` rule carries a `workload` block, the matchers of the
[workload firewall](../../configuration/workload-firewall.md), and may name
its destinations with `fqdn`; the resolvers whose answers are believed and
the grace kept past each record's TTL sit in `workloadDns` beside the rules.

```yaml
apiVersion: ebpfsentinel.io/v1
kind: FirewallPolicy
spec:
  workloadDns:
    resolvers:
      - 10.96.0.10
    graceSecs: 30
  rules:
    - id: allow-payments-to-psp
      action: allow
      protocol: tcp
      destinationPort:
        start: 443
        end: 443
      workload:
        container: payments
        mode: observe
        fqdn:
          - api.psp.example
          - "*.cdn.psp.example"
```

Every 15 seconds the leader asks each selected agent what such a rule has
resolved and writes the sum to the policy's `status.fqdn`: per rule, how many
names are currently resolved and how many agents were asked and answered, and
per name its state (`Resolved`, `Lapsed` once every address expired,
`NeverResolved` for a pattern nothing matched), the addresses it opens, the
agents opening them and when it was last refreshed. A pattern nothing
resolved is a row of its own, because a rule allowing a name nobody resolves
is usually a typo. "Never resolved" means never on the agents that answered,
which is why both counts are on the row. The status is written only when it
changed, and dropped once the policy no longer names a destination by name.

### Workload rules by pod, namespace and service account

A `workload` block may also name pods by label with `podSelector`, their
namespaces by label with `namespaceSelector`, and the service account they run
as with `serviceAccount`. The selectors reach the agents as written, and each
agent resolves them against the pods of its own node as its pod and namespace
watches report them: a pod created, relabelled or deleted, or a namespace
relabelled, changes what the rule covers within about a second, without the
operator rendering anything or the DaemonSet rolling.

Every 30 seconds the leader counts the running pods each such rule selects
and writes them to the policy's `status.workloads`, one row per rule with
`selectedPods`. A rule selecting no running pod is still accepted, since the
pods it names may be about to arrive, and it sets the condition
`WorkloadsSelected` to `False` with the reason `SelectorMatchesNothing` and
the rule named in the message; `True` says every such rule selects at least
one. Narrowed to a list of namespaces with `watchNamespaces`, the operator
counts only the pods in those namespaces, and since a `Role` cannot grant
read access to namespaces, a rule naming `namespaceSelector` gets no count, a
`reason` on its row, and the condition `Unknown`; the agents still resolve it.
The cluster-wide `ClusterRole` grants `list` on `namespaces` for this.

The fields are spelt the way a `NetworkPolicy` spells them, and the agent's
reference for the matchers states the two places they mean something
different: a selector left out narrows nothing, and `{}` selects every pod.

```yaml
apiVersion: ebpfsentinel.io/v1
kind: FirewallPolicy
metadata:
  name: allow-api
  namespace: payments
spec:
  target:
    all: true
  rules:
    - id: allow-api-to-database
      action: allow
      protocol: tcp
      destination: 10.96.14.7/32
      destinationPort: {start: 5432, end: 5432}
      priority: 45
      workload:
        podSelector:
          matchLabels: {app.kubernetes.io/name: api}
        namespaceSelector:
          matchLabels: {kubernetes.io/metadata.name: payments}
        serviceAccount: api
        mode: enforce
```

```sh
kubectl get firewallpolicy allow-api -o jsonpath='{.status.workloads}'
kubectl get firewallpolicy allow-api \
  -o jsonpath='{.status.conditions[?(@.type=="WorkloadsSelected")]}'
```

### Workload rules by lineage, digest and remote workload

A `workload` block also carries the rest of the
[workload firewall](../../configuration/workload-firewall.md) matchers, each
reaching the agent unchanged:

- `parent` names the executable the task's direct parent runs, and
  `ancestor` an executable any of its ancestors runs, both absolute paths.
  The two are exclusive, and a resource naming both is refused at admission
  ([selecting by what a task was started under](../../configuration/workload-firewall.md#selecting-by-what-a-task-was-started-under)).
- `exeHash` names the executable's bytes rather than its path, as
  `sha256:<64 hex>` or `fsverity-sha256:<64 hex>`
  ([a digest is not forgeable](../../configuration/workload-firewall.md#an-executable-path-is-forgeable-a-digest-is-not)).
- `peer` names the destination by the workload behind it instead of by
  address: `kind` (`host`, `container`, `pod` or `guest`), `container`,
  `podSelector`, `namespaceSelector`, `serviceAccount` or `guest`. It replaces
  `destination`, `destinationAlias` and `fqdn` on the same rule, needs a
  `tcp`, `udp` or `any` protocol, and a `guest` is not combined with a
  container or pod matcher; each of those is refused at admission
  ([destinations by remote workload](../../configuration/workload-firewall.md#destinations-by-remote-workload)).

A firewall rule also takes `mode: shadow`, which decides nothing and counts
what the rule would have decided
([shadow mode](../../configuration/firewall.md#shadow-mode)). A shadow rule
carrying a `workload`, a `dscpMark` or a `maxStates` is refused at admission,
since each of those acts on traffic.

```yaml
rules:
  - id: deny-curl-under-nginx
    action: deny
    protocol: tcp
    workload:
      exe: /usr/bin/curl
      ancestor: /usr/sbin/nginx
      mode: enforce
  - id: allow-api-to-ledger
    action: allow
    protocol: tcp
    destinationPort: {start: 8443, end: 8443}
    workload:
      serviceAccount: api
      mode: enforce
      peer:
        kind: pod
        podSelector:
          matchLabels: {app.kubernetes.io/name: ledger}
  - id: watch-legacy-subnet
    action: deny
    destination: 10.250.0.0/16
    mode: shadow
```

An `IDSPolicy` rule takes a `workload` block too, which inspects only the
traffic of the pods, containers, units, cgroups or guest it names
([workload scope](../../configuration/ids.md#workload-scope)). It carries
`unit`, `cgroup`, `container`, `podSelector`, `namespaceSelector`,
`serviceAccount` and `guest`, where a guest is named alone; it is refused at
admission beside `interfaces`, and on a rule carrying a `pattern`, which is
matched where the link a packet crossed is not known.

### The process table

`spec.config.processTable` sets the table of live processes each agent keeps
and the reverse shell, fileless binary and unexpected server descendant
detections read off it ([process table](../../configuration/process-table.md)):
`enabled`, `capacity` (256 to 262144), `captureCommandLine`, and under
`detections` the `enabled` switch, `intervalSecs`, one switch per detection
in `kinds`, the `interpreters`, `servers` and `expected` lists, and
`killProcess`. Every field left out keeps the agent's default, and
`killProcess` is refused at admission unless `response.killProcess.enabled`
is set. A `pod` profile agent does not watch the node's processes, so the
block is not rendered for one.

The guest naming directories (`container.guests`) and the Podman and LXC
enrichers are not typed on the resource and are set through
`spec.config.raw` where needed: they read a hypervisor's or a container
host's records on the node, which a Kubernetes node does not keep, and a
`KubeVirt` guest is named from its launcher pod's labels by the Kubernetes
enricher instead ([guest naming](../../configuration/container.md#guest-naming)).

### Namespaces a tenant holds

A `TenantPolicy` names its namespaces one by one with `namespaces`, selects
them by label with `namespaceSelector`, or both. Every 30 seconds the leader
resolves each tenant's selector against the namespaces that exist and writes
the result to `status.tenantNamespaces.mapped`, and the agents serve that
list: a customer namespace created with the right labels is onboarded at the
next reading, without a resource being edited.

A namespace two tenants claim, whether by name or by label, is given to
neither. It is listed under `status.tenantNamespaces.refused` on both, with
the other claimant named as `namespace/name`, and the condition
`NamespacesMapped` turns `False` with the reason `NamespaceCollision` until
one of them lets go. `True` says every namespace the tenant claims is its own.
Narrowed to a list of namespaces with `watchNamespaces`, the operator cannot
read namespaces, so a tenant keeps the namespaces it names, the selector is
left unresolved with a `reason`, and the condition is `Unknown`.

```yaml
apiVersion: ebpfsentinel.io/v1
kind: TenantPolicy
metadata:
  name: acme
  namespace: tenants
spec:
  target:
    all: true
  id: "1"
  name: acme
  namespaces:
    - acme-legacy
  namespaceSelector:
    matchLabels:
      ebpfsentinel.io/customer: acme
```

```sh
kubectl get tenantpolicy -A
kubectl get tenantpolicy acme -n tenants -o jsonpath='{.status.tenantNamespaces}'
```

### The container runtime the agents read

Attributing a container's traffic to a tenant reads the container's labels
from the node's runtime, and the agent pod mounts each runtime socket the
rendered document names, read-only:

- with `multiTenancy.cgroupAttribution.enabled` on `EnterpriseSettings`, the
  directory of every socket in `criSockets`, which defaults to containerd's
  `/run/containerd/containerd.sock` and CRI-O's `/run/crio/crio.sock`. A
  directory the node does not have is created empty under `/run`, a tmpfs,
  and the agent reports that socket as absent, so one list serves a fleet
  running both. List only the runtime the fleet runs to keep the other's
  directory off its nodes, and a socket elsewhere, k3s's
  `/run/k3s/containerd/containerd.sock` for one, by its own path;
- with `container.docker.enabled` on the agent resource, the socket
  `container.docker.socket` names, which then has to exist on every node the
  agents run on.

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EnterpriseSettings
metadata:
  name: settings
spec:
  target:
    all: true
  licenseSecretRef:
    name: ebpfsentinel-license
    key: license.lic
  multiTenancy:
    cgroupAttribution:
      enabled: true
      criSockets:
        - /run/containerd/containerd.sock
```

### Executables allowed to reach the network

A `FirewallPolicy` may carry `networkExecutables`, the list of executables
that alone open an internet socket on the nodes it targets, decided in the
kernel at the socket call. **It needs the BPF LSM active at boot on each
node**, which is the `lsm=` boot parameter and not a kernel version, so run
`ebpfsentinel-agent ebpf host-check` on a node of each pool before relying on
it. Where the module is off, an observing list is skipped and the agent says
why, and an enforcing list stops the agent from starting, which the DaemonSet
reports as a pod that never becomes ready.

```yaml
apiVersion: ebpfsentinel.io/v1
kind: FirewallPolicy
metadata:
  name: egress-binaries
spec:
  target:
    all: true
  networkExecutables:
    enabled: true
    mode: observe          # observe, then enforce
    executables:
      - /usr/bin/curl
      - /usr/sbin/sshd
```

The paths are resolved in the agent's own mount view, so a binary inside a
pod's image is not covered by naming its path. See
[Executables allowed to reach the network](../../configuration/workload-firewall.md#executables-allowed-to-reach-the-network).

### The write refusal

An `EbpfSentinelAgent` may carry `config.writeRefusal`, which refuses a writer
in the kernel past a count under the data paths, or at its first write under
the system paths when it is not expected there. **Refusing needs the BPF LSM
active at boot on each node**, which is the `lsm=` boot parameter and not a
kernel version; without it a fanotify permission group refuses on a bounded set
of paths, and with neither the node detects and stops a run instead of refusing
it. Run `ebpfsentinel-agent ebpf host-check` on a node of each pool before
relying on it. The files written before the threshold are lost in every case,
and the refusal fails open: an agent that stops leaves its node writable at
once.

```yaml
spec:
  config:
    writeRefusal:
      enabled: true
      mode: shadow           # shadow, then enforce
      paths:
        - /srv/data
      threshold: 50
      windowSecs: 10
      countBy: cgroup
```

One document is rendered for every node of a resource, so the operator cannot
hold the refusal back from one node and not another. It reads each node's own
answer instead: `status.agentStatuses[].writeRefusal` carries whether that node
refuses, through which route, and why not when it does not, and a resource
asking for `enforce` on a node that refuses nothing raises a
`WriteRefusalNotHeld` warning event naming that node and its reason. See
[Write refusal](../../configuration/file-watch.md#write-refusal).

### Firewall rules in tiers

`EnterpriseSettings` declares the
[firewall tiers](fleet-management.md#firewall-policy-in-tiers) in
`firewallTiers`, in evaluation order, and a `FirewallPolicy` places its rules in
one through `tier`. A policy naming no tier, or `default`, stays in the
community list:

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EnterpriseSettings
spec:
  firewallTiers:
    - name: provider
      ownerRole: mssp-provider
    - name: default
---
apiVersion: ebpfsentinel.io/v1
kind: FirewallPolicy
metadata:
  name: provider-baseline
  namespace: mssp-system
spec:
  tier: provider
  rules:
    - id: deny-known-bad-range
      priority: 10
      action: deny
      protocol: any
      source: 203.0.113.0/24
```

A rule naming a tier `firewallTiers` does not declare is refused when the
configuration is rendered, since nothing says where it would be evaluated. The
`provider` tier belongs to the service provider: admission refuses a
`FirewallPolicy` naming it in any namespace a `TenantPolicy` holds, so a
customer cannot place a rule there from their own namespaces.

### Stopping the process behind a blocked flow

An `IPSPolicy` rule in `block` mode may carry `killProcess: true`, which also
stops the process that owns a flow the rule blocks. The agent refuses the
whole configuration unless the agent resource turns the capability on, node
pool by node pool, under `config.response.killProcess`:

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EbpfSentinelAgent
spec:
  config:
    response:
      killProcess:
        enabled: true
        protectedCommands:
          - postgres
```

Process 1, the container runtimes, the kubelet and the agent are never
signalled, `protectedCommands` only adds to that list, and a stopped process
does not come back. See
[Stopping the process behind a blocked flow](../../configuration/ips.md#stopping-the-process-behind-a-blocked-flow).

### Inside selected pods

Where the node agent's coverage verdict names a pod it misses for a reason only
an agent inside the pod closes, a second resource runs the same agent under
[`profile: pod`](../../configuration/agent.md#pod-profile) beside the first:

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EbpfSentinelAgent
metadata:
  name: agent-in-pods
spec:
  profile: pod
  podSelector:
    namespaces: [shop]
    matchLabels:
      app: cart
  config:
    container:
      kubernetes:
        enabled: true
```

It is a DaemonSet of its own. `interfaces` is not read, the node sections are
left out of its configuration, and a policy that would write one of them into
it (a `FirewallPolicy`, a `QoSPolicy`, a `NATPolicy` and the rest) fails the
render with the policy's name, rather than every pod refusing the file at boot.
A `pod` profile with no `podSelector`, one without
`config.container.kubernetes.enabled` to read its pods from, or a
`podSelector` on a `node` profile, is refused the same way. The chain is put
inside each pod by the warden sidecar the DaemonSet already carries, which
holds `SYS_ADMIN` among its default capabilities for exactly that.

Every agent pod, under either profile, mounts the node directory
`/run/ebpfsentinel-claims`, handed to the agent's uid by a `claims-dir` init
container, and its configuration names it as `agent.pod_claims_dir`. Through
it the node agent stands back from the link of each pod the `pod` profile
agent holds the chain inside, so a flow between two pods of the node is read
once; the rule and its limits are under
[One flow, counted once](../../configuration/agent.md#one-flow-counted-once).

### Enforcing the cluster's NetworkPolicy

On a CNI that enforces no `NetworkPolicy`, the agents can carry the policies
out on the pods of their own node:

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EbpfSentinelAgent
metadata:
  name: agent
spec:
  config:
    container:
      kubernetes:
        enabled: true
        networkPolicy:
          mode: observe
```

The operator only renders the mode. Each agent watches the policies, pods,
namespaces, services and endpoint slices itself and compiles them for its
node, so a pod starting or stopping changes no configuration Secret and rolls
no agent. The agent refuses to start in `enforce` when it cannot read them,
so the operator grants its ServiceAccount `list` and `watch` on `pods`,
`namespaces` and `services`, on `networkpolicies` in `networking.k8s.io` and on
`endpointslices` in `discovery.k8s.io`, through a `ClusterRole` and binding
named `ebpfsentinel-agent-<namespace>-<name>`. The pod metadata enricher alone
gets `pods` and `namespaces`. Both objects are deleted when the mode goes back
to `off` and when the resource is deleted, and the resource's `ClusterReads`
condition says whether the grant is held. See
[Kubernetes NetworkPolicy](../network-policy.md) for the semantics and the
counters.

#### When the CNI already enforces

Two enforcers reading the same policy differently is an outage nobody can
debug, so the operator looks at what else runs on the nodes before it renders
`enforce`. It lists the cluster's `DaemonSet`s and recognises a CNI by the
container carrying its policy engine:

| Recognised as enforcing | Recognised as enforcing nothing |
|-------------------------|---------------------------------|
| Cilium (`cilium-agent`), including GKE Dataplane V2 (`anetd`) | Flannel alone (`kube-flannel`) |
| Calico and Canal (`calico-node`) | AWS VPC CNI without its policy agent turned on |
| Antrea (`antrea-agent`) | |
| kube-router (`kube-router`) | |
| Weave Net (`weave-npc`) | |
| kube-network-policies (`kube-network-policies`) | |
| Azure Network Policy Manager (`azure-npm`) | |
| AWS VPC CNI with `aws-network-policy-agent` run with `--enable-network-policy=true` | |

Anything else is unknown, and so is a cluster whose `DaemonSet`s the operator
may not list, which is the case when `watchNamespaces` narrows it to a Role
per namespace. The decision:

| Mode asked | CNI | Mode rendered | `reason` |
|------------|-----|---------------|----------|
| `off` | not looked at | `off` | none, no status block |
| `observe` | any | `observe` | `ObserveOnly` |
| `enforce` | enforces nothing | `enforce` | `NoOtherEnforcer` |
| `enforce` | enforces, or unknown | `observe` | `CniEnforces` or `CniUnknown` |
| `enforce` with `alongsideCni: true` | enforces, or unknown | `enforce` | `AlongsideCni` |

`observe` is allowed beside anything because it counts and refuses nothing.
Set `alongsideCni: true` only when you mean both enforcers to run, for
example to enforce on the agent's side while a CNI migration is in progress:

```yaml
        networkPolicy:
          mode: enforce
          alongsideCni: true
```

The decision is on the resource's status, under `status.networkPolicy`
(`requested`, `effective`, `cniState`, `cni`, `reason`, `message`), and in a
`NetworkPolicy` condition that is `False` when the mode rendered is not the
one asked for. A downgrade also raises one `NetworkPolicyNotEnforced` warning
event, repeated only when its reason changes:

```bash
kubectl get ebpfsentinelagent agent -o jsonpath='{.status.networkPolicy}'
```

#### Importing policies written for Cilium

An estate leaving Cilium for a CNI that enforces nothing carries its policies
as `CiliumNetworkPolicy` objects, which nothing reads once Cilium is gone. The
operator image translates them into `NetworkPolicy`, the kind the agent
enforces, and writes down everything it could not carry. It is an offline
step: it reads a file, needs no cluster access and no licence, and applies
nothing.

```bash
kubectl get ciliumnetworkpolicies -A -o yaml > cilium.yaml
docker run --rm -i ghcr.io/ebpfsentinel/ebpfsentinel-operator:<version> \
  import - < cilium.yaml > imported.yaml
```

The translated policies go to standard output, one document each, labelled
`app.kubernetes.io/managed-by: ebpfsentinel-import` and annotated
`ebpfsentinel.io/imported-from` with the object they came from; a policy with
several `specs` becomes one `NetworkPolicy` per spec, suffixed `-0`, `-1`.
The report goes to standard error, one line per object and one per field,
with the reason:

```text
CiliumNetworkPolicy/shop/api  partial
  refused  spec.egress[0].toFQDNs  a NetworkPolicy has no host names; write the destination as a firewall workload rule by name, or as CIDRs
```

The command exits `2` when anything was refused, so a pipeline cannot apply a
partial import without having seen it. Each object is `translated`,
`partial`, `refused`, or `as written` for a `NetworkPolicy` already in the
input, which is checked against the agent's limits and noted rather than
rewritten.

**A refusal never widens a policy.** A peer that cannot be carried is dropped
from its rule, which allows less. A restriction that cannot be carried, such
as a layer 7 rule on a port, drops the whole rule, because the port without
it would allow more. A rule left with no peer at all is dropped rather than
written as "every peer", and the direction stays isolated.

| In the Cilium policy | What the import does |
|---|---|
| `endpointSelector`, `fromEndpoints`, `toEndpoints` | Pod and namespace selectors; `k8s:` and `any:` prefixes stripped, `io.kubernetes.pod.namespace` and `io.cilium.k8s.namespace.labels.*` read as namespace labels |
| `fromCIDR`, `toCIDR`, `fromCIDRSet`, `toCIDRSet` | `ipBlock`, with `except` |
| `toPorts` with ports only | `ports`, with `endPort`; `ANY` written as TCP, UDP and SCTP |
| Entity `all` / `cluster` | Every peer / every namespace |
| Entity `host`, `remote-node`, `fromNodes`, `toNodes` | Nothing written, noted: node addresses are always open on the agent |
| An empty rule `{}` | Nothing written, noted: it allows nothing in Cilium and would allow everything in a `NetworkPolicy` |
| `toFQDNs` | Refused: a `NetworkPolicy` has no names. A [workload rule by name](#workload-rules-by-name) carries it |
| Entity `world` and the other reserved entities, `cidrGroupRef`, `toGroups`, `toServices` | Refused: the addresses are Cilium's to resolve |
| `ingressDeny`, `egressDeny` | Refused: a `NetworkPolicy` only allows |
| `enableDefaultDeny` set to `false` | That direction refused: a rule that allows without isolating has no equivalent |
| `toPorts` with `rules`, `serverNames`, TLS or `listener`; `icmps`; `fromRequires`, `toRequires`; `authentication` | The rule refused |
| `nodeSelector`, `CiliumClusterwideNetworkPolicy`, labels Cilium derives (`io.cilium.k8s.policy.*`, `reserved:`) | The policy or the peer refused |

Read the report before applying anything. A policy partly imported is a hole
the operator can believe is covered, which is why the import says so
rather than staying quiet.

### Resolving cluster addresses for chosen pods

The agents can send the connections some pods make to a Service cluster
address straight to a ready backend at `connect()`, every other pod keeping
kube-proxy, which stays installed. It is not a kube-proxy replacement; see
[Cluster address resolution](../cluster-ip.md) for what it leaves to
kube-proxy.

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EbpfSentinelAgent
metadata:
  name: agent
spec:
  config:
    container:
      kubernetes:
        enabled: true
        clusterIp:
          enabled: true
          workloads:
            - pods:
                matchLabels: {app: checkout}
              namespaces:
                matchLabels: {kubernetes.io/metadata.name: shop}
```

The operator renders the selectors as written and grants the agent's
ServiceAccount `list` and `watch` on `pods`, `namespaces` and `services`, and
on `endpointslices` in `discovery.k8s.io`, through the same per-resource
`ClusterRole` as the `NetworkPolicy` translation. Leave it off beside
Cilium running as the kube-proxy replacement, which already resolves every
pod's cluster addresses at `connect()`. Beside Cilium with kube-proxy and
beside Calico, the coexistence lanes check that a pod not named keeps going
through kube-proxy while a named one is resolved by the agent.

### Uninstalling

`helm uninstall` removes the operator and nothing it rendered: an agent
DaemonSet belongs to its `EbpfSentinelAgent`, so the agents keep running
with the configuration they last had. Delete the agent resources first,
while the operator still runs to remove their finalizer, when the agents
should go too:

```bash
kubectl delete ebpfsentinelagents --all --all-namespaces --wait
```

`helm uninstall` leaves the custom resource definitions in place, so every resource written against them survives: each
definition carries `helm.sh/resource-policy: keep`. Deleting a definition
deletes every resource of its kind, which is why it is a step of its own:

```bash
kubectl get crd -o name | grep ebpfsentinel.io | xargs kubectl delete
```

## Reporting to a console

An estate running several clusters can follow them from one dashboard. Each
cluster's operator posts, every minute and from the replica holding the
lease, what that cluster runs: each `EbpfSentinelAgent` with its desired and
ready nodes, how many policies there are and how many are not ready, and its
own version. Nothing a policy says leaves the cluster. The operator pushes
rather than being read, so the dashboard holds no credential for any
cluster's API server and a cluster behind a firewall reaches it like any other
HTTPS service.

Each cluster has a token of its own, held in a Secret in the operator's
namespace, and the dashboard files the report under the cluster that token
belongs to, so one cluster can never report as another. The dashboard side,
and how to generate the token and its digest, is
[`clusters`](../../configuration/dashboard.md#clusters-optional).

```yaml
console:
  url: https://dashboard.example.com
  cluster: eu-west-1
  tokenSecret:
    name: console-token
    key: token
```

| Value | Meaning |
|---|---|
| `console.url` | The dashboard's base URL. `https://` only; empty turns reporting off. |
| `console.cluster` | This cluster's name on the dashboard: lowercase letters, digits and hyphens. |
| `console.tokenSecret.name`, `.key` | The Secret holding this cluster's token, mounted read-only into the operator. |

A URL that is not `https://`, a missing cluster name or a missing token
refuses the chart, and the operator refuses to start, since a cluster that
never reports would read on the dashboard as one never installed. A refused
report is logged with its status, and a `401` means the token is not the one
the dashboard holds for this cluster. A cluster silent for longer than the
dashboard's `stale_after_seconds` is shown as stopped reporting, never dropped
from the list.

## Reporting to the vendor portal

An enterprise estate reports itself to the customer portal through
`spec.portal` on the `EnterpriseSettings` resource that names its licence. Two
credentials are involved and they are kept apart on purpose: the **join secret**
says the deployment exists and is what the subscription is measured against,
and the **ingest secret** sends counters, which is a choice made and unmade
separately. Both are minted on the deployment's page in the portal and shown
once.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Turns the report on. Off, nothing is sent and the portal does not count this estate |
| `baseUrl` | string | - | Where the portal answers. HTTPS unless it is loopback |
| `joinSecretRef` | `{name, key}` | - | Secret holding the deployment's join secret |
| `agentName` | string | host name | What each machine calls itself in the fleet list. Set it only where the host name changes on every restart, because a new name enrols a new agent |
| `statePath` | string | `/var/lib/ebpfsentinel/portal/enrolment.json` | Where the per-agent credential handed back at enrolment is kept |
| `caCertSecretRef` | `{name, key}` | - | Secret holding an extra PEM to trust, for an estate egressing through an inspecting proxy. Added to the system roots, never replacing them |
| `telemetryEnabled` | bool | `false` | Sends counters as well as saying the machine exists |
| `ingestSecretRef` | `{name, key}` | - | Secret holding the deployment's ingest secret. Neither the licence key nor the join secret |
| `telemetryIntervalSeconds` | integer | 300 | Seconds between two batches of counters, held between a minute and a day by the agent |

Create the two Secrets from a silent prompt, so the value lands in neither the
shell history nor the process list:

```bash
read -rsp 'Join secret: ' JOIN && printf '%s' "$JOIN" | \
  kubectl -n ebpfsentinel create secret generic ebpfsentinel-portal-join \
    --from-file=join-secret=/dev/stdin && unset JOIN

read -rsp 'Ingest secret: ' INGEST && printf '%s' "$INGEST" | \
  kubectl -n ebpfsentinel create secret generic ebpfsentinel-portal-ingest \
    --from-file=ingest-secret=/dev/stdin && unset INGEST
```

Then name them:

```yaml
apiVersion: ebpfsentinel.io/v1
kind: EnterpriseSettings
metadata:
  name: default
  namespace: ebpfsentinel
spec:
  target:
    all: true
  licenseSecretRef:
    name: ebpfsentinel-license
    key: license.lic
  portal:
    enabled: true
    baseUrl: https://portal.ebpfsentinel.io
    joinSecretRef:
      name: ebpfsentinel-portal-join
      key: join-secret
    telemetryEnabled: true
    ingestSecretRef:
      name: ebpfsentinel-portal-ingest
      key: ingest-secret
```

Leave `telemetryEnabled` off and `ingestSecretRef` out to be counted without
sending counters; turn telemetry on for the deployment in the portal first, since
the portal refuses to mint an ingest secret while it is off.

The operator resolves `joinSecretRef` and `ingestSecretRef` into the agent's
configuration document, which is itself the `<agent>-config` Secret described
above, and mounts `caCertSecretRef` as a file. Rotating either secret is
therefore a Secret edit followed by the rollout the checksum triggers. Several
join secrets can be live at once in the portal, so mint the new one, update the
Secret, let the DaemonSet roll, then withdraw the old one.

The enrolment state under `statePath` lives inside the pod unless a volume is
mounted there through `extraVolumes` and `extraVolumeMounts` on the
`EbpfSentinelAgent`. Losing it is not a new machine: an agent that joins again
under the same name is the same agent with a fresh credential, and with the
node's network namespace joined, which is the default, the name is the node's
own. It does need the join secret to still be live, so a Secret pointing at a
withdrawn join secret leaves a restarted pod unable to report.

The fields behave exactly as the agent's own
[vendor portal reporting](../../configuration/enterprise.md#vendor-portal-reporting)
section, and the whole path from purchase to machines reporting is walked in
[From purchase to reporting agents](../../getting-started/from-purchase-to-reporting-agents.md).

## Deploying without the operator

The operator is not required. An agent runs as a plain DaemonSet with a
ConfigMap, managed through the REST API or the CLI; see
[Kubernetes Deployment](../../operations/deployment/kubernetes.md). What the
operator adds is that the desired state is Kubernetes resources rather than a
file somebody edits on a node.

## REST API

The operator mounts no endpoint on the agent. The `kubernetes-operator` licence
feature gates no agent route either, only the operator's own startup: the
operator is a separate binary
that drives agents through the endpoints listed in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md) and through
the Kubernetes API, and it serves its own surface rather than adding to the
agent's.

## Dashboard integration

Every document rendered by the operator forces `management.operator_managed: true` in the agent config so the dashboard can lock its config-edit UI on operator-managed agents:

- `management.operator_managed` is set to `true` unconditionally - any user value supplied through the `EbpfSentinelAgent` resource's `spec.config.management` overlay is overridden, and the override is recorded as a `Warning` Kubernetes event with reason `OperatorManagedForced`. Audit it with `kubectl get events --field-selector reason=OperatorManagedForced`.
- `management.operator_endpoint` defaults to the operator's in-cluster service URL (`https://<svc>.<ns>.svc:<port>`). When the user provides a value in `spec.config.management.operatorEndpoint`, it is passed through verbatim so air-gapped or proxied deployments can deep-link the dashboard to a custom URL.

See the top-level `operatorEndpoint` in `charts/ebpfsentinel-operator/values.yaml` to override the default endpoint via Helm. Left empty, it is derived from the operator's own Service.
