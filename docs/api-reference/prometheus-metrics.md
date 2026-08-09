# Prometheus Metrics

Scrape from `:9090/metrics` (or `:8080/metrics` if a separate metrics port is not configured).

## Metrics Catalog

### Packet Processing

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_packets_total` | Counter | `interface`, `action` | Packets processed (pass, drop, log, rate_limited) |
| `ebpfsentinel_bytes_processed_total` | Counter | `interface`, `direction` | Bytes processed per interface |
| `ebpfsentinel_packet_processing_duration_seconds` | Histogram | `program` | Per-program packet processing latency |

### Rules

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_rules_loaded` | Gauge | `domain` | Loaded rule count per domain |

### Alerts

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_alerts_total` | Counter | `component`, `severity` | Total alerts generated |
| `ebpfsentinel_alerts_dropped_total` | Counter | `reason` | Alerts dropped before delivery (dedup, throttle, backpressure) |
| `ebpfsentinel_alerts_exported_total` | Counter | `destination` | Alerts handed off to an external sender (e.g. `otlp`) |
| `ebpfsentinel_alert_sender_circuit_state` | Gauge | `destination` | Alert sender circuit breaker state (0=closed, 1=half-open, 2=open) |
| `ebpfsentinel_alerts_sse_subscribers` | Gauge | — | Live SSE alert-stream subscriber count |
| `ebpfsentinel_threshold_suppressed_total` | Counter | `component`, `rule_id` | Alerts suppressed by threshold |
| `ebpfsentinel_events_sampled_total` | Counter | `component` | Events skipped by sampling |

### DDoS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ddos_attacks_active` | Gauge | — | Currently active attack mitigations |
| `ebpfsentinel_ddos_attacks_total` | Counter | `attack_type` | Total attacks detected by type |
| `ebpfsentinel_ddos_blocked_total` | Counter | — | Total packets blocked by DDoS policies |
| `ebpfsentinel_ddos_syn_received_total` | Counter | — | SYN packets observed (eBPF) |
| `ebpfsentinel_ddos_syn_flood_drops_total` | Counter | — | SYN flood packets dropped (eBPF) |
| `ebpfsentinel_ddos_icmp_dropped_total` | Counter | — | ICMP packets dropped (eBPF) |
| `ebpfsentinel_ddos_amp_dropped_total` | Counter | — | Amplification packets dropped (eBPF) |
| `ebpfsentinel_ddos_half_open_drops_total` | Counter | — | Half-open connection limit drops (eBPF) |
| `ebpfsentinel_ddos_rst_flood_drops_total` | Counter | — | RST flood drops (eBPF) |
| `ebpfsentinel_ddos_fin_flood_drops_total` | Counter | — | FIN flood drops (eBPF) |
| `ebpfsentinel_ddos_ack_flood_drops_total` | Counter | — | ACK flood drops (eBPF) |
| `ebpfsentinel_ddos_syncookie_sent_total` | Counter | — | SYN cookies forged and sent via XDP_TX (eBPF) |
| `ebpfsentinel_ddos_syncookie_valid_total` | Counter | — | Valid SYN cookie ACKs received (eBPF) |
| `ebpfsentinel_ddos_syncookie_invalid_total` | Counter | — | Invalid SYN cookie ACKs rejected (eBPF) |

### Firewall

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_firewall_rejected_total` | Counter | — | Packets rejected with TCP RST or ICMP unreachable via XDP_TX |
| `ebpfsentinel_firewall_reject_throttled_total` | Counter | — | Reject replies suppressed (dropped, not forged) by the per-source reflection rate limit |

### Scrub

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_scrub_tcp_flags_scrubbed_total` | Counter | — | TCP reserved/NS/CWR/ECE bits cleared |
| `ebpfsentinel_scrub_ecn_stripped_total` | Counter | — | ECN bits stripped from IP TOS/Traffic Class |
| `ebpfsentinel_scrub_tos_normalized_total` | Counter | — | TOS/DSCP bytes normalized to configured value |
| `ebpfsentinel_scrub_tcp_ts_stripped_total` | Counter | — | TCP timestamp options removed |

### NAT

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_nptv6_translated_total` | Counter | `direction` | Packets translated by NPTv6 prefix rewriting (ingress/egress) |

### IPS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ips_blacklist_size` | Gauge | — | Current blacklist entry count |

### Load Balancer

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_packets_total` | Counter | `domain="loadbalancer"`, `action` | LB packets (forward, no_backend) |
| `ebpfsentinel_lb_vip_arp_replies_total` | Gauge | `vip` | Forged ARP replies per VIP (L2 VIP announcer, speaker only) |
| `ebpfsentinel_lb_vip_takeovers_total` | Counter | `vip` | Gratuitous-ARP takeovers per VIP (L2 VIP announcer) |

### GeoIP

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_geoip_lookups_total` | Counter | `result` (`hit`/`miss`) | Total GeoIP database lookups, by resolution outcome |
| `ebpfsentinel_geoip_ready` | Gauge | — | Database readiness (1=loaded, 0=not) |

### DNS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_dns_cache_entries` | Gauge | — | Current DNS cache entry count |
| `ebpfsentinel_dns_cache_hits_total` | Counter | — | DNS cache hits |
| `ebpfsentinel_dns_cache_evictions_total` | Counter | — | DNS cache entries evicted |
| `ebpfsentinel_dns_queries_total` | Counter | — | DNS queries observed |
| `ebpfsentinel_dns_blocked_total` | Counter | — | Domains blocked by blocklist |
| `ebpfsentinel_domain_reputation_tracked` | Gauge | — | Domains with reputation scores |

### QoS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_qos_total_seen` | Counter | — | Total packets evaluated by the QoS classifier |
| `ebpfsentinel_qos_shaped_total` | Counter | — | Packets successfully shaped (passed token bucket) |
| `ebpfsentinel_qos_dropped_loss_total` | Counter | — | Packets dropped by random loss emulation |
| `ebpfsentinel_qos_dropped_queue_total` | Counter | — | Packets dropped by token bucket exhaustion |
| `ebpfsentinel_qos_delayed_total` | Counter | — | Packets with delay applied |
| `ebpfsentinel_qos_errors_total` | Counter | — | QoS processing errors |
| `ebpfsentinel_qos_events_dropped_total` | Counter | — | RingBuf events dropped due to backpressure |
| `ebpfsentinel_rules_loaded` | Gauge | `domain="qos"` | Number of loaded QoS classifiers |

### Zones

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_zone_packets_total` | Counter | `zone`, `action` | Packets decided per zone (`action` is `passed` or `dropped`). `zone="unzoned"` is traffic on interfaces no zone claims |

### System

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_memory_usage_bytes` | Gauge | — | Process RSS memory |
| `ebpfsentinel_cpu_usage_percent` | Gauge | — | Process CPU usage |
| `ebpfsentinel_ebpf_program_status` | Gauge | `program` | eBPF program load status (1=loaded, 0=not) |
| `ebpfsentinel_config_reloads_total` | Counter | `status` | Config reload count (success/failure) |

## Enterprise Metrics

> Scraped from enterprise agent port (default `:8444/metrics`). Prefix: `ebpfsentinel_ent_`.
> With `auth.enabled: true` this endpoint needs a credential like the rest of
> the enterprise port: give the scrape job an `authorization` or an
> `X-API-Key` header, otherwise it gets `401`.

### Fleet Management

| Metric | Type | Description |
|--------|------|-------------|
| `ebpfsentinel_ent_fleet_registrations` | Counter | Agent registrations processed |
| `ebpfsentinel_ent_fleet_heartbeats` | Counter | Agent heartbeats received |
| `ebpfsentinel_ent_fleet_identity_queries` | Counter | Identity queries served |
| `ebpfsentinel_ent_fleet_config_version_queries` | Counter | Config version queries served |
| `ebpfsentinel_ent_fleet_flow_graph_queries` | Counter | Flow graph queries served |

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

- **Traffic overview** — `rate(ebpfsentinel_packets_total[5m])` by action
- **Alert rate** — `rate(ebpfsentinel_alerts_total[5m])` by component and severity
- **Engine latency** — `histogram_quantile(0.99, rate(ebpfsentinel_packet_processing_duration_seconds_bucket[5m]))`
- **DDoS attacks** — `ebpfsentinel_ddos_attacks_active` and `rate(ebpfsentinel_ddos_attacks_total[5m])`
- **Blacklist size** — `ebpfsentinel_ips_blacklist_size`
- **DNS cache** — `ebpfsentinel_dns_cache_entries`
- **QoS shaping** — `rate(ebpfsentinel_qos_shaped_total[5m])` vs `rate(ebpfsentinel_qos_dropped_queue_total[5m])`
- **System health** — memory, CPU, eBPF program status
