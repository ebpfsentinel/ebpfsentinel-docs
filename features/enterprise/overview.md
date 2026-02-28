# Enterprise Features

> **Edition: Enterprise** | **Status: Planned**

## Overview

eBPFsentinel Enterprise extends the open-source agent with management, multi-tenancy, advanced analytics, and compliance automation features. Enterprise features are planned for future releases.

The OSS agent is fully functional for production use — all security domains, APIs, CLI, authentication, TLS, and observability are included in the open-source release.

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
