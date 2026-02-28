# Dashboard UI

> **Edition: Enterprise** | **Status: Planned**

## Overview

A web-based management console for visualizing security events, managing rules, and monitoring agent health across a fleet.

## Planned Capabilities

- Real-time security event dashboard with severity heatmaps
- Rule management UI (create, edit, delete across all domains)
- Agent fleet overview with health status
- Alert timeline with drill-down to packet details
- Threat intelligence feed status and IOC browser
- Configuration editor with validation
- Audit log viewer

## Current Alternative

Use the REST API with Swagger UI (`http://localhost:8080/swagger-ui/`) for API exploration, and build Grafana dashboards from Prometheus metrics for visualization. The CLI provides full management capabilities.
