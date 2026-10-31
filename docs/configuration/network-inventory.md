# Network Inventory Configuration

The network inventory lists the packet sockets open on the node, who holds
them and what filter is attached to them, and raises an alert for each one
that appears. It also lists the eBPF programs on the network path that the
agent did not load. What each reads and what it cannot see is on
[Packet Sockets](../features/raw-sockets.md) and
[Foreign eBPF Programs](../features/foreign-programs.md).

Nothing here enforces anything: the inventory only reads.

## Configuration

```yaml
network_inventory:
  enabled: true
  interval_secs: 30
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `true` | Read the inventory at all |
| `interval_secs` | u64 | `30` | How often the packet sockets and the eBPF programs are read, in seconds |

`interval_secs` is accepted between `1` and `3600`. A socket opened and closed
between two readings is never seen, so a shorter interval sees more at the cost
of one walk of `/proc` per reading.

Turning the inventory off stops the readings and the alerts, and both API
routes answer `reading: false`.
