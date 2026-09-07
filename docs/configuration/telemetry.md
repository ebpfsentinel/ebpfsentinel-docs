# Telemetry Configuration

The agent sends an anonymous heartbeat every 30 minutes so we know how many
installations are running and which eBPF programs they actually load. It is on
by default. This page states exactly what leaves your machine, shows the bytes
on the wire, and tells you how to switch it off.

## What is sent

Three things, and there is no fourth:

- a random installation identifier, drawn from `/dev/urandom` on first boot and
  kept in one file;
- the agent version;
- the name and load state of each eBPF program.

## What is never sent

**What the agent runs goes out. What the agent is configured with never does.**
That distinction is the whole design, and it is enforced by the shape of the
message rather than by a filter: the payload has no map, no free-text field and
no arbitrary JSON value, so there is nowhere for any of the following to travel.

Never sent, and structurally unable to be sent:

- your configuration file, in whole or in part
- firewall, IDS, IPS, L7, DLP, NAT, QoS or routing rules
- IP addresses, subnets, MAC addresses or interface names
- host names, domain names or DNS queries
- packet contents, flows, alerts or captures
- licence keys, API keys, tokens or any other credential
- kernel version, distribution, CPU count or any other machine fingerprint

The identifier is random. It is not derived from the machine, so it cannot be
reversed into a host name, a MAC address or a serial number.

## Example message

One `POST` with a JSON body. This is a complete heartbeat from an agent running
eight of its programs:

```json
{
  "installation_id": "3f8a1c9d47b25e60a1d3f9c8b7e40521",
  "version": "0.1.0",
  "programs": [
    { "program": "tc_conntrack", "state": "loaded" },
    { "program": "tc_dns", "state": "loaded" },
    { "program": "tc_ids", "state": "loaded" },
    { "program": "tc_nat_egress", "state": "not_loaded" },
    { "program": "tc_nat_ingress", "state": "not_loaded" },
    { "program": "tc_qos", "state": "not_loaded" },
    { "program": "tc_scrub", "state": "loaded" },
    { "program": "tc_threatintel", "state": "loaded" },
    { "program": "uprobe_dlp", "state": "not_loaded" },
    { "program": "xdp_firewall", "state": "loaded" },
    { "program": "xdp_loadbalancer", "state": "not_loaded" },
    { "program": "xdp_ratelimit", "state": "loaded" },
    { "program": "xdp_vip_announcer", "state": "not_loaded" }
  ]
}
```

An agent that loaded nothing - no eBPF capability, or every program refused by
the verifier - sends the same three keys with an empty list:

```json
{
  "installation_id": "3f8a1c9d47b25e60a1d3f9c8b7e40521",
  "version": "0.1.0",
  "programs": []
}
```

That is the entire message. The response is not read, so there is nothing the
endpoint can tell this agent to do.

## Saying so at boot

The agent announces telemetry once, on the way up, naming the destination and
the way out. If you never see this line, telemetry is not running:

```text
INFO telemetry on: this agent reports its installation id, its version and which
eBPF programs are loaded. It never reports configuration, rules, addresses,
interfaces or host names. Switch it off with telemetry.enabled=false or
EBPFSENTINEL_TELEMETRY_DISABLE=1
  endpoint="https://..." installation_id="3f8a1c9d47b25e60a1d3f9c8b7e40521"
  interval_minutes=30
```

## Switching it off

Either way works, and either is enough.

In the config file:

```yaml
telemetry:
  enabled: false
```

Or in the environment, which is often the only thing you can change about a
container image:

```bash
EBPFSENTINEL_TELEMETRY_DISABLE=1
```

Any value at all counts, including `0`. Somebody who sets that variable has
said what they want, and reading it as a boolean is how "I set it to 0 and it
stayed on" happens.

The environment wins over the file. Nothing else can turn it back on.

## Reference

```yaml
telemetry:
  enabled: true
  state_path: "/var/lib/ebpfsentinel/telemetry/installation"
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Send the heartbeat |
| `state_path` | `string` | `/var/lib/ebpfsentinel/telemetry/installation` | Where the installation identifier is kept. Must be absolute |

There is no `endpoint` key, and adding one is refused at boot along with any
other key this table does not name. Where the heartbeat goes is fixed at build
time, so a config file cannot redirect this agent at a host of somebody's
choosing.

## The identifier file

`state_path` holds thirty-two hex characters and nothing else. It is written
`0600` inside a `0700` directory, and a file the agent did not write is refused
rather than sent.

The path must be absolute. A relative one would follow the working directory,
so a service restarted from elsewhere would mint a second identifier and be
counted twice.

Delete the file and the agent draws a new identifier on its next start, which
is what to do before cloning a machine into an image: an identifier baked into
a golden image reports a thousand machines as one installation.

## Building from source

The destination is supplied at build time. A build from these sources without
it has nowhere to report, so telemetry does not start and the agent says so at
`debug` level:

```text
DEBUG telemetry not enabled in this build: telemetry not configured: no endpoint
```

Nothing else about the agent changes.

## Transport

`https` only, unless the endpoint is on loopback. Redirects are not followed,
so the destination cannot be moved by whatever answers. The connection times
out at 5 seconds and the request at 10.

A failed beat is logged at `debug` and forgotten. There is no retry: the next
one is half an hour away, and an agent that turned our outage into your alert
would be a worse neighbour than one that misses a window.

## Enterprise

The enterprise agent sends this same heartbeat, on the same interval, carrying
the same three fields, and it is switched off by the same two settings. An
enterprise deployment is an installation like any other, and leaving it out of
the count would report every paying estate as none.

Enrolling with the portal does not replace it and does not switch it off. The
two are different reports with different audiences:

| | This heartbeat | Portal enrolment and reporting |
|---|---|---|
| Who it names | nobody - a random identifier | your organisation and your deployment |
| What it carries | version, program names and states | version, and counters if you enable them |
| When it runs | on by default | only where you configured `enterprise.portal` |
| How to stop it | `telemetry.enabled: false` or the environment variable | remove the portal block |

So an enrolled agent sends both, and the two counts are never added together:
one counts installations and the other counts your estate against your
subscription. See [Enterprise configuration](./enterprise.md) for the portal
side, which is off unless you turn it on.
