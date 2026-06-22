# QoS / Traffic Shaping Configuration

The `qos` section configures kernel-side traffic shaping using pipes (bandwidth limits), queues (scheduling weights), and classifiers (traffic matching rules). The eBPF TC egress program enforces shaping at line rate.

## Reference

```yaml
qos:
  enabled: false
  scheduler: fifo              # fifo, wf2q, or fq_codel
  pipes:
    - id: "wan-100m"
      bandwidth: "100mbps"     # Rate limit: 100mbps, 1gbps, 500kbps, 1000bps
      delay: 0                 # Propagation delay in ms
      loss: 0.0                # Random loss percentage (0.0-100.0)
      burst: "64kb"            # Max burst size: 64kb, 1mb, 4096b
      priority: 0              # Lower = higher priority
      direction: egress        # egress, ingress, or both
      enabled: true
      interfaces: []           # Interface groups (empty = all). "!" prefix inverts.
  queues:
    - id: "high-prio"
      pipe_id: "wan-100m"      # Must reference an existing pipe
      weight: 80               # Scheduling weight (1-100)
      enabled: true
  classifiers:
    - id: "voip"
      queue_id: "high-prio"    # Must reference an existing queue
      priority: 0              # Lower = matched first
      interfaces: []           # Interface groups (empty = all). "!" prefix inverts.
      match_rule:
        src_ip: "10.0.0.0/8"
        dst_ip: "0.0.0.0/0"
        src_port: null
        dst_port: 5060
        protocol: udp          # tcp, udp, icmp, icmpv6, or numeric
        dscp: 46               # DSCP value (0-63)
        vlan_id: null
```

## Fields

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable QoS traffic shaping |
| `scheduler` | string | `"fifo"` | Packet scheduler: `fifo`, `wf2q` (weighted fair queuing), or `fq_codel` |

### Pipes

Pipes define bandwidth limits and link characteristics. Each pipe acts as a virtual link with a rate cap.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique pipe identifier |
| `bandwidth` | string | required | Rate limit (e.g., `"100mbps"`, `"1gbps"`, `"500kbps"`, `"1000bps"`) |
| `delay` | u32 | `0` | Propagation delay in milliseconds |
| `loss` | f32 | `0.0` | Random packet loss percentage (0.0--100.0) |
| `burst` | string | `"64kb"` | Maximum burst size (e.g., `"64kb"`, `"1mb"`, `"4096b"`) |
| `priority` | u8 | `0` | Pipe priority (lower number = higher priority) |
| `direction` | string | `"egress"` | Direction: `egress`, `ingress`, or `both` |
| `enabled` | bool | `true` | Whether this pipe is active |
| `interfaces` | list | `[]` | Interface groups this pipe applies to. Empty = all interfaces. Use `"!"` prefix for inversion (e.g., `"!lan"`) |

Maximum 64 pipes.

### Queues

Queues attach to pipes and control how traffic within a pipe is scheduled.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique queue identifier |
| `pipe_id` | string | required | ID of the pipe this queue is attached to (must exist) |
| `weight` | u16 | `100` | Scheduling weight (1--100). Higher weight gets more bandwidth share |
| `enabled` | bool | `true` | Whether this queue is active |

Maximum 256 queues.

### Classifiers

Classifiers match traffic and assign it to queues. They are evaluated in priority order (lowest number first).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique classifier identifier |
| `queue_id` | string | required | ID of the queue to assign matched traffic to (must exist) |
| `priority` | u8 | `0` | Match priority (lower = matched first) |
| `interfaces` | list | `[]` | Interface groups this classifier applies to. Empty = all. Use `"!"` prefix for inversion |
| `match_rule` | object | `{}` | Traffic match criteria (see below) |

Maximum 1024 classifiers.

#### Match Rule

All fields in `match_rule` are optional. Omitted fields match any value.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `src_ip` | string | `null` | Source IP CIDR filter (e.g., `"10.0.0.0/8"`) |
| `dst_ip` | string | `null` | Destination IP CIDR filter |
| `src_port` | u16 | `null` | Source port filter |
| `dst_port` | u16 | `null` | Destination port filter |
| `protocol` | string | `null` | IP protocol: `tcp`, `udp`, `icmp`, `icmpv6`, or numeric value |
| `dscp` | u8 | `null` | DSCP value (0--63) |
| `vlan_id` | u16 | `null` | 802.1Q VLAN ID |

## Referential Integrity

The configuration enforces referential integrity at load time:

- Every queue must reference an existing pipe via `pipe_id`.
- Every classifier must reference an existing queue via `queue_id`.
- Duplicate IDs within pipes, queues, or classifiers are rejected.

## Example

```yaml
qos:
  enabled: true
  scheduler: fq_codel
  pipes:
    - id: wan-uplink
      bandwidth: "100mbps"
      burst: "128kb"
      direction: egress
    - id: lan-shaped
      bandwidth: "1gbps"
      burst: "256kb"
      direction: both
      interfaces: ["lan"]
  queues:
    - id: realtime
      pipe_id: wan-uplink
      weight: 80
    - id: bulk
      pipe_id: wan-uplink
      weight: 20
    - id: lan-default
      pipe_id: lan-shaped
      weight: 100
  classifiers:
    - id: voip-traffic
      queue_id: realtime
      priority: 0
      match_rule:
        protocol: udp
        dst_port: 5060
        dscp: 46
    - id: video-traffic
      queue_id: realtime
      priority: 1
      match_rule:
        protocol: udp
        dscp: 34
    - id: default-traffic
      queue_id: bulk
      priority: 255
```
