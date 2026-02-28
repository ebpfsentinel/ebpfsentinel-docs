# Prometheus Metrics

Scrape from `:9090/metrics` (or `:8080/metrics` if a separate metrics port is not configured).

## Metrics Catalog

### Packet Processing

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_packets_total` | Counter | `interface`, `verdict` | Packets processed (pass, drop, log, rate_limited) |
| `ebpfsentinel_bytes_processed_total` | Counter | `interface`, `direction` | Bytes processed per interface |
| `ebpfsentinel_processing_duration_seconds` | Histogram | `domain` | Engine processing latency |

### Rules

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_rules_loaded` | Gauge | `domain` | Loaded rule count per domain |

### Alerts

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_alerts_total` | Counter | `component`, `severity` | Total alerts generated |
| `ebpfsentinel_threshold_suppressed_total` | Counter | `component`, `rule_id` | Alerts suppressed by threshold |
| `ebpfsentinel_events_sampled_total` | Counter | `component` | Events skipped by sampling |

### DDoS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ddos_attacks_active` | Gauge | — | Currently active attack mitigations |
| `ebpfsentinel_ddos_attacks_total` | Counter | `attack_type` | Total attacks detected by type |
| `ebpfsentinel_ddos_blocked_total` | Counter | — | Total packets blocked by DDoS policies |
| `ebpfsentinel_ddos_syn_received_total` | Counter | — | SYN packets observed (eBPF) |
| `ebpfsentinel_ddos_syncookies_sent_total` | Counter | — | SYN cookies issued (eBPF) |
| `ebpfsentinel_ddos_icmp_dropped_total` | Counter | — | ICMP packets dropped (eBPF) |
| `ebpfsentinel_ddos_amp_dropped_total` | Counter | — | Amplification packets dropped (eBPF) |
| `ebpfsentinel_ddos_half_open_drops_total` | Counter | — | Half-open connection limit drops (eBPF) |
| `ebpfsentinel_ddos_rst_flood_drops_total` | Counter | — | RST flood drops (eBPF) |
| `ebpfsentinel_ddos_fin_flood_drops_total` | Counter | — | FIN flood drops (eBPF) |
| `ebpfsentinel_ddos_ack_flood_drops_total` | Counter | — | ACK flood drops (eBPF) |

### IPS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_ips_blacklist_size` | Gauge | — | Current blacklist entry count |

### DNS

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_dns_cache_size` | Gauge | — | Current DNS cache entry count |
| `ebpfsentinel_dns_queries_total` | Counter | — | DNS queries observed |
| `ebpfsentinel_dns_blocked_total` | Counter | — | Domains blocked by blocklist |
| `ebpfsentinel_domain_reputation_tracked` | Gauge | — | Domains with reputation scores |

### System

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `ebpfsentinel_memory_usage_bytes` | Gauge | — | Process RSS memory |
| `ebpfsentinel_cpu_usage_percent` | Gauge | — | Process CPU usage |
| `ebpfsentinel_ebpf_program_status` | Gauge | `program` | eBPF program load status (1=loaded, 0=not) |
| `ebpfsentinel_config_reloads_total` | Counter | `status` | Config reload count (success/failure) |

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

- **Traffic overview** — `rate(ebpfsentinel_packets_total[5m])` by verdict
- **Alert rate** — `rate(ebpfsentinel_alerts_total[5m])` by component and severity
- **Engine latency** — `histogram_quantile(0.99, ebpfsentinel_processing_duration_seconds)`
- **DDoS attacks** — `ebpfsentinel_ddos_attacks_active` and `rate(ebpfsentinel_ddos_attacks_total[5m])`
- **Blacklist size** — `ebpfsentinel_ips_blacklist_size`
- **DNS cache** — `ebpfsentinel_dns_cache_size`
- **System health** — memory, CPU, eBPF program status
