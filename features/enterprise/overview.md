# Enterprise Features

> **Edition: Enterprise** | **Status: Partially Shipped**

## Overview

eBPFsentinel Enterprise extends the open-source agent with advanced security capabilities, management, multi-tenancy, analytics, and compliance automation features.

The OSS agent is fully functional for production use — all security domains, APIs, CLI, authentication, TLS, and observability are included in the open-source release. Enterprise adds deeper detection, enforcement, and operational capabilities.

Enterprise features are implemented in a **separate repository** (`ebpfsentinel-enterprise/`) that depends on the OSS core agent crates. Features are activated at runtime by a **license key system** with machine fingerprint binding and anti-tamper protections.

## Shipped Features

| Feature | Description | Status |
|---------|-------------|--------|
| [License System](license.md) | Ed25519-signed license keys, machine fingerprint binding, air-gap activation | **Shipped** |
| [Advanced DLP](dlp.md) | Vectorscan engine, custom patterns, block mode, per-pattern overrides, TLS deep inspection | **Shipped** |

## Planned Features

| Feature | Description | Status |
|---------|-------------|--------|
| [Dashboard UI](dashboard.md) | Web-based management console | Planned |
| [Kubernetes Operator](kubernetes-operator.md) | CRD-driven configuration | Planned |
| [High Availability](high-availability.md) | Active-passive clustering | Planned |
| [Multi-Cluster](multicluster.md) | Federated policy management | Planned |
| [Multi-Tenancy](multitenancy.md) | Namespace-scoped isolation | Planned |
| [ML Anomaly Detection](ml-detection.md) | Behavioral anomaly detection | Planned |
| [SIEM Integration](siem-integration.md) | Native connector ecosystem | Planned |
| [Compliance Reports](compliance-reports.md) | Automated compliance reporting | Planned |
| [Service Mesh Integration](service-mesh.md) | Mesh-aware security policies | Planned |
| [Air-Gap Mode](airgap.md) | Offline threat intelligence | Planned |
| [Advanced Analytics](analytics.md) | Traffic analytics and trends | Planned |
| [Advanced RBAC](advanced-rbac.md) | Fine-grained permissions | Planned |

## Enterprise Architecture

The enterprise edition follows the same hexagonal/DDD architecture as the OSS agent:

```
ebpfsentinel-enterprise/
├── enterprise-domain/          # License, DLP engine, TLS bypass rules
├── enterprise-ports/           # Secondary port traits
├── enterprise-application/     # License service
├── enterprise-adapters/        # License file store, HTTP handlers
├── enterprise-infrastructure/  # Config, integrity checks, cert authority
├── enterprise-agent/           # CLI + HTTP server entry point
└── enterprise-license/         # License management CLI tool
```

Each enterprise crate depends on its OSS counterpart without modifying OSS code.

## What OSS Can Do Today

Many enterprise use cases can be addressed with current OSS capabilities:

| Enterprise Need | OSS Alternative |
|----------------|-----------------|
| Dashboard | REST API + Swagger UI + Grafana dashboards via Prometheus metrics |
| K8s deployment | DaemonSet manifests with ConfigMap (manual, no operator) |
| HA | Run on each node independently (no shared state needed per-node) |
| SIEM export | Webhook alerts + structured JSON logs → log shipper → SIEM |
| Compliance | Audit trail + alerting routes + Prometheus metrics for evidence collection |
| RBAC | JWT/OIDC/API keys with admin/operator/viewer roles |
| DLP patterns | 9 built-in patterns (PCI, PII, credentials) in alert mode |
