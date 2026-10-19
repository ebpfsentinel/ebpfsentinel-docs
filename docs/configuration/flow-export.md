# Flow Export Configuration

Flow export turns the kernel connection table into flow records and sends them
where a SOC already reads. This page configures IPFIX and OTLP logs; syslog, CEF
and JSON lines are configured in their own sections.

Nothing here is licence-gated: flow export is part of the open-source agent.

## Configuration

```yaml
flow_export:
  enabled: false
  active_timeout_secs: 60
  idle_timeout_secs: 15
  table_capacity: 65536
  sampling: 1
  queue_depth: 4096
  batch_size: 256
  tick_interval_secs: 5
  ipfix:
    enabled: false
    targets: []
    observation_domain_id: 0
    enterprise_number: 0
    template_interval_secs: 600
    max_message_bytes: 1400
  otlp:
    enabled: false
```

## Reference

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Build flow records at all. Off means no flow table is kept, so a node exporting nowhere pays nothing. |
| `active_timeout_secs` | u64 | `60` | A record is written for a still-running flow this often. |
| `idle_timeout_secs` | u64 | `15` | A flow with no change for this long is treated as over. Checked before the active timeout, so an idle overdue flow is reported as ended rather than as running. |
| `table_capacity` | usize | `65536` | Flows held at once. Past it, the flow whose last reading is oldest is written out early with `lackOfResources` and counted as an eviction. |
| `sampling` | u32 | `1` | Export one flow in this many. `1` exports every flow. The decision is taken once per flow from a hash of its five-tuple, so what a collector receives is whole conversations. |
| `queue_depth` | usize | `4096` | Records held between the flow table and the sinks. A full queue drops the newest record and counts it; it never pushes back into the data path. |
| `batch_size` | usize | `256` | Records handed to a sink in one go. |
| `tick_interval_secs` | u64 | `5` | How often the table is asked what the clock has made due. |
| `ipfix.enabled` | bool | `false` | Enable the IPFIX sink. |
| `ipfix.targets` | list | `[]` | One entry per collector: `address` (`host:port`) and `transport` (`udp` or `tcp`). Each target is its own sink with its own connection, sequence number and health. |
| `ipfix.observation_domain_id` | u32 | `0` | Written into every message header, for a collector receiving from several exporters. |
| `ipfix.enterprise_number` | u32 | `0` | The private enterprise number the workload block is exported under. At `0` the workload elements are not exported at all. |
| `ipfix.template_interval_secs` | u64 | `600` | How often the templates are re-sent (RFC 7011 section 10.3.6). |
| `ipfix.max_message_bytes` | usize | `1400` | Maximum IPFIX message size. Keep it inside the path MTU. |
| `otlp.enabled` | bool | `false` | Send the same records as OTLP logs to the collector `alerting.otlp` names. There is no endpoint here: see below. |

A target address that does not parse, an empty target list with the sink
enabled, a sampling rate of `0` or a `max_message_bytes` too small to hold a
header and one record are refused at start rather than at the first packet.

## Why the enterprise number defaults to zero

The workload block, the process and container behind the local end of a flow,
has no IANA information element. It is exported as private enterprise elements,
and a private element only means something next to the number it was registered
under. This project holds no registered PEN, so the default is `0` and the
workload elements are simply not exported: a collector decoding somebody else's
number against our field layout would read the wrong field and say nothing about
it. Set `enterprise_number` to your own registered number and the workload
templates are offered.

The reverse counters are not affected. They use PEN 29305, which RFC 5103
registered for exactly that purpose.

## Templates

Four templates, so that the absence of a workload is structural rather than a
field full of zeroes. A record arrives on the template that fits what the node
actually knows:

| ID | Contents |
|----|----------|
| 256 | IPv4 five-tuple, counters, timestamps, end reason |
| 257 | IPv6 five-tuple, counters, timestamps, end reason |
| 258 | Template 256 plus the workload block |
| 259 | Template 257 plus the workload block |

Templates 258 and 259 are offered only when `enterprise_number` is set.

### Template 256 - IPv4

| Element | ID | Length | Meaning |
|---------|----|--------|---------|
| `sourceIPv4Address` | 8 | 4 | Source address |
| `destinationIPv4Address` | 12 | 4 | Destination address |
| `sourceTransportPort` | 7 | 2 | Source port |
| `destinationTransportPort` | 11 | 2 | Destination port |
| `protocolIdentifier` | 4 | 1 | IP protocol number |
| `packetDeltaCount` | 2 | 8 | Packets since the previous record for this flow |
| `octetDeltaCount` | 1 | 8 | Bytes since the previous record for this flow |
| `postPacketDeltaCount` (PEN 29305) | 2 | 8 | Packets in the reverse direction |
| `postOctetDeltaCount` (PEN 29305) | 1 | 8 | Bytes in the reverse direction |
| `flowStartMilliseconds` | 152 | 8 | First reading of the flow |
| `flowEndMilliseconds` | 153 | 8 | Last reading of the flow |
| `flowEndReason` | 136 | 1 | Why the record was written |

### Template 257 - IPv6

Identical, with `sourceIPv6Address` (27, 16 bytes) and
`destinationIPv6Address` (28, 16 bytes) in place of the two IPv4 elements.

### The workload block

Appended to templates 258 and 259, all under the configured PEN, all
variable-length except the two numeric fields:

| Element | ID | Length | Meaning |
|---------|----|--------|---------|
| `workloadProcessName` | 1 | varlen | Executable name of the local process |
| `workloadProcessPath` | 2 | varlen | Executable path. Forgeable: it is what the process claims, not a verified identity |
| `workloadProcessId` | 3 | 4 | PID |
| `workloadContainerId` | 4 | varlen | Container id, when the flow is a container's |
| `workloadContainerName` | 5 | varlen | Container name |
| `workloadContainerImage` | 6 | varlen | Container image |
| `workloadPodNamespace` | 7 | varlen | Kubernetes namespace |
| `workloadCgroupId` | 8 | 8 | Kernel cgroup id |

### What a transited flow carries

Nothing in the workload block. A packet this node only forwarded has no local
socket, so there is no process to attribute it to, and the record goes out on
template 256 or 257 rather than with empty workload fields. A collector that
sees a flow with no workload is looking at transit, not at a failed lookup.

### End reasons

RFC 7012 values: `1` idle timeout, `2` active timeout, `3` end of flow
(the kernel dropped the connection), `4` forced end (the agent is shutting
down), `5` lack of resources (the flow table was full).

## Flow records as OTLP logs

`flow_export.otlp.enabled: true` exports every record the table writes as an
OTLP log record, to the collector the `alerting.otlp` section already names.
That section holds the endpoint, the protocol (`grpc` or `http`), the headers,
the certificate authority and the timeout, and this one holds a single switch:
an estate running one collector writes its address once, and two copies of it
cannot disagree. Turning this on with no `alerting.otlp` block is refused at
start, naming the block that is missing, rather than running a sink that sends
nowhere.

```yaml
alerting:
  otlp:
    endpoint: http://otel-collector:4318
    protocol: http

flow_export:
  enabled: true
  otlp:
    enabled: true
```

Each record is one log record: event name `ebpfsentinel.flow`, severity `INFO`,
and a body that is the five-tuple as a reader recognises it
(`tcp 10.0.0.7:51234 -> 93.184.216.34:443 12 packets 2048 bytes`). Everything
worth querying is an attribute rather than text in the body.

### Attributes

Names follow the OpenTelemetry semantic conventions where one exists, so a SIEM
already holding OTLP logs queries these with the fields it already indexes, and
sit under `ebpfsentinel.` where no convention does.

| Attribute | Source |
|-----------|--------|
| `source.address`, `source.port` | The local end of the flow as conntrack printed it |
| `destination.address`, `destination.port` | The remote end |
| `network.transport` | `tcp` or `udp`, and absent for every other protocol: the conventions name those two |
| `network.type` | `ipv4` or `ipv6` |
| `ebpfsentinel.flow.protocol_number` | The IP protocol number, always present, which is how an ESP or GRE flow still carries its protocol |
| `ebpfsentinel.flow.packets`, `ebpfsentinel.flow.bytes` | Forward deltas since the previous record for this flow |
| `ebpfsentinel.flow.packets_reverse`, `ebpfsentinel.flow.bytes_reverse` | The same two in the reverse direction |
| `ebpfsentinel.flow.start_time_unix_ms`, `ebpfsentinel.flow.end_time_unix_ms`, `ebpfsentinel.flow.duration_ms` | The window this record covers |
| `ebpfsentinel.flow.end_reason`, `ebpfsentinel.flow.end_reason_code` | The word and the RFC 7012 number |
| `ebpfsentinel.flow.sampling` | The rate the table sampled at, written only when it is not `1`, because no convention carries it and a collector cannot scale a count up without it |

The workload block, where the node resolved one:

| Attribute | Source |
|-----------|--------|
| `process.pid`, `process.executable.path` | The process behind the local socket |
| `container.id`, `container.image.name` | The container it runs in |
| `k8s.pod.name`, `k8s.namespace.name` | The pod and namespace |
| `ebpfsentinel.workload.source` | How the join was made: `socket`, `flow` or `process` |
| `ebpfsentinel.workload.uid`, `ebpfsentinel.workload.cgroup_id`, `ebpfsentinel.workload.unit`, `ebpfsentinel.workload.service_account` | The rest of the block |

**Absence is absence.** A field the node could not read has no attribute at
all: no empty string and no zero. A transited flow carries no workload
attribute whatsoever, which is the same statement the IPFIX templates make
structurally.

### What a flush confirms

The SDK batches on a thread of its own, so an emit says nothing about whether a
collector accepted the record. Delivery is confirmed on a timer, every thirty
seconds, which is what the sink's health reports: a flush the collector refused
counts the records that batch held under `ebpfsentinel_flow_export_failures_total`,
backs the sink off for five seconds and then up to a minute, and shows the
reason under `flow_sinks_unhealthy`. A flush per batch would stall the drain for
the exporter's whole timeout on every tick a collector was down, and no flush at
all would leave the health endpoint calling a sink fine while every record was
lost.

## Counters

Every record carries deltas. A conntrack row is cumulative, so each record
carries what happened since the previous record for that flow, which is what
`octetDeltaCount` and `packetDeltaCount` mean on the wire. A counter that went
backwards is a reused tuple rather than a negative delta, and is reported as a
restart.

## Status and metrics

```bash
ebpfsentinel-agent flows export
```

The three Prometheus families are `ebpfsentinel_flows_exported_total`,
`ebpfsentinel_flow_export_failures_total` and
`ebpfsentinel_flows_dropped_total`. A flow dropped because the queue was full
is counted under the reason `queue_full`, one lost to a conntrack stream the
exporter could not keep up with under `conntrack_lag`, and one a sink refused
under `sink_error`. A dropped flow is always a counter and never a silence.

The sink name on both export series is the IPFIX target (`ipfix-udp-10.0.0.9:4739`)
or `otlp`.

An unreachable collector is reported by `/readyz` under `flow_sinks_unhealthy`
and deliberately does not hold readiness back: a dead SIEM must not evict a node
that is still enforcing traffic.

## Example

A full annotated example is at `config/examples/flow-export.yaml`.
