# Enterprise Features

> **Edition: Professional and above**

## Overview

eBPFsentinel Enterprise extends the open-source agent with advanced security capabilities, management, multi-tenancy, analytics, and compliance automation features.

The OSS agent is fully functional for production use - all security domains, APIs, CLI, authentication, TLS, and observability are included in the open-source release. Enterprise adds deeper detection, enforcement, and operational capabilities.

Enterprise features are implemented in a **separate repository** (`ebpfsentinel-enterprise/`) that depends on the OSS core agent crates. Features are activated at runtime by a **license key system**: fleet keys installed unchanged on every node, with machine binding for air-gapped activation, and anti-tamper protections.

## Enterprise Features

| Feature | Lowest tier | Description |
|---------|-------------|-------------|
| [License System](license.md) | Professional | Ed25519 + ML-DSA-65 dual-signed license keys, fleet keys, machine binding for air-gap activation |
| [Advanced DLP](dlp.md) | Professional | Vectorscan engine, custom patterns, block mode, per-pattern overrides, TLS deep inspection |
| [ML Anomaly Detection](ml-detection.md) | Enterprise | 9 detection engines: baseline Z-score, EWMA streaming, CUSUM change-point, ONNX model, Random Cut Forest, heavy-hitter (Space-Saving), DGA/tunneling (Markov), TLS fingerprint clustering (K-Means), C2 beaconing (TLS handshake timing) |
| [Multi-Tenancy](multitenancy.md) | Critical | Namespace/interface-scoped isolation, quotas, tenant-aware RBAC |
| [SIEM Integration](siem-integration.md) | Enterprise | 10 connectors: Splunk, Elasticsearch, OpenSearch, Wazuh, Sentinel, QRadar, Syslog, OTLP, S3, ClickHouse |
| [Compliance Reports](compliance-reports.md) | Professional | PCI-DSS 4, HIPAA, GDPR Art 32, SOC 2, NIS2, DORA, SecNumCloud, HDS + PDF export |
| [High Availability](high-availability.md) | Critical | Active-passive/active-active clustering, state replication, graceful degradation |
| [Multi-Cluster](multicluster.md) | Enterprise | Federation, policy distribution, alert aggregation |
| [Advanced RBAC](advanced-rbac.md) | Professional | Per-domain permissions, custom roles, permission inheritance |
| [Air-Gap Mode](airgap.md) | Critical | Offline feed bundles with Ed25519-signed import/export |
| [Advanced Analytics](analytics.md) | Enterprise | Top talkers, trends, IOC summaries, exportable reports |
| [Fleet Management](fleet-management.md) | Professional | Agent registration, heartbeat, identity, config versioning, flow graph |
| [AI/LLM Security](ai-security.md) | Enterprise | Shadow AI detection, AI-aware DLP, exfiltration heuristics, encrypted DNS policy |
<!-- feature-count: ja4-builtin-threats -->
| [TLS Intelligence](tls-intelligence.md) | Enterprise | JA4 matching against imported intelligence (the built-in list is a starter sample of 7 sourced fingerprints), behavior anomaly, PQC compliance, cipher policy, cipher downgrade, SNI/cert mismatch, session tracking, handshake timing for beaconing, ONNX ML, peer-group rarity |
| [Threat Intelligence Platforms](threat-intel-platforms.md) | Enterprise | TAXII 2.1 collections and MISP instances polled on their own intervals, the whole of STIX this engine can act on (addresses, domains, URLs, JA4), every indicator carrying where it came from, when it was last confirmed and what kind it is, and a type no matcher covers reported as not actionable at import |
| [Sigma Rules](sigma-rules.md) | Enterprise | Sigma rules over network connections compiled into the agent's own rules, every rule outside the declared subset refused by the field that stopped it, the supported list generated from the compiler, and `sigma check` to read the refusals before deploying |
| [Network Forensics](network-forensics.md) | Enterprise | Event ring buffer, event-triggered context freezes, flow timeline reconstruction |
| [Automated Response](automated-response.md) | Enterprise | Policy engine, SOAR webhook integration, cooldown tracking, audit trail |
| [Extended TLS Library Hooking](dlp.md#extended-tls-library-coverage) | Enterprise | Discovery + symbol resolution + `TlsProbeManager` for Go `crypto/tls`, Java JSSE, statically linked OpenSSL and BoringSSL, kTLS, GnuTLS, wolfSSL, mbedTLS, s2n-tls and NSS; `/proc` scanner, background scan loop, 6 Prometheus metrics, and `/api/v1/enterprise/tls-probes/*` admin API. A static build is recognised from its own content rather than from the process name, so a proxy called anything at all is detected and a build that is neither project is labelled unknown rather than mislabelled. Go `crypto/tls`, GnuTLS, wolfSSL, mbedTLS, s2n-tls and static OpenSSL or BoringSSL are probed at the resolved offsets, kTLS through kprobes on the kernel's own software send and receive path; Java JSSE and NSS are discovery only. [Coverage](dlp.md#what-this-host-actually-reads) is published per workload - read and by which means, or not read with the reason and the build id to send |
| [Extended L7 Protocol Parsers](../l7-firewall.md#supported-protocols---enterprise-extension-port) | Enterprise | MQTT, AMQP 0-9-1, NATS, Cassandra CQL detection via the `L7ExtendedParser` port, and rules on their parsed fields (MQTT packet type, client id and topic; AMQP version; NATS verb and subject; CQL opcode and keyspace) under the licence feature `extended-l7-protocols` |
| [Application Attack Detection](l7-deep-inspection.md) | Professional | 40+ SQLi / XSS / path traversal / command injection / data exfil signatures matched after decoding, on submitted payloads and on received HTTPS plaintext; the attacker blocked in the kernel for a bounded time once the first request has been seen, and the blocks exported as an IP list and STIX |
| [Per-Protocol Security Policies](l7-per-protocol-policies.md) | Professional | Redis / MongoDB / Kafka / SQL / LDAP / SSH policy engines with dangerous-command blocking, namespace/ACL enforcement, weak-crypto rejection. HTTP admin API and L7 dispatcher wiring |
| [L7 Alert Enrichment](l7-alert-enrichment.md) | Professional | `L7Enricher` mapping Vectorscan + policy signals to OWASP Top 10, MITRE ATT&CK (T1190/T1059/T1048/T1069/T1078/T1040/T1555) and PCI-DSS 6.5. SIEM export + compliance-report wiring |
| [Dashboard UI](dashboard.md) | Enterprise | Angular console over a fleet: OIDC login, tenant scope enforced server-side, a screen per feature |
| [Cases](cases.md) | Enterprise | Alerts grouped into cases with an owner, a status and one timeline, time to acknowledge and time to resolve, false-positive suppressions that expire, and an incident evidence pack |
| [Kubernetes Operator](kubernetes-operator.md) | Professional | One agent resource and 36 policy resources reconciled into an agent DaemonSet |
| [Bare-Metal Load Balancer](bare-metal-load-balancer.md) | Professional | Services of type LoadBalancer given an address from your pools, served by XDP, announced over ARP or BGP |
| [Content Channel](content-channel.md) | Professional | Signed, versioned content sets (rules, data patterns, fingerprints, provider definitions, models, TLS build offsets) delivered between releases, verified before a file is applied, rolled back or pinned per set |
| [Base Anomaly Model](base-model.md) | Enterprise | The model that scores while ML detection learns its own baseline: built by us, delivered through the content channel, measured again on each machine before it runs |
| [Reachable Vulnerabilities](reachable-vulnerabilities.md) | Professional | Your scanner's findings joined with the packages this host runs, maps, listens with and lets the outside reach |
| [Tamper Protection](tamper-protection.md) | Enterprise | The kernel refuses a signal, a trace or an unpin aimed at the agent, root included, until a signed stop for that node opens a short window; needs the BPF LSM at boot (`bpf` in `lsm=`), `ebpfsentinel-agent ebpf host-check` answers for your host, and without it an agent going quiet without a signed stop is still raised by the console, the federation and the HA peer |
| [Hunting](hunting.md) | Enterprise | A short query language over the tenant's alerts, forensic events and flows in the console's history store, scoped to the tenant by the server |
| [Proof for Regulated Estates](regulated-estates.md) | Critical | NIS2 and DORA notification drafts, dated control evidence, runtime attestation of the released bytes and a sealed audit record |

## API Surface

The enterprise agent serves its whole HTTP surface on the enterprise API port
(default `8444`), documented endpoint by endpoint with the role and the license
feature each one requires in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md). A feature the
license does not carry is never mounted, so a call to one of its paths answers
`404 Not Found` rather than `403 Forbidden`.

Twelve of this edition's own routes are mounted whatever the license carries:

| Method | Path | Command | Role | License feature | Description |
|--------|------|---------|------|-----------------|-------------|
| `POST` | `/api/v1/alerts/{id}/false-positive` | `alerts mark-fp` | operator | none | Mark an alert as false positive. |
| `GET` | `/api/v1/license` | `license status` | viewer | none | What the license itself says. Gating this on a feature would leave an expired deployment with no way to read why it had stopped working. |
| `GET` | `/api/v1/alerts` | `alerts list` | viewer | none | Query the OSS datapath alert store. |
| `GET` | `/api/v1/alerts/{id}` | `alerts show` | viewer | none | Read one stored alert by identifier. |
| `PATCH` | `/api/v1/alerts/{id}/triage` | `alerts triage` | operator | none | Set one alert's status or assignee, or append a note. |
| `POST` | `/api/v1/alerts/triage` | `alerts triage` | operator | none | Apply one triage change to at most 1000 alerts. |
| `GET` | `/api/v1/ebpf/kernel-features` | `ebpf kernel-features` | viewer | none | Return what the startup helper probe learned about this kernel. |
| `GET` | `/api/v1/ebpf/hidden-ports` | `ebpf hidden-ports` | viewer | none | The last hidden-port sweep, as the open-source agent serves it. |
| `GET` | `/api/v1/ebpf/hidden-processes` | `ebpf hidden-processes` | viewer | none | The last hidden-process sweep, as the open-source agent serves it. |
| `GET` | `/metrics` | `metrics` | none | none | OpenMetrics text output for every metric this process keeps: the `ebpfsentinel_ent_` registry and the datapath's own `ebpfsentinel_` one, in one exposition. |
| `GET` | `/healthz` | `health` | none | none | Liveness. Answers 200 while the process is running. |
| `GET` | `/readyz` | `health` | none | none | Readiness. 200 once this node is doing what its role asks of it, 503 otherwise. |

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
`404 Not Found` there too. Where the datapath runs and `alerts.redb` alone could
not be opened, the startup log says so and alerts are still detected, acted on,
exported and streamed on `/api/v1/alerts/stream`; only the history these routes
list is lost. Triage is `operator` where reading is `viewer`,
because a status or an assignee is a claim about who is handling an incident
and a note is written under the identity the agent authenticated, not under the
`author` the caller sent. Bodies and responses are the open-source ones, in
[REST API](../../api-reference/rest-api.md#patch-apiv1alertsidtriage).

### The open-source surface

The enterprise agent also serves the operations of the open-source agent, with
the open-source handlers and bodies: the firewall, IDS, IPS, rate-limit,
DDoS, NAT, routing, load-balancer, QoS, zone and alias rules, connection
tracking, DNS, GeoIP, threat-intel indicators, L7 rules, DLP, TLS handshakes
and posture, JA4 fingerprints, the service graph, the audit trail, manual
responses, manual packet capture, flow export status, the configuration and
its reload, the eBPF program status and the host surface. The TLS library
probes are the one open-source surface it does not serve: it answers
`404 Not Found`, and this edition probes TLS libraries under
`/api/v1/enterprise/tls-probes`. Manual capture is the open-source one,
started by hand and written under `/var/lib/ebpfsentinel/captures`; the
captures this edition records on its own, around a trigger and kept under
custody, are [network forensics](network-forensics.md). They are mounted
whatever the license carries, once the open-source datapath services are built
from the configuration, and `POST /api/v1/config/reload` runs the same reload
as a changed configuration file, datapath included. Each is described in
[REST API](../../api-reference/rest-api.md) and listed with its grant in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md#open-source-surface).

| Method | Path | Command | Role | License feature | Description |
|--------|------|---------|------|-----------------|-------------|
| `GET` | `/api/v1/agent/status` | `status` | viewer | none | Returns the current agent status including version, uptime, and eBPF state. |
| `GET` | `/api/v1/alerts/stream` | `watch` | viewer | none | Server-Sent Events live alert feed. |
| `GET` | `/api/v1/aliases/status` | `aliases status` | viewer | none | Alias service status. |
| `PUT` | `/api/v1/aliases/{id}/content` | `aliases set-content` | admin | none | Push content for an External alias. |
| `GET` | `/api/v1/audit/logs` | `audit logs` | viewer | none | Query stored audit log entries. |
| `GET` | `/api/v1/audit/rules/{id}/history` | `audit history` | viewer | none | Query rule version history. |
| `GET` | `/api/v1/captures` | `capture list` | viewer | none | List packet capture sessions. |
| `POST` | `/api/v1/captures/manual` | `capture start` | admin | none | Start a manual packet capture. |
| `DELETE` | `/api/v1/captures/{id}` | `capture stop` | admin | none | Stop a running capture. |
| `GET` | `/api/v1/config` | `config show` | viewer | none | Return the current (sanitized) agent configuration. |
| `POST` | `/api/v1/config/reload` | `config reload` | admin | none | Trigger a configuration reload via the API. |
| `PUT` | `/api/v1/config/{section}` | `config set` | admin | none | Write one section of the agent configuration file and reload. |
| `GET` | `/api/v1/conntrack/connections` | `conntrack list` | viewer | none | List tracked connections. |
| `GET` | `/api/v1/conntrack/events` | `conntrack watch` | viewer | none | Server-Sent Events stream of connection lifecycle events (new, update, destroy). |
| `POST` | `/api/v1/conntrack/flush` | `conntrack flush` | admin | none | Flush all tracked connections. |
| `GET` | `/api/v1/conntrack/status` | `conntrack status` | viewer | none | Connection tracking status. |
| `GET` | `/api/v1/ddos/attacks` | `ddos attacks` | viewer | none | List active `DDoS` attacks. |
| `GET` | `/api/v1/ddos/attacks/history` | `ddos history` | viewer | none | Attack history. |
| `GET` | `/api/v1/ddos/policies` | `ddos policies` | viewer | none | List `DDoS` policies. |
| `POST` | `/api/v1/ddos/policies` | `ddos add` | admin | none | Create a `DDoS` policy. |
| `DELETE` | `/api/v1/ddos/policies/{id}` | `ddos delete` | admin | none | Delete a `DDoS` policy. |
| `GET` | `/api/v1/ddos/status` | `ddos status` | viewer | none | `DDoS` protection status. |
| `GET` | `/api/v1/dlp/patterns` | `dlp patterns` | viewer | none | List DLP patterns. |
| `GET` | `/api/v1/dlp/scope` | `dlp scope` | viewer | none | Which workloads DLP is reading. |
| `GET` | `/api/v1/dlp/status` | `dlp status` | viewer | none | DLP status. |
| `GET` | `/api/v1/dns/blocklist` | `dns blocklist` | viewer | none | List loaded blocklist rules. |
| `GET` | `/api/v1/dns/cache` | `dns cache` | viewer | none | List DNS cache entries. |
| `DELETE` | `/api/v1/dns/cache` | `dns flush` | operator | none | Flush the DNS cache. |
| `GET` | `/api/v1/dns/stats` | `dns stats` | viewer | none | DNS cache and blocklist statistics. |
| `GET` | `/api/v1/dns/status` | `dns status` | viewer | none | DNS intelligence subsystem status. |
| `POST` | `/api/v1/domains/blocklist` | `domains block` | operator | none | Add a domain to the runtime blocklist. |
| `DELETE` | `/api/v1/domains/blocklist/{domain}` | `domains unblock` | operator | none | Remove a domain from the runtime blocklist. |
| `GET` | `/api/v1/domains/reputation` | `domains reputation` | viewer | none | Query domain reputations. |
| `GET` | `/api/v1/ebpf/coverage` | `ebpf coverage` | viewer | none | What the agent sees of each pod on this node. |
| `GET` | `/api/v1/ebpf/drop-reasons` | `ebpf drops` | viewer | none | Why the kernel dropped packets, counted by reason. |
| `GET` | `/api/v1/ebpf/foreign-programs` | `ebpf foreign-programs` | viewer | none | Who else has a program on the network path. |
| `GET` | `/api/v1/ebpf/guests` | `ebpf guests` | viewer | none | The virtual machines and KubeVirt guests whose links the agent holds, named or reported unnamed with the reason. |
| `GET` | `/api/v1/ebpf/raw-sockets` | `ebpf raw-sockets` | viewer | none | Who else reads the node's traffic. |
| `GET` | `/api/v1/ebpf/status` | `ebpf status` | viewer | none | Return the load status of each eBPF program. |
| `GET` | `/api/v1/fingerprints/summary` | `fingerprints summary` | viewer | none | Fingerprint cache status. |
| `GET` | `/api/v1/firewall/l7-rules` | `l7 list` | viewer | none | List all L7 rules. |
| `POST` | `/api/v1/firewall/l7-rules` | `l7 add` | admin | none | Create a new L7 rule. |
| `DELETE` | `/api/v1/firewall/l7-rules/{id}` | `l7 delete` | admin | none | Delete an L7 rule by ID. |
| `GET` | `/api/v1/firewall/rules` | `firewall list` | viewer | none | List all active rules. |
| `POST` | `/api/v1/firewall/rules` | `firewall add` | operator | none | Create a new rule. |
| `DELETE` | `/api/v1/firewall/rules/{id}` | `firewall delete` | operator | none | Delete a rule by ID. |
| `GET` | `/api/v1/firewall/workload/fqdn` | `firewall fqdn` | viewer | none | What the rules naming destinations by name have resolved, and what is still open. |
| `GET` | `/api/v1/firewall/workload/labels` | `firewall labels` | viewer | none | The containers whose labels carry policy, the rules each produced and any label refused. |
| `GET` | `/api/v1/firewall/workload/reach` | `firewall reach` | viewer | none | What the workload policy lets a workload reach. |
| `GET` | `/api/v1/firewall/workload/rules` | `firewall workload` | viewer | none | The workload rules in force and what each has refused. |
| `GET` | `/api/v1/flows/export` | `flows export` | viewer | none | Flow export status. |
| `GET` | `/api/v1/geoip/lookup` | `geoip lookup` | viewer | none | Resolve an IP to `GeoIP` info. |
| `GET` | `/api/v1/geoip/status` | `geoip status` | viewer | none | `GeoIP` enrichment status. |
| `GET` | `/api/v1/ids/rules` | `ids rules` | viewer | none | List all IDS rules. |
| `GET` | `/api/v1/ids/status` | `ids status` | viewer | none | IDS service status. |
| `GET` | `/api/v1/ids/suricata/report` | `ids suricata` | viewer | none | What the imported Suricata rulesets compiled to. |
| `GET` | `/api/v1/ips/blacklist` | `ips blacklist` | viewer | none | List current IPS blacklist entries. |
| `POST` | `/api/v1/ips/blacklist` | `ips blacklist add` | admin | none | Manually add an IP to the IPS blacklist. |
| `DELETE` | `/api/v1/ips/blacklist/{ip}` | `ips blacklist delete` | admin | none | Remove an IP from the IPS blacklist. |
| `GET` | `/api/v1/ips/domain-blocks` | `ips domain-blocks` | viewer | none | List IPS blacklist entries originating from domain mechanisms. |
| `GET` | `/api/v1/ips/rules` | `ips list` | viewer | none | List all IPS rules. |
| `PATCH` | `/api/v1/ips/rules/{id}` | `ips set-mode` | operator | none | Toggle a rule's mode. |
| `GET` | `/api/v1/lb/services` | `lb services` | viewer | none | List LB services. |
| `POST` | `/api/v1/lb/services` | `lb add` | admin | none | Create an LB service. |
| `GET` | `/api/v1/lb/services/{id}` | `lb service` | viewer | none | Get LB service detail. |
| `DELETE` | `/api/v1/lb/services/{id}` | `lb delete` | admin | none | Delete an LB service. |
| `GET` | `/api/v1/lb/status` | `lb status` | viewer | none | Load balancer status. |
| `GET` | `/api/v1/lb/vips` | `lb vips` | viewer | none | VIP announcer status. |
| `POST` | `/api/v1/lb/vips` | `lb announce` | admin | none | Apply a new VIP announce configuration. |
| `GET` | `/api/v1/lb/vips/bgp` | `lb bgp` | viewer | none | BGP sessions announcing the VIPs. |
| `POST` | `/api/v1/lb/vips/grant` | `lb grant` | admin | none | Grant or release the speaker role of an `elected` node. |
| `GET` | `/api/v1/learning/sessions` | `learning list` | viewer | none | Every learning window this node remembers. |
| `POST` | `/api/v1/learning/sessions` | `learning start` | operator | none | Open a learning window. |
| `GET` | `/api/v1/learning/sessions/{id}` | `learning status` | viewer | none | One learning window, as it stands. |
| `GET` | `/api/v1/learning/sessions/{id}/edges` | `learning edges` | viewer | none | What the window saw, edge by edge. |
| `GET` | `/api/v1/learning/sessions/{id}/policy` | `learning policy` | viewer | none | The allow-list the window describes. |
| `GET` | `/api/v1/learning/sessions/{id}/segmentation` | `learning segmentation` | viewer | none | The rules that keep each container on a bridge to the peers the window saw it reach. |
| `POST` | `/api/v1/learning/sessions/{id}/stop` | `learning stop` | operator | none | Close a learning window early. |
| `GET` | `/api/v1/mitre/coverage` | `mitre coverage` | viewer | none | MITRE ATT&CK coverage matrix. |
| `GET` | `/api/v1/nat/nptv6` | `nat nptv6 list` | viewer | none | List `NPTv6` rules. |
| `POST` | `/api/v1/nat/nptv6` | `nat nptv6 create` | admin | none | Create an `NPTv6` rule. |
| `DELETE` | `/api/v1/nat/nptv6/{id}` | `nat nptv6 delete` | admin | none | Delete an `NPTv6` rule. |
| `GET` | `/api/v1/nat/rules` | `nat rules` | viewer | none | List NAT rules. |
| `GET` | `/api/v1/nat/status` | `nat status` | viewer | none | NAT status. |
| `POST` | `/api/v1/netpol/replay` | `netpol replay` | operator | none | What proposed network policies would have refused. |
| `GET` | `/api/v1/processes` | `processes list` | viewer | none | The processes alive on this node. |
| `GET` | `/api/v1/processes/{pid}` | `processes show` | viewer | none | One process, by pid. |
| `GET` | `/api/v1/qos/classifiers` | `qos classifiers` | viewer | none | List all `QoS` classifiers. |
| `POST` | `/api/v1/qos/classifiers` | `qos add-classifier` | admin | none | Create a new `QoS` classifier. |
| `DELETE` | `/api/v1/qos/classifiers/{id}` | `qos delete-classifier` | admin | none | Delete a `QoS` classifier. |
| `GET` | `/api/v1/qos/pipes` | `qos pipes` | viewer | none | List all `QoS` pipes. |
| `POST` | `/api/v1/qos/pipes` | `qos add-pipe` | admin | none | Create a new `QoS` pipe. |
| `DELETE` | `/api/v1/qos/pipes/{id}` | `qos delete-pipe` | admin | none | Delete a `QoS` pipe. |
| `GET` | `/api/v1/qos/queues` | `qos queues` | viewer | none | List all `QoS` queues. |
| `POST` | `/api/v1/qos/queues` | `qos add-queue` | admin | none | Create a new `QoS` queue. |
| `DELETE` | `/api/v1/qos/queues/{id}` | `qos delete-queue` | admin | none | Delete a `QoS` queue. |
| `GET` | `/api/v1/qos/shaping` | `qos shaping` | viewer | none | Per-workload rates, where they act, and what each cgroup achieved. |
| `GET` | `/api/v1/qos/status` | `qos status` | viewer | none | `QoS` service status. |
| `GET` | `/api/v1/ratelimit/rules` | `ratelimit list` | viewer | none | List all rate limit rules. |
| `POST` | `/api/v1/ratelimit/rules` | `ratelimit add` | admin | none | Create a new rate limit rule. |
| `DELETE` | `/api/v1/ratelimit/rules/{id}` | `ratelimit delete` | admin | none | Delete a rate limit rule. |
| `GET` | `/api/v1/responses` | `responses list` | viewer | none | List active response actions. |
| `POST` | `/api/v1/responses/manual` | `responses create` | admin | none | Create a time-bounded response action. |
| `DELETE` | `/api/v1/responses/{id}` | `responses revoke` | admin | none | Revoke a response action early. |
| `GET` | `/api/v1/routing/gateways` | `routing gateways` | viewer | none | List routing gateways. |
| `POST` | `/api/v1/routing/gateways` | `routing add-gateway` | admin | none | Add a routing gateway. |
| `DELETE` | `/api/v1/routing/gateways/{id}` | `routing delete-gateway` | admin | none | Remove a routing gateway. |
| `GET` | `/api/v1/routing/routes` | `routing routes` | viewer | none | Effective default route(s) from gateway selection. |
| `GET` | `/api/v1/routing/status` | `routing status` | viewer | none | Routing status. |
| `GET` | `/api/v1/services/graph` | `flows services` | viewer | none | Who called whom over the last minutes. |
| `GET` | `/api/v1/surface` | `surface` | viewer | none | This host's surface: what is installed, what runs, what listens, what is reachable and what the policy blocks. |
| `GET` | `/api/v1/surface/listening` | `surface listening` | viewer | none | Every listener with the packages its process maps, the traffic it took and who may reach it. |
| `GET` | `/api/v1/surface/loaded` | `surface loaded` | viewer | none | Every file live processes map executable, once per root, and the package owning it. |
| `GET` | `/api/v1/surface/packages` | `surface packages` | viewer | none | What the package managers say is installed, in the host's root and every container's. |
| `GET` | `/api/v1/threatintel/feeds` | `threatintel feeds` | viewer | none | The configured feeds, the CrowdSec local API among them, with when each was last fetched. |
| `POST` | `/api/v1/threatintel/feeds/refresh` | `threatintel feeds refresh` | operator | none | Fetch every feed now; refused while a fetch is already running. |
| `GET` | `/api/v1/threatintel/iocs` | `threatintel iocs` | viewer | none | List loaded IOCs. |
| `GET` | `/api/v1/threatintel/status` | `threatintel status` | viewer | none | Threat intel subsystem status. |
| `GET` | `/api/v1/threatintel/urls` | `threatintel urls` | viewer | none | List malicious URL indicators ingested from CTI feeds. The threat-intel engine is IP-only, so URL indicators are surfaced from the service's retained snapshot. |
| `GET` | `/api/v1/tls/handshakes` | `tls handshakes` | viewer | none | What the TLS handshakes seen on the node negotiated: version, cipher suite, key exchange group and, in TLS 1.2, the certificate's validity. |
| `GET` | `/api/v1/crypto/posture` | `tls links` | viewer | none | The key exchange policy each of the agent's own TLS links was built with, the group it last negotiated and the handshakes it completed on each group. |
| `GET` | `/api/v1/tls/posture` | `tls posture` | viewer | none | The cryptographic posture of each edge between two workloads: how many connections ran over a post-quantum group, a classical exchange, a TLS version below 1.2, or in clear text, with the clear-text protocols named. |
| `GET` | `/api/v1/tls/status` | `tls status` | viewer | none | Report the negotiated TLS key-exchange group for the current connection. |
| `POST` | `/api/v1/trace` | `trace` | operator | none | What the loaded programs decide for one packet. |
| `GET` | `/api/v1/zones` | `zones list` | viewer | none | List security zones. |
| `POST` | `/api/v1/zones` | `zones add` | admin | none | Create a security zone. |
| `GET` | `/api/v1/zones/policies` | `zones policies` | viewer | none | List inter-zone policies. |
| `POST` | `/api/v1/zones/policies` | `zones add-policy` | admin | none | Create an inter-zone policy. |
| `DELETE` | `/api/v1/zones/policies/{id}` | `zones delete-policy` | admin | none | Remove an inter-zone policy. |
| `GET` | `/api/v1/zones/status` | `zones status` | viewer | none | Zone service status. |
| `DELETE` | `/api/v1/zones/{id}` | `zones delete` | admin | none | Remove a security zone. |

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
| Read | `agent.api_rate_limit.read_per_minute`, default 200/minute per peer | `agent.api_rate_limit.read_burst`, default 200 | Yes |
| Write | `agent.api_rate_limit.write_per_second`, default 1/second per peer | `agent.api_rate_limit.write_burst`, default 60 | Yes |

The write tier reads the same `agent.api_rate_limit` block as the OSS agent's
control API, so a deployment tunes one thing rather than two:

```yaml
agent:
  api_rate_limit:
    write_per_second: 1
    write_burst: 60
    read_per_minute: 200
    read_burst: 200
    exempt_loopback: true
```

Every value must be at least 1; a zero is rejected when the configuration loads,
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
