# Advanced RBAC

> **Edition: Enterprise** | **Status: Planned**

## Overview

Fine-grained per-resource permissions beyond the current role-based model.

## Planned Capabilities

- Per-domain permissions (e.g., manage firewall but not IDS)
- Per-resource permissions (e.g., manage only rules with a specific prefix)
- Custom role definitions
- Permission inheritance hierarchies
- Audit logging of permission checks

## Current Alternative

Use the current three-tier RBAC model: `admin` (full access), `operator` (namespace-scoped writes), `viewer` (read-only). Combine with multiple API keys to assign different roles to different automation pipelines. See [Authentication](../authentication.md).
