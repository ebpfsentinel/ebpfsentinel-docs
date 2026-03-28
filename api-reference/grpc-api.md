# gRPC API Reference

Port: `50051` (configurable via `agent.grpc_port`)

## AlertStreamService

Server-streaming RPC for real-time alert subscriptions.

### Service Definition

```protobuf
service AlertStreamService {
  rpc StreamAlerts(StreamAlertsRequest) returns (stream AlertEvent);
}

message StreamAlertsRequest {
  string min_severity = 1;    // Optional: critical, high, medium, low, info
  string component = 2;       // Optional: ids, ips, dlp, firewall, threatintel, dns, l7
}

message AlertEvent {
  string id = 1;
  string timestamp = 2;
  string component = 3;
  string severity = 4;
  string rule_id = 5;
  string src_addr = 6;
  string dst_addr = 7;
  string description = 8;
}
```

### Usage

```bash
# All alerts
grpcurl -plaintext localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts

# Only critical IDS alerts
grpcurl -plaintext -d '{"min_severity":"critical","component":"ids"}' \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts

# With TLS
grpcurl -cacert server.crt localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

## Authentication

gRPC supports the same authentication methods as the REST API.

**Bearer token (JWT):** Pass via the `authorization` metadata header:

```bash
grpcurl -plaintext -H "authorization: Bearer <JWT>" \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

**API key:** Pass via the `x-api-key` metadata header:

```bash
grpcurl -plaintext -H "x-api-key: sk-admin-key" \
  localhost:50051 ebpfsentinel.v1.AlertStreamService/StreamAlerts
```

The server checks `authorization` metadata first. If absent, it falls back to `x-api-key`. Bearer tokens must have valid JWT structure (three Base64-encoded parts separated by dots).

## Health Check

Standard gRPC health checking protocol:

```bash
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

## Reflection

gRPC server reflection is **disabled by default**. To enable it, set `agent.grpc_reflection` in your configuration:

```yaml
agent:
  grpc_reflection: true
```

Once enabled:

```bash
# List available services
grpcurl -plaintext localhost:50051 list

# Describe a service
grpcurl -plaintext localhost:50051 describe ebpfsentinel.v1.AlertStreamService
```

When reflection is disabled, `grpcurl list` will return an error. Use the proto file directly with `-proto` instead.

## Scope

eBPFsentinel is **REST-first**: all CRUD operations (firewall rules, rate limit policies, NAT rules, LB services, etc.) are managed via the [REST API](rest-api.md) with 73 routes. gRPC is used exclusively for **real-time alert streaming** (`AlertStreamService`), providing server-push event delivery for SIEM integrations and monitoring dashboards.

## Proto File

The proto file is at `proto/ebpfsentinel/v1/alerts.proto` in the repository.
