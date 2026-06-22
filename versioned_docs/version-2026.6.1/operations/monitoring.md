# Monitoring

## Prometheus Metrics

The agent serves `/metrics` on a dedicated listener bound to `agent.metrics_port`
(default `9090`), so the metrics port can be scraped while the control-API port
(`agent.http_port`, default `8080`) is firewalled. `/metrics` is also reachable
on the API port. See [Prometheus Metrics](../api-reference/prometheus-metrics.md)
for the full catalog.

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

## OpenTelemetry (OTLP) export

Beyond Prometheus scraping, the agent can **push alerts** to an OpenTelemetry
collector. This exports the OTLP **Logs** signal only — one alert per OTLP log
record (severity, MITRE technique, component, rule id as attributes). It is
**not** a traces or metrics pipeline; agent metrics stay on `/metrics`.

Enable it as an alert destination (see [Alerting](../configuration/alerting.md)):

```yaml
alerting:
  otlp:
    endpoint: "http://otel-collector:4317"
    protocol: "grpc"        # grpc (OTLP/gRPC) or http (OTLP/HTTP-protobuf)
    timeout_ms: 5000
  routes:
    - name: otlp-all
      destination: otlp
```

Delivery is **fire-and-forget** (batched by the OpenTelemetry SDK, no retry and
no delivery confirmation). Each successful hand-off increments
`ebpfsentinel_alerts_exported_total{destination="otlp"}`.

> **Note:** the Enterprise edition additionally ships an OTLP **SIEM exporter**
> (one of the SIEM destinations) that posts OTLP/HTTP JSON to `{endpoint}/v1/logs`
> with a durable buffer, circuit breaker and retry/backoff. See
> [Enterprise configuration](../configuration/enterprise.md). The OSS export
> above is the lightweight, best-effort alert sink.

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
| Drop rate | `rate(ebpfsentinel_packets_total{action="drop"}[5m])` |
| Alert rate | `rate(ebpfsentinel_alerts_total[5m])` by component |
| P99 latency | `histogram_quantile(0.99, rate(ebpfsentinel_packet_processing_duration_seconds_bucket[5m]))` |
| Blacklist size | `ebpfsentinel_ips_blacklist_size` |
| DNS cache | `ebpfsentinel_dns_cache_entries` |
| Memory | `ebpfsentinel_memory_usage_bytes` |
| CPU | `ebpfsentinel_cpu_usage_percent` |
