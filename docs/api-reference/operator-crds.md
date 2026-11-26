# Operator Custom Resources

Every kind the Kubernetes operator serves, and every field of its `spec`.
The operator is licensed from the Professional tier and refuses to start
without a licence carrying `kubernetes-operator`; the enterprise kinds below
are reconciled only when the licence also carries the feature each one
configures. How the operator is installed and how a resource reaches the
agents is explained in [Kubernetes Operator](../features/enterprise/kubernetes-operator.md).

The section below is generated from the CRDs the operator writes from its own
types, so it states what the API server accepts and nothing else. The same
text is what `kubectl explain <kind>.spec.<field>` prints on a cluster. Edit
the operator's types, not this page.

A field with a default can be left out; the default in the table is the one
the API server writes in. A nested field is described by `kubectl explain`
one level at a time, for example `kubectl explain firewallpolicy.spec.rules`.

<!-- BEGIN GENERATED KINDS -->

| Kind | apiVersion | Short names | Scope |
|------|------------|-------------|-------|
| [AirGapBundle](#airgapbundle) | `ebpfsentinel.io/v1` | `agb` | Namespaced |
| [AISecurityPolicy](#aisecuritypolicy) | `ebpfsentinel.io/v1` | `aisp` | Namespaced |
| [AlertPolicy](#alertpolicy) | `ebpfsentinel.io/v1` | `ap` | Namespaced |
| [AliasSet](#aliasset) | `ebpfsentinel.io/v1` | `als` | Namespaced |
| [AnalyticsConfig](#analyticsconfig) | `ebpfsentinel.io/v1` | `anl` | Namespaced |
| [BehavioralDetection](#behavioraldetection) | `ebpfsentinel.io/v1` | `bdet` | Namespaced |
| [ComplianceReport](#compliancereport) | `ebpfsentinel.io/v1` | `cmpr` | Namespaced |
| [ConnectionTrackingConfig](#connectiontrackingconfig) | `ebpfsentinel.io/v1` | `ct` | Namespaced |
| [DDoSProtection](#ddosprotection) | `ebpfsentinel.io/v1` | `ddos` | Namespaced |
| [DLPPolicy](#dlppolicy) | `ebpfsentinel.io/v1` | `dlp` | Namespaced |
| [DNSPolicy](#dnspolicy) | `ebpfsentinel.io/v1` | `dnsp` | Namespaced |
| [EbpfSentinelAgent](#ebpfsentinelagent) | `ebpfsentinel.io/v1` | `esa` | Namespaced |
| [EnterpriseSettings](#enterprisesettings) | `ebpfsentinel.io/v1` | `esettings` | Namespaced |
| [FederationPolicy](#federationpolicy) | `ebpfsentinel.io/v1` | `fp` | Namespaced |
| [FirewallPolicy](#firewallpolicy) | `ebpfsentinel.io/v1` | `fwp` | Namespaced |
| [FleetConfig](#fleetconfig) | `ebpfsentinel.io/v1` | `fleet` | Namespaced |
| [ForensicsPolicy](#forensicspolicy) | `ebpfsentinel.io/v1` | `frnsc` | Namespaced |
| [GeoIPConfig](#geoipconfig) | `ebpfsentinel.io/v1` | `geo` | Namespaced |
| [HACluster](#hacluster) | `ebpfsentinel.io/v1` | `hac` | Namespaced |
| [IDSPolicy](#idspolicy) | `ebpfsentinel.io/v1` | `idsp` | Namespaced |
| [InterfaceGroup](#interfacegroup) | `ebpfsentinel.io/v1` | `ifg` | Namespaced |
| [IPSPolicy](#ipspolicy) | `ebpfsentinel.io/v1` | `ips` | Namespaced |
| [L7FirewallPolicy](#l7firewallpolicy) | `ebpfsentinel.io/v1` | `l7fw` | Namespaced |
| [LoadBalancerConfig](#loadbalancerconfig) | `ebpfsentinel.io/v1` | `lbc` | Namespaced |
| [MLDetection](#mldetection) | `ebpfsentinel.io/v1` | `mld` | Namespaced |
| [NATPolicy](#natpolicy) | `ebpfsentinel.io/v1` | `nat` | Namespaced |
| [PacketCapture](#packetcapture) | `ebpfsentinel.io/v1` | `pcap` | Namespaced |
| [QoSPolicy](#qospolicy) | `ebpfsentinel.io/v1` | `qos` | Namespaced |
| [RateLimitPolicy](#ratelimitpolicy) | `ebpfsentinel.io/v1` | `rlp` | Namespaced |
| [RBACConfig](#rbacconfig) | `ebpfsentinel.io/v1` | `rbac` | Namespaced |
| [ResponsePolicy](#responsepolicy) | `ebpfsentinel.io/v1` | `rp` | Namespaced |
| [RoutingPolicy](#routingpolicy) | `ebpfsentinel.io/v1` | `rtp` | Namespaced |
| [SIEMExport](#siemexport) | `ebpfsentinel.io/v1` | `siem` | Namespaced |
| [TenantPolicy](#tenantpolicy) | `ebpfsentinel.io/v1` | `tp` | Namespaced |
| [ThreatIntelFeed](#threatintelfeed) | `ebpfsentinel.io/v1` | `tif` | Namespaced |
| [TLSIntelligence](#tlsintelligence) | `ebpfsentinel.io/v1` | `tlsi` | Namespaced |
| [ZonePolicy](#zonepolicy) | `ebpfsentinel.io/v1` | `zp` | Namespaced |

### AirGapBundle

`ebpfsentinel.io/v1`, plural `airgapbundles`, namespaced.

`AirGapBundle` configures offline updates for a cluster with no route to the internet. A bundle carries signatures, threat-intel indicators and `GeoIP` data. It is copied into `bundleDir` by whatever moves data across the gap; the agent imports what it finds there and refuses anything older than `maxAgeDays`, because a stale bundle silently degrades detection.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoImport` | boolean | `false` | Import a bundle as soon as it appears. Off means an operator imports it explicitly. |
| `bundleDir` | string | `"/var/lib/ebpfsentinel/bundles"` | Directory the agent watches for bundles. |
| `enabled` | boolean | `false` |  |
| `maxAgeDays` | integer | `7` | Age above which a bundle is refused rather than imported. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### AISecurityPolicy

`ebpfsentinel.io/v1`, plural `aisecuritypolicies`, namespaced.

`AISecurityPolicy` covers traffic to AI and LLM providers: which ones are in use, what is being sent to them, and whether the resolver answering for them is one we can see. Detection is by destination and TLS metadata. Request bodies are only inspected where DLP already terminates TLS.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `aiDlp` | object |  | Patterns matched against prompt bodies. |
| `customProviders` | array of object | `[]` | Providers beyond the built-in catalogue. |
| `enabled` | boolean | `false` |  |
| `encryptedDns` | object |  | What happens to `DoH` and `DoT` traffic, which hides the name being resolved from every DNS control on the node. |
| `exfiltration` | object |  | Volume thresholds that turn ordinary use into an exfiltration alert. |
| `shadowAi` | object |  | What happens to traffic reaching a provider nobody sanctioned. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### AlertPolicy

`ebpfsentinel.io/v1`, plural `alertpolicies`, namespaced.

`AlertPolicy` configures where the agent's alerts go, and how many of the same alert it will send before it starts collapsing them. A route naming a destination whose block is missing is a route that silently sends nowhere, so the block a destination reads has to be there. The rule covers `otlp` because that route has no per-route field to fall back on: a webhook route carries its own URL and an email route carries its own recipient, while an OTLP route reads the one collector configured on the policy.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dedupWindowSecs` | integer | `60` | Seconds within which an identical alert is folded into the one already sent rather than sent again. |
| `enabled` | boolean | `true` | Turn alerting on or off. |
| `otlp` | object |  | OTLP endpoint alerts are exported to as log records. |
| `routes` | array of object | `[]` | Where alerts go. |
| `smtp` | object |  | Mail relay used by the routes whose destination is `email`. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `throttleMax` | integer | `100` | Alerts allowed through per throttle window. Past it the agent keeps counting and stops sending. |
| `throttleWindowSecs` | integer | `300` | Length of the window the throttle counts over, in seconds. |

### AliasSet

`ebpfsentinel.io/v1`, plural `aliassets`, namespaced.

`AliasSet` names a set of addresses, ports, countries, hostnames, MAC addresses or autonomous systems, so a rule can say `corp-vpn` rather than carrying the list.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `aliases` | array of object | `[]` | The aliases. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### AnalyticsConfig

`ebpfsentinel.io/v1`, plural `analyticsconfigs`, namespaced.

`AnalyticsConfig` turns on the on-agent analytics store that backs top talkers, trends and the retrospective queries the dashboard runs. Everything is held on the node; nothing is shipped anywhere.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dataDir` | string | `"/var/lib/ebpfsentinel/analytics"` | Directory holding the analytics store. Back it with a volume that survives the pod, or a restart loses the history. |
| `enabled` | boolean | `false` |  |
| `retentionDays` | integer | `30` | Days of history kept before a rollup is dropped. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### BehavioralDetection

`ebpfsentinel.io/v1`, plural `behavioraldetections`, namespaced.

`BehavioralDetection` covers the three detectors that judge traffic by its shape rather than by matching it against something known: DNS names that look generated, TLS fingerprints that sit outside every cluster, and payloads repeating on a beat. All three report and none of them drop. They exist to find what a signature cannot describe, which is also why they need thresholds an operator can move.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `beaconing` | object | `{"allowlistedPorts":[53,123,5353],"enabled":false,"handshakesPerTuple":10,"maxTrackedTuples":100,"minHandshakes":3,"windowSecs":3600}` | TLS handshakes from one source to one destination with one client fingerprint, spaced too evenly for a person, which is what a command channel looks like from outside. |
| `dnsEntropy` | object | `{"allowlist":[],"enabled":false,"entropyThreshold":3.5,"markovThreshold":-4,"tunnelEntropyThreshold":3,"tunnelLabelLength":30}` | Names that look machine-generated, and subdomain labels long enough to be carrying data. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `tlsClustering` | object | `{"batchSize":32,"enabled":false,"k":50,"outlierThreshold":8}` | Grouping TLS fingerprints so the ones far from every centroid stand out. |

### ComplianceReport

`ebpfsentinel.io/v1`, plural `compliancereports`, namespaced.

`ComplianceReport` schedules the evidence reports the agent produces from its own configuration and audit log. A report states what the agent is enforcing against a framework's controls. It is evidence for an audit, not an attestation: nothing here certifies anything.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` |  |
| `frameworks` | array of string | `[]` | Frameworks the report is written against. |
| `outputDir` | string |  | Directory reports are written to. Unset keeps them beside the agent's other state. |
| `retentionDays` | integer | `90` | Days a generated report is kept on the node. |
| `schedule` | object |  | Automatic generation and delivery. Unset generates on request only. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### ConnectionTrackingConfig

`ebpfsentinel.io/v1`, plural `connectiontrackingconfigs`, namespaced.

`ConnectionTrackingConfig` sets the per-source connection ceilings the agent's connection tracker enforces on the XDP fast path. Note: kernel netfilter manages TCP/UDP/ICMP state machine, timeouts, and eviction via `bpf_skb_ct_lookup` / `bpf_xdp_ct_lookup` kfuncs. The agent only queries kernel CT and tracks per-source flood counters. Use sysctl `net.netfilter.nf_conntrack_*` to tune kernel-side timeouts.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ackThreshold` | integer |  | No longer read: see `halfOpenThreshold`. |
| `connRateWindowSecs` | integer | `5` | Width of the window `maxSrcConnRate` is measured over, in seconds. |
| `enabled` | boolean | `true` | Enable connection tracking kfunc probes. |
| `finThreshold` | integer |  | No longer read: see `halfOpenThreshold`. |
| `halfOpenThreshold` | integer |  | No longer read: the per-source flood thresholds belong to `DDoSProtection` `connectionTracking`. Accepted so a resource written against v1 still applies, left out of the document and reported on the `FieldsIgnored` condition. |
| `maxSrcConnRate` | integer | `0` | New connections a single source may open inside `connRateWindowSecs`. `0` is unlimited. |
| `maxSrcStates` | integer | `0` | Concurrent connections a single source may hold. `0` is unlimited, which is what an agent naming none does. |
| `overloadTtlSecs` | integer | `3600` | How long a source that exceeded `maxSrcConnRate` stays refused, in seconds. `0` holds it until the agent restarts. |
| `rstThreshold` | integer |  | No longer read: see `halfOpenThreshold`. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### DDoSProtection

`ebpfsentinel.io/v1`, plural `ddosprotections`, namespaced.

`DDoSProtection` configures the volumetric protections the XDP rate limiter enforces: SYN cookies, ICMP flood limits, amplification port caps, TCP state-abuse thresholds and named mitigation policies.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `amplificationProtection` | object | `{"enabled":false,"ports":[]}` | Reflection and amplification protection, per UDP service port. |
| `connectionTracking` | object | `{"ackThreshold":200,"enabled":true,"finThreshold":50,"halfOpenThreshold":100,"maxEntries":null,"rstThreshold":50}` | TCP state-abuse thresholds evaluated by the connection tracker. |
| `enabled` | boolean | `true` | Turn the whole `DDoS` subsystem on or off. |
| `icmpProtection` | object | `{"enabled":true,"maxPayloadSize":64,"maxPps":10}` | ICMP flood protection. |
| `maxTrackedSources` | integer |  | Capacity of each per-source kernel table the guards keep (SYN, ICMP and amplification rates, half-open counts, RST, FIN and ACK floods), in sources tracked at once. Each table is per CPU and evicts the least recently seen source when full. Unset leaves the agent's own default of 16384. Read at agent start only. Minimum `1024`. Maximum `1048576`. |
| `policies` | array of object | `[]` | Named mitigation policies. |
| `synProtection` | object | `{"enabled":true,"thresholdMode":true,"thresholdPps":10000}` | SYN flood protection. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### DLPPolicy

`ebpfsentinel.io/v1`, plural `dlppolicies`, namespaced.

`DLPPolicy` declares the data-loss-prevention pattern set the agent matches against payloads reassembled from cleartext and from the TLS libraries it hooks. The pattern set and the engine mode are open-source. The extended TLS hooking, the inspection proxy and the deep-inspection overrides are enterprise and are only present when the operator is built with the `enterprise` feature.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Turn the DLP engine on or off. |
| `extendedTls` | object | `{"boringsslStatic":true,"enabled":false,"excludePaths":[],"gnutls":true,"goTls":true,"javaJsse":true,"ktls":true,"mbedtls":true,"nss":true,"s2nTls":true,"scanIntervalSeconds":30,"wolfssl":true}` | Extended TLS library hooking: Go `crypto/tls`, statically linked `BoringSSL`, kTLS and `GnuTLS`, so payloads from processes that never link `libssl` are still scanned. Java and NSS are discovered and reported without being hooked; the agent says why beside each plan it attaches nothing for. |
| `l7Advanced` | object | `{"customInspectPatterns":[],"deepInspectRuleIds":[]}` | Deep-inspection overrides applied on top of the L7 rule set. |
| `mode` | string | `"alert"` | Engine-wide mode. A pattern may override it. One of `alert`, `block`. |
| `patterns` | array of object | `[]` | Patterns matched against reassembled payloads. |
| `recordBytes` | integer |  | The most plaintext one DLP event carries, in bytes, from 4,096 to 16,384 (the largest plaintext one TLS record holds). Where the node's kernel cannot read user memory straight into the ring buffer, an event carries at most 4,096 bytes whatever this says. Left out, the agent keeps 16,384. Minimum `4096`. Maximum `16384`. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `tlsProxy` | object |  | TLS inspection proxy, terminating and re-originating TLS so the cleartext can be scanned. |

### DNSPolicy

`ebpfsentinel.io/v1`, plural `dnspolicies`, namespaced.

`DNSPolicy` drives the agent's DNS plane: the answer cache, the domain blocklist and the feeds that fill it, and the reputation engine that scores domains the blocklist never named.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `blocklist` | object | `{"action":"block","domains":[],"feeds":[],"gracePeriodSecs":300,"injectTarget":"threatintel"}` | The blocklist and what enforcing it means. |
| `cache` | object | `{"maxEntries":100000,"minTtlSecs":60,"purgeIntervalSecs":30}` | Answer cache sizing. |
| `dohResolvers` | array of string | `[]` | Known DNS-over-HTTPS resolver addresses, so encrypted resolution can be recognised rather than passing as ordinary HTTPS. |
| `enabled` | boolean | `true` | Turn DNS inspection on or off. |
| `reputation` | object | `{"autoBlockEnabled":false,"autoBlockThreshold":0.8,"autoBlockTtlSecs":3600,"decayHalfLifeHours":24,"enabled":false,"highRiskCountries":[],"maxTrackedDomains":50000}` | Reputation scoring for domains no list names. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### EbpfSentinelAgent

`ebpfsentinel.io/v1`, plural `ebpfsentinelagents`, namespaced.

`EbpfSentinelAgent` manages the lifecycle of eBPFsentinel agent `DaemonSets`. This is the top-level CRD that controls agent deployment, image versions, configuration, and feature toggles across the cluster.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `affinity` | object |  | Affinity rules for scheduling, for an estate that keeps the agent off some nodes by rule rather than by label. |
| `auth` | object |  | Authentication for the operator to reach agent API. |
| `bgpDaemon` | object |  | The BIRD routing daemon run beside the agent when a load balancer policy announces its VIPs over BGP. No such image is published under this project's name, so the estate names the one it trusts; absent, no daemon runs and a BGP block has nothing to drive. |
| `config` | object | `{"allowPlaintextApi":null,"allowUnauthenticatedApi":null,"apiRateLimit":{"exemptLoopback":true,"readBurst":200,"readPerMinute":200,"writeBurst":60,"writePerSecond":1},"attachMode":"auto","audit":{"bufferSize":100000,"enabled":true,"retentionDays":90,"storagePath":"data/audit.redb"},"auth":{"apiKeySaltSecretRef":null,"apiKeys":[],"bootstrapKeySecretRef":null,"enabled":true,"jwt":{"algorithm":"RS256","audience":null,"issuer":null,"jwksCacheTtlSeconds":3600,"jwksRefreshOnUnknownKid":true,"jwksUrl":null,"publicKeySecretRef":null},"metricsAuthRequired":true,"oidc":null},"bindAddress":null,"bpfToken":{"bpffsPath":"/sys/fs/bpf/ebpfsentinel","pinLinksOnNode":true},"capture":{"maxDurationSecs":null},"container":{"docker":{"cacheSize":0,"cacheTtlSeconds":0,"enabled":false,"socket":"","timeoutMs":0},"kubernetes":{"clusterIp":{"enabled":false,"workloads":[]},"enabled":false,"labelFilter":[],"networkPolicy":{"alongsideCni":false,"mode":"off"},"nodeName":null},"resolver":{"cacheSize":4096,"cgroupRoot":"/sys/fs/cgroup","enabled":true,"procPath":"/proc"}},"ebpfProgramDir":null,"eventWorkers":null,"grpcPort":null,"grpcReflection":null,"httpPort":null,"management":{"operatorEndpoint":null,"operatorManaged":null},"metricsPort":null,"namespaces":{},"raw":null,"response":{"maxTtlSecs":null},"serverTls":{"allowTls12":false,"certKey":"tls.crt","enabled":false,"keyKey":"tls.key","pqMode":"prefer","secretRef":null},"swaggerUi":null,"telemetry":{"enabled":true,"machineIdPath":null,"statePath":null},"threatIntel":{"countryConfidenceBoost":{},"enabled":true,"maxEntries":null,"mode":"alert"}}` | Agent configuration overrides (merged with defaults). |
| `enterprisePort` | integer |  | Port the enterprise build serves its own API on. This is a deployment fact rather than a line of the agent's configuration document: the enterprise binary takes it as a command line argument, so setting it here also passes it to the container. It is also the one listener the enterprise binary opens, so once set the probes and the operator's own calls go to it. Leaving it unset means an OSS agent: the probes and calls go to `httpPort`, which an enterprise image never opens, so an enterprise agent sets it. Maximum `65535`. |
| `extraEnv` | array of object | `[]` | Extra environment variables injected into agent pods. |
| `extraVolumeMounts` | array of object | `[]` | Extra volume mounts for the agent container. |
| `extraVolumes` | array of object | `[]` | Extra volumes for agent pods. |
| `features` | object | `{}` | Feature toggles. |
| `host` | object | `{"capabilities":["BPF","NET_ADMIN","SYS_ADMIN","NET_RAW","PERFMON","SYS_PTRACE"],"network":true,"pid":false,"privileged":false,"statePath":null,"tailoredSeccomp":{"enabled":false,"kubeletRootDir":"/var/lib/kubelet"}}` | What the agent container is allowed to do on the node. |
| `image` | object, required |  | Container image configuration. |
| `interfaces` | array of string | `["eth0"]` | Network interfaces to attach eBPF programs to. Read only under the `node` profile: a `pod` profile agent attaches inside each pod it selects and names no interface of its own. |
| `nodeSelector` | map of string | `{}` | Node selector for scheduling. |
| `podSelector` | object |  | The pods a `pod` profile agent attaches inside. Required with that profile and refused with the other. |
| `priorityClassName` | string |  | Priority class of the agent pods. An agent evicted under node pressure is a node with no enforcement on it, which is why an estate running the agent as infrastructure names a class here. |
| `probes` | object | `{"liveness":{"failureThreshold":3,"initialDelaySeconds":10,"periodSeconds":10,"timeoutSeconds":1},"readiness":{"failureThreshold":3,"initialDelaySeconds":5,"periodSeconds":5,"timeoutSeconds":1},"startup":null}` | How the kubelet decides an agent pod is alive and serving. |
| `profile` | string | `"node"` | Where the agent attaches. `node`, the default, is the agent on the node's uplinks and on the host side of every workload link. `pod` runs as a second agent beside it and attaches inside the network namespace of each pod `podSelector` names, which is where a pod's loopback and a link the host side refused are visible. Run it where the node agent's coverage verdict says a pod is missed for a reason it closes, and nowhere else: it costs a chain per selected pod. The sections that belong to the node (firewall, rate limiting, flood protection, load balancing, NAT, routing, shaping, zones, interface groups, DLP, socket attribution, the process table and automatic capture) are refused under it rather than loaded twice. One of `node`, `pod`. |
| `resources` | object |  | Resource requirements for agent pods. |
| `stoppedNodes` | array of object |  | Nodes a protected agent was stopped on, each with the authorisation the console or the break-glass tool signed for it. The operator verifies the document against the stop pairs the enterprise settings name, hands it to the agent on that node and, once the agent admits it, keeps the `DaemonSet` off the node until the entry is removed. An entry the operator cannot verify, or the agent refuses, is taken back out. Under tamper protection only a named service account changes it. |
| `terminationGracePeriodSeconds` | integer | `30` | Seconds a pod is given to detach its programs and stop cleanly. |
| `tls` | object | `{"caKey":"ca.crt","caSecretRef":null,"insecureSkipVerify":false}` | TLS configuration for agent API. |
| `tolerations` | array of object | `[]` | Tolerations for scheduling on tainted nodes. |
| `updateStrategy` | object | `{"maxUnavailable":1,"type":"RollingUpdate"}` | Update strategy for the `DaemonSet`. |
| `wardenImage` | object | `{"repository":"ghcr.io/ebpfsentinel/ebpfsentinel-warden","tag":"latest"}` | The warden broker's image. The agent loads eBPF exclusively through a BPF token, which is created against a bpffs only a privileged process can delegate, so every agent pod runs the warden beside it as a native sidecar. It is a separate image from the agent's, and a separate field so an estate mirroring one registry can mirror both. |
| `xdpMode` | string | `"auto"` | XDP attachment mode. One of `auto`, `native`, `generic`, `offloaded`. |

### EnterpriseSettings

`ebpfsentinel.io/v1`, plural `enterprisesettings`, namespaced.

`EnterpriseSettings` carries the enterprise configuration that is not a policy: where the licence comes from, whether the data plane is partitioned by tenant at all, how much of the response engine's trail is kept, and whether this deployment reports itself to the vendor portal. One of these per agent set. The policies are separate resources because they change on a different clock than this does.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `api` | object |  | TLS terminated by the enterprise listener itself. Absent, the listener is plain HTTP for a terminator in front of it, and the agent says so at startup. |
| `content` | object |  | Detection content fetched from the vendor portal over the reporting relationship. Needs `portal.enabled`. |
| `extendedL7` | object |  | Rules on the parsed fields of MQTT, AMQP, NATS and Cassandra. Needs `extended-l7-protocols` on the licence. |
| `fileWatch` | object |  | File watch profiles from the signed content, watched beside the community file watch paths. Needs `content.enabled`. |
| `firewallTiers` | array of object |  | The firewall tiers, in the order the agent evaluates them. Each `FirewallPolicy` naming a tier in `tier` brings its rules into it; the node's own rules are the tier named `default`, last unless listed. Needs fleet-management, and the tier `provider` multi-tenancy as well: it must come first and name the role that alone may change it. |
| `hostRules` | object |  | Host rule profiles from the signed content, loaded beside the community host rules. Needs `content.enabled`. |
| `intel` | object |  | TAXII 2.1 servers and MISP instances this estate already runs, polled for indicators. Needs `threat-intel-platforms` on the licence. |
| `investigation` | object |  | The bounds every investigation of one workload, started from the console, runs inside. Absent keeps the agent's defaults: on, five minutes at most, four at once, the last fifty kept. |
| `licenseSecretRef` | object, required |  | Secret holding the signed licence key. The operator mounts it and the agent verifies the signature itself, so a licence that never reaches the agent is a licence the agent does not honour. |
| `multiTenancy` | object | `{"cgroupAttribution":{"criSockets":["/run/containerd/containerd.sock","/run/crio/crio.sock"],"criTimeoutMs":2000,"enabled":false,"pollIntervalSeconds":10,"tenantLabel":"ebpfsentinel.io/tenant"},"enabled":true}` | Whether the data plane is partitioned at all. Off means every rule is evaluated against every packet regardless of the tenant it was created under. |
| `portal` | object |  | Reporting this deployment to the vendor portal. |
| `response` | object | `{"auditMaxEntries":10000,"enabled":true,"statePath":null}` | Tuning for the automated response engine. What it actually does is a `ResponsePolicy`. |
| `sigma` | object |  | Sigma rules compiled into detection rules at load. Needs `sigma-rules` on the licence. |
| `tamperProtection` | object |  | Who may stop a protected agent. Absent leaves the agents unprotected. Needs `tamper-protection` on the licence and the BPF LSM at boot. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### FederationPolicy

`ebpfsentinel.io/v1`, plural `federationpolicies`, namespaced.

`FederationPolicy` joins a cluster to a management cluster, or turns this one into the management cluster. A managed cluster heartbeats to `managementEndpoint` and applies the policy snapshots it is handed; the management cluster receives those heartbeats and serves the snapshots. Exactly one side sets `isManagement`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `advertiseEndpoint` | string |  | Base URL the management cluster reaches this member on, for instance `https://federation-member.example.internal:8444`: a member registers under it. A loopback or unspecified host is refused by the agent. Absent, the agent advertises its bind address and enterprise port, and registers nothing when that address is loopback or `0.0.0.0`, which is what an agent the operator deploys binds to. The operator renders no Service in front of a member, so it has no address to default to. |
| `caSecretRef` | object |  | Secret holding the PEM CA that signs the management endpoint's certificate. |
| `dataDir` | string | `"/var/lib/ebpfsentinel/federation"` | Directory holding the federation state. |
| `degradedThresholdSecs` | integer | `90` | Silence after which a member is reported degraded. |
| `enabled` | boolean | `false` |  |
| `estateResponse` | string |  | The estate response's mode when the agent starts. One of `shadow`, `enforce`. |
| `heartbeatIntervalSecs` | integer | `30` | Interval between heartbeats. |
| `isManagement` | boolean | `false` | Make this cluster the receiver rather than a member. |
| `managementApiKeySecretRef` | object |  | Secret holding an API key the management cluster accepts. The operator mounts it as a file and the member sends it as `X-API-Key` on registration, heartbeats and forwarded alerts. Needed when the management cluster authenticates its API and `mtls` is off. |
| `managementEndpoint` | string |  | Where a managed cluster sends its heartbeats. Required unless `isManagement` is set. |
| `mtls` | object |  | Mutual TLS on the federation listener. Without it the listener authenticates the client by bearer credential only. |
| `offlineThresholdSecs` | integer | `180` | Silence after which a member is reported offline. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### FirewallPolicy

`ebpfsentinel.io/v1`, plural `firewallpolicies`, namespaced.

`FirewallPolicy` declares the stateful L3/L4 firewall enforced by the agent's XDP and TC programs: the rule table, the default verdict, the anti-lockout guard, packet scrubbing and the named time schedules the rules refer to.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `antiLockout` | object | `{"enabled":false,"interfaces":[],"ports":[]}` | Guard that keeps the management path reachable whatever the rule table says. |
| `defaultPolicy` | string | `"pass"` | Verdict applied to a packet no rule matched. One of `pass`, `drop`. |
| `enabled` | boolean | `true` | Turn the firewall engine on or off on the target agents. |
| `mode` | string | `"alert"` | Engine-wide mode. `alert` reports what would have been dropped, `block` enforces. One of `alert`, `block`. |
| `networkExecutables` | object |  | The executables that alone may open an internet socket, decided in the kernel at the socket call. Needs the BPF LSM active at boot on each node, which is the `lsm=` boot parameter and not a kernel version: `ebpfsentinel-agent ebpf host-check` answers for a node. Where it is off, an observing list is skipped and an enforcing one stops the agent from starting. |
| `rules` | array of object | `[]` | L3/L4 firewall rules. |
| `schedules` | map of object | `{}` | Named time schedules referenced by `rules[].schedule`. |
| `scrub` | object | `{"clearDf":false,"dropFragments":false,"enabled":false,"maxMss":null,"minHopLimit":null,"minTtl":null,"normalizeTos":false,"randomIpId":false,"scrubTcpFlags":false,"stripEcn":false,"stripTcpTimestamps":false,"tosValue":null}` | Packet normalisation applied before the rule table is consulted. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Target agents for this policy. |
| `tier` | string |  | The enterprise firewall tier `rules` belong to, one of the names `EnterpriseSettings.firewallTiers` declares. Unset, or `default`, the rules join the node's own list. The tier `provider` is the service provider's: a resource in a namespace a `TenantPolicy` maps is refused when it names it, and only the provider's role may change its rules on the agent. At most 63 characters. |
| `workloadDns` | object |  | Who a DNS answer is believed from when a rule names its destination by name under `rules[].workload.fqdn`, and how long past the record's TTL the address stays open. Required as soon as one rule names a destination by name. |

### FleetConfig

`ebpfsentinel.io/v1`, plural `fleetconfigs`, namespaced.

`FleetConfig` turns on the fleet inventory an agent keeps of the peers that register with it. This is the on-agent half only. Cross-cluster reporting is `FederationPolicy`, and reporting to our own portal is `PortalReporting`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dataDir` | string |  | Directory holding the inventory. Unset keeps it in memory, so it is rebuilt from registrations after a restart. |
| `enabled` | boolean | `false` |  |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### ForensicsPolicy

`ebpfsentinel.io/v1`, plural `forensicspolicies`, namespaced.

`ForensicsPolicy` keeps a rolling window of flow records on the node so that an alert can be answered with what happened before it, not only with the packet that fired it. The ring buffer is bounded twice - by event count and by age - and whichever bound is hit first evicts. What survives a trigger is kept for `retentionDays`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `capture` | object |  | Packet capture written when a timeline is preserved. Off unless enabled. |
| `enabled` | boolean | `false` |  |
| `retentionDays` | integer | `7` | Days a preserved timeline is kept after a trigger fired. |
| `ringBufferMaxAgeSecs` | integer | `300` | Age above which an event leaves the buffer even if there is room. |
| `ringBufferMaxEvents` | integer | `10000` | Events held in the rolling buffer. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `trigger` | object | `{"components":["ids","ips","dlp","threatintel"],"minSeverity":"high"}` | What causes the buffer to be preserved. |

### GeoIPConfig

`ebpfsentinel.io/v1`, plural `geoipconfigs`, namespaced.

`GeoIPConfig` says where the agent gets its `MaxMind` databases from and how often they are refreshed. Country enrichment feeds the firewall's country aliases, the IDS country thresholds and the rate limiter's country tiers, so an agent without a database silently loses all three.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `databaseDir` | string | `"/var/lib/ebpfsentinel/geoip"` | Directory on the node the databases are written to. |
| `enabled` | boolean | `true` | Turn country and ASN enrichment on or off. |
| `refreshIntervalHours` | integer | `24` | Hours between refreshes. |
| `source` | object, required |  | Where the databases come from. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### HACluster

`ebpfsentinel.io/v1`, plural `haclusters`, namespaced.

`HACluster` pairs agents so that state survives the loss of a node. `active-passive` keeps one node forwarding and the other warm; `active-active` splits the interfaces between nodes and each takes the other's on failure. The agent knows itself by `advertisedAddr`, which differs on every node, so an `active-active` pair is one resource per node, each targeting that node's agent, the same `peers` and `interfaceAssignments` on both.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `advertisedAddr` | string |  | Address the peers reach this node on, the same string as this node's entry in the others' `peers` and in `interfaceAssignments`. Required in `active-active`, where the agent finds the interfaces it owns by it; a wildcard such as `0.0.0.0` matches no assignment. At most 256 characters. |
| `dataDir` | string | `"/var/lib/ebpfsentinel/ha"` | Directory holding the replicated state. |
| `degradationPolicy` | string | `"continue"` | What a node does when replication is degraded but it is still forwarding. One of `continue`, `read-only`, `fail-closed`. |
| `enabled` | boolean | `false` |  |
| `failureThreshold` | integer | `3` | Missed heartbeats before a peer counts as down. |
| `heartbeatMs` | integer | `1000` | Interval between heartbeats. |
| `insecurePlaintext` | boolean | `false` | Run the peer link without TLS, for a link already inside a tunnel you terminate. Anything that reaches the port can then force a leadership change or replace a node's rules; the agent warns at every start. Setting it beside `tls` is refused. |
| `interfaceAssignments` | array of object | `[]` | Which interfaces each node owns in `active-active`, one entry per node, sixteen at most. At most 16 items. |
| `listenAddr` | string | `"0.0.0.0:9443"` | Address the replication listener binds to. |
| `maxReplicationBandwidth` | integer |  | Ceiling on replication traffic, in bytes per second. Unset means unbounded, which on a busy pair can starve the data plane. |
| `mode` | string | `"active-passive"` | One of `active-passive`, `active-active`. |
| `peers` | array of string | `[]` | Peer addresses, `host:port`. The operator does not discover them: an enabled cluster with none is refused. |
| `replicationIntervalMs` | integer | `200` | Interval between state replication rounds. |
| `splitBrainPolicy` | string | `"prefer_active"` | What a node does when it cannot see its peer and cannot tell whether the peer is down or the link is. One of `prefer_active`, `prefer_standby`, `fence`. |
| `takeoverOnFailure` | boolean | `false` | Take over the peer's interfaces when it is declared down. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `tls` | object |  | Mutual TLS on the peer link. The agent refuses an enabled cluster without it unless `insecurePlaintext` is set. |

### IDSPolicy

`ebpfsentinel.io/v1`, plural `idspolicies`, namespaced.

`IDSPolicy` declares the signature set the agent's TC classifier evaluates, together with the sampling policy that bounds its cost.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Turn the detection engine on or off. |
| `inspectEgress` | boolean | `false` | Also inspect traffic leaving the host, not only traffic arriving. |
| `mode` | string | `"alert"` | Engine-wide mode. A rule may override it. One of `alert`, `block`. |
| `rules` | array of object | `[]` | Signature rules. |
| `sampling` | object |  | Packet sampling applied before detection. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### InterfaceGroup

`ebpfsentinel.io/v1`, plural `interfacegroups`, namespaced.

`InterfaceGroup` names a set of interfaces so a policy can say `wan` rather than repeating the link names on every rule.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `groups` | array of object | `[]` | The groups. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### IPSPolicy

`ebpfsentinel.io/v1`, plural `ipspolicies`, namespaced.

`IPSPolicy` configures intrusion prevention: the rules that blacklist a source outright, the automatic blacklisting that follows repeated detections, and the addresses that are never blacklisted.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoBlacklistThreshold` | integer | `5` | Detections against one source before it is blacklisted. |
| `countryThresholds` | map of integer | `{}` | Per-country overrides of `autoBlacklistThreshold`, keyed by ISO 3166-1 alpha-2 code. |
| `enabled` | boolean | `true` | Turn intrusion prevention on or off. |
| `maxBlacklistDurationSecs` | integer | `3600` | How long an automatically blacklisted address stays blacklisted. |
| `maxBlacklistSize` | integer | `100000` | Cap on the blacklist, so a flood cannot exhaust the map. |
| `mode` | string | `"alert"` | Engine-wide mode. A rule may override it. One of `alert`, `block`. |
| `rules` | array of object | `[]` | Prevention rules. |
| `sampling` | object |  | Packet sampling applied before detection. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `whitelist` | array of string | `[]` | Addresses and CIDRs never blacklisted. |
| `whitelistAliases` | array of string | `[]` | `AliasSet` entries whose members are never blacklisted. |

### L7FirewallPolicy

`ebpfsentinel.io/v1`, plural `l7firewallpolicies`, namespaced.

`L7FirewallPolicy` configures the protocol-aware rule set the agent's userspace inspector evaluates on reassembled streams, the ports it inspects, and the reassembly budget it is allowed to spend.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Turn layer-7 inspection on or off. |
| `fingerprints` | object | `{"persistencePath":null}` | Where the fingerprint cache is persisted across restarts. |
| `ports` | array of integer | `[]` | TCP ports whose payloads are handed to the inspector. |
| `reassembly` | object | `{"enabled":true,"idleTimeoutSecs":60,"maxBufferPerFlow":65536,"maxFlows":10000,"sweepIntervalSecs":30}` | Stream reassembly budget. |
| `rules` | array of object | `[]` | Layer-7 rules. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### LoadBalancerConfig

`ebpfsentinel.io/v1`, plural `loadbalancerconfigs`, namespaced.

`LoadBalancerConfig` configures the L4 load balancer (TCP/UDP/TLS passthrough), including the L2 VIP announce policy used for DSR failover.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `addressPools` | array of object | `[]` | Address pools the operator allocates `Service` objects of type `LoadBalancer` from. A Service given an address from one of these pools is served by the agents this resource selects, and its address is announced by this resource's VIP announce policy. |
| `enabled` | boolean | `true` | Turn the load balancer on or off. |
| `maxBackends` | integer |  | Backend slots the kernel reserves at start, across every service. Unset, the agent counts the backends it is handed, with room for at least one service at its full backend count. Minimum `1`. |
| `maxFlows` | integer |  | Connections in flight the kernel tracks at once, each held on the backend its first packet was balanced to. Unset leaves the agent's own default. Past it the least recently used flow is forgotten and its next packet balanced afresh. Minimum `1`. Maximum `16777216`. |
| `maxMaglevServices` | integer |  | Maglev lookup tables the kernel reserves at start, one per service using `maglev`. Unset, the agent counts the `maglev` services it is handed, at least one. Set it to leave room for services added later without restarting the agent. Minimum `1`. |
| `services` | array of object | `[]` | L4 services to provision on selected agents. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `vipAnnounce` | object |  | Optional L2 VIP announce policy. Omit or set role to `disabled` when not running L2 DSR / VIP failover. |

### MLDetection

`ebpfsentinel.io/v1`, plural `mldetections`, namespaced.

`MLDetection` configures the streaming anomaly detectors: EWMA drift, CUSUM change-point, count-min-sketch heavy hitters and random cut forest. Every detector runs on the agent over its own counters - no traffic leaves the node - so the only external artefact is the optional pre-trained model at `modelSecretRef`.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `anomalyThreshold` | number | `2` | Score above which a sample is reported, in standard deviations. |
| `cusum` | object | `{"enabled":true,"slack":0.5,"threshold":5}` | Cumulative-sum change-point detector. |
| `enabled` | boolean | `true` |  |
| `ewma` | object | `{"alpha":0.01,"enabled":true,"threshold":3,"warmupSamples":100}` | Exponentially weighted moving average drift detector. |
| `heavyHitter` | object | `{"enabled":true,"k":100,"thresholdPct":10}` | Count-min-sketch heavy hitters. |
| `learningDays` | integer | `7` | Days of traffic used to build the baseline before a score is trusted. |
| `modelSecretRef` | object |  | Secret holding a pre-trained model. Without it the agent learns a baseline from live traffic over `learningDays`. |
| `rcf` | object | `{"anomalyThreshold":1.5,"enabled":false,"numThreads":null,"numTrees":100,"recentCapacity":256,"sampleSize":256,"seed":null,"timeDecay":0}` | Random cut forest. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `timeWindows` | array of integer | `[60,300,900]` | Feature aggregation windows, in seconds: any of 60, 300 and 900, the windows the detectors aggregate over. The agent refuses any other. |

### NATPolicy

`ebpfsentinel.io/v1`, plural `natpolicies`, namespaced.

`NATPolicy` configures address translation: source NAT on the way out, destination NAT on the way in, prefix translation for IPv6, and the hairpin case where an internal client reaches an internal server through its published address.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `dnatRules` | array of object | `[]` | Destination NAT rules, applied on ingress. |
| `enabled` | boolean | `true` | Turn address translation on or off. |
| `hairpin` | object | `{"enabled":false,"hairpinSnatAddress":null,"internalSubnet":null}` | Hairpin NAT, for an internal client reaching an internal server through its published address. |
| `nptv6Rules` | array of object | `[]` | IPv6 prefix translation rules. |
| `snatRules` | array of object | `[]` | Source NAT rules, applied on egress. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### PacketCapture

`ebpfsentinel.io/v1`, plural `packetcaptures`, namespaced.

`PacketCapture` covers both ways the agent writes a capture: a capture started once against a filter, and the standing rule that an alert of a given severity opens one on its own.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `autoCapture` | object |  | Open a capture automatically when an alert matches. |
| `manual` | object |  | Start a capture on every agent the target selects, once per node for each generation of this resource: editing the resource starts the next one, a pod that restarts does not. What each node started is listed under `status.captures`, and the files are read and stopped from the console or with `ebpfsentinel-agent capture`. Leave it out to configure only the automatic side. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### QoSPolicy

`ebpfsentinel.io/v1`, plural `qospolicies`, namespaced.

`QoSPolicy` shapes traffic: pipes carry the bandwidth budget, queues sit on a pipe, and classifiers decide which packets land in which queue.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cgroupShaping` | array of object |  | Rates the traffic a workload sends is held to, by its cgroup. The first rule whose workload matches a cgroup is the one it is held to, so a narrow rule goes above a wide one. Needs the `fq` qdisc on the interfaces the traffic leaves by, which is what holds a packet until its departure time. At most 256 items. |
| `classifiers` | array of object | `[]` | Classifiers mapping packets onto queues. |
| `enabled` | boolean | `true` | Turn traffic shaping on or off. |
| `pipes` | array of object | `[]` | Shaping pipes. |
| `queues` | array of object | `[]` | Queues, each attached to a pipe. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### RateLimitPolicy

`ebpfsentinel.io/v1`, plural `ratelimitpolicies`, namespaced.

`RateLimitPolicy` enforces per-source traffic budgets in the XDP rate limiter, either by explicit rule or by country tier.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `countryTiers` | array of object | `[]` | Budgets applied by source country. |
| `defaultAlgorithm` | string | `"token_bucket"` | Algorithm used when a rule does not name one: `token_bucket`, `leaky_bucket`, `fixed_window` or `sliding_window`. |
| `defaultBurst` | integer | `2000` | Burst allowance that goes with `defaultRate`. |
| `defaultRate` | integer | `1000` | Packets per second applied to a source no rule and no tier names. |
| `enabled` | boolean | `true` | Turn rate limiting on or off. |
| `maxBuckets` | integer |  | Capacity of the kernel bucket table, in sources tracked at once. The table is per CPU and evicts the least recently seen source when full. Unset leaves the agent's own default of 65536. Read at agent start only: a running agent keeps the table it was created with. Minimum `1024`. Maximum `4194304`. |
| `rules` | array of object | `[]` | Explicit per-source rules. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### RBACConfig

`ebpfsentinel.io/v1`, plural `rbacconfigs`, namespaced.

`RBACConfig` defines the roles the agent's own API recognises beyond the built-in `admin`, `operator` and `viewer`. A role is a set of grants, optionally inheriting another role's. The built-in three are always present and cannot be redefined here.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `customRoles` | array of object | `[]` | Roles added on top of the built-in three. |
| `enabled` | boolean | `false` |  |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### ResponsePolicy

`ebpfsentinel.io/v1`, plural `responsepolicies`, namespaced.

`ResponsePolicy` says what the agent does on its own when an alert fires: block the source, rate-limit it, or cut the flow.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Turn automated response on or off. With it off the policies below are still pushed, and nothing fires. |
| `policies` | array of object | `[]` | The policies. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### RoutingPolicy

`ebpfsentinel.io/v1`, plural `routingpolicies`, namespaced.

`RoutingPolicy` declares the upstream gateways a multi-WAN agent may send traffic through, and how each one is probed so a dead link stops receiving traffic.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Turn multi-WAN routing on or off. |
| `gateways` | array of object | `[]` | Upstream gateways. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### SIEMExport

`ebpfsentinel.io/v1`, plural `siemexports`, namespaced.

`SIEMExport` configures where the agent ships alerts and events. The buffer, batch and circuit-breaker settings are shared by every destination on the agent, so one resource carries them alongside the destination list rather than repeating them per backend. No credential appears in the spec: each destination names a Secret.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `batchSize` | integer | `1000` | Events sent per request. |
| `bufferSizeBytes` | integer | `1073741824` | On-disk spool holding events while a destination is unreachable. Once it is full the oldest events are dropped. |
| `destinations` | array of object | `[]` | Where events are shipped. Every destination receives every event; filtering happens at the backend. |
| `enabled` | boolean | `true` |  |
| `failureThreshold` | integer | `5` | Consecutive failures that open the circuit breaker on a destination. |
| `flushIntervalMs` | integer | `5000` | How long a partial batch waits before it is sent anyway. |
| `resetTimeoutMs` | integer | `30000` | How long an open circuit stays open before a probe is retried. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |

### TenantPolicy

`ebpfsentinel.io/v1`, plural `tenantpolicies`, namespaced.

`TenantPolicy` declares one tenant and the traffic that belongs to it. A tenant is matched by namespace, subnet, VLAN or interface, and every rule the agent evaluates carries the tenant it was created under, so a tenant's rules never see another tenant's traffic. Quotas bound what a tenant can create, because a shared data plane has finite map space.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `description` | string |  |  |
| `id` | string, required |  | Stable identifier. Every rule created under this tenant carries it, so renaming it re-keys the data plane. |
| `interfaces` | array of string | `[]` | Interfaces this tenant is confined to. Empty means every interface the agent is attached to. |
| `name` | string, required |  | Display name shown in the dashboard and the audit log. |
| `namespaceSelector` | object |  | Namespaces whose labels this selector matches belong to this tenant as well, so a customer namespace created with the right labels is onboarded without this resource being edited. The operator resolves it and lists the result in `status.tenantNamespaces`; a namespace two tenants claim is given to neither and named there instead. `{}` selects every namespace, which is almost never what is meant. |
| `namespaces` | array of string | `[]` | Kubernetes namespaces whose workloads belong to this tenant, named one by one. |
| `quotas` | object | `{"maxAlertRate":null,"maxAlertRatePerSec":null,"maxPatterns":null,"maxQosPipes":null,"maxRatelimitRules":null,"maxRules":null}` | Ceilings on what this tenant may create. |
| `state` | string | `"active"` | A suspended tenant keeps its rules on file and stops matching. One of `active`, `suspended`. |
| `subnets` | array of string | `[]` | Subnet CIDRs belonging to this tenant. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `vlans` | array of integer | `[]` | VLAN identifiers belonging to this tenant. |

### ThreatIntelFeed

`ebpfsentinel.io/v1`, plural `threatintelfeeds`, namespaced.

`ThreatIntelFeed` is one IOC source the agent loads into the threat intelligence table. Settings shared by every feed - the enforcement mode and the per-country confidence boost - live on the agent's own `threatIntel` config block, because they are not a property of any one feed.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `auth` | object |  | Credential for the feed URL, sent as an `Authorization` header. |
| `defaultAction` | string |  | What a hit on this feed does when the row carries no action of its own: `alert`, `block` or `drop`. |
| `enabled` | boolean | `true` | Enable or disable this feed without deleting it. |
| `fieldMapping` | object |  | Field mapping for CSV and JSON feeds. |
| `format` | string | `"plaintext"` | Feed data format. One of `stix`, `csv`, `json`, `plaintext`, `misp`. |
| `id` | string |  | Feed identifier the agent keys the IOCs on. Defaults to the resource name when left out. |
| `maxIocs` | integer | `500000` | Largest number of IOCs kept from this feed. Rows past the cap are dropped rather than silently overwriting earlier ones. |
| `minConfidence` | integer | `0` | Rows below this confidence, from 0 to 100, are not loaded. Maximum `255`. |
| `name` | string |  | Human-readable feed name, used in alerts and metrics. |
| `refreshIntervalSecs` | integer | `3600` | Seconds between refreshes. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `url` | string, required |  | Where the feed is fetched from. |

### TLSIntelligence

`ebpfsentinel.io/v1`, plural `tlsintelligences`, namespaced.

`TLSIntelligence` reads what a TLS handshake says about the client making it: the JA4 fingerprint, the cipher suites offered, and whether any of it has been seen from this destination before. None of it decrypts anything. The handshake is in the clear, and that is the whole surface this policy works on.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `anomaly` | object |  | Reporting on fingerprints rarely seen in this estate. |
| `beaconingBridge` | object |  | No longer read: every handshake reaches the beaconing detector whenever `BehavioralDetection` enables it. Accepted so a resource that sets it stays valid. |
| `cipherBaseline` | object |  | Detection of a destination suddenly negotiating weaker crypto than it has been. |
| `cryptoPolicy` | object |  | Versions and algorithms that are refused outright. |
| `enabled` | boolean | `true` |  |
| `ml` | object |  | Scoring handshake features with a trained model. |
| `peerGroupRarity` | object |  | Judging a fingerprint against the workloads that look like this one rather than against the whole estate. |
| `pqc` | object |  | Recording which handshakes are post-quantum ready. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `threatDb` | object |  | Fingerprints known to belong to a tool rather than a browser. |

### ZonePolicy

`ebpfsentinel.io/v1`, plural `zonepolicies`, namespaced.

`ZonePolicy` groups the agent's interfaces into named security zones and states what each ordered pair of zones is allowed to do. Zone verdicts are evaluated before the firewall rule table, so a pair set to `drop` costs nothing further down.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | Turn zone evaluation on or off. |
| `pairs` | array of object | `[]` | What each ordered pair of zones may do. |
| `target` | object | `{"all":true,"labelSelector":null,"names":[]}` | Which `EbpfSentinelAgent` resources a policy applies to. The operator renders the agent configuration file from the agent resource plus every policy resource selecting it, so a target names agent resources rather than the pods they produce. |
| `zones` | array of object | `[]` | The zones themselves. |

<!-- END GENERATED KINDS -->
