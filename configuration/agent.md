# Agent Configuration

The `agent` section configures the core agent behavior — network interfaces, API ports, and logging.

## Reference

```yaml
agent:
  interfaces: [eth0]           # Required. Network interfaces to attach eBPF programs to.
  xdp_mode: auto               # XDP attachment mode: auto, native, generic, offloaded. Default: auto
  host: "127.0.0.1"            # REST API listen address. Default: 127.0.0.1
  port: 8080                   # REST API port. Default: 8080
  grpc_port: 50051             # gRPC port. Default: 50051
  grpc_reflection: false       # gRPC reflection. Default: false (disabled for security)
  metrics_port: 9090           # Prometheus metrics port. Default: 9090 (or shared with REST)
  log_level: "info"            # Log level: error, warn, info, debug, trace. Default: info
  log_format: "json"           # Log format: json or text. Default: json
```

## Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `interfaces` | `[string]` | Yes | — | Network interfaces to monitor |
| `xdp_mode` | `string` | No | `auto` | XDP attachment mode (see below) |
| `host` | `string` | No | `127.0.0.1` | REST API listen address |
| `port` | `integer` | No | `8080` | REST API port |
| `grpc_port` | `integer` | No | `50051` | gRPC streaming port |
| `grpc_reflection` | `bool` | No | `false` | Enable gRPC server reflection. Disabled by default for security — exposes service definitions |
| `metrics_port` | `integer` | No | `9090` | Prometheus metrics port |
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

## CLI Overrides

```bash
ebpfsentinel-agent \
  --config config/ebpfsentinel.yaml \
  --log-level debug \
  --log-format text
```

## Environment Variables

```bash
EBPFSENTINEL_HOST=0.0.0.0
EBPFSENTINEL_PORT=8080
RUST_LOG=info
```

## Examples

### Listen on all interfaces

```yaml
agent:
  interfaces: [eth0, eth1]
  host: "0.0.0.0"
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
      vlan_id: 100       # matches 802.1Q VLAN 100
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
