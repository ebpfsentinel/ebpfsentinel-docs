# eBPFsentinel

Kernel-native **Network Detection & Response (NDR)** platform for Linux. One Rust binary replaces your firewall, IDS/IPS, DDoS mitigation, DLP, and 10+ other network security tools — all running inside the Linux kernel via eBPF at wire speed. Not an endpoint agent — a **network agent** that runs where your traffic flows.

eBPFsentinel attaches 14 eBPF programs at XDP, TC, and uprobe hook points to inspect, filter, and react to network traffic with no kernel modules and no packet copies to userspace for the fast path. Written entirely in Rust — kernel programs and userspace — using the [Aya](https://aya-rs.dev/) framework.

## What It Does

eBPFsentinel provides 14 security domains in a single agent binary:

| Domain | Description | Enforcement Point |
|--------|------------|-------------------|
| **Firewall** | L3/L4 stateful filtering with LPM trie CIDR, port ranges, GeoIP blocking, VLAN/QinQ 802.1ad, security zones, schedule-based rules, reject action (TCP RST / ICMP Unreachable) | XDP |
| **IDS** | Intrusion detection with regex patterns, kernel-side sampling, L7 protocol detection, MITRE ATT&CK mapping | TC classifier |
| **IPS** | Intrusion prevention with automatic IP and /24 subnet blacklisting | Shared with IDS |
| **DLP** | Data loss prevention — PCI card numbers, PII, credential patterns via SSL/TLS uprobe interception | uprobe (SSL) |
| **Rate Limiting** | Per-IP/subnet rate limiting with 4 algorithms (token bucket, fixed/sliding window, leaky bucket), per-country tiers, SYN cookie generation | XDP |
| **DDoS Mitigation** | SYN cookie forging (XDP_TX), ICMP/UDP/RST/FIN/ACK flood detection, volumetric thresholds, EWMA state machine, auto-CIDR blocking | XDP + Userspace |
| **Traffic Shaping / QoS** | Dummynet-inspired pipes (bandwidth/delay/loss), WF2Q+ queues, 5-tuple+DSCP classifiers, per-flow token bucket, FQ-CoDel AQM, EDT pacing | TC egress |
| **Threat Intelligence** | Source-agnostic OSINT feeds (CSV, JSON, plaintext, STIX 2.1), Bloom filter pre-check, LRU hash IOC correlation, auto-blocking | TC classifier |
| **L7 Firewall** | Application-layer filtering for HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB with GeoIP source/destination matching | Userspace |
| **DNS Intelligence** | Passive DNS capture, domain blocklists, behavioral reputation scoring, encrypted DNS detection (DoH/DoT) | TC classifier |
| **L4 Load Balancer** | TCP/UDP/TLS passthrough with round-robin, weighted, IP hash, least-connections algorithms | XDP |
| **Connection Tracking** | TCP/UDP/ICMP state machine, bidirectional tracking, packet + byte counters | TC classifier |
| **NAT** | SNAT/DNAT/masquerade/1:1/redirect/port-forward, NPTv6 (RFC 6296), hairpin NAT | TC ingress/egress |
| **Packet Scrubbing** | TTL/hop limit normalization, MSS clamp, DF clear, IP ID random, TCP flag scrub, ECN strip, TOS normalize, TCP timestamp removal | TC classifier |

Plus **policy routing** (multi-WAN failover, health checks, GeoIP gateway preference) and **zone segmentation** (interface-based security zones with inter-zone policies).

## Key Capabilities

- **IPv4/IPv6 dual-stack** across all 14 eBPF programs and userspace engines, with IPv6 extension header parsing and QinQ 802.1ad support
- **14 eBPF programs** — 5 XDP (firewall, firewall-reject, ratelimit, ratelimit-syncookie, loadbalancer), 8 TC (ids, threatintel, conntrack, dns, nat-ingress, nat-egress, qos, scrub), 1 uprobe (dlp)
- **Multi-NIC support** — attach to multiple interfaces, bond masters, VLAN trunks. [Interface groups](features/interface-groups.md) for per-interface rule scoping (up to 31 groups)
- **XDP tail-call chaining** — firewall → reject, firewall → ratelimit, ratelimit → syncookie in single attach points
- **XDP_TX packet forging** — firewall reject (TCP RST / ICMP Unreachable), SYN cookie SYN+ACK generation
- **Parallel event dispatch** — configurable worker count (default 4), deterministic per-source partitioning, lock-free ArcSwap service access
- **MITRE ATT&CK mapping** — every alert tagged with technique + tactic ID
- **JA4+ TLS fingerprinting** — ClientHello parsing in eBPF, JA4/JA4S computation in userspace
- **Shared `ebpf-helpers` crate** — deduplicated network helpers, header parsing, metrics macros across all eBPF programs
- **RingBuf adaptive backpressure** — skip event emission when buffer >75% full
- **REST API** (Axum) with OpenAPI 3.0, Swagger UI, CORS, 65+ endpoints
- **gRPC streaming** (tonic) for real-time alert subscriptions with severity, component, MITRE filters
- **JWT / OIDC / API key authentication** with role-based access control (Admin, Operator, Viewer)
- **TLS 1.3** via rustls + aws-lc-rs, post-quantum ready (X25519MLKEM768 hybrid)
- **Prometheus metrics** with per-domain counters, histograms, per-worker dispatch metrics, and kernel-side eBPF counters
- **OTLP export** — alerts as OpenTelemetry Logs (gRPC or HTTP) to any OTLP-compatible collector
- **Alert pipeline** with routing to email, webhook, log, and OTLP sinks, concurrent sender dispatch
- **Hot reload** of configuration without restart (SIGHUP, file watcher, or API trigger)
- **CLI** with 18 domain subcommands + 8 utility commands and table/JSON output
- **Helm chart** for Kubernetes DaemonSet deployment with JSON schema validation

## Who Is This For?

- **Security engineers** who need kernel-speed network detection and response without kernel modules
- **Platform teams** deploying network security on Linux hosts, VMs, or Kubernetes nodes
- **Compliance teams** needing audit trails, DLP, and threat detection for PCI-DSS, HIPAA, NIS2, DORA
- **Teams migrating** from iptables + Suricata + tc + ipset + fail2ban to a single unified agent

## OSS vs Enterprise

eBPFsentinel is open source (AGPL-3.0). All 14 security domains, the REST/gRPC API, CLI, authentication, TLS, Prometheus, OTLP, MITRE ATT&CK, and JA4+ fingerprinting are included — no paywall.

An [enterprise edition](features/enterprise/overview.md) adds ML anomaly detection, advanced DLP (Vectorscan), multi-tenancy, SIEM integration (Splunk, Elastic, QRadar, S3, OTLP), compliance reporting (PCI-DSS, NIS2, DORA), HA clustering, multi-cluster federation, RBAC, air-gap deployment, analytics, AI/LLM security, TLS intelligence, network forensics, and automated response orchestration.

## Next Steps

- [Prerequisites](getting-started/prerequisites.md) — verify your system meets the requirements
- [Installation](getting-started/installation.md) — build from source or use Docker
- [Quickstart](getting-started/quickstart.md) — get the agent running in 5 minutes
- [Core Concepts](getting-started/concepts.md) — understand the architecture before diving in
- [Kubernetes Deployment](operations/deployment/kubernetes.md) — Helm chart and DaemonSet guide
