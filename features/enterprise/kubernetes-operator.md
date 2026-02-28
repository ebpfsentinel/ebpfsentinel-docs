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
