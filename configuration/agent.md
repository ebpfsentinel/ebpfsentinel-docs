# Agent Configuration

The `agent` section configures the core agent behavior — network interfaces, API ports, and logging.

## Reference

```yaml
agent:
  interfaces: [eth0]                    # Required. Network interfaces to attach eBPF programs to.
  xdp_mode: auto                        # XDP attachment mode: auto, native, generic, offloaded. Default: auto
  bind_address: "127.0.0.1"             # REST API listen address. Default: 127.0.0.1
  http_port: 8080                       # REST API port. Default: 8080
  grpc_port: 50051                      # gRPC port. Default: 50051
  grpc_reflection: false                # gRPC reflection. Default: false (disabled for security)
  metrics_port: 9090                    # Prometheus metrics port. Default: 9090 (or shared with REST)
  ebpf_program_dir: null                # Directory for eBPF binaries. Default: null (uses embedded)
  event_workers: 4                      # Parallel event dispatcher workers. Default: 4
  log_level: "info"                     # Log level: error, warn, info, debug, trace. Default: info
  log_format: "json"                    # Log format: json or text. Default: json
```

## Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `interfaces` | `[string]` | Yes | — | Network interfaces to monitor |
| `xdp_mode` | `string` | No | `auto` | XDP attachment mode (see below) |
| `bind_address` | `string` | No | `127.0.0.1` | REST API listen address |
| `http_port` | `integer` | No | `8080` | REST API port |
| `grpc_port` | `integer` | No | `50051` | gRPC streaming port |
| `grpc_reflection` | `bool` | No | `false` | Enable gRPC server reflection. Disabled by default for security — exposes service definitions |
| `metrics_port` | `integer` | No | `9090` | Prometheus metrics port |
| `ebpf_program_dir` | `Option<string>` | No | `None` | Directory for eBPF binaries. When `None`, the agent uses embedded programs |
| `event_workers` | `usize` | No | `4` | Number of parallel event dispatcher workers |
| `attach_mode` | `string` | No | `auto` | TC program attachment mode (see below) |
| `swagger_ui` | `bool` | No | `false` | Enable Swagger UI at `/swagger-ui/` |
| `log_level` | `string` | No | `info` | Log level |
| `log_format` | `string` | No | `json` | Log output format |

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

**Netkit hot-plug**: in `auto` or `netkit` mode, a background watcher polls `/sys/class/net/` every 5 seconds for new netkit devices. When a new device appears (e.g., Kubernetes pod creation), all loaded TC programs are automatically attached without restarting the agent.

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

**VLAN trunk interfaces**: attach to the parent interface. VLAN-tagged traffic passes through XDP/TC on the physical NIC before VLAN decapsulation. eBPFsentinel parses 802.1Q/802.1ad headers natively — firewall rules can match on `vlan_id`:

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
- Do not list both a bond master and its members (`[bond0, eth0, eth1]`) — traffic would be processed twice.
- Do not list VLAN sub-interfaces (`eth0.100`) — attach to the parent (`eth0`) and use `vlan_id` in rules.

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
| `operator_managed` | bool | `false` | When `true`, the dashboard locks its config-edit UI on this agent — the Kubernetes operator (CRD) owns the configuration and writes back from the dashboard would drift. |
| `operator_endpoint` | string (URL) | unset | Optional absolute `http://` or `https://` URL pointing at the operator's UI. The dashboard deep-links from the "operator-managed" badge. Validated at config load — malformed or non-`http(s)` URLs reject the reload. |

```yaml
management:
  operator_managed: true
  operator_endpoint: https://operator.example.com:9443/ui
```

A reload that toggles either field is reflected on the next request to
`GET /api/v1/agent/identity` without restarting the agent.
