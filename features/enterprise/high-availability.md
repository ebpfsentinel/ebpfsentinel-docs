# High Availability

> **Edition: Enterprise** | **Status: Planned**

## Overview

Active-passive clustering with state replication for zero-downtime failover.

## Planned Capabilities

- Active-passive agent pairs with automatic failover
- Blacklist and cache state replication between peers
- Split-brain detection and resolution
- Health-based leader election

## Current Alternative

eBPFsentinel agents run independently per node. Since each agent operates on its own network interface, there is no single point of failure at the agent level — each node's traffic is protected by its local agent. Restart recovery is fast (sub-second eBPF program reload).
