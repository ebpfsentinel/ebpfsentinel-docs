# Zone Segmentation

Zone segmentation groups network interfaces into logical security zones (WAN, LAN, DMZ, etc.) and enforces inter-zone traffic policies. This is the classic DMZ-firewall pattern — define zones by interface membership, then declare which zone pairs allow or deny traffic.

## Concepts

### Zones

A zone is a named group of network interfaces with a default traffic policy:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique zone name (e.g., `wan`, `lan`, `dmz`) |
| `interfaces` | list | Network interfaces belonging to this zone |
| `default_policy` | string | `allow` or `deny` — policy for traffic within the zone |

Each interface can belong to only one zone. The maximum is 64 zones.

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

- **Firewall**: Rules can match by zone ID instead of raw CIDRs, simplifying rule management
- **Aliases**: Zones complement [IP aliases](aliases.md) — zones group interfaces while aliases group addresses

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/zones/status` | Enabled status, zone count, and policy count |
| GET | `/api/v1/zones` | List all zones with interfaces and default policies |
| GET | `/api/v1/zones/policies` | List all inter-zone policies |

See [REST API Reference](../api-reference/rest-api.md) for details.
