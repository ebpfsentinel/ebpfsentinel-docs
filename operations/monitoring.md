# Monitoring

## Prometheus Metrics

Scrape from `:9090/metrics` (or `:8080/metrics`). See [Prometheus Metrics](../api-reference/prometheus-metrics.md) for the full catalog.

### Scrape Configuration

```yaml
scrape_configs:
  - job_name: ebpfsentinel
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 15s
```

### Key Alerts

Example Prometheus alerting rules:

```yaml
groups:
  - name: ebpfsentinel
    rules:
      - alert: HighAlertRate
        expr: rate(ebpfsentinel_alerts_total{severity="critical"}[5m]) > 10
        for: 2m
        annotations:
          summary: "High critical alert rate"

      - alert: EbpfProgramDown
        expr: ebpfsentinel_ebpf_program_status == 0
        for: 1m
        annotations:
          summary: "eBPF program not loaded: {{ $labels.program }}"

      - alert: HighMemoryUsage
        expr: ebpfsentinel_memory_usage_bytes > 1e9
        for: 5m
        annotations:
          summary: "Agent memory exceeds 1 GiB"

      - alert: BlacklistGrowing
        expr: delta(ebpfsentinel_ips_blacklist_size[1h]) > 100
        annotations:
          summary: "IPS blacklist growing rapidly"
```

## Structured Logging

JSON logs by default:

```json
{"timestamp":"2026-02-19T10:00:00Z","level":"INFO","target":"agent","message":"agent started","version":"0.1.0"}
```

Switch to text: `--log-format text`

Per-module filtering: `RUST_LOG=domain=debug,adapters::http=trace`

## Health Checks

```bash
# Liveness
curl http://localhost:8080/healthz

# Readiness (eBPF programs loaded)
curl http://localhost:8080/readyz

# Full status
curl http://localhost:8080/api/v1/agent/status
```

## Grafana Dashboard

Key panels for a Grafana dashboard:

| Panel | Query |
|-------|-------|
| Packets/sec | `rate(ebpfsentinel_packets_total[5m])` |
| Drop rate | `rate(ebpfsentinel_packets_total{verdict="drop"}[5m])` |
| Alert rate | `rate(ebpfsentinel_alerts_total[5m])` by component |
| P99 latency | `histogram_quantile(0.99, rate(ebpfsentinel_processing_duration_seconds_bucket[5m]))` |
| Blacklist size | `ebpfsentinel_ips_blacklist_size` |
| DNS cache | `ebpfsentinel_dns_cache_size` |
| Memory | `ebpfsentinel_memory_usage_bytes` |
| CPU | `ebpfsentinel_cpu_usage_percent` |
