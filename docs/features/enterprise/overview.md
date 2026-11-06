# Enterprise Features

> **Edition: Enterprise**

## Overview

eBPFsentinel Enterprise extends the open-source agent with advanced security capabilities, management, multi-tenancy, analytics, and compliance automation features.

The OSS agent is fully functional for production use - all security domains, APIs, CLI, authentication, TLS, and observability are included in the open-source release. Enterprise adds deeper detection, enforcement, and operational capabilities.

Enterprise features are implemented in a **separate repository** (`ebpfsentinel-enterprise/`) that depends on the OSS core agent crates. Features are activated at runtime by a **license key system** with machine fingerprint binding and anti-tamper protections.

## Enterprise Features

| Feature | Description |
|---------|-------------|
| [License System](license.md) | Ed25519 + ML-DSA-65 dual-signed license keys, machine fingerprint binding, air-gap activation |
| [Advanced DLP](dlp.md) | Vectorscan engine, custom patterns, block mode, per-pattern overrides, TLS deep inspection |
| [ML Anomaly Detection](ml-detection.md) | 8 detection engines: baseline Z-score, EWMA streaming, CUSUM change-point, ONNX model, heavy-hitter (CMS), DGA/tunneling (Markov), TLS fingerprint clustering (K-Means), C2 beaconing (TLSH) |
| [Multi-Tenancy](multitenancy.md) | Namespace/interface-scoped isolation, quotas, tenant-aware RBAC, self-service API |
| [SIEM Integration](siem-integration.md) | 10 connectors: Splunk, Elasticsearch, OpenSearch, Wazuh, Sentinel, QRadar, Syslog, OTLP, S3, ClickHouse |
| [Compliance Reports](compliance-reports.md) | PCI-DSS 4, HIPAA, GDPR Art 32, SOC 2, NIS2, DORA, SecNumCloud, HDS + PDF export |
| [High Availability](high-availability.md) | Active-passive/active-active clustering, state replication, graceful degradation |
| [Multi-Cluster](multicluster.md) | Federation, policy distribution, alert aggregation |
| [Advanced RBAC](advanced-rbac.md) | 17 security domains, custom roles, permission inheritance |
| [Air-Gap Mode](airgap.md) | Offline feed bundles with Ed25519-signed import/export |
| [Advanced Analytics](analytics.md) | Top talkers, trends, IOC summaries, exportable reports |
| [Fleet Management](fleet-management.md) | Agent registration, heartbeat, identity, config versioning, flow graph |
| [AI/LLM Security](ai-security.md) | Shadow AI detection, AI-aware DLP, exfiltration heuristics, encrypted DNS policy |
<!-- feature-count: ja4-builtin-threats -->
| [TLS Intelligence](tls-intelligence.md) | JA4+ matching against imported intelligence (the built-in list is a starter sample of 7 sourced fingerprints), behavior anomaly, PQC compliance, cipher policy, cipher downgrade, JA4S, SNI/cert mismatch, session tracking, beaconing bridge, ONNX ML, peer-group rarity |
| [Threat Intelligence Platforms](threat-intel-platforms.md) | TAXII 2.1 collections and MISP instances polled on their own intervals, the whole of STIX this engine can act on (addresses, domains, URLs, JA4), every indicator carrying where it came from, when it was last confirmed and what kind it is, and a type no matcher covers reported as not actionable at import |
| [Sigma Rules](sigma-rules.md) | Sigma rules over network connections compiled into the agent's own rules, every rule outside the declared subset refused by the field that stopped it, the supported list generated from the compiler, and `sigma check` to read the refusals before deploying |
| [Network Forensics](network-forensics.md) | Event ring buffer, event-triggered context freezes, flow timeline reconstruction |
| [Automated Response](automated-response.md) | Policy engine, SOAR webhook integration, cooldown tracking, audit trail |
| [Extended TLS Library Hooking](dlp.md#extended-tls-library-coverage) | Discovery + symbol resolution + `TlsProbeManager` for Go `crypto/tls`, Java JSSE, statically linked OpenSSL and BoringSSL, kTLS, GnuTLS, wolfSSL, mbedTLS, s2n-tls and NSS; `/proc` scanner, background scan loop, 6 Prometheus metrics, and `/api/v1/enterprise/tls-probes/*` admin API. A static build is recognised from its own content rather than from the process name, so a proxy called anything at all is detected and a build that is neither project is labelled unknown rather than mislabelled. Go `crypto/tls`, GnuTLS, wolfSSL, mbedTLS, s2n-tls and static OpenSSL or BoringSSL are probed at the resolved offsets, kTLS through kprobes on the kernel's own software send and receive path; Java JSSE and NSS are discovery only. [Coverage](dlp.md#what-this-host-actually-reads) is published per workload - read and by which means, or not read with the reason and the build id to send |
| [Extended L7 Protocol Parsers](../l7-firewall.md#supported-protocols---enterprise-extension-port) | MQTT, AMQP 0-9-1, NATS, Cassandra CQL detection and field extraction via the `L7ExtendedParser` port |
| [Application Attack Detection](l7-deep-inspection.md) | 40+ SQLi / XSS / path traversal / command injection / data exfil signatures matched after decoding, on submitted payloads and on received HTTPS plaintext; the attacker blocked in the kernel for a bounded time once the first request has been seen, and the blocks exported as an IP list and STIX |
| [Per-Protocol Security Policies](l7-per-protocol-policies.md) | Redis / MongoDB / Kafka / SQL / LDAP / SSH policy engines with dangerous-command blocking, namespace/ACL enforcement, weak-crypto rejection. HTTP admin API and L7 dispatcher wiring |
| [L7 Alert Enrichment](l7-alert-enrichment.md) | `L7Enricher` mapping Vectorscan + policy signals to OWASP Top 10, MITRE ATT&CK (T1190/T1059/T1048/T1069/T1078/T1040/T1555) and PCI-DSS 6.5. SIEM export + compliance-report wiring |
| [Dashboard UI](dashboard.md) | Angular console over a fleet: OIDC login, tenant scope enforced server-side, a screen per feature |
| [Cases](cases.md) | Alerts grouped into cases with an owner, a status and one timeline, time to acknowledge and time to resolve, false-positive suppressions that expire, and an incident evidence pack |
| [Kubernetes Operator](kubernetes-operator.md) | One agent resource and 36 policy resources reconciled into an agent DaemonSet |
| [Bare-Metal Load Balancer](bare-metal-load-balancer.md) | Services of type LoadBalancer given an address from your pools, served by XDP, announced over ARP or BGP |

## API Surface

The enterprise agent serves its whole HTTP surface on the enterprise API port
(default `8444`), documented endpoint by endpoint with the role and the license
feature each one requires in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md). A feature the
license does not carry is never mounted, so a call to one of its paths answers
`404 Not Found` rather than `403 Forbidden`.

Eleven of this edition's own routes are mounted whatever the license carries:

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/license` | viewer | none | What the license itself says. Gating this on a feature would leave an expired deployment with no way to read why it had stopped working. |
| `GET` | `/api/v1/alerts` | viewer | none | Query the OSS datapath alert store. |
| `GET` | `/api/v1/alerts/{id}` | viewer | none | Read one stored alert by identifier. |
| `PATCH` | `/api/v1/alerts/{id}/triage` | operator | none | Set one alert's status or assignee, or append a note. |
| `POST` | `/api/v1/alerts/triage` | operator | none | Apply one triage change to at most 1000 alerts. |
| `GET` | `/api/v1/ebpf/kernel-features` | viewer | none | Return what the startup helper probe learned about this kernel. |
| `GET` | `/api/v1/ebpf/hidden-ports` | viewer | none | The last hidden-port sweep, as the open-source agent serves it. |
| `GET` | `/api/v1/ebpf/hidden-processes` | viewer | none | The last hidden-process sweep, as the open-source agent serves it. |
| `GET` | `/metrics` | none | none | OpenMetrics text output for every metric this process keeps: the `ebpfsentinel_ent_` registry and the datapath's own `ebpfsentinel_` one, in one exposition. |
| `GET` | `/healthz` | none | none | Liveness. Answers 200 while the process is running. |
| `GET` | `/readyz` | none | none | Readiness. 200 once this node is doing what its role asks of it, 503 otherwise. |

The two probes carry no authentication and no license check on purpose: an
orchestrator has no credential, and a license that cannot be read is exactly
when an operator needs the pod to keep answering why. They are served on the
enterprise API port like everything else, because this binary opens one HTTP
listener and never starts the open-source agent's.

That one listener is also why `/metrics` carries both registries rather than
the enterprise one alone: this binary builds the datapath through its own
activator, so an estate running it has no other port on which the packet,
firewall, IDS and DLP counters could answer. The prefixes are disjoint, so the
join declares no family twice and a query written for either edition reads the
same here. The kernel-side counters are polled out of their maps, every ten
seconds for the counters and every thirty for what the kernel granted the
datapath, because an eBPF per-CPU array notifies nobody when the kernel writes
to it.

The four alert routes are free of the license and not free of the
configuration: they are mounted only where the OSS datapath was activated and
its alert store opened, so an enterprise agent running no OSS datapath answers
`404 Not Found` there too. Triage is `operator` where reading is `viewer`,
because a status or an assignee is a claim about who is handling an incident
and a note is written under the identity the agent authenticated, not under the
`author` the caller sent. Bodies and responses are the open-source ones, in
[REST API](../../api-reference/rest-api.md#patch-apiv1alertsidtriage).

### The open-source surface

The enterprise agent also serves 110 operations of the open-source agent, with
the open-source handlers and bodies: the firewall, IDS, IPS, rate-limit,
DDoS, NAT, routing, load-balancer, QoS, zone and alias rules, connection
tracking, DNS, GeoIP, threat-intel indicators, the configuration and its
reload, the eBPF program status and the host surface. They are mounted
whatever the license carries, once the open-source datapath services are built
from the configuration, and `POST /api/v1/config/reload` runs the same reload
as a changed configuration file, datapath included. Each is described in
[REST API](../../api-reference/rest-api.md) and listed with its grant in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md#open-source-surface).

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/agent/status` | viewer | none | Returns the current agent status including version, uptime, and eBPF state. |
| `GET` | `/api/v1/alerts/stream` | viewer | none | Server-Sent Events live alert feed. |
| `GET` | `/api/v1/aliases/status` | viewer | none | Alias service status. |
| `PUT` | `/api/v1/aliases/{id}/content` | operator | none | Push content for an External alias. |
| `GET` | `/api/v1/config` | viewer | none | Return the current (sanitized) agent configuration. |
| `POST` | `/api/v1/config/reload` | operator | none | Trigger a configuration reload via the API. |
| `PUT` | `/api/v1/config/{section}` | operator | none | Write one section of the agent configuration file and reload. |
| `GET` | `/api/v1/conntrack/connections` | viewer | none | List tracked connections. |
| `GET` | `/api/v1/conntrack/events` | viewer | none | Server-Sent Events stream of connection lifecycle events (new, update, destroy). |
| `POST` | `/api/v1/conntrack/flush` | operator | none | Flush all tracked connections. |
| `GET` | `/api/v1/conntrack/status` | viewer | none | Connection tracking status. |
| `GET` | `/api/v1/ddos/attacks` | viewer | none | List active `DDoS` attacks. |
| `GET` | `/api/v1/ddos/attacks/history` | viewer | none | Attack history. |
| `GET` | `/api/v1/ddos/policies` | viewer | none | List `DDoS` policies. |
| `POST` | `/api/v1/ddos/policies` | operator | none | Create a `DDoS` policy. |
| `DELETE` | `/api/v1/ddos/policies/{id}` | operator | none | Delete a `DDoS` policy. |
| `GET` | `/api/v1/ddos/status` | viewer | none | `DDoS` protection status. |
| `GET` | `/api/v1/dns/blocklist` | viewer | none | List loaded blocklist rules. |
| `GET` | `/api/v1/dns/cache` | viewer | none | List DNS cache entries. |
| `DELETE` | `/api/v1/dns/cache` | operator | none | Flush the DNS cache. |
| `GET` | `/api/v1/dns/stats` | viewer | none | DNS cache and blocklist statistics. |
| `GET` | `/api/v1/dns/status` | viewer | none | DNS intelligence subsystem status. |
| `POST` | `/api/v1/domains/blocklist` | operator | none | Add a domain to the runtime blocklist. |
| `DELETE` | `/api/v1/domains/blocklist/{domain}` | operator | none | Remove a domain from the runtime blocklist. |
| `GET` | `/api/v1/domains/reputation` | viewer | none | Query domain reputations. |
| `GET` | `/api/v1/ebpf/coverage` | viewer | none | What the agent sees of each pod on this node. |
| `GET` | `/api/v1/ebpf/drop-reasons` | viewer | none | Why the kernel dropped packets, counted by reason. |
| `GET` | `/api/v1/ebpf/foreign-programs` | viewer | none | Who else has a program on the network path. |
| `GET` | `/api/v1/ebpf/guests` | viewer | none | The virtual machines and KubeVirt guests whose links the agent holds, named or reported unnamed with the reason. |
| `GET` | `/api/v1/ebpf/raw-sockets` | viewer | none | Who else reads the node's traffic. |
| `GET` | `/api/v1/ebpf/status` | viewer | none | Return the load status of each eBPF program. |
| `GET` | `/api/v1/firewall/rules` | viewer | none | List all active rules. |
| `POST` | `/api/v1/firewall/rules` | operator | none | Create a new rule. |
| `DELETE` | `/api/v1/firewall/rules/{id}` | operator | none | Delete a rule by ID. |
| `GET` | `/api/v1/firewall/workload/fqdn` | viewer | none | What the rules naming destinations by name have resolved, and what is still open. |
| `GET` | `/api/v1/firewall/workload/labels` | viewer | none | The containers whose labels carry policy, the rules each produced and any label refused. |
| `GET` | `/api/v1/firewall/workload/reach` | viewer | none | What the workload policy lets a workload reach. |
| `GET` | `/api/v1/firewall/workload/rules` | viewer | none | The workload rules in force and what each has refused. |
| `GET` | `/api/v1/geoip/lookup` | viewer | none | Resolve an IP to `GeoIP` info. |
| `GET` | `/api/v1/geoip/status` | viewer | none | `GeoIP` enrichment status. |
| `GET` | `/api/v1/ids/rules` | viewer | none | List all IDS rules. |
| `GET` | `/api/v1/ids/status` | viewer | none | IDS service status. |
| `GET` | `/api/v1/ids/suricata/report` | viewer | none | What the imported Suricata rulesets compiled to. |
| `GET` | `/api/v1/ips/blacklist` | viewer | none | List current IPS blacklist entries. |
| `POST` | `/api/v1/ips/blacklist` | operator | none | Manually add an IP to the IPS blacklist. |
| `DELETE` | `/api/v1/ips/blacklist/{ip}` | operator | none | Remove an IP from the IPS blacklist. |
| `GET` | `/api/v1/ips/domain-blocks` | viewer | none | List IPS blacklist entries originating from domain mechanisms. |
| `GET` | `/api/v1/ips/rules` | viewer | none | List all IPS rules. |
| `PATCH` | `/api/v1/ips/rules/{id}` | operator | none | Toggle a rule's mode. |
| `GET` | `/api/v1/lb/services` | viewer | none | List LB services. |
| `POST` | `/api/v1/lb/services` | operator | none | Create an LB service. |
| `GET` | `/api/v1/lb/services/{id}` | viewer | none | Get LB service detail. |
| `DELETE` | `/api/v1/lb/services/{id}` | operator | none | Delete an LB service. |
| `GET` | `/api/v1/lb/status` | viewer | none | Load balancer status. |
| `GET` | `/api/v1/lb/vips` | viewer | none | VIP announcer status. |
| `POST` | `/api/v1/lb/vips` | operator | none | Apply a new VIP announce configuration. |
| `GET` | `/api/v1/lb/vips/bgp` | viewer | none | BGP sessions announcing the VIPs. |
| `POST` | `/api/v1/lb/vips/grant` | operator | none | Grant or release the speaker role of an `elected` node. |
| `GET` | `/api/v1/learning/sessions` | viewer | none | Every learning window this node remembers. |
| `POST` | `/api/v1/learning/sessions` | operator | none | Open a learning window. |
| `GET` | `/api/v1/learning/sessions/{id}` | viewer | none | One learning window, as it stands. |
| `GET` | `/api/v1/learning/sessions/{id}/edges` | viewer | none | What the window saw, edge by edge. |
| `GET` | `/api/v1/learning/sessions/{id}/policy` | viewer | none | The allow-list the window describes. |
| `GET` | `/api/v1/learning/sessions/{id}/segmentation` | viewer | none | The rules that keep each container on a bridge to the peers the window saw it reach. |
| `POST` | `/api/v1/learning/sessions/{id}/stop` | operator | none | Close a learning window early. |
| `GET` | `/api/v1/mitre/coverage` | viewer | none | MITRE ATT&CK coverage matrix. |
| `GET` | `/api/v1/nat/nptv6` | viewer | none | List `NPTv6` rules. |
| `POST` | `/api/v1/nat/nptv6` | operator | none | Create an `NPTv6` rule. |
| `DELETE` | `/api/v1/nat/nptv6/{id}` | operator | none | Delete an `NPTv6` rule. |
| `GET` | `/api/v1/nat/rules` | viewer | none | List NAT rules. |
| `GET` | `/api/v1/nat/status` | viewer | none | NAT status. |
| `POST` | `/api/v1/netpol/replay` | operator | none | What proposed network policies would have refused. |
| `GET` | `/api/v1/processes` | viewer | none | The processes alive on this node. |
| `GET` | `/api/v1/processes/{pid}` | viewer | none | One process, by pid. |
| `GET` | `/api/v1/qos/classifiers` | viewer | none | List all `QoS` classifiers. |
| `POST` | `/api/v1/qos/classifiers` | operator | none | Create a new `QoS` classifier. |
| `DELETE` | `/api/v1/qos/classifiers/{id}` | operator | none | Delete a `QoS` classifier. |
| `GET` | `/api/v1/qos/pipes` | viewer | none | List all `QoS` pipes. |
| `POST` | `/api/v1/qos/pipes` | operator | none | Create a new `QoS` pipe. |
| `DELETE` | `/api/v1/qos/pipes/{id}` | operator | none | Delete a `QoS` pipe. |
| `GET` | `/api/v1/qos/queues` | viewer | none | List all `QoS` queues. |
| `POST` | `/api/v1/qos/queues` | operator | none | Create a new `QoS` queue. |
| `DELETE` | `/api/v1/qos/queues/{id}` | operator | none | Delete a `QoS` queue. |
| `GET` | `/api/v1/qos/shaping` | viewer | none | Per-workload rates, where they act, and what each cgroup achieved. |
| `GET` | `/api/v1/qos/status` | viewer | none | `QoS` service status. |
| `GET` | `/api/v1/ratelimit/rules` | viewer | none | List all rate limit rules. |
| `POST` | `/api/v1/ratelimit/rules` | operator | none | Create a new rate limit rule. |
| `DELETE` | `/api/v1/ratelimit/rules/{id}` | operator | none | Delete a rate limit rule. |
| `GET` | `/api/v1/routing/gateways` | viewer | none | List routing gateways. |
| `POST` | `/api/v1/routing/gateways` | operator | none | Add a routing gateway. |
| `DELETE` | `/api/v1/routing/gateways/{id}` | operator | none | Remove a routing gateway. |
| `GET` | `/api/v1/routing/routes` | viewer | none | Effective default route(s) from gateway selection. |
| `GET` | `/api/v1/routing/status` | viewer | none | Routing status. |
| `GET` | `/api/v1/surface` | viewer | none | This host's surface: what is installed, what runs, what listens, what is reachable and what the policy blocks. |
| `GET` | `/api/v1/surface/listening` | viewer | none | Every listener with the packages its process maps, the traffic it took and who may reach it. |
| `GET` | `/api/v1/surface/loaded` | viewer | none | Every file live processes map executable, once per root, and the package owning it. |
| `GET` | `/api/v1/surface/packages` | viewer | none | What the package managers say is installed, in the host's root and every container's. |
| `GET` | `/api/v1/threatintel/feeds` | viewer | none | The configured feeds, the CrowdSec local API among them, with when each was last fetched. |
| `POST` | `/api/v1/threatintel/feeds/refresh` | operator | none | Fetch every feed now; refused while a fetch is already running. |
| `GET` | `/api/v1/threatintel/iocs` | viewer | none | List loaded IOCs. |
| `GET` | `/api/v1/threatintel/status` | viewer | none | Threat intel subsystem status. |
| `GET` | `/api/v1/threatintel/urls` | viewer | none | List malicious URL indicators ingested from CTI feeds. The threat-intel engine is IP-only, so URL indicators are surfaced from the service's retained snapshot. |
| `POST` | `/api/v1/trace` | operator | none | What the loaded programs decide for one packet. |
| `GET` | `/api/v1/zones` | viewer | none | List security zones. |
| `POST` | `/api/v1/zones` | operator | none | Create a security zone. |
| `GET` | `/api/v1/zones/policies` | viewer | none | List inter-zone policies. |
| `POST` | `/api/v1/zones/policies` | operator | none | Create an inter-zone policy. |
| `DELETE` | `/api/v1/zones/policies/{id}` | operator | none | Remove an inter-zone policy. |
| `GET` | `/api/v1/zones/status` | viewer | none | Zone service status. |
| `DELETE` | `/api/v1/zones/{id}` | operator | none | Remove a security zone. |

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
├── enterprise-license/         # Signing and verification library plus its CLI, behind the `cli` feature
├── enterprise-warden/          # Privileged broker the rootless agent asks for what a user namespace cannot do
├── enterprise-warden-proto/    # The wire contract between the agent and that broker
├── enterprise-vectorscan/      # Safe Rust Vectorscan wrapper
└── enterprise-vectorscan-sys/  # Vectorscan FFI bindings
```

Each enterprise crate depends on its OSS counterpart without modifying OSS code.

## API Rate Limiting

The enterprise API port carries a per-peer rate limit in two tiers. Which tier a
request pays is decided by its method: `GET`, `HEAD` and `OPTIONS` pay the read
bucket, and everything else pays the write bucket, including a method the build
does not recognise.

| Tier | Sustained rate | Burst | Configurable |
|------|---------------|-------|--------------|
| Read | 4 requests/second per peer | 200 | No |
| Write | `agent.api_rate_limit.write_per_second`, default 1/second per peer | `agent.api_rate_limit.write_burst`, default 60 | Yes |

The write tier reads the same `agent.api_rate_limit` block as the OSS agent's
control API, so a deployment tunes one thing rather than two:

```yaml
agent:
  api_rate_limit:
    write_per_second: 1
    write_burst: 60
    exempt_loopback: true
```

Both values must be at least 1; a zero is rejected when the configuration loads,
because a bucket that refills at nothing refuses every request and locks the
write API out entirely.

### The loopback exemption

With `exempt_loopback: true`, which is the default, a request from `127.0.0.0/8`
or `::1` skips both buckets. Local tooling and same-host bulk reconfiguration
are never throttled. Every other peer is limited whatever the exemption says.
Set it to `false` where the API port is reached through a same-host proxy, since
otherwise every request arrives as loopback and nothing is limited at all.

### What a refusal looks like

A peer over its burst gets `429 Too Many Requests` with a `Retry-After` header
carrying the whole seconds to wait, which is always at least 1:

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 4
```

Buckets are keyed by peer address, so one client cannot spend another's
allowance. A request whose peer address cannot be determined is charged to a
single shared bucket rather than waved through.

The limit is applied outside authentication, so a flood that never proves
anything is refused before it costs a signature verification, and outside every
route the agent mounts, so a route added to any subsystem is limited without
anyone choosing which half of the router to put it in. The routes that reach
outward or generate a document - applying a federation policy, a bulk L7 pattern
load, starting a forensics mirror, importing an air-gap bundle and generating a
compliance report - are on the write bucket for that reason.
