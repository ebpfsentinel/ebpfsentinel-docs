# OpenTelemetry Collectors

Flow records leave the node as OTLP log records, through the exporter
configuration the agent already carries for its alerts. An estate already
receiving agent telemetry over OTLP receives flows by turning one switch.

## The agent side

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

There is no endpoint in the `flow_export` section on purpose. The address, the
protocol, the headers, the certificate authority and the timeout live once in
`alerting.otlp`, so two copies of a collector address cannot disagree. Turning
this on with no `alerting.otlp` block is refused at start, naming the block that
is missing, rather than running a sink that sends nowhere.

## The collector side

A receiver, a batch processor and whatever the estate already exports to. This
one prints, which is what to start with:

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  batch: {}

exporters:
  debug:
    verbosity: detailed

service:
  pipelines:
    logs:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
```

Flows and alerts arrive on the same pipeline, because they come from one
exporter. Telling them apart is one attribute:

```yaml
processors:
  filter/flows_only:
    logs:
      log_record:
        - 'attributes["event.name"] != "ebpfsentinel.flow"'
```

An alert record carries `alert.component` and `alert.rule_id` and no
`event.name`, so the same condition inverted keeps the alerts and drops the
flows. Routing the two to different backends is the `routing` connector over
that same attribute.

## Volume

A flow record is a log record, and flows are not alerts: a busy node writes
thousands a minute where it writes a handful of alerts a day. Two numbers decide
what the collector receives, and both are on the agent:

- `flow_export.sampling` exports one flow in N, chosen once per flow from a hash
  of its five-tuple, so what arrives is whole conversations rather than fragments
  of all of them. The rate rides every record as
  `ebpfsentinel.flow.sampling` whenever it is not `1`, so a query can multiply
  back up, and its absence means every flow was exported rather than meaning
  nobody wrote the rate down.
- `flow_export.active_timeout_secs` decides how often a long-lived flow is
  reported again. Raising it from 60 to 300 divides the records a steady
  connection produces by five and costs five minutes of resolution.

Sampling on the agent is cheaper than filtering in the collector, because the
record is never built, never queued and never serialised.

## Attributes

The attribute names follow the OpenTelemetry semantic conventions wherever one
exists, so a backend already holding OTLP logs queries flows with the fields it
already indexes, and sit under `ebpfsentinel.` where no convention does. The
full table is in
[flow export configuration](../configuration/flow-export.md).

**Absence is absence.** A field the node could not read has no attribute at all:
no empty string and no zero. A transited flow carries no workload attribute
whatsoever, which is the same statement the IPFIX templates make structurally. A
dashboard grouping by `process.executable.path` therefore shows transit as a
missing key rather than as an empty bucket.

## When the collector is down

The SDK batches on a thread of its own, so an emit says nothing about whether a
collector accepted the record. Delivery is confirmed on a timer, every thirty
seconds, which is what `ebpfsentinel-agent flows export` reports: a flush the
collector refused counts the records that batch held, backs the sink off, and
shows the reason under `flow_sinks_unhealthy` on `/readyz` without holding
readiness back.
