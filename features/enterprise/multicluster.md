# Multi-Cluster

> **Edition: Enterprise** | **Status: Planned**

## Overview

Federated policy management across multiple Kubernetes clusters or host groups.

## Planned Capabilities

- Central policy repository with per-cluster overrides
- Cross-cluster threat intelligence sharing (IOCs, blacklists)
- Unified alert aggregation across clusters
- Cluster group targeting for policy rollouts

## Current Alternative

Deploy agents independently per cluster/host with identical configuration files. Use a configuration management tool (Ansible, Puppet, Chef) or GitOps workflow to keep configurations synchronized.
