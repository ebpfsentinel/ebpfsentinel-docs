# Kubernetes Operator

> **Edition: Enterprise** | **Status: Planned**

## Overview

A Kubernetes operator that manages eBPFsentinel agents via Custom Resource Definitions (CRDs), enabling declarative security policy management through the Kubernetes API.

## Planned Capabilities

- CRDs for firewall rules, IDS/IPS policies, rate limits, and threat intel feeds
- Automatic agent deployment and lifecycle management
- Policy reconciliation — desired state in CRDs, actual state in agents
- Rolling updates with zero-downtime rule transitions
- Namespace-scoped policies for multi-tenant clusters
- Webhook validation for policy syntax

## Current Alternative

Deploy eBPFsentinel as a DaemonSet with ConfigMap-based configuration. Use the REST API or CLI for runtime rule management. See [Kubernetes Deployment](../../operations/deployment/kubernetes.md).

## Dashboard integration

Every ConfigMap rendered by the operator forces `management.operator_managed: true` in the agent config so the dashboard can lock its config-edit UI on operator-managed agents:

- `management.operator_managed` is set to `true` unconditionally — any user value supplied through the `Agent` CR's `spec.config.management` overlay is overridden, and the override is recorded as a `Warning` Kubernetes event with reason `OperatorManagedForced`. Audit it with `kubectl get events --field-selector reason=OperatorManagedForced`.
- `management.operator_endpoint` defaults to the operator's in-cluster service URL (`https://<svc>.<ns>.svc:<port>`). When the user provides a value in `spec.config.management.operatorEndpoint`, it is passed through verbatim so air-gapped or proxied deployments can deep-link the dashboard to a custom URL.

See `agent.management.operatorEndpoint` in `charts/ebpfsentinel-operator/values.yaml` to override the default endpoint via Helm.
