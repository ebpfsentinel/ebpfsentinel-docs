# Agent Configuration

The `agent` section configures the core agent behavior — network interfaces, API ports, and logging.

## Reference

```yaml
agent:
  interfaces: [eth0]           # Required. Network interfaces to attach eBPF programs to.
  host: "127.0.0.1"            # REST API listen address. Default: 127.0.0.1
  port: 8080                   # REST API port. Default: 8080
  grpc_port: 50051             # gRPC port. Default: 50051
  metrics_port: 9090           # Prometheus metrics port. Default: 9090 (or shared with REST)
  log_level: "info"            # Log level: error, warn, info, debug, trace. Default: info
  log_format: "json"           # Log format: json or text. Default: json
```

## Fields

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `interfaces` | `[string]` | Yes | — | Network interfaces to monitor |
| `host` | `string` | No | `127.0.0.1` | REST API listen address |
| `port` | `integer` | No | `8080` | REST API port |
| `grpc_port` | `integer` | No | `50051` | gRPC streaming port |
| `metrics_port` | `integer` | No | `9090` | Prometheus metrics port |
| `log_level` | `string` | No | `info` | Log level |
| `log_format` | `string` | No | `json` | Log output format |

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

### Debug logging with text format

```yaml
agent:
  interfaces: [eth0]
  log_level: "debug"
  log_format: "text"
```
