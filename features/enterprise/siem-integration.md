# SIEM Integration

> **Edition: Enterprise** | **Status: Shipped**

## Overview

Native connectors for 7 enterprise SIEM platforms with durable buffering (redb-backed), Elastic Common Schema (ECS) mapping, fan-out to multiple destinations, circuit breaker protection, and broadcast channel for internal subscribers (analytics bridge).

## Supported Platforms

| Platform | Protocol | Format | Key Features |
|----------|----------|--------|--------------|
| **Splunk** | HTTP Event Collector (HEC) | Splunk envelope | Indexer acknowledgement, channel management, configurable sourcetype/index |
| **Elasticsearch** | Bulk API | ECS (NDJSON) | ApiKey or Basic auth, index templates with date pattern, ILM policy support |
| **OpenSearch** | Bulk API | ECS (NDJSON) | Basic auth only, ISM policy support, API-compatible with Elasticsearch |
| **Wazuh** | REST API | ECS + agent_name | JWT auth (auto-refresh on 401), agent-based integration |
| **Microsoft Sentinel** | CEF over Syslog | CEF | RFC 5424 syslog, TLS/TCP transport, 6 custom extension fields |
| **IBM QRadar** | LEEF over Syslog | LEEF 2.0 | Tab-delimited fields, TLS/TCP transport |
| **Generic Syslog** | JSON over Syslog | JSON + RFC 5424 | TLS/TCP/UDP transport, all optional fields |

## Architecture

```
Alert (OSS domain)
  └── SiemEvent (enterprise domain: event_id, tenant_id, alert, delivery_attempt)
        └── SiemExportService
              ├── Broadcast Channel (capacity 1024, for analytics bridge)
              └── RedbSiemBuffer (durable, FIFO, configurable max size)
                    └── Batch Assembler (size + time triggers)
                          └── Circuit Breaker (3-state: Closed → Open → HalfOpen)
                                └── Fan-Out (concurrent export to N destinations)
                                      ├── Splunk HEC Exporter
                                      ├── Elasticsearch Bulk Exporter
                                      ├── OpenSearch Bulk Exporter
                                      ├── Wazuh API Exporter
                                      ├── Sentinel CEF Exporter
                                      ├── QRadar LEEF Exporter
                                      └── Syslog JSON Exporter
```

## SiemEvent

Each event wraps an OSS alert with enterprise metadata:

| Field | Description |
|-------|-------------|
| `event_id` | UUIDv7 (time-ordered) |
| `tenant_id` | Optional multi-tenancy scope |
| `alert` | Original OSS alert |
| `export_timestamp_ms` | When the event was queued |
| `destination_name` | Target connector name |
| `delivery_attempt` | Retry counter (0 = first) |

## ECS Mapping

All events are mapped to [Elastic Common Schema](https://www.elastic.co/guide/en/ecs/current/index.html):

| ECS Field | Source |
|-----------|--------|
| `event.id` | UUIDv7 |
| `event.kind` | `"alert"` |
| `event.category` | `["network"]` |
| `event.action` | Alert action |
| `event.severity` | 1 (low) to 4 (critical) |
| `event.module` | `"ebpfsentinel"` |
| `event.dataset` | `"ebpfsentinel.{component}"` |
| `@timestamp` | ISO 8601 |
| `rule.id`, `rule.name` | Alert rule |
| `source.ip`, `source.port` | Source address |
| `destination.ip`, `destination.port` | Destination address |
| `network.transport` | tcp/udp/icmp |
| `message` | Alert message |
| `threat.indicator.type` | Threat type (if present) |
| `threat.indicator.confidence` | Confidence (if present) |
| `ebpfsentinel.tenant_id` | Tenant ID (custom field) |
| `ebpfsentinel.component` | OSS component |

## Durable Buffer

Events are buffered in a **redb-backed** durable store (not in-memory ring buffer):

| Setting | Default | Description |
|---------|---------|-------------|
| `buffer_size_bytes` | 1 GB | Maximum buffer size |
| `batch_size` | 1,000 | Events per batch |
| `flush_interval_ms` | 5,000 | Maximum time before flush |

Key properties:

- **Persistence** — events survive agent restart (redb transactions)
- **FIFO eviction** — oldest events dropped when buffer cap exceeded
- **Dropped counter** — `dropped_total` metric incremented on overflow
- **At-least-once delivery** — events acked only after successful export
- **Recovery** — on startup, scans stored events to rebuild sequence positions

Batches are flushed when either the batch size or flush interval is reached, whichever comes first.

## Circuit Breaker

Three-state circuit breaker protects against cascading failures:

| State | Behavior |
|-------|----------|
| `Closed` | Normal operation, exports proceed |
| `Open` | Exports skipped, timer running |
| `HalfOpen` | Single probe attempt, revert to Closed on success |

| Setting | Default | Description |
|---------|---------|-------------|
| `failure_threshold` | 5 | Consecutive failures before circuit opens |
| `reset_timeout_ms` | 30,000 | Time before transitioning Open → HalfOpen |

## Fan-Out

Multiple SIEM destinations can be configured simultaneously. `FanOutExporter` sends every batch to ALL wrapped exporters **concurrently**. Returns `Ok(())` only if all succeed; returns first error on partial failure.

## Connector Details

### Splunk HEC

- **Envelope**: `{"event": <ECS JSON>, "sourcetype": "...", "index": "...", "time": <float>}`
- **Batch format**: NDJSON (newline-delimited envelopes)
- **Authentication**: `Authorization: Splunk {token}`
- **Channel**: UUIDv7-based channel ID per exporter instance (for ACK correlation)
- **ACK flow** (when `use_ack: true`): send with `X-Splunk-Request-Channel`, poll ACK endpoint 3 times (1s intervals)

### Elasticsearch

- **Endpoint**: `{endpoint}/_bulk`
- **Format**: NDJSON with action line + ECS document per event
- **Authentication priority**: ApiKey > Basic > None
- **Index pattern**: `ebpfsentinel-{yyyy.MM.dd}` (date resolved from event timestamp)
- **Response validation**: checks `{"errors": false}`, counts failed items, extracts first error

### OpenSearch

- API-compatible with Elasticsearch
- **Basic auth only** (no ApiKey support)
- Uses ISM (Index State Management) instead of ILM

### Wazuh

- **Auth flow**: `POST /security/user/authenticate` → JWT token → cached in Mutex
- **Token management**: auto-refresh on 401 response (re-authenticate and retry once)
- **Event format**: `{"events": [<ECS doc with agent.name>, ...]}`

### Microsoft Sentinel (CEF)

- **Format**: `CEF:0|eBPFsentinel|Agent|1.0|{rule_id}|{message}|{severity}|{extensions}`
- **CEF severity**: Low→3, Medium→5, High→7, Critical→10
- **Extensions**: `src`, `dst`, `spt`, `dpt`, `proto`, `act`, `externalId`, `rt` + custom fields (`cs1`-`cs6` for component, tenant_id, threat_type, confidence, attack_type, data_type)
- **Escaping**: `\|` in headers, `\=` in extension values
- **Wrapped in RFC 5424 syslog** (facility=1/user, severity mapped to syslog levels)

### IBM QRadar (LEEF)

- **Format**: `LEEF:2.0|eBPFsentinel|Agent|1.0|{event_id}|{tab-delimited key=value pairs}`
- **Fields**: `devTime`, `src`, `dst`, `srcPort`, `dstPort`, `proto`, `sev` (string), `action`, `ruleId`, `msg`, `component` + optional `tenantId`, `threatType`, etc.
- **Escaping**: tabs replaced with spaces (tab is field delimiter)
- **Wrapped in RFC 5424 syslog**

### Generic Syslog (JSON)

- **Format**: Full JSON payload over RFC 5424 syslog
- **Fields**: All core + optional fields (threat_type, confidence, attack_type, matched_domain, data_type)

### Shared Syslog Transport

Used by Sentinel, QRadar, and generic Syslog connectors:

- **Persistent connection**: TCP or TLS, lazily established, Tokio Mutex-protected
- **Reconnection**: one retry on I/O error
- **Framing**: octet-counting format (`{len} {message}\n`, per RFC 3164)
- **TLS**: rustls with configurable CA cert, optional `verify_tls=false`

## Metrics

`SiemExportService` tracks:

| Metric | Description |
|--------|-------------|
| `events_exported_total` | Lifetime exported count |
| `events_dropped_total` | Buffer overflow drops |
| `export_errors_total` | Failed export attempts |
| `buffer_size_bytes` | Current buffer size |

## Configuration

```yaml
enterprise:
  siem:
    enabled: true
    buffer_size_bytes: 1073741824       # 1 GB
    batch_size: 1000
    flush_interval_ms: 5000
    failure_threshold: 5
    reset_timeout_ms: 30000

    splunk:
      endpoint: https://splunk.internal:8088
      token: <hec-token>
      sourcetype: ebpfsentinel
      index: ebpfsentinel                # optional
      use_ack: false
      verify_tls: true

    elasticsearch:
      endpoint: https://es.internal:9200
      api_key: <api-key>                 # or username/password for Basic auth
      index_pattern: "ebpfsentinel-{yyyy.MM.dd}"
      ilm_policy: ebpfsentinel           # optional, reserved
      verify_tls: true

    opensearch:
      endpoint: https://opensearch.internal:9200
      username: admin
      password: <password>
      index_pattern: "ebpfsentinel-{yyyy.MM.dd}"
      ism_policy: ebpfsentinel           # optional, reserved
      verify_tls: true

    wazuh:
      endpoint: https://wazuh.internal:55000
      username: <user>
      password: <pass>
      agent_name: ebpfsentinel
      verify_tls: true

    sentinel:
      endpoint: sentinel.internal:514
      transport: tls                     # tcp or tls
      ca_cert: /etc/ebpfsentinel/ca.pem
      verify_tls: true
      hostname: ebpfsentinel

    qradar:
      endpoint: qradar.internal:514
      transport: tls
      ca_cert: /etc/ebpfsentinel/ca.pem
      verify_tls: true
      hostname: ebpfsentinel

    syslog:
      endpoint: syslog.internal:514
      transport: tls
      ca_cert: /etc/ebpfsentinel/ca.pem
      verify_tls: true
      hostname: ebpfsentinel
```

Only configure the connectors you need. Unconfigured connectors are ignored.

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/siem/status` | Export pipeline status (connectors, buffer size, exported/dropped/error counts) |

## Feature Gating

SIEM Integration requires a valid license with the `siem-integration` feature. Without a license, SIEM connectors are disabled and events are not exported.
