# Service Mesh Integration

> **Edition: Enterprise** | **Status: Planned**

## Overview

Mesh-aware security policies that integrate with service mesh data planes.

## Planned Capabilities

- Istio integration (read service identity from mTLS certificates)
- Linkerd integration (tap API for traffic metadata)
- Cilium mesh interop (shared eBPF maps)
- Service-identity-based firewall rules (allow service A → service B)
- Mesh-aware alert enrichment (service name, namespace, version)

## Current Alternative

Use L7 firewall rules to filter by protocol-level identifiers (HTTP host, TLS SNI, gRPC service name). The L7 firewall supports HTTP, TLS/SNI, gRPC, SMTP, FTP, and SMB protocols. See [L7 Firewall](../l7-firewall.md).
