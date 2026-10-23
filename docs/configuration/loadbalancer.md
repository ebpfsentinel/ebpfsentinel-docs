# Load Balancer Configuration

The `loadbalancer` section configures L4 (TCP/UDP/TLS passthrough) load balancing services with backend pools, health checks, and balancing algorithms.

## Reference

```yaml
loadbalancer:
  enabled: true                          # Enable/disable load balancer
  services:
    - id: "service-id"                   # Unique service identifier (max 64 chars)
      name: "human-readable-name"        # Display name
      protocol: "tcp"                    # tcp, udp, or tls_passthrough
      listen_addr: "192.0.2.10"          # Optional: answer on this address only (IPv4 or IPv6)
      listen_port: 443                   # Frontend port
      algorithm: "round_robin"           # round_robin, weighted, ip_hash, least_conn, maglev
      mode: "dnat"                       # dnat (default) or l2dsr
      enabled: true                      # Administrative enable flag
      backends:
        - id: "backend-id"               # Unique backend identifier within service
          addr: "10.0.1.10"              # Backend IP (IPv4 or IPv6)
          port: 443                      # Backend port
          weight: 1                      # Traffic weight (higher = more traffic)
          enabled: true                  # Administrative enable flag
          same_segment: false            # required true for every backend of an l2dsr service
      health_check:                      # Optional health probe (probes each backend's addr:port)
        protocol: "tcp"                  # tcp or icmp
        interval_secs: 10                # Probe interval
        timeout_secs: 5                  # Probe timeout
        unhealthy_threshold: 3           # Failures before marking unhealthy (alias: failure_threshold)
        healthy_threshold: 3             # Successes before marking healthy (alias: recovery_threshold)
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable load balancer |
| `services` | `[LbService]` | `[]` | List of load balancer service definitions |

### LbService

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique service identifier (max 256 characters) |
| `name` | `string` | Yes | Human-readable service name |
| `protocol` | `string` | No | `tcp` (default), `udp`, or `tls_passthrough` |
| `listen_addr` | `string` | No | Destination address the service answers on, IPv4 or IPv6. This is how a virtual address is served: the data plane matches the exact address first, then a service carrying no `listen_addr` on the same port, so two services can share one port at two addresses and a service bound to an address never captures traffic sent to the node itself. Omitted, the service answers on every address on its port. |
| `listen_port` | `integer` | Yes | Frontend port to listen on (1-65535) |
| `algorithm` | `string` | No | `round_robin` (default), `weighted`, `ip_hash`, `least_conn`, `maglev` |
| `mode` | `string` | No | Forwarding mode: `dnat` (default) or `l2dsr`. Aliases for `l2dsr`: `l2_dsr`, `dsr`. With `l2dsr`, every backend must set `same_segment: true` or config is rejected. |
| `enabled` | `bool` | No | Enable/disable this service (default: `true`) |
| `backends` | `[LbBackend]` | Yes | At least one backend required, at most 256 |
| `health_check` | `LbHealthCheck` | No | Optional backend health probe |

Two services with the same protocol, `listen_addr` and `listen_port` are refused at load, because the data plane holds one service per key and the later would silently replace the earlier. `tcp` and `tls_passthrough` are one protocol on the wire, so they conflict with each other; a service carrying no `listen_addr` and one carrying an address on the same port do not.

### LbBackend

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique backend identifier within the service |
| `addr` | `string` | Yes | Backend IP address (IPv4 or IPv6) |
| `port` | `integer` | Yes | Backend port (1-65535) |
| `weight` | `integer` | No | Traffic weight, must be > 0 (default: `1`) |
| `enabled` | `bool` | No | Enable/disable this backend (default: `true`) |
| `same_segment` | `bool` | No | Backend is on the same L2 segment as the load balancer (default: `false`). Must be `true` for every backend of an `l2dsr` service. Ignored in `dnat` mode. |

### LbHealthCheck

The probe targets each backend's own `addr:port` - there is no separate target field.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `protocol` | `string` | `tcp` | `tcp` (connect to the backend's port) or `icmp` (ping the backend's address) |
| `interval_secs` | `integer` | `10` | Seconds between probes, must be > 0 |
| `timeout_secs` | `integer` | `5` | Seconds before probe timeout, must be > 0 and must not exceed `interval_secs` |
| `unhealthy_threshold` | `integer` | `3` | Consecutive failures before marking unhealthy, must be > 0 (alias: `failure_threshold`) |
| `healthy_threshold` | `integer` | `3` | Consecutive successes before marking healthy, must be > 0 (alias: `recovery_threshold`) |

Every enabled backend of the service is probed on the interval configured
here. A backend that fails `unhealthy_threshold` probes in a row leaves the
balancing set - in userspace and in the eBPF backend map - and rejoins it
after `healthy_threshold` successes in a row. Omit the whole `health_check`
block and the service's backends are never probed; they stay in the
balancing set until an operator disables them.

The probe set is built at startup from the YAML services. A service created
through `POST /api/v1/lb/services` carries no health check, so it is not
probed.

## Limits

- Maximum **64 services**
- Each service must have at least **1 backend**
- Service and backend IDs: max **64 characters**, must not be empty
- Backend weight must be **> 0**
- Listen port must be **> 0**
- An `l2dsr` service requires **every backend** to set `same_segment: true`
- A `health_check` block requires a known `protocol`, non-zero intervals and thresholds, and `timeout_secs` no larger than `interval_secs`

## Forwarding mode

`mode` selects how the selected backend is reached. It is independent of the balancing algorithm.

- **`dnat`** (default) - destination IP/port rewritten to the backend; L3/L4 checksums recomputed. Works across L3 boundaries. Unchanged from prior releases.
- **`l2dsr`** - Direct Server Return: only the Ethernet header is rewritten, destination to the backend's resolved MAC and source to this node's interface MAC; destination IP stays the VIP and checksums are not recomputed. Backends reply directly to the client. Requires all backends on the same L2 segment (`same_segment: true`); backend MACs are resolved automatically via neighbor/ARP (IPv4) or ND (IPv6). Packets whose backend MAC cannot be resolved fall back to `dnat` automatically.

## Examples

### HTTPS load balancer - TLS passthrough

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-https
      name: web-https
      protocol: tls_passthrough
      listen_port: 443
      algorithm: round_robin
      backends:
        - id: web-1
          addr: "10.0.1.10"
          port: 443
          weight: 1
        - id: web-2
          addr: "10.0.1.11"
          port: 443
          weight: 1
        - id: web-3
          addr: "10.0.1.12"
          port: 443
          weight: 2
      health_check:
        protocol: tcp
        interval_secs: 10
        timeout_secs: 5
        unhealthy_threshold: 3
        healthy_threshold: 3
```

### DNS cluster - UDP round-robin

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-dns
      name: dns-cluster
      protocol: udp
      listen_port: 53
      algorithm: round_robin
      backends:
        - id: dns-1
          addr: "10.0.2.10"
          port: 53
        - id: dns-2
          addr: "10.0.2.11"
          port: 53
```

### Database pool - TCP least-connections

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-db
      name: postgres-cluster
      protocol: tcp
      listen_port: 5432
      algorithm: least_conn
      backends:
        - id: db-primary
          addr: "10.0.3.10"
          port: 5432
          weight: 3
        - id: db-replica-1
          addr: "10.0.3.11"
          port: 5432
          weight: 1
        - id: db-replica-2
          addr: "10.0.3.12"
          port: 5432
          weight: 1
      health_check:
        protocol: tcp
        interval_secs: 5
        timeout_secs: 3
        unhealthy_threshold: 2
        healthy_threshold: 2
```

### Sticky sessions - IP hash

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-app
      name: app-sticky
      protocol: tcp
      listen_port: 8080
      algorithm: ip_hash
      backends:
        - id: app-1
          addr: "10.0.4.10"
          port: 8080
        - id: app-2
          addr: "10.0.4.11"
          port: 8080
```

### L2 Direct Server Return

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-dsr
      name: web-dsr
      protocol: tcp
      listen_port: 80
      algorithm: maglev
      mode: l2dsr
      backends:
        - id: web-1
          addr: "10.0.6.10"
          port: 80
          same_segment: true
        - id: web-2
          addr: "10.0.6.11"
          port: 80
          same_segment: true
```

### Weighted traffic split

```yaml
loadbalancer:
  enabled: true
  services:
    - id: lb-canary
      name: canary-deploy
      protocol: tcp
      listen_port: 80
      algorithm: weighted
      backends:
        - id: stable
          addr: "10.0.5.10"
          port: 80
          weight: 9
        - id: canary
          addr: "10.0.5.11"
          port: 80
          weight: 1
```

## L2 VIP announcer

The optional `loadbalancer.announce` block makes this node claim one or
more virtual IPs (VIPs) on a flat L2 segment by answering ARP, and emit
gratuitous ARP on failover. See the
[L2 VIP announcer feature page](../features/loadbalancer.md#l2-vip-announcer)
for the design and split-brain guarantees.

```yaml
loadbalancer:
  enabled: true
  services: []
  announce:
    role: primary          # primary | standby | elected | disabled (default: disabled)
    interface: eth0        # NIC whose MAC answers ARP for the VIPs
    vips:
      - name: web-vip      # label used in metrics ({vip="web-vip"})
        addr: "10.0.6.100" # IPv4 VIP to claim while elected speaker
      - name: api-vip
        addr: "10.0.6.101"
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `role` | string | `disabled` | `primary` = always the speaker (answers ARP, emits gratuitous ARP). `standby` = silent until its role is changed. `elected` = silent until an elector grants it the speaker role for a bounded time, and silent again when that grant is not renewed. `disabled` = announcer off. Aliases: `speaker`/`active`, `passive`/`backup`, `off`/`none`. |
| `interface` | string | - | Interface whose NIC MAC is used as the ARP `sha`. Required unless `role: disabled`. |
| `vips` | list | `[]` | VIPs to announce. Required unless `role: disabled`. |
| `vips[].name` | string | - | Unique label, surfaced as the `{vip}` metric label. |
| `vips[].addr` | string | - | Unique IPv4 address. IPv6 entries are ignored (ARP is IPv4-only). |

Only a speaker ever populates the kernel `VIP_SET`; `standby` and
`disabled` nodes stay completely silent, so a misconfigured pair cannot both
answer ARP. With fixed roles, promotion is config-driven: change `role` to
`primary` on the surviving node and reload.

### Elected speaker

With `role: elected` every node carries the same block and none of them
answers until it is granted the role through
[`POST /api/v1/lb/vips/grant`](../api-reference/rest-api.md#post-apiv1lbvipsgrant)
with a number of seconds, at most 300. The grant is counted on the node's
own clock: the agent checks it every second and falls silent when it runs
out, without hearing from anybody. A grant of `0` releases the role at once.
A reload that keeps the role `elected` keeps the grant; any other role drops
it.

The Kubernetes operator is the elector. Only the replica holding the
operator's lease grants anything, so there is exactly one elector, and for
each `LoadBalancerConfig` whose `vipAnnounce.role` is `elected` it:

- renews the current speaker every 2 seconds with a 30-second grant, for as
  long as that agent answers;
- records the speaker in a `Lease` named `<policy>-vip-speaker` beside the
  policy and owned by it, so a replica taking over the lead keeps the speaker
  already chosen rather than picking another;
- when the speaker stops answering, grants nobody until 30 seconds after its
  last renewal, the instant its own grant lapses, and then grants the first
  selected agent (by node, then pod name) that accepts. That fence is what
  keeps two nodes from answering for one address.

What a failover costs:

| Event | Addresses unanswered |
|-------|----------------------|
| Speaker node lost, network cut or agent stopped | Up to 32 seconds: the 30-second grant plus one 2-second pass. |
| Operator leader lost | None. The standby replica takes the operator's lease within 17 seconds (15-second lease, 2-second retry) and renews the recorded speaker before its 30-second grant lapses. |
| Operator leader and speaker lost together | Up to 32 seconds after the speaker's last renewal, as above. |
| Every operator replica gone | The speaker keeps answering for up to 30 seconds, then falls silent until an operator is back. |

The operator writes the outcome to the policy's `status.speaker`: `Speaking`
with the pod, node and the time it took the role, `Fenced` with the previous
pod and the time its grant lapses, or `Unelected` when no selected agent took
the grant.

### Runtime control surface

Both the REST API and the CLI expose live read/write access to this block;
applied changes go through the same validation + hot-reload path as a YAML
reload (Maglev tables are re-generated and bindings re-registered under
the per-domain reload lock).

- REST: [`GET /api/v1/lb/vips`, `POST /api/v1/lb/vips`](../api-reference/rest-api.md#get-apiv1lbvips)
- CLI: [`ebpfsentinel-agent lb vips`, `lb announce --json`](../cli-reference/index.md#lb)
