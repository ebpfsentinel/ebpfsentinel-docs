# Integrations

The agent's own screens are not where most estates read it. These pages take
what the agent produces and put it into the tool the team already watches, with
a collector configuration that works as written.

## Flow export

Every record the flow table writes can leave the node in five formats at once.
They carry the same fields, so the choice is about what the receiving side
already parses rather than about what is in the record.

| Format | Page | Pick it when |
|--------|------|--------------|
| IPFIX | [IPFIX collectors](flow-export-ipfix.md) | A netflow collector is already in place, and the question asked of flows is volume over time |
| OTLP logs | [OpenTelemetry collectors](flow-export-otlp.md) | The estate already runs an OpenTelemetry collector, and this is one switch rather than one more endpoint |
| RFC 5424 syslog | [rsyslog and syslog-ng](flow-export-syslog.md) | Everything else on the node already arrives by syslog, and the flows should land beside it |
| CEF | [CEF to a SIEM](flow-export-cef.md) | The SIEM is ArcSight or QRadar, or any reader whose flow parser expects CEF |
| JSON lines | [A file and a shipper](flow-export-json-lines.md) | A shipper already tails files, or the flows must sit on disk before anything forwards them |

Flow export is part of the open-source agent. None of it is licence-gated, and
the field names the enterprise SIEM exporters use are the ones the open-source
CEF sink writes, so an estate that upgrades keeps its correlation rules.

The fields themselves, the defaults and every refusal are in
[flow export configuration](../configuration/flow-export.md). What those pages
add is the other half of the wire: the collector.
