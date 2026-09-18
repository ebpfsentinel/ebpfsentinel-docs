# Zone Segmentation

Zone segmentation groups network interfaces into logical security zones (WAN, LAN, DMZ, etc.) and enforces inter-zone traffic policies. This is the classic DMZ-firewall pattern - define zones by interface membership, then declare which zone pairs allow or deny traffic.

## Concepts

### Zones

A zone is a named group of network interfaces with a default traffic policy:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique zone name (e.g., `wan`, `lan`, `dmz`) |
| `interfaces` | list | Network interfaces belonging to this zone |
| `default_policy` | string | `allow` or `deny` - verdict when nothing more specific matched |

Each interface can belong to only one zone. The maximum is 64 zones, refused
the same way whether the sixty-fifth arrives in a configuration file or
through `POST /api/v1/zones`.

A packet is attributed to a zone by the interface it arrived on, so an interface
that no zone claims stays unzoned and is never evaluated against a zone policy.

### Decision Order

For every packet, the firewall applies the first of these that matches:

1. An explicit firewall rule.
2. The inter-zone policy for the (source zone, destination zone) pair. The
   destination zone is the zone of the interface the packet would be routed
   out of, resolved through a kernel FIB lookup. That step is skipped, and the
   next one decides, whenever the ingress interface belongs to no zone, the FIB
   cannot resolve a route, the interface it names belongs to no zone, or the
   packet stays inside one zone: traffic that does not cross a boundary is not
   inter-zone traffic.
3. The `default_policy` of the zone the packet arrived in.
4. The global firewall default policy.

### Inter-Zone Policies

Zone policies define what happens when traffic crosses zone boundaries:

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Source zone |
| `to` | string | Destination zone |
| `policy` | string | `allow` or `deny` |

Policies are directional - a policy from `lan` to `wan` does not imply the reverse. You must explicitly define both directions if needed.

### Policy Aliases

The following policy strings are all accepted, in a configuration file and in
an API request body alike:

- **Allow**: `allow`, `permit`, `accept`
- **Deny**: `deny`, `drop`, `reject`

Case is not significant. Any other word is refused - `400 ZONE_INVALID` over
the API, a load error in a file - rather than read as a deny, so a request
asking for something the agent does not understand is answered rather than
silently given the opposite of what it asked for. Every reading answers in the
two canonical words, `allow` and `deny`, whichever alias declared the policy.

## Example

```yaml
zones:
  enabled: true
  zones:
    - id: wan
      interfaces: [eth0]
      default_policy: deny
    - id: lan
      interfaces: [eth1, eth2]
      default_policy: allow
    - id: dmz
      interfaces: [eth3]
      default_policy: deny
  policies:
    - from: lan
      to: wan
      policy: allow
    - from: lan
      to: dmz
      policy: allow
    - from: dmz
      to: wan
      policy: allow
    - from: wan
      to: dmz
      policy: deny
    - from: wan
      to: lan
      policy: deny
    - from: dmz
      to: lan
      policy: deny
```

This creates a classic DMZ topology: LAN can reach WAN and DMZ, DMZ can reach WAN, but WAN cannot initiate connections to LAN or DMZ.

## Validation

The zone configuration is validated at load time:

- Zone IDs must be non-empty and unique
- Each zone must have at least one interface
- Interfaces cannot belong to multiple zones
- Zone pair policies must reference existing zones
- `from` and `to` must be different zones

**The API is held to the same rules**, because a zone the datapath cannot
program is a zone the API would otherwise report as configured: a zone with no
interface, an interface another zone already claims, a sixty-fifth zone and a
policy naming a zone that does not exist are all refused by `POST /api/v1/zones`
and `POST /api/v1/zones/policies` exactly as they are refused in a file.
Removing a zone removes the inter-zone policies that name it, for the same
reason.

## Integration

- **Firewall**: zones decide the packets no firewall rule matched, so they set the posture the rule set carves exceptions out of
- **Aliases**: Zones complement [IP aliases](aliases.md) - zones group interfaces while aliases group addresses

## Metrics

Per-zone counters are exported as `ebpfsentinel_zone_packets_total{zone, action}`
with `action` being `passed` or `dropped`, counted against the zone the packet
**arrived** in. Only the packets zone posture decided are counted: a packet an
explicit firewall rule matched is counted by the firewall and never reaches
these counters, so they measure the posture rather than the interface's total
traffic. Traffic on interfaces no zone claims is counted under `zone="unzoned"`
- a non-zero value there is traffic that escaped the segmentation entirely.

Two gauges sit beside them, both labelled by zone: `ebpfsentinel_zone_interfaces`
counts the interfaces a zone claims and `ebpfsentinel_zone_policies` the
inter-zone policies whose source it is.

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/zones/status` | Enabled status, zone count, and policy count |
| GET | `/api/v1/zones` | List all zones with interfaces and default policies |
| GET | `/api/v1/zones/policies` | List all inter-zone policies |
| POST | `/api/v1/zones` | Create a zone |
| DELETE | `/api/v1/zones/{id}` | Remove a zone |
| POST | `/api/v1/zones/policies` | Create an inter-zone policy |
| DELETE | `/api/v1/zones/policies/{id}` | Remove an inter-zone policy |

`POST /api/v1/zones` takes `{name, interfaces?, default_policy?}` - `name` is
the zone id, and an absent `default_policy` denies. `POST /api/v1/zones/policies`
takes `{source_zone, dest_zone, action}`. A policy is addressed by
`{from}__{to}`, which is the `id` every policy reading carries, so
`DELETE /api/v1/zones/policies/lan__wan` removes the `lan` to `wan` policy.
Each policy also carries `action` as an alias of `policy`, holding the same
word.

Changes made through the API and through a configuration reload are both pushed
down to the datapath immediately, so a zone that the API reports is a zone that
decides packets. An interface that is not up yet has no ifindex and is skipped
with a warning rather than failing the whole programming, so it stays unzoned
until the next reload.

See [REST API Reference](../api-reference/rest-api.md) for details.
