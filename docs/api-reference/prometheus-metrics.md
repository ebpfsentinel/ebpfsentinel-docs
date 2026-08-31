# Prometheus Metrics

## Which port each registry is on

There are two registries and they are scraped separately, because the two
agents are two binaries: neither one exposes the other's series.

| Registry | Prefix | Scraped from | Also served on |
|----------|--------|--------------|----------------|
| OSS agent | `ebpfsentinel_` | `:9090/metrics`, the dedicated metrics listener (`agent.metrics_port`) | `:8080/metrics`, the control API (`agent.http_port`) |
| Enterprise agent | `ebpfsentinel_ent_` | `:8444/metrics`, the enterprise API (`--enterprise-port`) | - |

The OSS registry has a listener of its own so a scraper can reach it while the
control API port stays firewalled off. The enterprise agent runs no second
listener: its `/metrics` is on the enterprise API port and carries the
enterprise registry only.

## How to read this page

Every family below is registered by one of the two agents. Two encoding rules
decide the name you actually query:

- A counter is registered without a suffix and the OpenMetrics text encoder
  appends `_total` to every sample. `alerts` is registered, `ebpfsentinel_alerts_total`
  is scraped. This page lists the scraped name.
- A histogram is sampled as `_bucket`, `_sum` and `_count`. The name in the
  table is the family; `histogram_quantile` reads the `_bucket` series.

A gauge carries no suffix at all, so a gauge named `_total` would be invalid
OpenMetrics rather than a naming preference.

## Renamed series

Two metrics changed name. Both were registered under a name ending in
`_total`, which the OpenMetrics text encoder appends to every counter sample
by itself, so one was exported twice over and the other carried a counter
suffix on a gauge.

| Old series | New series | Why |
|--------|------|--------|
| `ebpfsentinel_ids_ct_dying_total_total` | `ebpfsentinel_ids_ct_dying_total` | Registered as `ids_ct_dying_total`, so the encoder appended a second suffix. Nothing naming the intended series ever matched it |
| `ebpfsentinel_lb_vip_arp_replies_total` | `ebpfsentinel_lb_vip_arp_replies` | It is a gauge, and `_total` on a gauge is not valid OpenMetrics |

This is a breaking change for any dashboard panel, alert rule or recording
rule naming the old series: the query returns no data rather than an error, so
update the query rather than waiting for something to fail.

## Removed series

Five metrics were registered and never written, so they exported nothing: a
panel or an alert rule naming one of them was always empty, which reads as a
quiet estate rather than as a metric nobody wired. Four of them restated a
counter the kernel already publishes, and are removed in favour of it.

| Removed series | Read instead | Why |
|--------|------|--------|
| `ebpfsentinel_bytes_processed_total` | Nothing | No datapath counts bytes per interface, so the family had no source at all |
| `ebpfsentinel_conntrack_expired_total` | `ebpfsentinel_packets_total{interface="CT_METRICS",action="evicted"}` and `action="closed"` | Expiry happens in the kernel, and the kernel already counts it |
| `ebpfsentinel_conntrack_kfunc_lookups` | `ebpfsentinel_packets_total{interface="CT_METRICS",action="kfunc_lookups"}` | Same counter under the kernel-map family, and as a counter rather than a gauge, so `rate()` works on it |
| `ebpfsentinel_conntrack_kfunc_hits` | `ebpfsentinel_packets_total{interface="CT_METRICS",action="kfunc_hits"}` | As above |
| `ebpfsentinel_conntrack_kfunc_misses` | `ebpfsentinel_packets_total{interface="CT_METRICS",action="kfunc_misses"}` | As above |

The same applies to the query rather than to the exporter: a panel naming a
removed series returns no data, which is what it was already doing.

## Kernel counter maps

`ebpfsentinel_packets_total` carries two kinds of series. A real NIC name in
`interface` is traffic on that link. A name ending in `_METRICS` is not an
interface at all: it is one of the per-CPU counter arrays an eBPF program
keeps, drained on the metrics poll, with `action` naming the counter slot.

There is no per-feature family for these counters. A drop counted by the
firewall is `ebpfsentinel_packets_total{interface="FIREWALL_METRICS",action="dropped"}`,
not `ebpfsentinel_firewall_dropped_total`, and the same fold-in holds for every
program below.

Counter slots are additive across releases, and a slot the kernel writes with
no exported label fails the build, so a counter cannot silently stop being
visible.

| `interface` | Program | `action` values |
|--------|------|--------|
| `FIREWALL_METRICS` | `xdp-firewall`, `xdp-firewall-reject` | `passed`, `dropped`, `errors`, `events_dropped`, `total_seen`, `rejected`, `mtu_exceeded`, `reject_throttled` |
| `RATELIMIT_METRICS` | `xdp-ratelimit` | `matched`, `dropped`, `errors`, `events_dropped`, `total_seen`, `mtu_exceeded` |
| `IDS_METRICS` | `tc-ids` | `matched`, `dropped`, `errors`, `events_dropped`, `total_seen`, `cgroup_resolved`, `cgroup_attributed` |
| `THREATINTEL_METRICS` | `tc-threatintel` | `matched`, `dropped`, `errors`, `events_dropped`, `total_seen` |
| `DNS_METRICS` | `tc-dns` | `inspected`, `emitted`, `errors`, `events_dropped`, `total_seen` |
| `DLP_METRICS` | `uprobe-dlp` | `write_events`, `read_events`, `errors`, `events_dropped`, `total_seen` |
| `CT_METRICS` | `tc-conntrack` | `new`, `established`, `closed`, `invalid`, `evicted`, `errors`, `lookups`, `hits`, `total_seen`, `kfunc_lookups`, `kfunc_hits`, `kfunc_misses`, `kfunc_state_new`, `kfunc_state_established`, `kfunc_state_related`, `kfunc_state_invalid`, `kfunc_marked`, `kfunc_read_errors` |
| `NAT_METRICS` | `tc-nat-ingress`, `tc-nat-egress` | `snat_applied`, `dnat_applied`, `masq_applied`, `port_alloc_fail`, `errors`, `total_seen`, `nptv6_translated`, `hairpin_applied`, `kfunc_delegated`, `kfunc_fallback`, `xfrm_steered`, `fou_encap` |
| `SCRUB_METRICS` | `tc-scrub` | `packets`, `ttl_fixed`, `mss_clamped`, `df_cleared`, `ipid_randomized`, `errors`, `hop_fixed`, `total_seen`, `tcp_flags_scrubbed`, `ecn_stripped`, `tos_normalized`, `tcp_ts_stripped`, `fragments_dropped` |
| `DDOS_METRICS` | `xdp-ratelimit`, `xdp-ratelimit-syncookie` | `syn_rcv`, `syn_flood_drops`, `icmp_pass`, `icmp_drop`, `amp_passed`, `amp_dropped`, `oversized_icmp`, `errors`, `events_dropped`, `conn_tracked`, `half_open_drops`, `rst_flood_drops`, `fin_flood_drops`, `ack_flood_drops`, `total_seen`, `syncookie_sent`, `syncookie_valid`, `syncookie_invalid` |
| `LB_METRICS` | `xdp-loadbalancer` | `forwarded`, `no_backend`, `bytes_forwarded`, `events_dropped`, `total_seen`, `mtu_exceeded` |
| `QOS_METRICS` | `tc-qos` | `total_seen`, `shaped`, `dropped_loss`, `dropped_queue`, `delayed`, `errors`, `events_dropped` |

Three of these repay reading in pairs.

`conn_tracked` and the four flood counters under `DDOS_METRICS` only move when
`ddos.connection_tracking` is enabled, since that is what arms the TCP state
machine they belong to.

`kfunc_delegated` against `kfunc_fallback` under `NAT_METRICS` says how much
of the translation the kernel is doing: the first counts translations handed
to the kernel's own conntrack kfuncs, the second counts those the agent had to
do itself because the running kernel did not offer them.

`kfunc_read_errors` under `CT_METRICS` is a correctness signal rather than a
volume one. The four `kfunc_state_*` counters read `nf_conn` fields at BTF
offsets resolved once at startup; a non-zero error count means the offsets no
longer match the running kernel, so those four are undercounting rather than
reporting an idle datapath.

## Metrics Catalog

### Packet Processing

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_packets_total` | Counter | `interface`, `action` | Packets processed, per interface or per kernel counter map |
| `ebpfsentinel_packet_processing_duration_seconds` | Histogram | `program` | Time spent dispatching one datapath event. `program` is the event source: `firewall`, `ids`, `ratelimit`, `threatintel`, `ddos`, `lb`, `l7`, `dns`, `dlp`, or `unknown` for an event type this build does not know |
| `ebpfsentinel_worker_events_total` | Counter | `worker_id` | Events processed per dispatch worker |
| `ebpfsentinel_worker_processing_duration_seconds` | Histogram | `worker_id` | Event processing duration per dispatch worker |
| `ebpfsentinel_events_dropped_total` | Counter | `reason` | Events dropped before the pipeline. `reason` is `channel_full`, `alert_channel_full` or `parse_error` |

### Datapath Ring Buffers

Each eBPF program hands its events to userspace through a ring buffer. These
three metrics account for that handover, labelled by the producing program
(`source`): `xdp-firewall`, `xdp-ratelimit`, `xdp-loadbalancer`, `tc-ids`,
`tc-threatintel`, `tc-dns`, `tc-conntrack`, `tc-qos`, `uprobe-dlp`.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ringbuf_events_total` | Counter | `source` | Records drained from the ring buffer |
| `ebpfsentinel_ringbuf_events_dropped_total` | Counter | `source`, `reason` | Records drained then lost before the processing pipeline. `reason="channel_full"` is backpressure on the processing channel; `decode_failed` and `truncated_record` mean the record itself could not be read |
| `ebpfsentinel_ringbuf_latency_seconds` | Histogram | `source` | Delay between the kernel committing a record and userspace draining it |

Reading them together tells you where events are lost. The kernel refuses to
emit when the ring is above 75% full, and counts that refusal in the
`events_dropped` slot of the program's own metrics map. `ringbuf_events_total`
counts what userspace actually received, and `ringbuf_events_dropped_total`
counts what it received and then had to throw away because the processing
channel was saturated. A rising `ringbuf_latency_seconds` with no drops means
the pipeline is keeping up but falling behind; drops on top of it mean it is
not keeping up at all.

### Rules and Configuration

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_rules_loaded` | Gauge | `component` | Loaded rule count per component (`firewall`, `ids`, `ratelimit`, `qos`, `l7`, `threatintel`, `ddos`, ...) |
| `ebpfsentinel_rules_reloads_total` | Counter | `component`, `result` | Configuration reload attempts, by component and `result` (`success` or `failure`) |

### Alerts

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_alerts_total` | Counter | `component`, `severity`, `technique_id` | Total alerts produced. `technique_id` is the MITRE ATT&CK technique, empty when the rule maps to none |
| `ebpfsentinel_alerts_by_rule_total` | Counter | `component`, `rule_id` | Total alerts per rule |
| `ebpfsentinel_alerts_dropped_total` | Counter | `reason` | Alerts dropped before delivery. `reason="dedup"` is a repeat inside the dedup window, `reason="throttle"` is the per-component rate limit, `reason="no_route"` is an alert no route wanted, `reason="no_sender"` is a route whose destination was never built |
| `ebpfsentinel_alerts_exported_total` | Counter | `destination` | Alerts accepted by an external sender's transport. Acceptance is an HTTP 2xx for a webhook, an SMTP hand-over for an email and a place in the batch queue for `otlp`, so for `otlp` it is not confirmation from the collector |
| `ebpfsentinel_alerts_export_failures_total` | Counter | `destination` | Alert exports that failed: one per alert the sender gave up on, and one per batch an OTLP flush could not deliver, since a batched exporter cannot say which alerts were in the batch it lost |
| `ebpfsentinel_alert_sender_circuit_state` | Gauge | `destination` | Alert sender circuit breaker state (0=closed, 1=half-open, 2=open) |
| `ebpfsentinel_alerts_sse_subscribers` | Gauge | - | Live SSE alert-stream subscriber count |
| `ebpfsentinel_false_positives_total` | Counter | `component`, `rule_id` | Alerts an operator marked as a false positive |

### DDoS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ddos_attacks_active` | Gauge | - | Currently active attack mitigations |
| `ebpfsentinel_ddos_attacks_detected_total` | Counter | `attack_type` | Total attacks detected by type |
| `ebpfsentinel_ddos_mitigations_total` | Counter | `attack_type` | Total mitigation actions applied by type |

The packets the datapath actually dropped are counted in the kernel, under
`interface="DDOS_METRICS"`. These three are the userspace detector's own view:
how many attacks it declared, not how many packets went with them.

### Firewall, Scrub, NAT and QoS

These four programs export no family of their own. Everything they count is a
slot in their kernel counter map, read on `ebpfsentinel_packets_total` under
`interface="FIREWALL_METRICS"`, `"SCRUB_METRICS"`, `"NAT_METRICS"` and
`"QOS_METRICS"`. Their loaded rule counts are on
`ebpfsentinel_rules_loaded{component=...}`.

### Connection Tracking

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_conntrack_active` | Gauge | - | Currently tracked connections |

Everything else about conntrack is a slot under `interface="CT_METRICS"`.

### IPS and Automated Response

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ips_blacklist_size` | Gauge | - | Current blacklist entry count |
| `ebpfsentinel_ips_blocks_total` | Counter | - | Total IPS enforcement actions applied |
| `ebpfsentinel_auto_responses_total` | Counter | `policy` | Auto-response enforcements applied, by the policy that matched. Only an enforcement that succeeded is counted; a policy that matched and failed to apply is logged and left out |
| `ebpfsentinel_ids_ct_dying_total` | Counter | - | Conntrack entries the IDS verdict pipeline marked `IPS_DYING` (flow kill) |

### Threat Intelligence

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_threatintel_matches_total` | Counter | `feed` | IOC matches resolved against a threat-intelligence feed, by feed |
| `ebpfsentinel_ids_domain_matches_total` | Counter | `rule_id` | IDS rule matches driven by a domain pattern |

### DLP

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_dlp_scans_total` | Counter | - | Data scans performed |
| `ebpfsentinel_dlp_matches_total` | Counter | `rule_id` | Pattern matches, by pattern |
| `ebpfsentinel_dlp_scan_duration_seconds` | Histogram | - | Scan latency in seconds |

### Load Balancer

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_lb_backends_healthy` | Gauge | `service` | Backends passing health checks, per configured service (zero for a service that has been removed) |
| `ebpfsentinel_lb_vip_arp_replies` | Gauge | `vip` | Forged ARP replies per VIP (L2 VIP announcer, speaker only) |
| `ebpfsentinel_lb_vip_takeovers_total` | Counter | `vip` | Gratuitous-ARP takeovers per VIP (L2 VIP announcer) |

Forwarded and unbackable packets are kernel slots, read on
`ebpfsentinel_packets_total{interface="LB_METRICS"}`.

### GeoIP

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_geoip_lookups_total` | Counter | `result` (`hit`/`miss`) | Total GeoIP database lookups, by resolution outcome |

There is no readiness gauge. A database that failed to load produces no
lookups at all, so `absent(rate(ebpfsentinel_geoip_lookups_total[5m]))` is the
query that says so, and `GET /api/v1/geoip/status` is the authoritative answer.

### DNS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_dns_cache_entries` | Gauge | - | Current DNS cache entry count |
| `ebpfsentinel_dns_cache_hits_total` | Counter | - | DNS cache lookup hits |
| `ebpfsentinel_dns_cache_evictions_total` | Counter | - | DNS cache entries evicted (LRU and TTL expiry) |
| `ebpfsentinel_dns_blocked_domains_total` | Counter | - | Domains matched by the blocklist |
| `ebpfsentinel_dns_injected_ips` | Gauge | - | IPs currently injected into the datapath from the DNS blocklist |
| `ebpfsentinel_domain_reputation_high_risk` | Gauge | - | Domains the reputation engine currently rates high risk |
| `ebpfsentinel_domain_auto_blocked_total` | Counter | - | Domains auto-blocked by the reputation engine |
| `ebpfsentinel_encrypted_dns_detections_total` | Counter | `protocol` (`doh`/`dot`), `resolver` | Encrypted DNS connections detected. A DoT detection reads the resolver out of the TLS SNI, which the client writes, so the label is capped at 64 distinct values per process and everything past the cap is counted under `resolver="other"` |

Queries observed on the wire are a kernel slot:
`ebpfsentinel_packets_total{interface="DNS_METRICS",action="inspected"}`.

### TLS Fingerprints

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_fingerprints_seen_total` | Counter | - | JA4 fingerprints computed from observed TLS ClientHellos. The fingerprint value is deliberately not a label: it is derived from bytes the client chose, so one series per value is an unbounded label set a peer controls. Read them from `GET /api/v1/fingerprints/summary` or `ebpfsentinel-agent fingerprints` |

### Zones

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_zone_packets_total` | Counter | `zone`, `action` | Packets decided per zone (`action` is `passed` or `dropped`). `zone="unzoned"` is traffic on interfaces no zone claims |
| `ebpfsentinel_zone_interfaces` | Gauge | `zone` | Interfaces bound to each zone |
| `ebpfsentinel_zone_policies` | Gauge | `zone` | Inter-zone policies whose source is this zone |

### Routing

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_routing_gateway_status` | Gauge | `gateway` | Gateway health (1=healthy, 0=unhealthy) |
| `ebpfsentinel_routing_gateways` | Gauge | - | Configured gateway count |
| `ebpfsentinel_routing_failovers_total` | Counter | - | Gateway failover events |

### Container Resolution

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_container_resolver_cache_hits_total` | Counter | - | Container identity resolved from cache |
| `ebpfsentinel_container_resolver_cache_misses_total` | Counter | - | Container identity resolved by reading `/proc` |
| `ebpfsentinel_container_resolver_errors_total` | Counter | - | `/proc` read failures during resolution |

### Audit

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_audit_events_total` | Counter | - | Audit events recorded |
| `ebpfsentinel_audit_failures_total` | Counter | - | Audit write failures |

### System and eBPF

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_memory_usage_bytes` | Gauge | - | Process resident set size |
| `ebpfsentinel_cpu_usage_percent` | Gauge | - | Process CPU usage |
| `ebpfsentinel_open_fds` | Gauge | - | Open file descriptors held by the process |
| `ebpfsentinel_thread_count` | Gauge | - | Threads in the process |
| `ebpfsentinel_ebpf_program_status` | Gauge | `program` | eBPF program load status (1=loaded, 0=failed) |
| `ebpfsentinel_ebpf_attach_blocked` | Gauge | - | Programs that loaded but could not be attached to any interface |
| `ebpfsentinel_xdp_attach_mode` | Gauge | `interface`, `mode` | The XDP mode actually in force (1=in force). `mode` is `native`, `generic`, `offloaded`, `multiple` or `unknown` |
| `ebpfsentinel_bpf_token_used` | Gauge | - | eBPF loaded through a BPF token (1=token-loaded, 0=API-only or no eBPF) |

## Enterprise Metrics

> Scraped from the enterprise API port (default `:8444/metrics`). Prefix:
> `ebpfsentinel_ent_`.
> With `auth.enabled: true` this endpoint needs a credential like the rest of
> the enterprise port: give the scrape job an `authorization` or an
> `X-API-Key` header, otherwise it gets `401`.

Everything under `ebpfsentinel_ent_` requires an Enterprise licence. An OSS
agent exposes none of it, so a panel mixing the two prefixes goes blank on an
OSS install rather than reading zero.

The tables below are the whole enterprise registry: every family it registers
is listed once, under the feature that writes it, with the name a query
returns data for. The same two encoding rules apply as above, so a counter is
listed with the `_total` the encoder appends and a gauge without it. A family
this page omits, or a name it carries that the registry does not expose, fails
`npm run check:metrics`.

### Renamed enterprise series

Five families were registered under a name ending in `_total`. The encoder
appends that suffix to every counter sample and to nothing else, so the
counter came out with two of them and the four gauges claimed on the wire to
be counters.

| Old series | New series | Why |
|--------|------|--------|
| `ebpfsentinel_ent_ml_rcf_anomalies_total_total` | `ebpfsentinel_ent_ml_rcf_anomalies_total` | Registered as `ml_rcf_anomalies_total`, so the encoder appended a second suffix. Nothing naming the intended series ever matched it |
| `ebpfsentinel_ent_fed_clusters_total` | `ebpfsentinel_ent_fed_clusters` | It is a gauge, and `_total` on a gauge is not valid OpenMetrics |
| `ebpfsentinel_ent_siem_connectors_total` | `ebpfsentinel_ent_siem_connectors` | As above |
| `ebpfsentinel_ent_tenant_total` | `ebpfsentinel_ent_tenants` | As above. The new name is plural because it counts tenants rather than describing one |
| `ebpfsentinel_ent_airgap_bundles_total` | `ebpfsentinel_ent_airgap_bundles` | As above |

This is a breaking change for any dashboard panel, alert rule or recording
rule naming an old series: the query returns no data rather than an error, so
update the query rather than waiting for something to fail.

### Fleet management

The control plane serving agent registration, heartbeats and fleet queries.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_fleet_registrations_total` | Counter | - | Agent registrations processed |
| `ebpfsentinel_ent_fleet_heartbeats_total` | Counter | - | Agent heartbeats received |
| `ebpfsentinel_ent_fleet_identity_queries_total` | Counter | - | Agent identity queries served |
| `ebpfsentinel_ent_fleet_config_version_queries_total` | Counter | - | Config version queries served |
| `ebpfsentinel_ent_fleet_flow_graph_queries_total` | Counter | - | Flow graph queries served |

### Multi-tenancy

Tenant lifecycle, per-tenant dispatch and quota enforcement.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_tenants` | Gauge | - | Total configured tenants |
| `ebpfsentinel_ent_tenant_alerts_total` | Counter | `tenant` | Tenant-scoped alerts dispatched |
| `ebpfsentinel_ent_tenant_audit_total` | Counter | `tenant` | Tenant-scoped audit entries |
| `ebpfsentinel_ent_tenant_quota_exceeded_total` | Counter | `tenant`, `resource` | Quota exceeded events by tenant and resource |
| `ebpfsentinel_ent_tenant_quota_usage_ratio` | Gauge | `tenant`, `resource` | Quota usage ratio (0.0-1.0) by tenant and resource |
| `ebpfsentinel_ent_tenants_added_total` | Counter | `source` | Tenants added dynamically by the source they came from |
| `ebpfsentinel_ent_tenants_suspended_total` | Counter | - | Tenants suspended |
| `ebpfsentinel_ent_tenants_activated_total` | Counter | - | Tenants reactivated after suspension |
| `ebpfsentinel_ent_tenant_self_service_checks_total` | Counter | `operation` | Self-service operations admitted, by operation |

There is no gauge carrying the configured limit itself. Usage is published as
a ratio so a panel needs no second series to be readable, and the limit is
read from `GET /api/v1/tenants/{id}/quota`.

### Role-based access control

Permission checks and role administration on the enterprise API.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_rbac_permission_checks_total` | Counter | `result` | RBAC permission checks by result |
| `ebpfsentinel_ent_rbac_role_changes_total` | Counter | `action` | RBAC role changes by action |
| `ebpfsentinel_ent_rbac_custom_roles` | Gauge | - | Number of custom RBAC roles |
| `ebpfsentinel_ent_rbac_role_assignments` | Gauge | - | Active role assignments |

### High availability

Leader election, failover, heartbeats and interface ownership in an HA pair or cluster.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_ha_elections_total` | Counter | `outcome` | HA leader elections by outcome |
| `ebpfsentinel_ent_ha_failovers_total` | Counter | `trigger` | HA failover events by trigger |
| `ebpfsentinel_ent_ha_heartbeats_sent_total` | Counter | - | HA heartbeats sent to peers |
| `ebpfsentinel_ent_ha_heartbeats_received_total` | Counter | - | HA heartbeats received from peers |
| `ebpfsentinel_ent_ha_role` | Gauge | - | Current HA role (0=follower, 1=candidate, 2=leader) |
| `ebpfsentinel_ent_ha_term` | Gauge | - | Current Raft term number |
| `ebpfsentinel_ent_ha_peers` | Gauge | - | Number of known HA peers |
| `ebpfsentinel_ent_ha_ebpf_active` | Gauge | - | Whether eBPF programs are active on this node (0/1) |
| `ebpfsentinel_ent_ha_split_brain_total` | Counter | `action` | Split-brain resolution actions |
| `ebpfsentinel_ent_ha_interface_takeovers_total` | Counter | `interface` | Interface takeovers in active-active mode |
| `ebpfsentinel_ent_ha_interface_releases_total` | Counter | `interface` | Interface releases after peer recovery |
| `ebpfsentinel_ent_ha_mode` | Gauge | `mode` | HA operating mode |
| `ebpfsentinel_ent_ha_owned_interfaces` | Gauge | - | Number of interfaces owned by this node |
| `ebpfsentinel_ent_ha_cluster_health` | Gauge | `health` | Cluster health state |
| `ebpfsentinel_ent_ha_degradation_entered_total` | Counter | `policy` | Degraded mode entries by policy |
| `ebpfsentinel_ent_ha_degradation_exited_total` | Counter | - | Degraded mode exits |
| `ebpfsentinel_ent_ha_peer_failure_count` | Gauge | `peer` | Consecutive heartbeat failures per peer |

### State replication

Delta and snapshot replication of runtime state between HA members.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_repl_deltas_sent_total` | Counter | `category` | Replication deltas sent by category |
| `ebpfsentinel_ent_repl_deltas_received_total` | Counter | `category` | Replication deltas received by category |
| `ebpfsentinel_ent_repl_snapshots_sent_total` | Counter | `category` | Full snapshots sent by category |
| `ebpfsentinel_ent_repl_snapshots_received_total` | Counter | `category` | Full snapshots received by category |
| `ebpfsentinel_ent_repl_lag` | Gauge | `category`, `follower` | Replication lag (sequence delta) by category and follower |
| `ebpfsentinel_ent_repl_bandwidth_rejected_total` | Counter | `category` | Replication attempts rejected by bandwidth limiter |
| `ebpfsentinel_ent_repl_errors_total` | Counter | `category` | Replication errors by category |

### Multi-cluster federation

Cluster registry, federated alert ingest and policy distribution.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_fed_cluster_registrations_total` | Counter | - | Cluster registrations |
| `ebpfsentinel_ent_fed_cluster_unregistrations_total` | Counter | - | Cluster unregistrations |
| `ebpfsentinel_ent_fed_clusters` | Gauge | - | Total registered clusters |
| `ebpfsentinel_ent_fed_clusters_online` | Gauge | - | Online clusters |
| `ebpfsentinel_ent_fed_alerts_ingested_total` | Counter | - | Federated alerts ingested |
| `ebpfsentinel_ent_fed_alerts_deduplicated_total` | Counter | - | Federated alerts deduplicated |
| `ebpfsentinel_ent_fed_policy_pushes_total` | Counter | - | Policy distribution pushes |
| `ebpfsentinel_ent_fed_policy_failures_total` | Counter | `cluster` | Policy distribution failures by cluster |
| `ebpfsentinel_ent_fed_alerts_sse_subscribers` | Gauge | `tenant` | Live federation alerts SSE subscribers by tenant scope |
| `ebpfsentinel_ent_fed_policies_applied_total` | Counter | `policy_type` | Federated policies applied locally by policy type |
| `ebpfsentinel_ent_fed_policy_apply_failures_total` | Counter | `policy_type` | Federated policy applies that failed and were rolled back, by policy type |
| `ebpfsentinel_ent_fed_policies_active` | Gauge | - | Federated policies currently applied on this cluster |

### SIEM export

Outbound event delivery to a SIEM connector, with its buffer and circuit breaker.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_siem_events_exported_total` | Counter | - | SIEM events exported |
| `ebpfsentinel_ent_siem_events_dropped_total` | Counter | - | SIEM events dropped |
| `ebpfsentinel_ent_siem_export_errors_total` | Counter | - | SIEM export errors |
| `ebpfsentinel_ent_siem_buffer_size_bytes` | Gauge | - | SIEM buffer size in bytes |
| `ebpfsentinel_ent_siem_circuit_state` | Gauge | - | SIEM circuit breaker state (0=closed, 1=half-open, 2=open) |
| `ebpfsentinel_ent_siem_connectors` | Gauge | - | Configured SIEM connectors |

### Automated response

Policy evaluation, response actions, SOAR webhooks and the cooldowns holding them back.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_response_policy_evaluations_total` | Counter | - | Alerts evaluated against the response policy set |
| `ebpfsentinel_ent_response_actions_executed_total` | Counter | `action`, `outcome` | Response actions executed by action and outcome |
| `ebpfsentinel_ent_response_webhooks_sent_total` | Counter | `result` | SOAR webhook deliveries by result |
| `ebpfsentinel_ent_response_policies_active` | Gauge | - | Response policies currently enabled |
| `ebpfsentinel_ent_response_cooldowns_active` | Gauge | - | Response cooldowns currently holding an action back |
| `ebpfsentinel_ent_response_audit_trail_depth` | Gauge | - | Entries currently held in the response audit trail |

### Forensics

Forensic event ingest, the ring buffer holding it and the captures triggered off it.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_forensics_sse_subscribers` | Gauge | - | Live forensic events SSE subscribers |
| `ebpfsentinel_ent_forensics_events_ingested_total` | Counter | - | Forensic events ingested into the ring buffer |
| `ebpfsentinel_ent_forensics_ring_buffer_depth` | Gauge | - | Forensic events currently held in the ring buffer |
| `ebpfsentinel_ent_forensics_ingestion_seconds_total` | Counter | - | Time spent ingesting forensic events |
| `ebpfsentinel_ent_forensics_captures_triggered_total` | Counter | `component` | Forensic captures triggered by the alert component that fired them |
| `ebpfsentinel_ent_forensics_captures_completed_total` | Counter | - | Forensic captures that completed |
| `ebpfsentinel_ent_forensics_captures_failed_total` | Counter | - | Forensic captures that failed |
| `ebpfsentinel_ent_forensics_captures_expired_total` | Counter | - | Forensic captures removed by the retention sweep |

### Compliance reporting

Report generation and control results per framework.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_compliance_reports_generated_total` | Counter | `framework` | Compliance reports generated by framework |
| `ebpfsentinel_ent_compliance_controls_passing` | Gauge | `framework` | Passing compliance controls by framework |
| `ebpfsentinel_ent_compliance_controls_failing` | Gauge | `framework` | Failing compliance controls by framework |
| `ebpfsentinel_ent_compliance_reports_stored` | Gauge | - | Total compliance reports stored |

### Analytics

Event ingest, trend reports, top talkers and flow queries.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_analytics_events_ingested_total` | Counter | `event_type` | Analytics events ingested by type |
| `ebpfsentinel_ent_analytics_trends_generated_total` | Counter | - | Analytics trend reports generated |
| `ebpfsentinel_ent_analytics_top_talkers` | Gauge | - | Number of tracked top-talkers |
| `ebpfsentinel_ent_analytics_events_buffered` | Gauge | - | Events in analytics buffer |
| `ebpfsentinel_ent_analytics_flow_queries_total` | Counter | - | Flow queries executed against the analytics store |

### ML anomaly detection

Baseline learning, streaming detectors and the Random Cut Forest.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_ml_anomalies_detected_total` | Counter | `severity` | ML anomalies detected by severity |
| `ebpfsentinel_ent_ml_suggestions_generated_total` | Counter | - | ML rule suggestions generated |
| `ebpfsentinel_ent_ml_feedback_submitted_total` | Counter | `label` | ML feedback submitted by label |
| `ebpfsentinel_ent_ml_baseline_samples` | Gauge | - | ML baseline sample count |
| `ebpfsentinel_ent_ml_model_loaded` | Gauge | - | Whether an ML model is loaded (0/1) |
| `ebpfsentinel_ent_ml_ewma_anomalies_total` | Counter | - | EWMA streaming anomalies detected |
| `ebpfsentinel_ent_ml_cusum_drifts_total` | Counter | - | CUSUM change-point drifts detected |
| `ebpfsentinel_ent_ml_heavy_hitter_alerts_total` | Counter | - | Heavy-hitter threshold alerts emitted |
| `ebpfsentinel_ent_ml_heavy_hitter_top1_bytes` | Gauge | - | Byte volume of current top-1 heavy hitter |
| `ebpfsentinel_ent_ml_rcf_anomalies_total` | Counter | - | Random Cut Forest anomaly observations recorded |
| `ebpfsentinel_ent_ml_rcf_last_score` | Gauge | - | Most recent Random Cut Forest anomaly score |
| `ebpfsentinel_ent_ml_rcf_trees_count` | Gauge | - | Number of trees in the active Random Cut Forest |
| `ebpfsentinel_ent_ml_rcf_points_inserted_total` | Counter | - | Points inserted into the Random Cut Forest |

### Deep DLP

Hyperscan content scanning and the blocks it triggers.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_dlp_hyperscan_scans_total` | Counter | - | Hyperscan DLP scans performed |
| `ebpfsentinel_ent_dlp_hyperscan_matches_total` | Counter | `pattern_id` | Hyperscan DLP matches by pattern |
| `ebpfsentinel_ent_dlp_blocks_total` | Counter | - | DLP block actions triggered |
| `ebpfsentinel_ent_dlp_patterns_loaded` | Gauge | - | DLP patterns currently loaded |
| `ebpfsentinel_ent_dlp_reloads_total` | Counter | `result` | DLP pattern reload attempts by result |

### Shadow AI and AI DLP

AI provider matching, exfiltration tracking and encrypted-DNS policy.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_ai_providers_loaded` | Gauge | - | Number of loaded AI provider entries |
| `ebpfsentinel_ent_ai_provider_matches_total` | Counter | `provider` | AI provider domain matches |
| `ebpfsentinel_ent_ai_shadow_detections_total` | Counter | `provider`, `action` | Shadow AI detections by provider and action |
| `ebpfsentinel_ent_ai_shadow_bytes_total` | Counter | `provider` | Bytes sent to AI providers (shadow AI) |
| `ebpfsentinel_ent_ai_dlp_scans_total` | Counter | - | AI DLP scans performed |
| `ebpfsentinel_ent_ai_dlp_matches_total` | Counter | `pattern_id` | AI DLP pattern matches |
| `ebpfsentinel_ent_ai_dlp_blocks_total` | Counter | - | AI DLP block actions |
| `ebpfsentinel_ent_ai_exfil_detections_total` | Counter | `detection_type` | AI exfiltration detections by type |
| `ebpfsentinel_ent_ai_exfil_bytes_total` | Counter | `provider` | Bytes tracked for AI exfiltration |
| `ebpfsentinel_ent_ai_enc_dns_detections_total` | Counter | `resolver`, `action` | Encrypted DNS policy detections |
| `ebpfsentinel_ent_ai_enc_dns_bypassed_total` | Counter | - | Encrypted DNS policy bypasses |

### DNS and beaconing detection

Domain-generation, tunnelling and C2 beaconing detectors.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_dns_dga_detected_total` | Counter | - | DGA-generated domains detected |
| `ebpfsentinel_ent_dns_tunneling_detected_total` | Counter | - | DNS tunneling domains detected |
| `ebpfsentinel_ent_beaconing_detected_total` | Counter | - | C2 beaconing suspects detected |

### L7 inspection and policy

Vectorscan pattern matching, per-protocol policy decisions and the analysis pipeline.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_l7_inspect_patterns_loaded` | Gauge | - | Number of Vectorscan patterns currently compiled in the L7 inspect engine |
| `ebpfsentinel_ent_l7_inspect_matches_total` | Counter | `category` | Vectorscan L7 pattern matches by category |
| `ebpfsentinel_ent_l7_inspect_scans_total` | Counter | - | Total L7 inspection scans (hits + misses) |
| `ebpfsentinel_ent_l7_policy_decisions_total` | Counter | `protocol`, `outcome` | Per-protocol L7 policy decisions by protocol and outcome |
| `ebpfsentinel_ent_l7_policy_violations_total` | Counter | `code` | L7 policy violations by machine-readable code |
| `ebpfsentinel_ent_l7_policy_rules_loaded` | Gauge | `protocol` | Number of rules currently loaded per L7 policy engine |
| `ebpfsentinel_ent_l7_enrichments_produced_total` | Counter | `source`, `technique` | L7 alert enrichments emitted by source detector and MITRE technique |
| `ebpfsentinel_ent_l7_analyze_requests_total` | Counter | `protocol` | Requests to the L7 `/analyze` admin pipeline by protocol |
| `ebpfsentinel_ent_l7_analyze_duration_seconds` | Gauge | - | Most recent `/analyze` pipeline duration in seconds |

### TLS interception proxy

The inspecting proxy and the internal CA issuing its certificates.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_tls_connections_intercepted_total` | Counter | - | TLS connections intercepted |
| `ebpfsentinel_ent_tls_connections_bypassed_total` | Counter | - | TLS connections bypassed |
| `ebpfsentinel_ent_tls_certs_generated_total` | Counter | - | TLS certificates generated by internal CA |
| `ebpfsentinel_ent_tls_active_connections` | Gauge | - | Active TLS proxy connections |

### TLS intelligence

Fingerprint tracking, threat matching, crypto policy and the behavioural models.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_tls_intel_threat_entries_loaded` | Gauge | - | Number of loaded TLS threat entries |
| `ebpfsentinel_ent_tls_intel_threat_matches_total` | Counter | `category` | TLS threat matches by category |
| `ebpfsentinel_ent_tls_intel_fingerprints_tracked` | Gauge | - | Number of tracked TLS fingerprints |
| `ebpfsentinel_ent_tls_intel_anomalies_detected_total` | Counter | - | TLS behavior anomalies detected |
| `ebpfsentinel_ent_tls_intel_pqc_connections_total` | Counter | `status` | PQC connections by status |
| `ebpfsentinel_ent_tls_intel_pqc_compliance_ratio` | Gauge | - | PQC compliance ratio (0-100) |
| `ebpfsentinel_ent_tls_intel_crypto_violations_total` | Counter | `violation_type` | Crypto policy violations by type |
| `ebpfsentinel_ent_tls_intel_weak_protocol_seen_total` | Counter | - | Weak TLS protocol versions seen |
| `ebpfsentinel_ent_tls_intel_events_processed_total` | Counter | - | TLS intelligence events processed |
| `ebpfsentinel_ent_tls_intel_allowlist_skipped_total` | Counter | - | TLS threat matches skipped due to allowlist |
| `ebpfsentinel_ent_tls_intel_clustering_outliers_total` | Counter | - | TLS fingerprint clustering outliers detected |
| `ebpfsentinel_ent_tls_intel_cipher_downgrades_total` | Counter | - | Cipher suite or protocol version downgrades detected |
| `ebpfsentinel_ent_tls_intel_sni_cert_mismatches_total` | Counter | - | Connections whose SNI did not match the presented certificate |
| `ebpfsentinel_ent_tls_intel_session_resume_anomalies_total` | Counter | - | Session resumption anomalies detected |
| `ebpfsentinel_ent_tls_intel_ml_inferences_total` | Counter | - | TLS behavioural model inferences run |
| `ebpfsentinel_ent_tls_intel_ml_anomalies_total` | Counter | - | TLS behavioural model anomalies detected |
| `ebpfsentinel_ent_tls_intel_peer_group_anomalies_total` | Counter | - | Peer-group rarity anomalies detected |
| `ebpfsentinel_ent_tls_intel_peer_groups_tracked` | Gauge | - | Peer groups currently tracked |

### Extended TLS probes

The uprobe scanner attaching to userspace TLS libraries.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_tls_probes_binaries_discovered_total` | Counter | `library` | Binaries discovered by the extended TLS probe scanner, labelled by TLS library |
| `ebpfsentinel_ent_tls_probes_attached_total` | Counter | `library` | Extended TLS probes successfully attached, labelled by TLS library |
| `ebpfsentinel_ent_tls_probes_attach_failures_total` | Counter | `library`, `reason` | Extended TLS probe attach failures, labelled by library and reason |
| `ebpfsentinel_ent_tls_probes_binaries_tracked` | Gauge | `library` | Unique binaries currently tracked per TLS library |
| `ebpfsentinel_ent_tls_probes_scan_duration_seconds` | Gauge | - | Most recent extended TLS probe scan duration in seconds |
| `ebpfsentinel_ent_tls_probes_scan_warnings_total` | Counter | `library` | Warnings emitted during extended TLS probe scans, labelled by category |

The scanner itself is documented with the feature in
[Enterprise DLP](../features/enterprise/dlp.md).

### Air-gap

Offline bundle import and the features an air-gapped deployment turns off.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_airgap_bundles_imported_total` | Counter | - | Successful bundle imports |
| `ebpfsentinel_ent_airgap_import_failures_total` | Counter | `reason` | Bundle import failures by reason |
| `ebpfsentinel_ent_airgap_bundles` | Gauge | - | Total bundles imported since startup |
| `ebpfsentinel_ent_airgap_features_disabled` | Gauge | - | Features disabled in air-gap mode |

## Scrape Configuration

### Prometheus

```yaml
scrape_configs:
  - job_name: ebpfsentinel
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 15s

  # The enterprise registry is a second target: it lives on the enterprise API
  # port, and with `auth.enabled: true` the job needs a credential.
  - job_name: ebpfsentinel-enterprise
    scheme: https
    static_configs:
      - targets: ['localhost:8444']
    authorization:
      credentials_file: /etc/prometheus/ebpfsentinel-enterprise.token
    scrape_interval: 15s
```

### Grafana Dashboard

Import Prometheus metrics into Grafana for visualization. Key panels:

- **Traffic overview** - `rate(ebpfsentinel_packets_total[5m])` by action
- **Alert rate** - `rate(ebpfsentinel_alerts_total[5m])` by component and severity
- **Engine latency** - `histogram_quantile(0.99, rate(ebpfsentinel_packet_processing_duration_seconds_bucket[5m]))`
- **DDoS attacks** - `ebpfsentinel_ddos_attacks_active` and `rate(ebpfsentinel_ddos_attacks_detected_total[5m])`
- **DDoS drops** - `rate(ebpfsentinel_packets_total{interface="DDOS_METRICS",action="syn_flood_drops"}[5m])`
- **Blacklist size** - `ebpfsentinel_ips_blacklist_size`
- **DNS cache** - `ebpfsentinel_dns_cache_entries`
- **QoS shaping** - `rate(ebpfsentinel_packets_total{interface="QOS_METRICS",action="shaped"}[5m])` vs `action="dropped_queue"`
- **System health** - memory, CPU, eBPF program status

## Keeping this page honest

Every `ebpfsentinel_*` token in this documentation tree is checked against the
two registries by `npm run check:metrics`, which reads the registered families
out of the OSS agent source and the enterprise agent source and fails on a
name neither one exposes. It runs in both directions: a family that either
registry exposes and no page names fails the check as well, so this page is
the registry rather than a subset of it somebody remembered to write down.

Names that belong to a third binary (the dashboard server) or that are quoted
here only as a retired series are listed with their source in
`scripts/known-metrics.json`. An entry in that list that no page names fails
the check too, so the exception register shrinks rather than accumulates.

The check runs on every pull request against a fresh checkout of both agents,
so a family renamed in either one breaks this page's build rather than a
Grafana panel somebody opens a month later.
