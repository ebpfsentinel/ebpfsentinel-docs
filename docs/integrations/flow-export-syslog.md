# rsyslog and syslog-ng

The agent writes RFC 5424 records over UDP, TCP or TLS. This page configures the
receiving side so the flows land in a file or a relay of their own rather than
in the middle of everything else the node says.

## The agent side

```yaml
flow_export:
  enabled: true
  syslog:
    enabled: true
    facility: 16
    hostname: ""
    targets:
      - address: "10.0.0.9:514"
        transport: udp
```

One record looks like this:

```text
<134>1 2025-10-09T08:53:32.500Z node-1 ebpfsentinel - flow - rt=1760000012500 src=10.0.0.7 spt=51234 dst=93.184.216.34 dpt=443 proto=tcp out=2048 in=16384 flowPackets=12 flowPacketsReverse=10 start=1760000000000 end=1760000012500 flowDurationMs=12500 flowEndReason=idle_timeout
```

The three things a collector matches on are the application name
`ebpfsentinel`, the message id `flow`, and the facility, `16` by default, which
is `local0`. The structured-data field is `-`: an SD-ID of one's own requires a
registered enterprise number, this project holds none, and the fields ride the
message where every reader can see them instead of under somebody else's number.

The timestamp is the record's own end time, not the moment of the send, so a
message delayed by a collector that was down still says when the flow ended.

## rsyslog

```text
module(load="imudp")
input(type="imudp" port="514" ruleset="sentinel_flows")

module(load="imtcp")
input(type="imtcp" port="601" ruleset="sentinel_flows")

template(name="sentinel_flow_line" type="string"
         string="%timereported:::date-rfc3339% %hostname% %msg%\n")

ruleset(name="sentinel_flows") {
  if ($app-name == "ebpfsentinel" and $msgid == "flow") then {
    action(type="omfile"
           file="/var/log/ebpfsentinel/flows.log"
           template="sentinel_flow_line")
    stop
  }
}
```

`stop` is what keeps thousands of flow records a minute out of
`/var/log/syslog`, and the reason the agent defaults to `local0` rather than to
the facility its alerts use: a rule that matches the facility is one an operator
can write before reading this page.

On a stream the agent frames with RFC 6587 octet counting rather than newlines,
which is what `imtcp` expects by default. Leave
`supportOctetCountedFraming` alone unless something else on that port needs it
off; turning it off makes every record arrive truncated at the first length
prefix.

### TLS

```text
global(
  defaultNetstreamDriver="gtls"
  defaultNetstreamDriverCAFile="/etc/ssl/internal-ca.pem"
  defaultNetstreamDriverCertFile="/etc/rsyslog/collector-cert.pem"
  defaultNetstreamDriverKeyFile="/etc/rsyslog/collector-key.pem"
)

module(load="imtcp" StreamDriver.Name="gtls"
                    StreamDriver.Mode="1"
                    StreamDriver.AuthMode="anon")
input(type="imtcp" port="6514" ruleset="sentinel_flows")
```

The agent verifies the collector against the authority named in
`syslog.ca_cert` and **sends no client certificate**, so the collector
authenticates the agent by network position rather than mutually. `AuthMode`
above says so rather than leaving a rejected handshake to be debugged. There is
no option on the agent to skip verification: a flow record names every address a
workload talked to, and an agent that accepted any certificate would send that
to whoever answered the port.

```yaml
flow_export:
  syslog:
    enabled: true
    targets:
      - address: "syslog.internal:6514"
        transport: tls
    ca_cert: /etc/ebpfsentinel/syslog-ca.pem
```

An unreadable or unparseable authority fails startup naming the path, rather
than leaving the sink quietly absent.

## syslog-ng

```text
source s_ebpfsentinel {
  network(ip(0.0.0.0) port(514) transport("udp") flags(syslog-protocol));
  network(ip(0.0.0.0) port(601) transport("tcp") flags(syslog-protocol));
};

destination d_flows {
  file("/var/log/ebpfsentinel/flows.log"
       template("${ISODATE} ${HOST} ${MESSAGE}\n"));
};

filter f_flows {
  program("ebpfsentinel") and match("flow" value("MSGID"));
};

log { source(s_ebpfsentinel); filter(f_flows); destination(d_flows); flags(final); };
```

`flags(syslog-protocol)` is required: without it the source is parsed as RFC
3164 and the version, the message id and the structured-data field end up inside
the message.

## The fields

The message is the field list and nothing else, because a collector parses it
rather than reads it. The keys are the ones the enterprise SIEM exporters
already write for the same fields, so an estate that upgrades keeps its parsers;
the full table is on the [CEF page](flow-export-cef.md), which shares the
mapping.

A field the node could not read has **no key at all** rather than an empty one,
and a transited flow carries none of the workload keys: a packet this node only
forwarded has no local socket, so there is no process to name. A parser that
reads `spid=0` as a process is a parser this agent never feeds.

## When the collector is down

Each target is its own sink. One that cannot reach its collector counts the
records it could not send, waits a second before trying again and doubles that
wait up to a minute, and names the reason in
`ebpfsentinel-agent flows export` and under `flow_sinks_unhealthy` on
`/readyz`. UDP hides a dead collector by design, which is the argument for `tcp`
or `tls` on anything whose silence would be noticed late.
