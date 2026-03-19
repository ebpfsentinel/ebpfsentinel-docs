# Enterprise Features

> **Edition: Enterprise** | **Status: Shipped**

## Overview

eBPFsentinel Enterprise extends the open-source agent with advanced security capabilities, management, multi-tenancy, analytics, and compliance automation features.

The OSS agent is fully functional for production use — all security domains, APIs, CLI, authentication, TLS, and observability are included in the open-source release. Enterprise adds deeper detection, enforcement, and operational capabilities.

Enterprise features are implemented in a **separate repository** (`ebpfsentinel-enterprise/`) that depends on the OSS core agent crates. Features are activated at runtime by a **license key system** with machine fingerprint binding and anti-tamper protections.

## Shipped Features

| Feature | Description | Status |
|---------|-------------|--------|
| [License System](license.md) | Ed25519 + ML-DSA-65 dual-signed license keys, machine fingerprint binding, air-gap activation | **Shipped** |
| [Advanced DLP](dlp.md) | Vectorscan engine, custom patterns, block mode, per-pattern overrides, TLS deep inspection | **Shipped** |
| [ML Anomaly Detection](ml-detection.md) | ONNX-based behavioral anomaly detection, multi-window aggregation, rule suggestion | **Shipped** |
| [Multi-Tenancy](multitenancy.md) | Namespace/interface-scoped isolation, quotas, tenant-aware RBAC, self-service API | **Shipped** |
| [SIEM Integration](siem-integration.md) | Splunk, Elasticsearch, OpenSearch, Wazuh, Sentinel, QRadar, Syslog connectors | **Shipped** |
| [Compliance Reports](compliance-reports.md) | PCI-DSS 4, HIPAA, GDPR Art 32, SOC 2 automated reporting | **Shipped** |
| [High Availability](high-availability.md) | Active-passive/active-active clustering, state replication, graceful degradation | **Shipped** |
| [Multi-Cluster](multicluster.md) | Federation, policy distribution, alert aggregation | **Shipped** |
| [Advanced RBAC](advanced-rbac.md) | 17 security domains, custom roles, permission inheritance | **Shipped** |
| [Air-Gap Mode](airgap.md) | Offline feed bundles with Ed25519-signed import/export | **Shipped** |
| [Advanced Analytics](analytics.md) | Top talkers, trends, IOC summaries, exportable reports | **Shipped** |
| [Fleet Management](fleet-management.md) | Agent registration, heartbeat, identity, config versioning, flow graph | **Shipped** |
| [AI/LLM Security](ai-security.md) | Shadow AI detection, AI-aware DLP, exfiltration heuristics, encrypted DNS policy | **Shipped** |
| [TLS Intelligence](tls-intelligence.md) | JA4+ threat DB, TLS behavior anomaly, PQC compliance, cipher policy enforcement | **Shipped** |

## Planned Features

| Feature | Description | Status |
|---------|-------------|--------|
| [Dashboard UI](dashboard.md) | Web-based management console | Planned |
| [Kubernetes Operator](kubernetes-operator.md) | CRD-driven configuration | Planned |

## Enterprise Architecture

The enterprise edition follows the same hexagonal/DDD architecture as the OSS agent:

```
ebpfsentinel-enterprise/
├── enterprise-domain/          # License, DLP, ML, tenants, HA, SIEM, compliance, RBAC, federation, analytics, air-gap, fleet, AI security
├── enterprise-ports/           # Secondary port traits (stores, transports, exporters)
├── enterprise-application/     # Application services (DLP, ML, air-gap orchestration)
├── enterprise-adapters/        # HTTP handlers, gRPC services, persistence (redb), SIEM connectors
├── enterprise-infrastructure/  # Config parsing, TLS CA, encrypted assets, binary integrity
├── enterprise-agent/           # CLI + HTTP server entry point
├── enterprise-license/         # License management CLI tool
├── enterprise-vectorscan/      # Safe Rust Vectorscan wrapper
└── enterprise-vectorscan-sys/  # Vectorscan FFI bindings
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
