# CEF to a SIEM

The same flow records inside a CEF message, in the same RFC 5424 envelope, over
UDP, TCP or TLS. The syslog message id is `CEF`, so a collector's CEF rule finds
them without parsing the message.

## The agent side

```yaml
flow_export:
  enabled: true
  cef:
    enabled: true
    facility: 16
    hostname: ""
    targets:
      - address: "siem.internal:6514"
        transport: tls
    ca_cert: /etc/ebpfsentinel/siem-ca.pem
```

One record, with a workload resolved:

```text
CEF:0|eBPFsentinel|Agent|0.0.0-dev|flow|network flow|1|rt=1760000012500 src=10.0.0.7 spt=51234 dst=93.184.216.34 dpt=443 proto=tcp out=2048 in=16384 flowPackets=12 flowPacketsReverse=10 start=1760000000000 end=1760000012500 flowDurationMs=12500 flowEndReason=idle_timeout workloadSource=socket spid=4242 sproc=curl filePath=/usr/bin/curl suid=1000 cgroupId=9876 containerId=3f2b containerImage=docker.io/library/nginx:1.27 podName=web-0 podNamespace=shop serviceAccount=web systemdUnit=nginx.service
```

The device vendor and product are the strings the enterprise SIEM exporters
already send, the device version is the agent's own, the signature id is `flow`
and the name is `network flow`, which is what tells a reader holding both alerts
and flows from one agent which of the two it has. The severity is `1`: a flow
record is an observation, and the lowest alert this product sends is a `3`, so a
rule that fires above `2` never fires on a flow.

## The fields

The field names are shared with the enterprise SIEM exporters wherever the field
exists on both sides, so an operator moving from the open-source agent to the
enterprise one does not re-learn them. The mapping lives in one place in the
agent and is asserted there rather than compared on a reader's screen.

| Key | Field |
|-----|-------|
| `rt` | The record's end time, in milliseconds |
| `src`, `spt`, `dst`, `dpt` | The five-tuple's addresses and ports |
| `proto` | The protocol's name, or `proto-<n>` where the number has no usual name |
| `out`, `in` | Bytes from and to the source, as deltas |
| `flowPackets`, `flowPacketsReverse` | Packets in each direction, as deltas |
| `start`, `end`, `flowDurationMs` | The two timestamps and the span between them |
| `flowEndReason` | `idle_timeout`, `active_timeout`, `end_of_flow`, `forced` or `lack_of_resources` |
| `flowSampling` | The sampling rate, written only where it is not `1` |
| `workloadSource` | How the workload was joined: `socket`, `flow` or `process` |
| `spid`, `sproc`, `filePath`, `suid` | The process id, the binary's name, its whole path and the owning user |
| `cgroupId`, `containerId`, `containerImage` | The cgroup and container |
| `podName`, `podNamespace`, `serviceAccount`, `systemdUnit` | The Kubernetes and systemd identities |

Everything a flow has and an alert does not is prefixed `flow`, because CEF has
no key for a packet delta, a reverse direction, an end reason or a sampling
rate, and an invented short name would sit in the same namespace as a future
standard one.

`cnt` is deliberately **not** used for the packet count. CEF defines it as a
base event count, a reader that honours it multiplies the event, and one record
carrying two hundred packets would become two hundred records in the SIEM's own
totals.

**`filePath` is what the process claims.** It is the path the kernel reports for
the executable, which an attacker who controls the binary controls too, so it
identifies a workload and does not authenticate one. Correlate on it; do not
authorise on it.

### What a transited flow carries

Nothing in the workload block. A packet this node only forwarded has no local
socket, so the record carries none of the workload keys rather than carrying
them empty. A correlation rule that reads `spid=0` as a process is a rule this
agent cannot feed, and a rule keyed on `workloadSource` being absent is how
transit is selected.

## ArcSight

Point the agent at the Syslog Daemon connector and let the connector do the
parsing, since the format is already CEF:

```yaml
flow_export:
  cef:
    enabled: true
    targets:
      - address: "arcsight-connector.internal:514"
        transport: udp
```

The extension keys above are not ArcSight's own field names: `src`, `spt`,
`dst`, `dpt`, `proto`, `out`, `in`, `rt`, `spid`, `sproc`, `filePath` and `suid`
map to the standard CEF dictionary and arrive as fields; the `flow`-prefixed
keys and the workload keys that are not in the dictionary arrive as custom
string fields. Map the ones a rule needs in the connector rather than renaming
them on the agent, because the agent's names are what the enterprise exporters
also send.

## QRadar

Create a log source per node or per relay, with a CEF-capable DSM, and point the
agent at QRadar's syslog port. DSM names and the exact event-mapping screen move
between versions, so take the version's own list rather than a name from here:

```yaml
flow_export:
  cef:
    enabled: true
    targets:
      - address: "qradar-collector.internal:514"
        transport: tcp
```

QRadar maps the CEF header's signature id to an event, so every flow record
arrives as one event named `flow`, with `network flow` as its name. Setting the
severity mapping to leave a `1` at the bottom keeps flows out of the offence
rules that alerts should drive.

## Any SIEM that reads syslog

A SIEM with no CEF support still receives useful records: relay them to a file
with rsyslog, matching on the message id `CEF` rather than on `flow`, and index
the file. The [syslog page](flow-export-syslog.md) has the rsyslog and syslog-ng
configurations, including the TLS listener, and the plain syslog sink carries the
same fields without the CEF header if that is all the reader wants.

## When the SIEM is down

Each target is its own sink. One that cannot reach the SIEM counts the records
it could not send, waits a second before trying again and doubles that wait up
to a minute, and names the reason in `ebpfsentinel-agent flows export` and under
`flow_sinks_unhealthy` on `/readyz`, without holding readiness back or blocking
the pipeline.
