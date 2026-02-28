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

## Health Check

Standard gRPC health checking protocol:

```bash
grpcurl -plaintext localhost:50051 grpc.health.v1.Health/Check
```

## Reflection

gRPC server reflection is enabled by default:

```bash
# List available services
grpcurl -plaintext localhost:50051 list

# Describe a service
grpcurl -plaintext localhost:50051 describe ebpfsentinel.v1.AlertStreamService
```

## Proto File

The proto file is at `proto/ebpfsentinel/v1/alerts.proto` in the repository.
