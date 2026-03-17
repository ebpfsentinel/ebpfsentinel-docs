# Advanced Analytics

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Traffic analytics and trend analysis beyond real-time alerting. Ingests events from all security domains (firewall, IDS/IPS, DLP, DNS, DDoS, NAT, load balancer, conntrack), aggregates them at minute granularity, and provides top talker identification, alert summaries, IOC hit tracking, period-over-period deltas, and statistical trend detection with anomaly flagging.

## Architecture

```
Security Events (all domains)
  └── AnalyticsEngine (in-memory accumulators)
        ├── TrafficAccumulator (bytes, packets, connections, IPs, ports, protocols)
        ├── AlertAccumulator (by severity, by component)
        └── IocAccumulator (by threat type)
              │
              ▼ flush every 60s
        RedbAnalyticsStore (minute-level persistence)
              │
              ├── Re-aggregate on query (Minute → Hour → Day)
              ├── Top Talkers + Period Deltas
              ├── Alert/IOC Summaries
              └── Trend Analysis (Welford's algorithm, 2σ anomaly detection)
                    └── Daily auto-generated reports (up to 30 cached)
```

## Event Ingestion

### Sources

Events are ingested from all eBPFsentinel security domains via component-specific methods:

| Method | Source | Event Types |
|--------|--------|-------------|
| `ingest_firewall_event` | Firewall | Traffic + alert |
| `ingest_ratelimit_event` | Rate limiter | Traffic + alert (medium severity) |
| `ingest_ddos_event` | Anti-DDoS | High severity alert (`ddos:{attack_type}`) |
| `ingest_dlp_event` | DLP | Alert (`dlp:{pattern_type}`) |
| `ingest_dns_event` | DNS intelligence | DNS query/block event (port 53) |
| `ingest_nat_event` | NAT | Alert (`nat:{nat_type}`) |
| `ingest_lb_event` | Load balancer | Traffic (`lb:{service_id}`) |
| `ingest_conntrack_event` | Connection tracking | Traffic |
| `ingest_scrub_event` | Packet scrubbing | Traffic |

### Cross-Feature Integration

- **SIEM events** — `ingest_from_siem_event()` decomposes a `SiemEvent` into traffic, alert, IOC, DDoS, DLP, and DNS sub-events based on metadata fields
- **Federated alerts** — `ingest_from_federated_alert()` ingests alerts from member clusters in a multi-cluster deployment

## Time Buckets

All raw events are stored at minute granularity and re-aggregated on-demand:

| Bucket | Duration | Use Case |
|--------|----------|----------|
| `Minute` | 60s | Raw storage, real-time queries |
| `Hour` | 3,600s | Medium-range queries |
| `Day` | 86,400s | Trend analysis, long-range queries |

Timestamps are aligned to bucket boundaries (e.g., minute events are truncated to the start of each minute).

## Traffic Metrics

Each minute-level `TrafficAggregate` captures:

| Field | Description |
|-------|-------------|
| `total_bytes` | Total bytes observed |
| `total_packets` | Total packets observed |
| `connection_count` | Unique connections (hash-deduplicated) |
| `top_src_ips` | Top source IPs by volume (up to 50) |
| `top_dst_ports` | Top destination ports by volume (up to 50) |
| `protocol_distribution` | Packet counts by protocol (TCP, UDP, ICMP, etc.) |

Top entries are capped at **50 per bucket** (`MAX_TOP_ENTRIES`) to preserve accuracy during cross-bucket merging.

## Top Talkers

`GET /api/v1/analytics/top-talkers?period=24h&limit=20`

Returns top source IPs, destination ports, and protocol distribution for the requested period, along with **period-over-period deltas** comparing the current period to the previous period of equal length.

Delta fields:

| Field | Description |
|-------|-------------|
| `bytes_delta` | Byte count change (current - previous) |
| `packets_delta` | Packet count change |
| `connections_delta` | Connection count change |
| `bytes_pct_change` | Percentage change in bytes |

## Alert Summary

`GET /api/v1/analytics/alerts?period=24h`

Aggregated alert counts broken down by:

- **Severity** — low, medium, high, critical
- **Component** — firewall, ids, ips, dlp, dns, ddos, nat, lb, ratelimit, conntrack, scrub, etc.

## IOC Summary

`GET /api/v1/analytics/ioc?period=24h`

Threat intelligence indicator hit counts broken down by threat type.

## Trend Analysis

`GET /api/v1/analytics/trends?period=30d` (minimum 7 days)

Statistical trend analysis using **Welford's online algorithm** for numerically stable mean and standard deviation computation.

### Analyzed Metrics

| Category | Metrics |
|----------|---------|
| Traffic | `total_bytes`, `total_packets`, `connection_count` |
| Alerts | `total_alerts`, per-severity counts |
| IOC | `ioc_hits` |

### Analysis Per Metric

| Field | Description |
|-------|-------------|
| `mean` | Average value across the period |
| `std_dev` | Standard deviation |
| `anomalous` | `true` if latest value is outside mean ± 2σ |
| `trend_direction` | `increasing`, `decreasing`, or `stable` |
| `pct_change` | Percentage change from first to last data point |

**Trend direction** is determined by comparing the first-half average to the second-half average:
- \>10% increase → `increasing`
- \>10% decrease → `decreasing`
- Otherwise → `stable`

**Anomaly detection** uses the 2-sigma rule: a data point is anomalous if it falls more than 2 standard deviations from the mean.

### Automatic Report Generation

A background flush loop runs continuously:
- **Every 60 seconds** — flush in-memory accumulators to persistent storage
- **Every 24 hours** — auto-generate a 7-day trend report and cache it

Up to **30 daily reports** are retained in memory and accessible via the history endpoint.

## Export Formats

Trend reports are available in three formats:

| Format | Endpoint | Content-Type | Description |
|--------|----------|--------------|-------------|
| JSON | `/api/v1/analytics/trends` | `application/json` | Full structured report |
| CSV | `/api/v1/analytics/trends/csv` | `text/csv` | Columns: category, metric, timestamp_ms, value, mean, std_dev, anomalous, direction, pct_change |
| Text | `/api/v1/analytics/trends/text` | `text/plain` | Human-readable sections for traffic, alert, and IOC trends |

## Persistence

Analytics data is stored in **redb** (embedded key-value store) with three tables:

| Table | Key Format | Value |
|-------|-----------|-------|
| `analytics_traffic` | `{bucket}:{timestamp_ms:020}` | JSON-serialized `TrafficAggregate` |
| `analytics_alerts` | `{bucket}:{timestamp_ms:020}` | JSON-serialized `AlertAggregate` |
| `analytics_ioc` | `{bucket}:{timestamp_ms:020}` | JSON-serialized `ThreatIntelAggregate` |

Keys are zero-padded for lexicographic ordering, enabling efficient range queries. Retention cleanup runs during each flush cycle, deleting all entries older than `retention_days`.

## Query Parameters

All query endpoints accept a `period` parameter:

| Format | Example | Description |
|--------|---------|-------------|
| Hours | `1h`, `6h`, `24h` | Short-range queries |
| Days | `7d`, `30d` | Long-range queries |

Default period is `24h`. The `top-talkers` endpoint also accepts a `limit` parameter (default: 20).

Trend endpoints require a minimum period of **7 days**.

## Pipeline Status

`GET /api/v1/analytics/status`

| Field | Description |
|-------|-------------|
| `enabled` | Whether analytics is active |
| `events_ingested` | Lifetime event counter |
| `last_flush_ms` | Timestamp of last successful flush |
| `retention_days` | Configured retention window |

## Configuration

```yaml
enterprise:
  analytics:
    enabled: true
    retention_days: 30
    data_dir: /var/lib/ebpfsentinel/analytics
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Enable analytics pipeline |
| `retention_days` | u32 | `30` | Days to retain analytics data |
| `data_dir` | string | `/var/lib/ebpfsentinel/analytics` | Directory for redb database |

## REST API

| Method | Endpoint | Query Params | Description |
|--------|----------|-------------|-------------|
| `GET` | `/api/v1/analytics/top-talkers` | `period` (default 24h), `limit` (default 20) | Top talkers with period-over-period deltas |
| `GET` | `/api/v1/analytics/alerts` | `period` (default 24h) | Alert summary by severity and component |
| `GET` | `/api/v1/analytics/ioc` | `period` (default 24h) | IOC hit summary by threat type |
| `GET` | `/api/v1/analytics/status` | — | Pipeline status |
| `GET` | `/api/v1/analytics/trends` | `period` (min 7d) | Trend report (JSON) |
| `GET` | `/api/v1/analytics/trends/csv` | `period` (min 7d) | Trend report (CSV) |
| `GET` | `/api/v1/analytics/trends/text` | `period` (min 7d) | Trend report (text) |
| `GET` | `/api/v1/analytics/trends/history` | — | Cached daily trend reports (up to 30) |

## Feature Gating

Advanced Analytics requires a valid license with the `advanced-analytics` feature. Without a license, use Prometheus metrics with Grafana for traffic analysis.
