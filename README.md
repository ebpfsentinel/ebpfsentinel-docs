# eBPFsentinel

**High-performance network security agent powered by eBPF.** Written entirely in Rust — kernel programs and userspace — using the [Aya](https://aya-rs.dev/) framework.

eBPFsentinel attaches eBPF programs at XDP, TC, and uprobe hook points to inspect, filter, and react to network traffic at wire speed, with no kernel modules and no packet copies to userspace for the fast path.

## What It Does

eBPFsentinel provides 17 domains in a single agent binary:

| Domain | Description | Enforcement Point |
|--------|------------|-------------------|
| **Firewall** | L3/L4 packet filtering with LPM trie CIDR, port ranges, VLAN/QinQ 802.1ad, IPv6 extension headers, reject action (TCP RST / ICMP Unreachable) | XDP |
| **IDS** | Intrusion detection with regex patterns, kernel-side sampling, L7 protocol detection | TC classifier |
| **IPS** | Intrusion prevention with automatic IP blacklisting | Shared with IDS |
| **DLP** | Data loss prevention with configurable pattern scanning | uprobe (SSL) |
| **Rate Limiting** | Per-IP/subnet rate limiting with 4 algorithms (token bucket, fixed/sliding window, leaky bucket), per-CPU lock-free buckets | XDP |
| **Traffic Shaping / QoS** | Dummynet-inspired pipes (bandwidth/delay/loss), WF2Q+ queues, 5-tuple+DSCP classifiers, per-flow token bucket, FQ-CoDel | TC egress |
| **DDoS Protection** | SYN cookies (XDP_TX forging), ICMP/UDP/RST/FIN/ACK flood detection, connection tracking, EWMA state machine | XDP + Userspace |
| **Threat Intelligence** | OSINT feed integration with Bloom filter pre-check, LRU hash IOC correlation | TC classifier |
| **L7 Firewall** | Application-layer filtering for HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB | Userspace |
| **DNS Intelligence** | Passive DNS capture, domain blocklists, feed integration | TC classifier |
| **Domain Reputation** | Behavioral scoring engine, auto-blocking, alert enrichment | Userspace |
| **L4 Load Balancer** | TCP/UDP/TLS passthrough, per-service round-robin, weighted, ip-hash, least-conn, MAC swap | XDP |
| **Connection Tracking** | TCP/UDP/ICMP state machine, bidirectional tracking, packet + byte counters | TC classifier |
| **NAT** | SNAT/DNAT/masquerade/1:1/redirect/port-forward, NPTv6 (RFC 6296), hairpin NAT | TC ingress/egress |
| **Packet Scrubbing** | TTL/hop limit, MSS clamp, DF clear, IP ID random, TCP flag scrub, ECN strip, TOS normalize, TCP timestamp removal | TC classifier |
| **Policy Routing** | Multi-WAN failover, health checks, GeoIP gateway preference | XDP |
| **Zone Segmentation** | Interface-based security zones with inter-zone policies | Kernel + Userspace |

## Key Capabilities

- **IPv4/IPv6 dual-stack** across all 12 eBPF programs and userspace engines, with IPv6 extension header parsing and QinQ 802.1ad support
- **12 eBPF programs** — XDP firewall, XDP rate limiter, XDP load balancer, TC conntrack, TC NAT ingress/egress, TC scrub, TC IDS, TC threat intel, TC DNS, TC QoS, uprobe DLP
- **Interface groups** — multi-interface rule scoping with bitmask-based groups (up to 31), inversion support, across firewall/NAT/IDS/rate limit/QoS
- **XDP tail-call chaining** — firewall → rate limiter in a single attach point
- **XDP_TX packet forging** — firewall reject (TCP RST / ICMP Unreachable), SYN cookie SYN+ACK generation
- **Shared `ebpf-helpers` crate** — deduplicated network helpers, header parsing, metrics macros across all eBPF programs
- **RingBuf adaptive backpressure** — skip event emission when buffer >75% full
- **REST API** (Axum) with OpenAPI 3.0, Swagger UI, 60+ endpoints
- **gRPC streaming** (tonic) for real-time alert subscriptions
- **JWT / OIDC / API key authentication** with role-based access control
- **TLS 1.3** via rustls for both REST and gRPC
- **Prometheus metrics** with per-domain counters, histograms, and gauges
- **Hot reload** of configuration without restart (SIGHUP, file watcher, or API trigger)
- **CLI** with 13 domain subcommands and table/JSON output

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
