# Agent Configuration

The `agent` section configures the core agent behavior - network interfaces, API ports, and logging.

## Reference

```yaml
agent:
  interfaces: [eth0]                    # Required. Network interfaces to attach eBPF programs to.
  xdp_mode: auto                        # XDP attachment mode: auto, native, generic, offloaded. Default: auto
  bind_address: "127.0.0.1"             # REST API listen address. Default: 127.0.0.1
  allow_unauthenticated_api: false      # Safety override for non-loopback bind with auth disabled. Default: false
  allow_plaintext_api: false            # Safety override for non-loopback bind without TLS. Default: false
  http_port: 8080                       # REST API port. Default: 8080
  grpc_port: 50051                      # gRPC port. Default: 50051
  grpc_reflection: false                # gRPC reflection. Default: false (disabled for security)
  metrics_port: 9090                    # Prometheus metrics port. Default: 9090 (or shared with REST)
  ebpf_program_dir: null                # Directory for eBPF binaries. Default: null (uses embedded)
  event_workers: 4                      # Parallel event dispatcher workers. Default: 4
  log_level: "info"                     # Log level: error, warn, info, debug, trace. Default: info
  log_format: "json"                    # Log format: json or text. Default: json
  config_writes: refused                # Whether the control API may rewrite this file: refused or allowed. Default: refused
  api_rate_limit:                       # Write-API rate limit (see below). Optional.
    write_per_second: 1                 # Sustained write rate per IP. Default: 1
    write_burst: 60                     # Write burst per IP. Default: 60
    exempt_loopback: true               # Don't rate-limit loopback clients. Default: true
```

## Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `interfaces` | `[string]` | Yes | - | Network interfaces to monitor |
| `xdp_mode` | `string` | No | `auto` | XDP attachment mode (see below) |
| `bind_address` | `string` | No | `127.0.0.1` | REST API listen address |
| `allow_unauthenticated_api` | `bool` | No | `false` | Safety override. With `auth.enabled: false` the agent **refuses to start** when `bind_address` is non-loopback, because that would expose the control plane (firewall, IPS, NAT, config reload) to anyone who can reach the port. Set `true` only when the API is fenced off by other means (network policy, mTLS-terminating proxy). Leaving auth enabled, or binding to `127.0.0.1`/`::1`, is the safe default. |
| `allow_plaintext_api` | `bool` | No | `false` | Safety override. With `agent.tls.enabled: false` the agent **refuses to start** when `bind_address` is non-loopback, because the API key and every configuration call then cross the network readable by anything on the path. Set `true` only where TLS is terminated in front of the agent or the hop is already a tunnel. The two overrides are separate on purpose: one says nobody is identified, the other says nothing is encrypted, and accepting one is not accepting the other. |
| `http_port` | `integer` | No | `8080` | REST API port |
| `grpc_port` | `integer` | No | `50051` | gRPC streaming port |
| `grpc_reflection` | `bool` | No | `false` | Enable gRPC server reflection. Disabled by default for security - exposes service definitions |
| `metrics_port` | `integer` | No | `9090` | Prometheus metrics port |
| `ebpf_program_dir` | `Option<string>` | No | `None` | Directory for eBPF binaries. When `None`, the agent uses embedded programs |
| `event_workers` | `usize` | No | `4` | Number of parallel event dispatcher workers |
| `attach_mode` | `string` | No | `auto` | TC program attachment mode (see below) |
| `swagger_ui` | `bool` | No | `false` | Enable Swagger UI at `/swagger-ui/` |
| `log_level` | `string` | No | `info` | Log level |
| `log_format` | `string` | No | `json` | Log output format |
| `api_rate_limit` | `object` | No | see below | Rate limit for the mutating control-plane API (see below) |
| `config_writes` | `string` | No | `refused` | Whether `PUT /api/v1/config/{section}` may rewrite this agent's own configuration file: `refused` or `allowed`. Refused by default. Where the file is rendered by the Kubernetes operator from a custom resource, a write accepted here is reverted at the next reconcile and nobody is told why the setting went back, so allow it only where the file on disk is what decides what this agent does. |

## Write-API rate limit

The mutating control-plane endpoints (`POST`/`DELETE`/`PATCH`/`PUT` under `/api/v1/`) are rate-limited per client IP with a GCRA token bucket, so a leaked token or a runaway client cannot rewrite the firewall, IPS blacklist, NAT, or rate-limit state at high speed. Read endpoints keep a separate, looser limit that is not configurable: 200 requests/minute per IP with a burst of 200 on the open-source port, 4 requests/second per IP with a burst of 200 on the enterprise one. The full set of tiers per port is in [REST API](../api-reference/rest-api.md#rate-limiting) and [Enterprise REST API](../api-reference/rest-api-enterprise.md#rate-limiting).

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `write_per_second` | `integer` | No | `1` | Sustained refill rate of the write bucket, requests/second/IP. Must be ≥ 1 |
| `write_burst` | `integer` | No | `60` | Burst capacity of the write bucket, requests/IP. Must be ≥ 1 |
| `exempt_loopback` | `bool` | No | `true` | Exempt loopback clients (`127.0.0.0/8`, `::1`) from the write limit |

With the defaults, a non-loopback client gets a 60-request burst that refills at 1/s (60/minute); once exhausted, further writes return `429 Too Many Requests` with a `Retry-After` header. **Loopback is exempt by default**, so local CLI tooling and same-host bulk reconfiguration are never throttled. Raise `write_burst` / `write_per_second` if you drive bulk reconfiguration through the API from a remote host, or set `exempt_loopback: false` to rate-limit local clients too. Bulk rule/IOC sets are normally loaded from the YAML config at startup rather than the write API.

This block governs both ports. The enterprise agent reads the same three fields and applies the same two tiers to its own API, so a deployment running both tunes one thing rather than two.

Every mutating route sits in that group, including the ones whose cost is not in the agent: `POST /api/v1/threatintel/feeds/refresh` starts an outbound download of every enabled feed, so it is throttled as a write like any other mutation. Because the limit bounds how often the route is called and not how many downloads it starts, that refresh is additionally single-flight: one feed cycle runs at a time, and a caller arriving while one is fetching gets `409 Conflict` with the code `REFRESH_IN_PROGRESS` rather than queueing a second download.

```yaml
agent:
  interfaces: [eth0]
  api_rate_limit:
    write_per_second: 5      # allow 5 writes/s sustained
    write_burst: 300         # with a 300-request burst
    exempt_loopback: true
```

## XDP Attachment Mode

The `xdp_mode` field controls how XDP programs (`xdp-firewall`, `xdp-ratelimit`, `xdp-loadbalancer`) are attached to network interfaces. This directly impacts packet processing performance.

| Mode | Flag | Performance | Description |
|------|------|-------------|-------------|
| `auto` | `0` (default) | Best available | Kernel tries native first, falls back to generic. Recommended for most deployments. |
| `native` | `XDP_FLAGS_DRV_MODE` | Fastest | Runs in the NIC driver, before `sk_buff` allocation. Requires driver support. |
| `generic` | `XDP_FLAGS_SKB_MODE` | Slowest | Runs after `sk_buff` allocation. Works on any interface but loses the zero-copy advantage. |
| `offloaded` | `XDP_FLAGS_HW_MODE` | Hardware | Offloads the program to the NIC itself (`SmartNIC`). Requires hardware support (e.g. Netronome NFP). |

**Fallback behavior**: if the requested mode is not supported by the NIC driver, eBPFsentinel automatically falls back to `auto` and logs a warning. The agent never fails to start because of an unsupported XDP mode.

**Drivers supporting native XDP**: `virtio_net`, `i40e`, `ixgbe`, `mlx4`, `mlx5`, `ice`, `bnxt`, `ena` (AWS), `gve` (GCP), `hv_netvsc` (Azure/Hyper-V), `veth`, `bond`.

> **Tip**: use `ethtool -i eth0 | grep driver` to check your NIC driver, then set `xdp_mode: native` if it appears in the list above.

## TC Attachment Mode

The `attach_mode` field controls how TC programs (tc-ids, tc-conntrack, tc-dns, tc-threatintel, tc-nat-ingress, tc-nat-egress, tc-scrub) are attached to network interfaces.

| Mode | Description |
|------|-------------|
| `auto` (default) | Use netkit for netkit interfaces (Kubernetes pods with Cilium 1.16+), fall back to TC clsact for standard interfaces |
| `tc` | Force TC clsact qdisc attach on all interfaces |
| `netkit` | Force netkit attach via `BPF_LINK_CREATE` on all interfaces (fails if interface is not a netkit device) |

### Netkit attach

**Netkit** devices (kernel **6.7+**) replace veth pairs for container networking and let BPF programs attach natively - no TC qdisc overhead. eBPFsentinel detects them by reading `/sys/class/net/{iface}/type` (netkit reports `ARPHRD_NONE` / `65534`) and attaches each TC program with a `BPF_LINK_CREATE` syscall using `BPF_NETKIT_PRIMARY` (the ingress side of the netkit pair).

The programs eligible for netkit attach are the TC datapath: `tc-ids`, `tc-threatintel`, `tc-dns`, `tc-conntrack`, `tc-nat-ingress`, `tc-nat-egress`, `tc-scrub`, `tc-qos`. XDP programs (`xdp-firewall`, `xdp-ratelimit`, `xdp-loadbalancer`) keep their own [XDP attach mode](#xdp-attachment-mode).

In `netkit` mode, attaching to a non-netkit interface is a hard error. In `auto` mode the agent silently falls back to TC clsact for any interface that is not a netkit device, so the same config works on bare metal and on Cilium clusters.

### Workload link hot-plug

A container's traffic crosses the host on a link its runtime creates for it, and the agent attaches its TC chain to each such link as it appears, **without restarting**. The watcher subscribes to rtnetlink's link group, so it hears a link created or removed the moment the kernel announces it rather than on a poll. It recognises:

| Link | Typical source | Hook used |
|------|----------------|-----------|
| `veth` | Docker, Podman, most CNIs (Calico, Flannel, kindnet, Cilium in veth mode) | TCX ingress and egress |
| `netkit` | Cilium 1.16+ in netkit mode | netkit primary and peer hooks (TCX in `tc` mode) |
| `macvlan`, `ipvlan` | Multus secondary networks, Docker macvlan/ipvlan networks | TCX ingress and egress |
| any virtual device enslaved to a bridge (a tap, for example) | VMs and KubeVirt, custom bridges | TCX ingress and egress |

`attach_mode` decides which of them the hot-plug takes: `auto` attaches all of them, netkit devices through their own hooks; `tc` attaches all of them through TCX; `netkit` attaches netkit devices only. Physical devices, loopback, bridges themselves, bonds, VLANs and tunnels (`vxlan`, `geneve`, `wireguard`...) are infrastructure and left alone. A link of a kind the agent does not know is logged once per kind, with the kind, and not attached:

```
hot-plug: link kind not understood, links of this kind are not attached (reported once per kind) kind=tun iface=tun0
```

Each attach is logged with the owning workload when the agent can find it: the namespace the link's peer sits in is matched against every network namespace behind a process in the host procfs (`EBPFSENTINEL_HOST_PROC` when the agent does not share the host pid namespace), and that process's cgroup gives the container id and runtime. A link whose owner cannot be found is attached all the same.

When a link goes away its attachments are released at once; a link renamed or re-enslaved is released and attached again under its new identity. Interfaces listed in `interfaces` are attached by the configuration and never a second time by the hot-plug.

**Bursts.** Messages are gathered over 100 ms and folded per interface before anything is attached, so a node starting fifty containers at once costs one attach per container, and a link created and moved into a namespace within that window costs nothing extra. If a burst overruns the socket buffer (the agent asks for 4 MB), the agent reads the whole link table again instead of trusting what survived, and it does so every 60 seconds regardless, so a lost message cannot leave a link unattached.

**Before the chain is attached.** A workload link carries traffic from the moment its runtime brings it up, and the TC chain is on it only once the attach completes: the 100 ms gathering window plus a few system calls per program, typically well under a second. Packets crossing the link in that window are not seen by the TC programs (IDS, threat intelligence, DNS, NAT, QoS, scrub). They are not unprotected altogether: XDP on the node's physical interfaces still applies to traffic entering or leaving the node, and the workload firewall, when enabled, sits on the cgroup rather than on the link, so a connection the workload opens is judged whether or not its link is attached yet. The window is measured rather than assumed, per link kind:

| Metric | What it says |
|--------|--------------|
| `ebpfsentinel_link_attach_gap_seconds{kind}` | Time from the first message announcing a link to the chain being attached to it |
| `ebpfsentinel_link_attach_unguarded_packets_total{kind}` | Packets the link had carried, both directions, by the time the chain was attached, read from the kernel's own counters for it |

Only links the watcher heard announced are counted. A link found by reading the table, at start, after a socket overrun or on the 60-second resync, has no announcement to measure from and is not counted: at start its traffic predates the agent. A link renamed or re-enslaved is not counted either, since the chain was on it until the release just before. A steady non-zero rate on the packet counter means workloads are talking before the agent can see them, and is the figure to alert on.

The watcher runs whenever at least one TC program is loaded.

## CLI Overrides

```bash
ebpfsentinel-agent \
  --config config/ebpfsentinel.yaml \
  --log-level debug \
  --log-format text
```

## Environment Variables

```bash
EBPFSENTINEL_BIND_ADDRESS=0.0.0.0
EBPFSENTINEL_HTTP_PORT=8080
RUST_LOG=info
```

## Examples

### Listen on all interfaces

```yaml
agent:
  interfaces: [eth0, eth1]
  bind_address: "0.0.0.0"
```

### Force native XDP for production

```yaml
agent:
  interfaces: [eth0]
  xdp_mode: native
```

If the driver does not support native XDP, the agent falls back to auto and logs:

```
WARN XDP attach failed with requested mode, falling back to auto  requested_mode="native" error="..."
INFO XDP program attached (fallback from native)  mode="auto"
```

### Multi-NIC and Bond Interfaces

eBPFsentinel natively supports multiple interfaces. Every eBPF program (XDP and TC) is attached to **each** interface listed in `agent.interfaces`. All 14 security domains work identically across all listed interfaces.

```yaml
# Multi-NIC: attach to all physical interfaces
agent:
  interfaces: [eth0, eth1, eth2]
```

**Bond / Team interfaces**: attach to the bond master, not the member NICs. The bond device receives all traffic from its members:

```yaml
# Linux bond (active-passive or LACP)
agent:
  interfaces: [bond0]
```

**VLAN trunk interfaces**: attach to the parent interface. VLAN-tagged traffic passes through XDP/TC on the physical NIC before VLAN decapsulation. eBPFsentinel parses 802.1Q/802.1ad headers natively - firewall rules can match on `vlan_id`:

```yaml
# Physical interface carrying tagged VLANs
agent:
  interfaces: [eth0]

firewall:
  rules:
    - id: block-guest-vlan
      action: deny
      vlan_id: 100         # matches 802.1Q VLAN 100
```

If you also need rules scoped per-interface, use [interface groups](../features/interface-groups.md):

```yaml
agent:
  interfaces: [eth0, eth1, eth2]

interface_groups:
  lan:
    interfaces: [eth0, eth1]
  wan:
    interfaces: [eth2]
```

**What NOT to do**:
- Do not list both a bond master and its members (`[bond0, eth0, eth1]`) - traffic would be processed twice.
- Do not list VLAN sub-interfaces (`eth0.100`) - attach to the parent (`eth0`) and use `vlan_id` in rules.

### Debug logging with text format

```yaml
agent:
  interfaces: [eth0]
  log_level: "debug"
  log_format: "text"
```

## Management metadata

Top-level `management:` block. Surfaces ownership of the agent's
configuration to the dashboard via `GET /api/v1/agent/identity`. Both
fields default to absent / `false` and are hot-reloadable.

| Field | Type | Default | Description |
|---|---|---|---|
| `operator_managed` | bool | `false` | When `true`, the dashboard locks its config-edit UI on this agent - the Kubernetes operator (CRD) owns the configuration and writes back from the dashboard would drift. |
| `operator_endpoint` | string (URL) | unset | Optional absolute `http://` or `https://` URL pointing at the operator's UI. The dashboard deep-links from the "operator-managed" badge. Validated at config load - malformed or non-`http(s)` URLs reject the reload. |

```yaml
management:
  operator_managed: true
  operator_endpoint: https://operator.example.com:9443/ui
```

A reload that toggles either field is reflected on the next request to
`GET /api/v1/agent/identity` without restarting the agent.
