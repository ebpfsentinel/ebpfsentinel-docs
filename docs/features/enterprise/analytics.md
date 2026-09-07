# Advanced Analytics

> **Edition: Enterprise**

## Overview

Traffic analytics and trend analysis beyond real-time alerting. What it measures is the alerts the agent raises: every event reaching the pipeline arrives as an alert, from the local SIEM event stream, from the tenant alert stream or from a member cluster in a federated deployment. There is no direct datapath feed, so a packet that matches no rule is counted nowhere here - use Prometheus metrics for total traffic volume. The pipeline aggregates what it does receive at minute granularity and provides top talker identification, alert summaries, IOC hit tracking, period-over-period deltas, and statistical trend detection with anomaly flagging.

Alerts carry no packet length, so **no byte figure is reported anywhere in this feature**. Counts are packets and connections: `total_packets` is one per alert-bearing packet observed.

## Architecture

```
Security Events (all domains)
  └── AnalyticsEngine (in-memory accumulators)
        ├── TrafficAccumulator (packets, connections, IPs, ports, protocols)
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

Three feeds run in the agent, and they are the whole of what the pipeline sees:

| Feed | What it carries |
|------|-----------------|
| Local SIEM event stream | Every alert the agent raises, whatever the component that raised it: firewall, IDS/IPS, rate limiter, DDoS, DLP, DNS, NAT, load balancer, connection tracking, packet scrubbing |
| Tenant alert stream | Alerts raised inside a tenant in a multi-tenant deployment |
| Federated alert stream | Alerts forwarded by member clusters in a multi-cluster deployment |

A SIEM event is decomposed into its sub-events by the ingestion methods below, chosen from the event's component and metadata:

| Method | Produces |
|--------|----------|
| `ingest_traffic` | Traffic event: source and destination address, ports, protocol |
| `ingest_alert` | Alert counted by severity and component |
| `ingest_ioc_hit` | IOC hit counted by threat type |
| `ingest_ddos_event` | High severity alert (`ddos:{attack_type}`) |
| `ingest_dlp_event` | Alert (`dlp:{pattern_type}`) |
| `ingest_dns_event` | Alert (`dns:query` or `dns:blocked`) |

Every field of a traffic event is optional and an absent field is counted nowhere: a federated alert carries no ports and no protocol, so it contributes to the source-IP ranking and to nothing else. Ports and protocols are never filled with a placeholder, because a placeholder becomes the top entry of its own table.

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
| `total_packets` | Alert-bearing packets observed, one per traffic event |
| `connection_count` | Unique connections (hash-deduplicated) |
| `top_src_ips` | Top source IPs by observed packet count (up to 50) |
| `top_dst_ports` | Top destination ports by observed packet count (up to 50), counting only events that carried a port |
| `protocol_distribution` | Packet counts by protocol (TCP, UDP, ICMP, etc.), counting only events that carried a protocol |

Top entries are capped at **50 per bucket** (`MAX_TOP_ENTRIES`) to preserve accuracy during cross-bucket merging.

## Top Talkers

`GET /api/v1/analytics/top-talkers?period=24h&limit=20`

Returns top source IPs, destination ports, and protocol distribution for the requested period, along with **period-over-period deltas** comparing the current period to the previous period of equal length.

Delta fields:

| Field | Description |
|-------|-------------|
| `packets_delta` | Packet count change (current - previous) |
| `connections_delta` | Connection count change |
| `packets_pct_change` | Percentage change in packet count |

## Alert Summary

`GET /api/v1/analytics/alerts?period=24h`

Aggregated alert counts broken down by:

- **Severity** - low, medium, high, critical
- **Component** - firewall, ids, ips, dlp, dns, ddos, nat, lb, ratelimit, conntrack, scrub, etc.

## IOC Summary

`GET /api/v1/analytics/ioc?period=24h`

Threat intelligence indicator hit counts broken down by threat type.

## Trend Analysis

`GET /api/v1/analytics/trends?period=30d` (minimum 7 days)

Statistical trend analysis using **Welford's online algorithm** for numerically stable mean and standard deviation computation.

### Analyzed Metrics

| Category | Metrics |
|----------|---------|
| Traffic | `total_packets`, `connection_count` |
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
- **Every 60 seconds** - flush in-memory accumulators to persistent storage
- **Every 24 hours** - auto-generate a 7-day trend report and cache it

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

**Flow records are not persisted.** The individual records served by `/api/v1/analytics/flows` are held in memory only, bounded at **100,000 records** with the oldest dropped once the bound is reached, and lost when the agent restarts. Only the minute-level aggregates above survive a restart, so a flow query never reaches further back than the current process.

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
| `events_ingested` | Lifetime event counter |
| `last_flush_ms` | Timestamp of last successful flush |
| `retention_days` | Configured retention window |

There is no `enabled` field: the analytics routes are mounted only when the license carries the `advanced-analytics` feature and `enterprise.analytics.enabled` is `true`, so a reachable status endpoint is itself the answer.

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

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

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/analytics/top-talkers` | viewer | advanced-analytics | Top talkers with period-over-period deltas. Query: `period` (default 24h), `limit` (default 20). |
| `GET` | `/api/v1/analytics/alerts` | viewer | advanced-analytics | Alert summary by severity and component. Query: `period` (default 24h). |
| `GET` | `/api/v1/analytics/ioc` | viewer | advanced-analytics | IOC hit summary by threat type. Query: `period` (default 24h). |
| `GET` | `/api/v1/analytics/flows` | viewer | advanced-analytics | Individual flow records held in memory, newest first. Query: `period` (default 24h), `src_ip`, `dst_ip`, `src_port`, `dst_port`, `protocol`, `severity`, `component`, `limit`, `offset`, `sort_order` (`asc` or `desc`, default `desc`). |
| `GET` | `/api/v1/analytics/status` | viewer | advanced-analytics | Pipeline status. |
| `GET` | `/api/v1/analytics/trends` | viewer | advanced-analytics | Trend report (JSON). Query: `period` (minimum 7d). |
| `GET` | `/api/v1/analytics/trends/csv` | viewer | advanced-analytics | Trend report (CSV). Query: `period` (minimum 7d). |
| `GET` | `/api/v1/analytics/trends/text` | viewer | advanced-analytics | Trend report (text). Query: `period` (minimum 7d). |
| `GET` | `/api/v1/analytics/trends/history` | viewer | advanced-analytics | Cached daily trend reports (up to 30). |

## Feature Gating

Advanced Analytics requires a valid license with the `advanced-analytics` feature. Without a license, use Prometheus metrics with Grafana for traffic analysis.
