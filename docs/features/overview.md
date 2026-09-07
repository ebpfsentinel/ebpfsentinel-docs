# Feature Overview

<!--
Six counts on this page are read out of the agent tree rather than remembered.
Each carries a `feature-count:` marker on the line above it, and
`npm run check:feature-counts` holds it to the file it was counted from:

  eBPF programs        crates/ebpf-programs/       (one directory per program)
  REST paths and       openapi.json                (`paths`, and the methods
  operations                                        declared under each one)
  CLI subcommands      crates/agent/src/cli.rs     (variants of `enum Command`)
  Rate limit           crates/domain/src/ratelimit/entity.rs
  algorithms                                       (`enum RateLimitAlgorithm`)
  Load balancer        crates/domain/src/loadbalancer/entity.rs
  algorithms                                       (`enum LbAlgorithm`)
  ATT&CK techniques    crates/domain/src/alert/mitre.rs
                                                   (distinct technique ids)

The first five went stale together and were corrected by hand; the sixth, the
technique count, went stale on its own afterwards, which is what settled the
question this comment used to leave open. The numbers are still written into
sentences rather than generated into them, so the checker reads the sentence
and holds the number in it to the tree: the prose stays editable and the fact
in it cannot drift. The program count is checked as a whole and as its parts,
because a total that is right while its breakdown is wrong reads as correct.

A marker naming a count the checker does not know, and a count the checker
knows that no page marks, both fail, so the register of checked numbers cannot
quietly shrink.
-->

## OSS / Enterprise Matrix

All features listed as **OSS** are included in the open-source release (AGPL-3.0). Features listed as Enterprise ship in the enterprise agent and are activated by a licence key - see [Enterprise Features](enterprise/overview.md).

### Security Domains

| Feature | Edition | Enforcement Point | Description |
|---------|---------|-------------------|-------------|
| [Firewall](firewall.md) | OSS | XDP | L3/L4 stateful filtering, LPM trie CIDR, TCP flags, ICMP type/code, MAC, DSCP, aliases, conntrack, NAT, zones, scheduling, scrub, policy routing |
| [IDS](ids.md) | OSS | TC classifier | Regex pattern matching, kernel-side sampling, payload shipped to the userspace L7 engine |
| [IPS](ips.md) | OSS | Shared with IDS | Automatic IP blacklisting, threshold detection |
| [DLP](dlp.md) | OSS | uprobe (SSL) | Pattern scanning for credit cards, SSN, API keys, etc. |
<!-- feature-count: ratelimit-algorithms -->
| [Rate Limiting](ratelimit.md) | OSS | XDP | 4 algorithms, per-CPU lock-free, SYN cookie protection |
| [DDoS Protection](ddos.md) | OSS | XDP + Userspace | SYN/ICMP/UDP flood detection, connection tracking, EWMA state machine |
<!-- feature-count: lb-algorithms -->
| [L4 Load Balancer](loadbalancer.md) | OSS | XDP | TCP/UDP/TLS passthrough, 5 algorithms: round-robin, weighted, ip-hash, least-conn, maglev |
| [Threat Intelligence](threatintel.md) | OSS | TC classifier | OSINT feeds (plaintext, CSV, JSON, STIX 2.1), IOC correlation, multi-engine distribution (IP, domain, URL), per-feed alert or block |
| [L7 Firewall](l7-firewall.md) | OSS | Userspace | HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB protocol-aware rules |
| [DNS Intelligence](dns-intelligence.md) | OSS | TC classifier | Passive DNS, domain blocklists, feed integration |
| [Alerting](alerting.md) | OSS | Userspace | Circuit breaker, dedup, routing to email/webhook/log |
| [Audit Trail](audit.md) | OSS | Userspace | Rule change history, retention policies |
| [Authentication](authentication.md) | OSS | Userspace | JWT (RS256), OIDC (JWKS), API keys, RBAC |
| [IPv6](ipv6.md) | OSS | All programs | Full dual-stack IPv4/IPv6 across all eBPF programs and engines |
| [GeoIP Enforcement](geoip.md) | OSS | Userspace + Kernel (LPM) | IP-to-location enrichment + cross-domain country-aware enforcement (DDoS auto-block, IPS /24 injection, rate limit tiers, L7 country matching, IDS country sampling) |
| [VLAN 802.1Q / 802.1ad](vlan.md) | OSS | XDP, TC | VLAN filtering, QinQ double tagging, VLAN ID on every event |
| [Connection Tracking](conntrack.md) | OSS | TC classifier | TCP/UDP/ICMP state machine, bidirectional tracking |
| [NAT](nat.md) | OSS | TC ingress/egress | DNAT/SNAT, NPTv6 (RFC 6296), hairpin NAT, port mapping, checksum offload |
| [Policy Routing](routing.md) | OSS | XDP | Multi-gateway, weighted selection, health-aware failover |
| [Zone Segmentation](zones.md) | OSS | Kernel + Userspace | Network zones with inter-zone policies |
| [QoS / Traffic Shaping](qos.md) | OSS | TC egress | Pipe/queue/classifier hierarchy, token bucket, WF2Q+, EDT pacing (`bpf_skb_set_tstamp`), delay/loss emulation |
| [IP/Port Aliases](aliases.md) | OSS | Userspace | Named address/port groups, external URL content |
| [Interface Groups](interface-groups.md) | OSS | XDP, TC | Scope rules to interface groups, floating rules, bitmask enforcement |
<!-- feature-count: mitre-techniques -->
| [MITRE ATT&CK Mapping](mitre-attack.md) | OSS | Userspace | 36 techniques mapped, filter by tactic/technique, coverage dashboard |
| [JA4+ Fingerprinting](ja4-fingerprinting.md) | OSS | Userspace | TLS ClientHello fingerprints, GREASE filtering, flow cache |
| [Encrypted DNS Detection](operational-essentials.md#encrypted-dns-detection-dohdot) | OSS | Userspace | DoH/DoT passive detection with built-in resolvers |

### Infrastructure

| Feature | Edition | Description |
|---------|---------|-------------|
<!-- feature-count: rest-surface -->
| REST API (89 paths, 105 operations) | OSS | OpenAPI 3.0 with SecurityScheme (JWT + API Key), Swagger UI, Axum |
| gRPC Streaming | OSS | Real-time alert subscriptions via tonic |
| Prometheus Metrics | OSS | Per-domain counters, histograms, gauges |
| [Post-Quantum TLS](pq-tls.md) | OSS | X25519MLKEM768 hybrid key exchange (inbound + outbound) |
| Hot Reload | OSS | SIGHUP, file watcher, or REST API trigger |
| [OTLP Export](operational-essentials.md#otlp-export) | OSS | Fire-and-forget OTLP Logs via gRPC or HTTP |
| [Manual Response Actions](operational-essentials.md#manual-response-actions) | OSS | Time-bounded block/throttle with TTL auto-expiry |
| [Auto-Response](operational-essentials.md#auto-response) | OSS | Severity-based auto block/throttle on alerts (max 3 policies, multi-component filter) |
| [Manual Packet Capture](operational-essentials.md#manual-packet-capture) | OSS | libpcap-based pcap capture with BPF filter |
| [Auto-Capture](operational-essentials.md#auto-capture) | OSS | Event-triggered PCAP on high-severity alerts (1 capture, max 60s, auto BPF filter) |
<!-- feature-count: cli-subcommands -->
| CLI (37 subcommands) | OSS | `watch` (live alerts), `score` (risk score), `investigate` (IP correlation), `top` (top talkers), `flows`, `alerts stats` |
| Docker / Compose | OSS | Multi-stage build, compose file included |

### Enterprise

| Feature | Description |
|---------|-------------|
| [License System](enterprise/license.md) | Ed25519 + ML-DSA-65 dual-signed keys, machine fingerprint, air-gap activation |
| [Advanced DLP](enterprise/dlp.md) | Vectorscan engine, custom patterns, block mode, TLS deep inspection |
| [ML Anomaly Detection](enterprise/ml-detection.md) | ONNX behavioral anomaly detection, multi-window, rule suggestion |
| [Multi-Tenancy](enterprise/multitenancy.md) | Namespace/interface isolation, quotas, RBAC, self-service API |
| [SIEM Integration](enterprise/siem-integration.md) | 10 connectors: Splunk, ES, OpenSearch, Wazuh, Sentinel, QRadar, Syslog, OTLP, S3, ClickHouse |
| [Compliance Reports](enterprise/compliance-reports.md) | PCI-DSS 4, HIPAA, GDPR, SOC 2, NIS2, DORA, SecNumCloud, HDS + PDF export |
| [High Availability](enterprise/high-availability.md) | Active-passive/active-active, state replication, graceful degradation |
| [Multi-Cluster](enterprise/multicluster.md) | Federation, policy distribution, alert aggregation |
| [Advanced RBAC](enterprise/advanced-rbac.md) | 17 security domains, custom roles, permission inheritance |
| [Air-Gap Mode](enterprise/airgap.md) | Offline feed bundles with Ed25519-signed import/export |
| [Advanced Analytics](enterprise/analytics.md) | Top talkers, trends, IOC summaries, flow query API |
| [Fleet Management](enterprise/fleet-management.md) | Agent registration, heartbeat, identity, config versioning |
| [AI/LLM Security](enterprise/ai-security.md) | Shadow AI detection, AI-aware DLP, exfiltration, encrypted DNS |
| [TLS Intelligence](enterprise/tls-intelligence.md) | JA4+ threat DB, behavior anomaly, PQC compliance, cipher policy |
| [Network Forensics](enterprise/network-forensics.md) | Ring buffer capture, event-triggered captures, flow timeline |
| [Automated Response](enterprise/automated-response.md) | Policy engine, SOAR webhook, eBPF enforcement, audit trail |
| [Dashboard UI](enterprise/dashboard.md) | Angular console over a fleet: OIDC login, tenant scope enforced server-side, a screen per feature |
| [Kubernetes Operator](enterprise/kubernetes-operator.md) | One agent resource and 36 policy resources reconciled into an agent DaemonSet |

## Deployment Compatibility

Not all features work in every deployment mode. See the [deployment compatibility matrix](deployment-matrix.md) for per-feature support across bare metal, container, Kubernetes DaemonSet, and sidecar deployments.

## eBPF Program Map

<!-- feature-count: ebpf-programs -->
`crates/ebpf-programs/` holds sixteen program directories: twelve attached at an
enforcement point, three reached only by tail call from one of those twelve, and
`xdp-pass`, which is peer-side test scaffolding rather than part of the
datapath. The twelve enforcement points:

| Program | Hook | Features |
|---------|------|----------|
| `xdp-firewall` | XDP | 5-phase pipeline, LPM trie, conntrack fast-path, TCP flags, ICMP, MAC, DSCP, aliases, connection limits, policy routing, DEVMAP/CPUMAP, FIB lookup, tail-call to rate limiter, interface groups |
| `xdp-ratelimit` | XDP | 4 algorithms, PerCPU hash, SYN cookie, `bpf_timer` maintenance, per-country LPM tier lookup, interface groups |
| `xdp-loadbalancer` | XDP | L4 load balancing, per-service round-robin, MAC swap, backend selection, health-aware routing |
| `tc-conntrack` | TC classifier | Unified TCP/UDP/ICMP state machine, bidirectional tracking, packet+byte counters, IPv4/IPv6 |
| `tc-scrub` | TC classifier | TTL/hop limit normalization, MSS clamping, DF clearing, IP ID randomization, IPv4/IPv6 |
| `tc-nat-ingress` | TC ingress | NPTv6 prefix translation, hairpin NAT, destination NAT (DNAT), port mapping, checksum updates, IPv4/IPv6, interface groups |
| `tc-nat-egress` | TC egress | NPTv6 prefix translation, source NAT (SNAT), reverse mapping, checksum updates, IPv4/IPv6, interface groups |
| `tc-ids` | TC classifier | Regex matching, kernel sampling, full packet sizing (`bpf_dynptr_size`), RingBuf backpressure, interface groups |
| `tc-threatintel` | TC classifier | Bloom filter pre-check, LRU hash IOC confirmation, VLAN and QinQ tag parsing, backpressure |
| `tc-qos` | TC egress | Token bucket bandwidth limiting, WF2Q+ queuing, 4-level classifier, EDT pacing (`bpf_skb_set_tstamp`), delay/loss emulation, interface groups |
| `tc-dns` | TC classifier | Passive DNS capture |
| `uprobe-dlp` | uprobe | SSL/TLS content inspection |

The three tail-called programs are attached to no hook of their own. Each is
entered from the program that needs it, which is why they are counted apart:

| Program | Called from | Purpose |
|---------|-------------|---------|
| `xdp-firewall-reject` | `xdp-firewall` | Forges the TCP RST or ICMP unreachable a `reject` rule owes |
| `xdp-ratelimit-syncookie` | `xdp-ratelimit` | Forges the SYN-ACK cookie under SYN-flood protection |
| `xdp-vip-announcer` | `xdp-loadbalancer` | Emits the gratuitous ARP that claims a VIP |

`xdp-pass` is the sixteenth directory. It is a no-op XDP program attached to the
far side of a veth pair in the integration tests, because native XDP_TX on a
veth needs a program on the peer to be delivered. Nothing deploys it.

All rule-bearing programs (xdp-firewall, xdp-ratelimit, tc-nat-ingress, tc-nat-egress, tc-ids, tc-qos) support **interface groups** - rules can be scoped to named groups of interfaces via a u32 bitmask. Rules with no `interfaces` field are floating (apply everywhere). See [Interface Groups](interface-groups.md).
