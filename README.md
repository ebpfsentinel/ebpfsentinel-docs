# eBPFsentinel

**High-performance network security agent powered by eBPF.** Written entirely in Rust — kernel programs and userspace — using the [Aya](https://aya-rs.dev/) framework.

eBPFsentinel attaches eBPF programs at XDP, TC, and uprobe hook points to inspect, filter, and react to network traffic at wire speed, with no kernel modules and no packet copies to userspace for the fast path.

## What It Does

eBPFsentinel provides 10 security domains in a single agent binary:

| Domain | Description | Enforcement Point |
|--------|------------|-------------------|
| **Firewall** | L3/L4 packet filtering with LPM trie CIDR matching, port ranges, VLAN filtering | XDP |
| **IDS** | Intrusion detection with regex patterns, kernel-side sampling, L7 protocol detection | TC classifier |
| **IPS** | Intrusion prevention with automatic IP blacklisting | Shared with IDS |
| **DLP** | Data loss prevention with configurable pattern scanning | uprobe (SSL) |
| **Rate Limiting** | DDoS protection with 5 algorithms, per-CPU lock-free buckets | XDP |
| **DDoS Protection** | SYN/ICMP/UDP flood detection, connection tracking, EWMA state machine | XDP + Userspace |
| **Threat Intelligence** | OSINT feed integration with Bloom filter pre-check, IOC correlation | TC classifier |
| **L7 Firewall** | Application-layer filtering for HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB | Userspace |
| **DNS Intelligence** | Passive DNS capture, domain blocklists, feed integration | TC classifier |
| **Domain Reputation** | Behavioral scoring engine, auto-blocking, alert enrichment | Userspace |

## Key Capabilities

- **IPv6 + VLAN 802.1Q** dual-stack across all eBPF programs and engines
- **10 eBPF programs** — XDP firewall, XDP rate limiter, TC conntrack, TC NAT ingress/egress, TC scrub, TC IDS, TC threat intel, TC DNS, uprobe DLP
- **XDP tail-call chaining** — firewall → rate limiter in a single attach point
- **RingBuf adaptive backpressure** — skip event emission when buffer >75% full
- **REST API** (Axum) with OpenAPI 3.0, Swagger UI, 23 endpoints
- **gRPC streaming** (tonic) for real-time alert subscriptions
- **JWT / OIDC / API key authentication** with role-based access control
- **TLS 1.3** via rustls for both REST and gRPC
- **Prometheus metrics** with per-domain counters, histograms, and gauges
- **Hot reload** of configuration without restart (SIGHUP, file watcher, or API trigger)
- **CLI** with 10 domain subcommands and table/JSON output

## Who Is This For?

- **Security engineers** who need kernel-speed network enforcement without kernel modules
- **Platform teams** deploying network security on Linux hosts, VMs, or Kubernetes nodes
- **Compliance teams** needing audit trails, DLP, and threat detection for PCI-DSS, HIPAA, GDPR, or SOC 2

## OSS vs Enterprise

eBPFsentinel is open source (AGPL-3.0). All security domains, the REST/gRPC API, CLI, authentication, TLS, and observability are included.

Enterprise features (dashboard UI, Kubernetes operator, HA clustering, ML detection, SIEM integration) are planned — see the [Enterprise Features](features/enterprise/overview.md) section for the roadmap.

## Next Steps

- [Prerequisites](getting-started/prerequisites.md) — verify your system meets the requirements
- [Installation](getting-started/installation.md) — build from source or use Docker
- [Quickstart](getting-started/quickstart.md) — get the agent running in 5 minutes
- [Core Concepts](getting-started/concepts.md) — understand the architecture before diving in
