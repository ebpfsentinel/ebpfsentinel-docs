# Connection Tracking Configuration

Connection tracking probes kernel netfilter via `bpf_skb_ct_lookup` kfuncs. The kernel manages all TCP/UDP/ICMP state, timeouts, and eviction. The userspace config controls flood detection thresholds only. See [Connection Tracking](../features/conntrack.md) for the feature overview.

## Configuration

```yaml
conntrack:
  enabled: false
  half_open_threshold: 100
  rst_threshold: 50
  fin_threshold: 50
  ack_threshold: 200
```

## Reference

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable connection tracking probe |

### Flood Detection

These thresholds trigger alerts when anomalous connection patterns are detected in the eBPF program:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `half_open_threshold` | u32 | `100` | Half-open connections before alerting |
| `rst_threshold` | u32 | `50` | RST packets per window before alerting |
| `fin_threshold` | u32 | `50` | FIN packets per window before alerting |
| `ack_threshold` | u32 | `200` | ACK-only packets per window before alerting |

> **Note:** TCP/UDP/ICMP timeouts and connection limits are managed by kernel netfilter, not by the agent. Use `sysctl net.netfilter.nf_conntrack_*` to tune kernel-side timeouts.
