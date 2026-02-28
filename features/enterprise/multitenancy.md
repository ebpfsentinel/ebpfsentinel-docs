# Multi-Tenancy

> **Edition: Enterprise** | **Status: Planned**

## Overview

Namespace-scoped security policy isolation for multi-tenant environments.

## Planned Capabilities

- Per-namespace policy scoping (rules only apply to traffic within a namespace)
- Tenant-isolated alert streams and audit logs
- Resource quotas per tenant (max rules, max alert rate)
- Tenant-aware RBAC (operators manage only their namespace)

## Current Alternative

Use RBAC roles with `operator` scope for namespace-level access control. The current RBAC model supports `admin`, `operator`, and `viewer` roles. See [Authentication](../authentication.md).
