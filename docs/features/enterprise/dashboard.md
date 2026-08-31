# Dashboard UI

> **Edition: Enterprise**

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

Use the REST API with Swagger UI (`http://localhost:8080/swagger-ui/` on the
open-source agent, `https://localhost:8444/swagger-ui/` on the enterprise
agent) for API exploration, and build Grafana dashboards from Prometheus
metrics for visualization. The CLI provides full management capabilities.

## REST API

This feature mounts no endpoint. There is no `dashboard` license feature and
no route belongs to it: the console described above does not exist yet, and
what it would read is already served by the endpoints listed in
[Enterprise REST API](../../api-reference/rest-api-enterprise.md).
