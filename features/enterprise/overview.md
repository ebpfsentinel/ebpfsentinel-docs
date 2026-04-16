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
| [ML Anomaly Detection](ml-detection.md) | 8 detection engines: baseline Z-score, EWMA streaming, CUSUM change-point, ONNX model, heavy-hitter (CMS), DGA/tunneling (Markov), TLS fingerprint clustering (K-Means), C2 beaconing (TLSH) | **Shipped** |
| [Multi-Tenancy](multitenancy.md) | Namespace/interface-scoped isolation, quotas, tenant-aware RBAC, self-service API | **Shipped** |
| [SIEM Integration](siem-integration.md) | 10 connectors: Splunk, Elasticsearch, OpenSearch, Wazuh, Sentinel, QRadar, Syslog, OTLP, S3, ClickHouse | **Shipped** |
| [Compliance Reports](compliance-reports.md) | PCI-DSS 4, HIPAA, GDPR Art 32, SOC 2, NIS2, DORA, SecNumCloud, HDS + PDF export | **Shipped** |
| [High Availability](high-availability.md) | Active-passive/active-active clustering, state replication, graceful degradation | **Shipped** |
| [Multi-Cluster](multicluster.md) | Federation, policy distribution, alert aggregation | **Shipped** |
| [Advanced RBAC](advanced-rbac.md) | 17 security domains, custom roles, permission inheritance | **Shipped** |
| [Air-Gap Mode](airgap.md) | Offline feed bundles with Ed25519-signed import/export | **Shipped** |
| [Advanced Analytics](analytics.md) | Top talkers, trends, IOC summaries, exportable reports | **Shipped** |
| [Fleet Management](fleet-management.md) | Agent registration, heartbeat, identity, config versioning, flow graph | **Shipped** |
| [AI/LLM Security](ai-security.md) | Shadow AI detection, AI-aware DLP, exfiltration heuristics, encrypted DNS policy | **Shipped** |
| [TLS Intelligence](tls-intelligence.md) | JA4+ threat DB, behavior anomaly, PQC compliance, cipher policy, cipher downgrade, JA4S, SNI/cert mismatch, session tracking, beaconing bridge, ONNX ML, peer-group rarity | **Shipped** |
| [Network Forensics](network-forensics.md) | Ring buffer capture engine, event-triggered captures, flow timeline reconstruction | **Shipped** |
| [Automated Response](automated-response.md) | Policy engine, SOAR webhook integration, cooldown tracking, audit trail | **Shipped** |

## Shipped — Partial

| Feature | Description | Status |
|---------|-------------|--------|
| [Extended TLS Library Hooking](dlp.md#extended-tls-library-coverage) | Discovery + symbol resolution + `TlsProbeManager` for Go `crypto/tls`, Java JSSE, statically-linked BoringSSL, kTLS, GnuTLS; `/proc` scanner, background scan loop, 6 Prometheus metrics, and `/api/v1/enterprise/tls-probes/*` admin API wired. Kernel-side uprobe attachment blocked on upstream aya support. | **Shipped — discovery + admin API** |
| [Extended L7 Protocol Parsers](../l7-firewall.md#supported-protocols-enterprise-extension-port) | MQTT, AMQP 0-9-1, NATS, Cassandra CQL detection via the `L7ExtendedParser` port. Per-protocol matcher evaluation | **Shipped — detection layer** |
| [L7 Deep Content Inspection](l7-deep-inspection.md) | Vectorscan-backed pattern engine with 40+ curated SQLi / XSS / path traversal / command injection / data exfil signatures. HTTP handler + L7 pipeline wiring | **Shipped — detection engine** |
| [Per-Protocol Security Policies](l7-per-protocol-policies.md) | Redis / MongoDB / Kafka / SQL / LDAP / SSH policy engines with dangerous-command blocking, namespace/ACL enforcement, weak-crypto rejection. HTTP admin API and L7 dispatcher wiring ship in a follow-up release. | **Shipped — policy engines** |
| [L7 Alert Enrichment](l7-alert-enrichment.md) | `L7Enricher` mapping Vectorscan + policy signals to OWASP Top 10, MITRE ATT&CK (T1190/T1059/T1048/T1069/T1078/T1040/T1555) and PCI-DSS 6.5. SIEM export + compliance-report wiring ship in a follow-up release. | **Shipped — enrichment engine** |

## Planned Features

| Feature | Description | Status |
|---------|-------------|--------|
| [Dashboard UI](dashboard.md) | Web-based management console | Planned |
| [Kubernetes Operator](kubernetes-operator.md) | CRD-driven configuration | Planned |

## Enterprise Architecture

The enterprise edition follows the same hexagonal/DDD architecture as the OSS agent:

```
ebpfsentinel-enterprise/
├── enterprise-domain/          # License, DLP, ML, tenants, HA, SIEM, compliance, RBAC, federation, analytics, air-gap, fleet, AI security, TLS intelligence, forensics, response
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
