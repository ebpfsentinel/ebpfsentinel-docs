# QoS / Traffic Shaping Configuration

The `qos` section configures kernel-side traffic shaping using pipes (the shapers), queues (the indirection classifiers point at), and classifiers (traffic matching rules). The eBPF TC program is attached to both the ingress and the egress hook, and each pipe declares which of the two it shapes.

## Reference

```yaml
qos:
  enabled: false
  pipes:
    - id: "wan-100m"
      bandwidth: "100mbps"     # Rate limit: 100mbps, 1gbps, 500kbps, 1000bps
      delay: 0                 # Added latency in ms (egress only, needs fq)
      loss: 0.0                # Random loss percentage (0.0-100.0)
      burst: "64kb"            # Max burst size: 64kb, 1mb, 4096b
      direction: egress        # egress, ingress, or both
      enabled: true
      interfaces: []           # Interface groups (empty = all). "!" prefix inverts.
  queues:
    - id: "high-prio"
      pipe_id: "wan-100m"      # Must reference an existing pipe
      enabled: true
  classifiers:
    - id: "voip"
      queue_id: "high-prio"    # Must reference an existing queue
      priority: 0              # Tie-break only (see below)
      interfaces: []           # Interface groups (empty = all). "!" prefix inverts.
      match:
        src_ip: "10.0.0.7"     # Single host
        dst_port: 5060
        protocol: udp          # tcp, udp, icmp, icmpv6, or numeric
        dscp: 46               # DSCP value (0-63)
        vlan_id: null
  cgroup_shaping:
    - id: "batch-jobs"
      workload:                # Which workloads; each matched cgroup on its own
        unit: "batch.service"
      rate: "50mbps"           # Egress rate each matched cgroup is held to
      horizon_ms: 2000         # Furthest a packet may be scheduled ahead (1-60000)
```

## Fields

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable QoS traffic shaping |

### Pipes

A pipe is the shaper: it owns the rate cap, the burst allowance, the added latency and the loss rate. Every queue underneath it draws from the same token bucket, so a pipe's capacity is contended for, not divided.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique pipe identifier |
| `bandwidth` | string | required | Rate limit (e.g., `"100mbps"`, `"1gbps"`, `"500kbps"`, `"1000bps"`) |
| `delay` | u32 | `0` | Added latency in milliseconds. Applied by pacing the departure time, so it needs the `fq` qdisc on the interface and has no effect on an ingress-only pipe |
| `loss` | f32 | `0.0` | Random packet loss percentage (0.0--100.0) |
| `burst` | string | `"64kb"` | Maximum burst size (e.g., `"64kb"`, `"1mb"`, `"4096b"`). Must be above 0 on a pipe with a non-zero `bandwidth`, since a bucket that holds no token drops every packet |
| `direction` | string | `"egress"` | Hook this pipe shapes: `egress`, `ingress`, or `both`. A forwarded packet crosses both hooks, so a pipe set to `both` is charged twice for it |
| `enabled` | bool | `true` | Whether this pipe is active |
| `interfaces` | list | `[]` | Interface groups this pipe applies to. Empty = all interfaces. Use `"!"` prefix for inversion (e.g., `"!lan"`) |
| `tenant_id` | u32 | `0` | Tenant this pipe shapes. `0` is global and shapes traffic from every tenant. A non-zero value makes the kernel skip the pipe for packets resolved to another tenant, so the pipe's bandwidth becomes that tenant's share. An agent without tenant attribution resolves every packet to `0` |

Maximum 64 pipes.

### Queues

A queue names the pipe that shapes it, and nothing else. It exists so that a set of classifiers can be moved to another pipe, or detached altogether, in one edit: disabling a queue stops every classifier pointing at it without touching them.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique queue identifier |
| `pipe_id` | string | required | ID of the pipe this queue is attached to (must exist) |
| `enabled` | bool | `true` | Whether this queue is active |

Maximum 256 queues.

### Classifiers

Classifiers match traffic and assign it to a queue. They are **not** evaluated in list order: the data plane looks the packet up by the most specific shape first and walks outwards, so a rule naming a host and both ports is tried before a host-only rule, a host-only rule before a port-only rule, and the wildcard (`match: {}`) last. A rule that names a DSCP is tried before an equivalent rule that leaves it open.

`priority` therefore only breaks a tie between classifiers whose criteria collapse onto the same lookup key: the lowest number wins and the others never fire.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique classifier identifier |
| `queue_id` | string | required | ID of the queue to assign matched traffic to (must exist) |
| `priority` | u8 | `0` | Tie-break between classifiers sharing one lookup key (lower wins) |
| `interfaces` | list | `[]` | Interface groups this classifier applies to. Empty = all. Use `"!"` prefix for inversion |
| `tenant_id` | u32 | `0` | Tenant this classifier applies to. `0` is global. A non-zero value makes the kernel skip the classifier for packets resolved to another tenant, so two tenants can send matching traffic to different queues |
| `match` | object | `{}` | Traffic match criteria (see below). Also accepted as `match_rule` |

Maximum 1024 classifiers.

#### Match Rule

All fields in `match` are optional. Omitted fields match any value.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `src_ip` | string | `null` | Source host, as a bare address or a `/32` (e.g., `"10.0.0.7"`) |
| `dst_ip` | string | `null` | Destination host, same shape as `src_ip` |
| `src_port` | u16 | `null` | Source port filter |
| `dst_port` | u16 | `null` | Destination port filter |
| `protocol` | string | `null` | IP protocol: `tcp`, `udp`, `icmp`, `icmpv6`, or numeric value |
| `dscp` | u8 | `null` | DSCP value (0--63) |
| `vlan_id` | u16 | `null` | 802.1Q VLAN ID (0--4094). `null` matches any VLAN, `0` matches untagged traffic only |

Addresses are matched exactly. A prefix shorter than `/32` and an IPv6 address are both rejected at load, with the reason, rather than being accepted and then shaping nothing. Shape IPv6 traffic by port, protocol or DSCP instead.

### Per-Workload Shaping

`cgroup_shaping` holds each cgroup a rule selects to an egress rate of its own, independent of pipes, queues and classifiers. At most 256 rules. The first rule in file order whose `workload` matches a cgroup is the one it is held to, so a narrow rule written above a wide one wins.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Rule identifier, unique among `cgroup_shaping` rules |
| `workload.unit` | string | `null` | systemd unit name, such as `nginx.service` |
| `workload.cgroup` | string | `null` | Absolute cgroup v2 path, matching that cgroup and everything under it |
| `workload.container` | string | `null` | Container id, an id prefix of at least twelve characters, or the runtime's name for it |
| `workload.pods` | label selector | `null` | Labels of the pod, with the Kubernetes meaning |
| `workload.namespaces` | label selector | `null` | Labels of the pod's namespace |
| `workload.service_account` | string | `null` | Service account the pod runs as |
| `rate` | string | required | Rate each matched cgroup is held to: `100mbps`, `1gbps`, `500kbps`, `8000bps`. At least `8kbps` |
| `horizon_ms` | u32 | `2000` | How far ahead, in milliseconds, a packet may be scheduled before it is dropped instead. 1 to 60000 |

`workload` must name at least one matcher. An executable path is refused, because a cgroup holds tasks of more than one executable and the rate belongs to the cgroup, and so are `parent` and `ancestor`, for the same reason. The rate applies to each matched cgroup on its own, not to their sum: two replicas selected by one rule are each held to the rate.

Shaping acts only on interfaces whose qdisc honours a departure time: `fq` as the root qdisc, or `mq` with `fq` under every queue. On any other interface the rule is reported as not applied and no packet is touched. `ebpfsentinel-agent qos shaping` shows, per interface, which of the two it is.

## Referential Integrity

The configuration enforces referential integrity at load time:

- Every queue must reference an existing pipe via `pipe_id`.
- Every classifier must reference an existing queue via `queue_id`.
- Duplicate IDs within pipes, queues, or classifiers are rejected.

## Example

```yaml
qos:
  enabled: true
  pipes:
    - id: wan-uplink
      bandwidth: "100mbps"
      burst: "128kb"
      direction: egress
    - id: realtime-reserved
      bandwidth: "10mbps"
      burst: "16kb"
      direction: both
    - id: lan-shaped
      bandwidth: "1gbps"
      burst: "256kb"
      direction: both
      interfaces: ["lan"]
  queues:
    # Reserving bandwidth for realtime traffic means giving it its own pipe:
    # sharing one pipe with bulk traffic would mean sharing its token bucket.
    - id: realtime
      pipe_id: realtime-reserved
    - id: bulk
      pipe_id: wan-uplink
    - id: lan-default
      pipe_id: lan-shaped
  classifiers:
    - id: voip-traffic
      queue_id: realtime
      match:
        protocol: udp
        dst_port: 5060
        dscp: 46
    - id: video-traffic
      queue_id: realtime
      match:
        protocol: udp
        dscp: 34
    # No criteria at all: the catch-all every unmatched packet falls into.
    - id: default-traffic
      queue_id: bulk
      match: {}
```
