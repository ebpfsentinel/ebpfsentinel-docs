# Zone Segmentation

Zone segmentation groups network interfaces into logical security zones (WAN, LAN, DMZ, etc.) and enforces inter-zone traffic policies. This is the classic DMZ-firewall pattern — define zones by interface membership, then declare which zone pairs allow or deny traffic.

## Concepts

### Zones

A zone is a named group of network interfaces with a default traffic policy:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique zone name (e.g., `wan`, `lan`, `dmz`) |
| `interfaces` | list | Network interfaces belonging to this zone |
| `default_policy` | string | `allow` or `deny` — verdict when nothing more specific matched |

Each interface can belong to only one zone. The maximum is 64 zones.

A packet is attributed to a zone by the interface it arrived on, so an interface
that no zone claims stays unzoned and is never evaluated against a zone policy.

### Decision Order

For every packet, the firewall applies the first of these that matches:

1. An explicit firewall rule.
2. The inter-zone policy for the (source zone, destination zone) pair. The
   destination zone is the zone of the interface the packet would be routed
   out of, resolved through a kernel FIB lookup.
3. The `default_policy` of the zone the packet arrived in.
4. The global firewall default policy.

### Inter-Zone Policies

Zone policies define what happens when traffic crosses zone boundaries:

| Field | Type | Description |
|-------|------|-------------|
| `from` | string | Source zone |
| `to` | string | Destination zone |
| `policy` | string | `allow` or `deny` |

Policies are directional — a policy from `lan` to `wan` does not imply the reverse. You must explicitly define both directions if needed.

### Policy Aliases

The following policy strings are all accepted:
- **Allow**: `allow`, `permit`, `accept`
- **Deny**: `deny`, `drop`, `reject`

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

## Integration

- **Firewall**: zones decide the packets no firewall rule matched, so they set the posture the rule set carves exceptions out of
- **Aliases**: Zones complement [IP aliases](aliases.md) — zones group interfaces while aliases group addresses

## Metrics

Per-zone counters are exported as `ebpfsentinel_zone_packets_total{zone, action}`
with `action` being `passed` or `dropped`. Traffic on interfaces no zone claims
is counted under `zone="unzoned"` — a non-zero value there is traffic that
escaped the segmentation entirely.

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

Changes made through the API and through a configuration reload are both pushed
down to the datapath immediately, so a zone that the API reports is a zone that
decides packets.

See [REST API Reference](../api-reference/rest-api.md) for details.
