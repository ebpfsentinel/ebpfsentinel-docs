# IPFIX Collectors

The agent writes RFC 7011 IPFIX over UDP or TCP. This page configures the
receiving side: a quick check with nfdump, a collector that decodes the workload
block, and what a commercial collector needs to be told.

## The agent side

```yaml
flow_export:
  enabled: true
  sampling: 1
  ipfix:
    enabled: true
    observation_domain_id: 1
    enterprise_number: 0
    targets:
      - address: "collector.internal:4739"
        transport: udp
```

`enterprise_number` stays `0` until you have a registered private enterprise
number of your own: the workload block has no IANA element, and a collector
decoding somebody else's number against this field layout reads the wrong field
without saying so. At `0` the five-tuple, the counters, the timestamps and the
end reason are exported and the workload block is not.

Every field, every default and the four template definitions are in
[flow export configuration](../configuration/flow-export.md).

## nfdump, for the first packet

nfdump's collector accepts IPFIX and is the shortest way to prove the wire is
alive before any element definition exists.

```bash
mkdir -p /var/cache/nfdump
nfcapd -l /var/cache/nfdump -p 4739 -b 0.0.0.0 -T all -e
```

Read what landed:

```bash
nfdump -R /var/cache/nfdump -o long -c 20
```

nfdump maps the IANA elements and ignores the private ones, so this shows the
five-tuple, the counters and the timestamps and shows nothing of the workload
block. That is the right first step and the wrong final state: a collector that
drops the workload block turns this export back into the flow record every other
product already has.

## ipfixcol2, with the workload block decoded

ipfixcol2 reads element definitions from libfds, so the private elements can be
named once and then appear in the output like any other field. Create the scope
under the number you registered, matching the layout the agent writes:

```xml
<?xml version="1.0" encoding="utf-8"?>
<ipfix-elements>
  <scope>
    <pen>55555</pen>
    <name>ebpfsentinel</name>
    <biflowMode>none</biflowMode>
  </scope>
  <element><id>1</id><name>workloadProcessName</name><dataType>string</dataType></element>
  <element><id>2</id><name>workloadProcessPath</name><dataType>string</dataType></element>
  <element><id>3</id><name>workloadProcessId</name><dataType>unsigned32</dataType></element>
  <element><id>4</id><name>workloadContainerId</name><dataType>string</dataType></element>
  <element><id>5</id><name>workloadContainerName</name><dataType>string</dataType></element>
  <element><id>6</id><name>workloadContainerImage</name><dataType>string</dataType></element>
  <element><id>7</id><name>workloadPodNamespace</name><dataType>string</dataType></element>
  <element><id>8</id><name>workloadCgroupId</name><dataType>unsigned64</dataType></element>
</ipfix-elements>
```

Replace `55555` with your own number, and drop the file where your build of
libfds reads user definitions from. The path moved between versions, so check
the one your package ships rather than copying a path from here:

```bash
ipfixcol2 -h | head -n 20
ls /etc/libfds/system/elements/
```

The startup configuration then needs nothing special, because by this point the
elements are no longer unknown:

```xml
<ipfixcol2>
  <inputPlugins>
    <input>
      <name>UDP input</name>
      <plugin>udp</plugin>
      <params>
        <localPort>4739</localPort>
      </params>
    </input>
  </inputPlugins>
  <outputPlugins>
    <output>
      <name>JSON output</name>
      <plugin>json</plugin>
      <params>
        <tcpFlags>formatted</tcpFlags>
        <timestamp>formatted</timestamp>
        <protocol>formatted</protocol>
        <ignoreUnknown>false</ignoreUnknown>
        <outputs>
          <print><name>Printer</name></print>
        </outputs>
      </params>
    </output>
  </outputPlugins>
</ipfixcol2>
```

`ignoreUnknown` set to `false` is what makes a mistake visible: an element the
collector has no definition for is printed under its number instead of being
dropped, so a scope written against the wrong number is obvious on the first
record rather than at the first investigation.

## A commercial collector

Three things have to be told to it, and none of them is on the wire:

- **The sampling rate.** No information element carries it. A collector left at
  `1` while the agent exports one flow in ten under-reports volume by a factor
  of ten, and the number it shows is wrong in a way nothing in the data reveals.
- **The observation domain id**, where several exporters send to one collector
  and their flows must stay apart.
- **The private enterprise number and this field layout**, if the workload block
  is wanted. A collector that cannot be taught private elements receives the
  five-tuple and the counters correctly and nothing else, which is a supported
  configuration rather than a broken one.

Templates are re-sent every `ipfix.template_interval_secs` and immediately on
reconnection, so a collector restarted mid-stream decodes again without the
agent being touched.

## What a transited flow carries

Nothing in the workload block. A packet this node only forwarded has no local
socket, so there is no process to attribute it to, and the record goes out on
template 256 or 257 rather than with empty workload fields. A collector that
sees a flow with no workload is looking at transit, not at a failed lookup.

## When the collector is down

```bash
ebpfsentinel-agent flows export
```

Each target is its own sink with its own connection, sequence number and health.
A sink that cannot reach its collector counts the records it could not send,
waits a second before trying again and doubles that wait up to a minute, and
names the reason here and under `flow_sinks_unhealthy` on `/readyz`. It never
holds readiness back: a dead collector must not evict a node that is still
enforcing traffic.
