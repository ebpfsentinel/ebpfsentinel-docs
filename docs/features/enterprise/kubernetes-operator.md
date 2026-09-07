# Kubernetes Operator

> **Edition: Enterprise**

## Overview

The operator manages eBPFsentinel agents through the Kubernetes API. It
reconciles one `EbpfSentinelAgent` resource and thirty-six policy resources into
a running agent DaemonSet, so a cluster's whole security configuration is
declarative and reviewable in the same place as the rest of its manifests.

It ships as its own binary and image, built and signed by the same release
pipeline as the agent:

| Edition | Image |
|---------|-------|
| Open source kinds only | `ghcr.io/ebpfsentinel/ebpfsentinel-operator` |
| Open source plus the enterprise kinds | `ghcr.io/ebpfsentinel/ebpfsentinel-operator-enterprise` |

Both are tagged with the release version and cosign-signed, the same way the
[agent images](../../operations/deployment/docker.md) are.

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
a policy rolls the DaemonSet, and each running agent is additionally told to
reload.

## Resources

| Group | Kinds |
|-------|-------|
| The agent itself | `EbpfSentinelAgent` |
| Open source policies | 21 kinds: `AlertPolicy`, `AliasSet`, `ConnectionTrackingConfig`, `DDoSProtection`, `DLPPolicy`, `DNSPolicy`, `FirewallPolicy`, `GeoIPConfig`, `IDSPolicy`, `IPSPolicy`, `InterfaceGroup`, `L7FirewallPolicy`, `LoadBalancerConfig`, `NATPolicy`, `PacketCapture`, `QoSPolicy`, `RateLimitPolicy`, `ResponsePolicy`, `RoutingPolicy`, `ThreatIntelFeed`, `ZonePolicy` |
| Enterprise policies | 15 kinds: `AISecurityPolicy`, `AirGapBundle`, `AnalyticsConfig`, `BehavioralDetection`, `ComplianceReport`, `EnterpriseSettings`, `FederationPolicy`, `FleetConfig`, `ForensicsPolicy`, `HACluster`, `MLDetection`, `RBACConfig`, `SIEMExport`, `TLSIntelligence`, `TenantPolicy` |

One example per kind ships with the operator repository under `config/samples`.

The enterprise kinds are watched only when the chart is installed with
`enterprise.enabled=true`, and each kind is additionally gated by the feature bit
the licence carries, so a kind the licence does not admit is left unreconciled
rather than half-applied. `EnterpriseSettings` is the one exception: it is where
the licence is named, so it is reconciled without a feature check.

## Installing

The chart lives in the operator repository and is installed from a checkout:

```bash
helm install ebpfsentinel-operator charts/ebpfsentinel-operator
```

The chart configures the operator and nothing about an agent: every agent-side
setting, open source and enterprise alike, is a custom resource. For the
enterprise kinds:

```bash
helm install ebpfsentinel-operator charts/ebpfsentinel-operator \
    --set enterprise.enabled=true \
    --set enterprise.license.existingSecret=ebpfsentinel-license
```

## Deploying without the operator

The operator is not required. An agent runs as a plain DaemonSet with a
ConfigMap, managed through the REST API or the CLI; see
[Kubernetes Deployment](../../operations/deployment/kubernetes.md). What the
operator adds is that the desired state is Kubernetes resources rather than a
file somebody edits on a node.

## REST API

The operator mounts no endpoint on the agent. There is no `kubernetes-operator`
license feature and no route belongs to it: the operator is a separate binary
that drives agents through the endpoints listed in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md) and through
the Kubernetes API, and it serves its own surface rather than adding to the
agent's.

## Dashboard integration

Every document rendered by the operator forces `management.operator_managed: true` in the agent config so the dashboard can lock its config-edit UI on operator-managed agents:

- `management.operator_managed` is set to `true` unconditionally - any user value supplied through the `EbpfSentinelAgent` resource's `spec.config.management` overlay is overridden, and the override is recorded as a `Warning` Kubernetes event with reason `OperatorManagedForced`. Audit it with `kubectl get events --field-selector reason=OperatorManagedForced`.
- `management.operator_endpoint` defaults to the operator's in-cluster service URL (`https://<svc>.<ns>.svc:<port>`). When the user provides a value in `spec.config.management.operatorEndpoint`, it is passed through verbatim so air-gapped or proxied deployments can deep-link the dashboard to a custom URL.

See `agent.management.operatorEndpoint` in `charts/ebpfsentinel-operator/values.yaml` to override the default endpoint via Helm.
