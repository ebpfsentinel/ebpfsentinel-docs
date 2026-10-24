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

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
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
no agent. The agent's ServiceAccount needs `list` and `watch` on `pods`,
`namespaces` and `services`, on `networkpolicies` in `networking.k8s.io` and
on `endpointslices` in `discovery.k8s.io`, bound through a `ClusterRole` of
your own, the same way the pod metadata enricher's read of `pods` is. See
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

### Uninstalling

`helm uninstall` removes the operator and leaves the custom resource
definitions in place, so every resource written against them survives: each
definition carries `helm.sh/resource-policy: keep`. Deleting a definition
deletes every resource of its kind, which is why it is a step of its own:

```bash
kubectl get crd -o name | grep ebpfsentinel.io | xargs kubectl delete
```

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
