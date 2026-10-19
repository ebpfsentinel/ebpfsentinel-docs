# A File and a Shipper

One JSON object per line, appended to a file. This is the sink for an estate
whose shipper already tails files, and for the case where the flows must sit on
disk before anything forwards them.

## The agent side

```yaml
flow_export:
  enabled: true
  json_lines:
    enabled: true
    path: /var/log/ebpfsentinel/flows.jsonl
```

One line, with no workload resolved:

```json
{"timestamp":"2025-10-09T08:53:32.500Z","event.name":"ebpfsentinel.flow","source.address":"10.0.0.7","source.port":51234,"destination.address":"93.184.216.34","destination.port":443,"network.transport":"tcp","ebpfsentinel.flow.protocol_number":6,"network.type":"ipv4","ebpfsentinel.flow.packets":12,"ebpfsentinel.flow.bytes":2048,"ebpfsentinel.flow.packets_reverse":10,"ebpfsentinel.flow.bytes_reverse":16384,"ebpfsentinel.flow.start_time_unix_ms":1760000000000,"ebpfsentinel.flow.end_time_unix_ms":1760000012500,"ebpfsentinel.flow.duration_ms":12500,"ebpfsentinel.flow.end_reason":"idle_timeout","ebpfsentinel.flow.end_reason_code":1}
```

The names are the OTLP attribute names, so a file tailed off disk and a log
pushed to a collector answer the same query. What differs is the typing: every
count is a JSON number, because a reader indexing
`ebpfsentinel.flow.bytes` as a string cannot sum it. `timestamp` is the record's
own end time in RFC 3339, which is what a reader indexes on, so a file replayed
after an outage does not re-date every flow in it.

There is no array and no wrapping object, which is what lets a shipper start in
the middle of a rotated file and makes a truncated last line cost one record
rather than the file. The full attribute table is in
[flow export configuration](../configuration/flow-export.md).

A field the node could not read has no key at all, and a transited flow carries
no workload key whatsoever: a packet this node only forwarded has no local
socket, so there is no process to name. A query grouping by
`process.executable.path` shows transit as a missing key rather than as an empty
bucket.

## logrotate

Rotation is the system's job, and both policies work because the sink checks
before each batch that the file it holds open is still the file at the
configured path:

```text
/var/log/ebpfsentinel/flows.jsonl {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

`create`, the default, renames the file and the sink reopens the path on its
next batch. `copytruncate` keeps the inode, so no reopen happens and none is
needed. Neither needs a signal sent to the agent, and neither leaves it writing
into an unlinked inode.

Size it for the volume: a busy node writes thousands of records a minute, each
around 400 bytes with a workload resolved. `flow_export.sampling` and
`flow_export.active_timeout_secs` are the two numbers that change that, and
sampling on the agent is cheaper than discarding later because the record is
never built. `maxsize 500M` alongside `daily` is the usual answer on a node
whose disk is smaller than its traffic.

The file is created readable and writable by its owner alone, and its directory
is created where it is absent. A flow record names every address a workload
talked to, which on a shared node is somebody's business, so a shipper reading
it runs as that owner or in its group rather than the mode being widened.

## Vector

```toml
[sources.sentinel_flows]
type = "file"
include = ["/var/log/ebpfsentinel/flows.jsonl"]
read_from = "beginning"

[transforms.sentinel_flows_parsed]
type = "remap"
inputs = ["sentinel_flows"]
source = '''
. = parse_json!(string!(.message))
.timestamp = parse_timestamp!(.timestamp, "%+")
'''
```

The parse is unconditional on purpose: every line this sink writes is one JSON
object, so a line that does not parse is a corrupted file rather than a format
to tolerate, and `parse_json!` aborting the event is how it gets noticed.

## Filebeat

```yaml
filebeat.inputs:
  - type: filestream
    id: ebpfsentinel-flows
    paths:
      - /var/log/ebpfsentinel/flows.jsonl
    parsers:
      - ndjson:
          target: ""
          overwrite_keys: true
          add_error_key: true
```

`target: ""` lifts the fields to the top level, which is what makes
`source.address` and `destination.port` the same field names an Elastic Common
Schema index already holds. The attribute names were chosen for that: the
OpenTelemetry conventions and ECS agree on the ones that matter here.

## Promtail and Loki

```yaml
scrape_configs:
  - job_name: ebpfsentinel-flows
    static_configs:
      - targets: [localhost]
        labels:
          job: ebpfsentinel-flows
    pipeline_stages:
      - json:
          expressions:
            end_reason: '"ebpfsentinel.flow.end_reason"'
            transport: '"network.transport"'
      - labels:
          end_reason:
          transport:
      - timestamp:
          source: timestamp
          format: RFC3339Nano
```

Label on the end reason and the transport and nothing else. An address or a port
as a label is a new stream per flow, which is how a Loki install falls over;
they stay in the line, where `json` filters read them at query time.

## When the disk is full

A write that fails is the same story as a dead collector: the sink counts the
records it could not write, waits a second before trying again and doubles that
wait up to a minute, and names the reason in `ebpfsentinel-agent flows export`
and under `flow_sinks_unhealthy` on `/readyz`. It never blocks the pipeline, and
a full disk therefore costs flow records rather than enforcement.
