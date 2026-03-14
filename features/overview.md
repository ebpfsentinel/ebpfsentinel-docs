# Feature Overview

## OSS / Enterprise Matrix

All features listed as **OSS** are included in the open-source release (AGPL-3.0). Enterprise features are planned — see the [Enterprise roadmap](enterprise/overview.md).

### Security Domains

| Feature | Edition | Status | Enforcement Point | Description |
|---------|---------|--------|-------------------|-------------|
| [Firewall](firewall.md) | OSS | Shipped | XDP | L3/L4 stateful filtering, LPM trie CIDR, TCP flags, ICMP type/code, MAC, DSCP, aliases, conntrack, NAT, zones, scheduling, scrub, policy routing |
| [IDS](ids.md) | OSS | Shipped | TC classifier | Regex pattern matching, kernel-side sampling, L7 detection |
| [IPS](ips.md) | OSS | Shipped | Shared with IDS | Automatic IP blacklisting, threshold detection |
| [DLP](dlp.md) | OSS | Shipped | uprobe (SSL) | Pattern scanning for credit cards, SSN, API keys, etc. |
| [Rate Limiting](ratelimit.md) | OSS | Shipped | XDP | 5 algorithms, per-CPU lock-free, SYN cookie protection |
| [DDoS Protection](ddos.md) | OSS | Shipped | XDP + Userspace | SYN/ICMP/UDP flood detection, connection tracking, EWMA state machine |
| [L4 Load Balancer](loadbalancer.md) | OSS | Shipped | XDP | TCP/UDP/TLS passthrough, round-robin, weighted, ip-hash, least-conn |
| [Threat Intelligence](threatintel.md) | OSS | Shipped | TC classifier | OSINT feeds, Bloom filter, IOC correlation, VLAN quarantine |
| [L7 Firewall](l7-firewall.md) | OSS | Shipped | Userspace | HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB protocol-aware rules |
| [DNS Intelligence](dns-intelligence.md) | OSS | Shipped | TC classifier | Passive DNS, domain blocklists, feed integration |
| [Alerting](alerting.md) | OSS | Shipped | Userspace | Circuit breaker, dedup, routing to email/webhook/log |
| [Audit Trail](audit.md) | OSS | Shipped | Userspace | Rule change history, retention policies |
| [Authentication](authentication.md) | OSS | Shipped | Userspace | JWT (RS256), OIDC (JWKS), API keys, RBAC |
| [IPv6](ipv6.md) | OSS | Shipped | All programs | Full dual-stack IPv4/IPv6 across all eBPF programs and engines |
| [GeoIP Enforcement](geoip.md) | OSS | Shipped | Userspace + Kernel (LPM) | IP-to-location enrichment + cross-domain country-aware enforcement (DDoS auto-block, IPS /24 injection, rate limit tiers, L7 country matching, IDS country sampling) |
| [VLAN 802.1Q / 802.1ad](vlan.md) | OSS | Shipped | XDP, TC | VLAN filtering, QinQ double tagging, quarantine tagging |
| [Connection Tracking](conntrack.md) | OSS | Shipped | TC classifier | TCP/UDP/ICMP state machine, bidirectional tracking |
| [NAT](nat.md) | OSS | Shipped | TC ingress/egress | DNAT/SNAT, NPTv6 (RFC 6296), hairpin NAT, port mapping, checksum offload |
| [Policy Routing](routing.md) | OSS | Shipped | XDP | Multi-gateway, weighted selection, health-aware failover |
| [Zone Segmentation](zones.md) | OSS | Shipped | Kernel + Userspace | Network zones with inter-zone policies |
| [QoS / Traffic Shaping](qos.md) | OSS | Shipped | TC egress | Pipe/queue/classifier hierarchy, token bucket, WF2Q+, delay/loss emulation |
| [IP/Port Aliases](aliases.md) | OSS | Shipped | Userspace | Named address/port groups, external URL content |
| [Interface Groups](interface-groups.md) | OSS | Shipped | XDP, TC | Scope rules to interface groups, floating rules, bitmask enforcement |

### Infrastructure

| Feature | Edition | Status | Description |
|---------|---------|--------|-------------|
| REST API (50+ endpoints) | OSS | Shipped | OpenAPI 3.0, Swagger UI, Axum |
| gRPC Streaming | OSS | Shipped | Real-time alert subscriptions via tonic |
| Prometheus Metrics | OSS | Shipped | Per-domain counters, histograms, gauges |
| TLS 1.3 | OSS | Shipped | rustls with aws-lc backend |
| Hot Reload | OSS | Shipped | SIGHUP, file watcher, or REST API trigger |
| CLI (11 subcommands) | OSS | Shipped | Table/JSON output, authenticated access |
| Docker / Compose | OSS | Shipped | Multi-stage build, compose file included |

### Enterprise (Planned)

| Feature | Status | Description |
|---------|--------|-------------|
| [Dashboard UI](enterprise/dashboard.md) | Planned | Web-based management console |
| [Kubernetes Operator](enterprise/kubernetes-operator.md) | Planned | CRD-driven configuration, auto-reconciliation |
| [High Availability](enterprise/high-availability.md) | Planned | Active-passive clustering, state replication |
| [Multi-Cluster](enterprise/multicluster.md) | Planned | Federated policy across clusters |
| [Multi-Tenancy](enterprise/multitenancy.md) | Planned | Namespace-scoped isolation |
| [ML Anomaly Detection](enterprise/ml-detection.md) | Planned | Behavioral anomaly detection |
| [SIEM Integration](enterprise/siem-integration.md) | Planned | Native Splunk, Elastic, Sentinel connectors |
| [Compliance Reports](enterprise/compliance-reports.md) | Planned | Automated PCI-DSS, HIPAA, SOC 2 reports |
| [Service Mesh Integration](enterprise/service-mesh.md) | Planned | Istio, Linkerd, Cilium mesh interop |
| [Air-Gap Mode](enterprise/airgap.md) | Planned | Offline threat intel, local feed bundles |
| [Advanced Analytics](enterprise/analytics.md) | Planned | Traffic analytics, trend analysis |
| [Advanced RBAC](enterprise/advanced-rbac.md) | Planned | Fine-grained per-resource permissions |

## Deployment Compatibility

Not all features work in every deployment mode. See the [deployment compatibility matrix](deployment-matrix.md) for per-feature support across bare metal, container, Kubernetes DaemonSet, and sidecar deployments.

## eBPF Program Map

Twelve kernel programs cover all enforcement points:

| Program | Hook | Features |
|---------|------|----------|
| `xdp-firewall` | XDP | 5-phase pipeline, LPM trie, conntrack fast-path, TCP flags, ICMP, MAC, DSCP, aliases, connection limits, policy routing, DEVMAP/CPUMAP, FIB lookup, tail-call to rate limiter, interface groups |
| `xdp-ratelimit` | XDP | 5 algorithms, PerCPU hash, SYN cookie, `bpf_timer` maintenance, per-country LPM tier lookup, interface groups |
| `xdp-loadbalancer` | XDP | L4 load balancing, per-service round-robin, MAC swap, backend selection, health-aware routing |
| `tc-conntrack` | TC classifier | Unified TCP/UDP/ICMP state machine, bidirectional tracking, packet+byte counters, IPv4/IPv6 |
| `tc-scrub` | TC classifier | TTL/hop limit normalization, MSS clamping, DF clearing, IP ID randomization, IPv4/IPv6 |
| `tc-nat-ingress` | TC ingress | NPTv6 prefix translation, hairpin NAT, destination NAT (DNAT), port mapping, checksum updates, IPv4/IPv6, interface groups |
| `tc-nat-egress` | TC egress | NPTv6 prefix translation, source NAT (SNAT), reverse mapping, checksum updates, IPv4/IPv6, interface groups |
| `tc-ids` | TC classifier | Regex matching, kernel sampling, L7 detection, RingBuf backpressure, interface groups |
| `tc-threatintel` | TC classifier | Bloom filter pre-check, LRU hash IOC confirmation, VLAN quarantine, backpressure |
| `tc-qos` | TC egress | Token bucket bandwidth limiting, WF2Q+ queuing, 4-level classifier, delay/loss emulation, interface groups |
| `tc-dns` | TC classifier | Passive DNS capture |
| `uprobe-dlp` | uprobe | SSL/TLS content inspection |

All rule-bearing programs (xdp-firewall, xdp-ratelimit, tc-nat-ingress, tc-nat-egress, tc-ids, tc-qos) support **interface groups** — rules can be scoped to named groups of interfaces via a u32 bitmask. Rules with no `interfaces` field are floating (apply everywhere). See [Interface Groups](interface-groups.md).
