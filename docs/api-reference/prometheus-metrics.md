# Prometheus Metrics

Scrape from `:9090/metrics` (or `:8080/metrics` if a separate metrics port is not configured).

## How to read this page

Every family below is registered by the agent. Two encoding rules decide the
name you actually query:

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
| `ebpfsentinel_alerts_dropped_total` | Counter | `reason` | Alerts dropped before delivery. `reason="dedup"` is a repeat inside the dedup window, `reason="throttle"` is the per-component rate limit |
| `ebpfsentinel_alerts_exported_total` | Counter | `destination` | Alerts handed off to an external sender (e.g. `otlp`) |
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

> Scraped from enterprise agent port (default `:8444/metrics`). Prefix: `ebpfsentinel_ent_`.
> With `auth.enabled: true` this endpoint needs a credential like the rest of
> the enterprise port: give the scrape job an `authorization` or an
> `X-API-Key` header, otherwise it gets `401`.

Everything under `ebpfsentinel_ent_` requires an Enterprise licence. An OSS
agent exposes none of it, so a panel mixing the two prefixes goes blank on an
OSS install rather than reading zero.

### Fleet Management

| Metric | Type | Description |
|--------|------|-------------|
| `ebpfsentinel_ent_fleet_registrations_total` | Counter | Agent registrations processed |
| `ebpfsentinel_ent_fleet_heartbeats_total` | Counter | Agent heartbeats received |
| `ebpfsentinel_ent_fleet_identity_queries_total` | Counter | Identity queries served |
| `ebpfsentinel_ent_fleet_config_version_queries_total` | Counter | Config version queries served |
| `ebpfsentinel_ent_fleet_flow_graph_queries_total` | Counter | Flow graph queries served |

### Multi-Tenancy

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ent_tenant_total` | Gauge | - | Configured tenants |
| `ebpfsentinel_ent_tenant_quota_usage_ratio` | Gauge | `tenant`, `resource` | Quota usage as a fraction of the limit (0.0 to 1.0) |
| `ebpfsentinel_ent_tenant_quota_exceeded_total` | Counter | `tenant`, `resource` | Requests refused because a quota was already at its limit |

There is no gauge carrying the configured limit itself. Usage is published as
a ratio so a panel needs no second series to be readable, and the limit is
read from `GET /api/v1/tenants/{id}/quota`.

### Extended TLS Probes

Documented with the feature in
[Enterprise DLP](../features/enterprise/dlp.md).

## Scrape Configuration

### Prometheus

```yaml
scrape_configs:
  - job_name: ebpfsentinel
    static_configs:
      - targets: ['localhost:9090']
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
agent's own registry by `npm run check:metrics`, which reads the registered
families out of the agent source and fails on a name nothing exposes. Names
that belong to another binary (the enterprise agent, the dashboard server) or
that are quoted here only as a retired series are listed with their source in
`scripts/known-metrics.json`. An entry in that list that no page names fails
the check as well, so the exception register shrinks rather than accumulates.

The check runs on every pull request against a fresh checkout of the agent, so
a family renamed there breaks this page's build rather than a Grafana panel
somebody opens a month later.
