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
