# SIEM Integration

> **Edition: Enterprise** | **Status: Planned**

## Overview

Native connectors for enterprise SIEM platforms.

## Planned Capabilities

- Splunk HEC (HTTP Event Collector) native output
- Elastic Common Schema (ECS) formatted output
- Microsoft Sentinel connector
- QRadar LEEF/CEF output
- Configurable field mappings per SIEM vendor
- Buffered delivery with at-least-once guarantees

## Current Alternative

eBPFsentinel produces structured JSON logs and webhook alerts that can be shipped to any SIEM via standard log shippers:

- **Fluentd/Fluent Bit** — collect JSON logs from the log file sender
- **Webhook** — send alerts directly to SIEM HTTP endpoints
- **Prometheus** — scrape metrics for SIEM correlation
- **gRPC streaming** — build a custom adapter that forwards alerts to your SIEM
