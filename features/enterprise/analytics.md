# Advanced Analytics

> **Edition: Enterprise** | **Status: Planned**

## Overview

Traffic analytics and trend analysis beyond real-time alerting.

## Planned Capabilities

- Historical traffic volume analysis
- Top talkers (source IPs, destination ports, protocols)
- Trend detection (traffic patterns over time)
- Threat landscape dashboard (IOC hit rates, attack categories)
- Exportable analytics reports

## Current Alternative

Use Prometheus metrics with Grafana for traffic analysis. Key metrics available today:

- `ebpfsentinel_packets_total{interface, verdict}` — traffic volume
- `ebpfsentinel_bytes_processed_total{interface, direction}` — bandwidth
- `ebpfsentinel_alerts_total{component, severity}` — alert trends
- `ebpfsentinel_dns_queries_total` — DNS query volume
