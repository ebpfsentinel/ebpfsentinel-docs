# Monitoring

## Prometheus Metrics

The agent serves `/metrics` on a dedicated listener bound to `agent.metrics_port`
(default `9090`), so the metrics port can be scraped while the control-API port
(`agent.http_port`, default `8080`) is firewalled. `/metrics` is also reachable
on the API port. Both answer under the same rate limit, and when authentication
is enabled both require a token unless `auth.metrics_auth_required` is `false`
(it defaults to `true`). See [Prometheus Metrics](../api-reference/prometheus-metrics.md)
for the full catalog.

An Enterprise deployment scrapes one port instead of two. That binary opens a
single listener (`8444` by default), builds the datapath itself and never
starts `9090` or `8080`, so its `/metrics` serves the datapath's own
`ebpfsentinel_` series alongside the `ebpfsentinel_ent_` ones and every query
on this page answers there unchanged. Point the scrape at `8444` and drop the
other two targets.

### Scrape Configuration

```yaml
scrape_configs:
  - job_name: ebpfsentinel
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 15s
    # Authentication is on by default and `auth.metrics_auth_required` is
    # `true`, so a scrape carries the key unless that is turned off:
    authorization:
      credentials_file: /etc/prometheus/ebpfsentinel.token
```

Write that file from the key the agent kept:

```bash
sudo install -m 0600 -o prometheus -g prometheus \
  /var/lib/ebpfsentinel/auth/api-key /etc/prometheus/ebpfsentinel.token
```

A key the agent drew for itself is one no scraper outside the host can read,
which is why the Helm chart ships `metrics.authRequired: false` and leaves the
counters open on the metrics port while the control plane stays shut. Setting
`metrics.authRequired: true` there requires `auth.existingSecret`, and the
ServiceMonitor then presents that Secret.

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
          description: >-
            Only a program the configuration asks for has a series here, so
            zero is a load this agent wanted and did not get rather than a
            feature somebody turned off.

      - alert: EbpfAttachBlocked
        expr: ebpfsentinel_ebpf_attach_blocked > 0
        for: 1m
        annotations:
          summary: "eBPF programs loaded but attached nowhere"
          description: >-
            A program that loaded and was then refused an attachment leaves the
            agent running and reporting zeros while watching nothing, which the
            load gauge above cannot tell you.

      - alert: XdpFellBackToGeneric
        expr: ebpfsentinel_xdp_attach_mode{mode="generic"} == 1
        for: 15m
        annotations:
          summary: "XDP running in generic mode on {{ $labels.interface }}"
          description: >-
            The mode the kernel granted rather than the one that was configured.
            Generic mode works everywhere and costs an order of magnitude
            against native, so a driver that refused native is worth knowing
            about before a throughput figure is disputed.

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
collector. This exports the OTLP **Logs** signal only - one alert per OTLP log
record, carrying `timeUnixNano` and `observedTimeUnixNano` (both nanoseconds
since the Unix epoch), a `severityNumber` and `severityText` pair, the alert JSON
as the body, and the MITRE technique, component and rule id as attributes. It is
**not** a traces or metrics pipeline; agent metrics stay on `/metrics`, and a
trace store has nothing to receive from this agent.

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
no delivery confirmation). Each record the batch queue accepts increments
`ebpfsentinel_alerts_exported_total{destination="otlp"}`.

That series counts acceptance rather than delivery, and the difference is
deliberate: acceptance is an HTTP 2xx for a webhook and an SMTP hand-over for an
email, which are the moment the destination stops being able to refuse, but for
a batched exporter it is only a place in the queue. What the collector did with
the batch afterwards is reported by
`ebpfsentinel_alerts_export_failures_total{destination="otlp"}`, which counts one
per batch a flush could not deliver - a batched exporter cannot say which alerts
were in the batch it lost. The same series carries `destination="webhook"` and
`destination="email"`, where it counts one per alert the sender gave up on after
its retries, so a collector outage and a webhook outage are read the same way.

A route naming a destination the agent was never configured to build delivers
nothing at all, and that is counted as
`ebpfsentinel_alerts_dropped_total{reason="no_sender"}` rather than passing
silently. An `otlp` route never reaches that counter: a route naming it with no
`alerting.otlp` block is refused at boot, and an exporter that could not be built
fails the boot too.

> **Note:** the Enterprise edition additionally ships an OTLP **SIEM exporter**
> (one of the SIEM destinations) that posts OTLP/HTTP JSON to `{endpoint}/v1/logs`
> with a durable buffer, circuit breaker and retry/backoff. See
> [Enterprise configuration](../configuration/enterprise.md). The OSS export
> above is the lightweight, best-effort alert sink.

## Structured Logging

JSON logs on stdout by default, one object per line, with the event's fields
flattened beside the message and the `service` span (name and version) attached:

```json
{"timestamp":"2026-02-19T10:00:00.000000Z","level":"INFO","message":"eBPFsentinel agent starting","config_path":"/etc/ebpfsentinel/config.yaml","log_level":"info","log_format":"json","xdp_mode":"auto","interfaces":"[\"eth0\"]","target":"ebpfsentinel_agent::startup","span":{"service.name":"ebpfsentinel","service.version":"...","name":"service"},"spans":[...]}
```

Switch to human-readable output with `--log-format text` or `agent.log_format: text`.

`RUST_LOG`, when set, replaces the configured level with a per-module filter:
`RUST_LOG=info,application=debug,adapters::http=trace`.

## Health Checks

```bash
# Liveness
curl http://localhost:8080/healthz

# Readiness: 200 when the eBPF programs are loaded, no kernel helper they
# need is missing and no attachment was refused; 503 otherwise, with the
# reason in the body (ebpf_loaded, kernel_helpers_missing, attach_blocked)
curl http://localhost:8080/readyz

# Full status
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" http://localhost:8080/api/v1/agent/status
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
