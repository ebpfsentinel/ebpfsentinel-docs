# Zone Segmentation Configuration

Network zone segmentation with inter-zone policies. See [Zone Segmentation](../features/zones.md) for the feature overview.

## Configuration

```yaml
zones:
  enabled: false
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

## Reference

### Core

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable zone segmentation |
| `zones` | list | `[]` | Zone definitions (max 64) |
| `policies` | list | `[]` | Inter-zone traffic policies |

### Zone Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | — | Unique zone name |
| `interfaces` | list | — | Network interfaces (at least one required) |
| `default_policy` | string | `deny` | Intra-zone default: `allow` or `deny` |

### Policy Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `from` | string | — | Source zone (must exist in `zones`) |
| `to` | string | — | Destination zone (must differ from `from`) |
| `policy` | string | — | `allow`/`permit`/`accept` or `deny`/`drop`/`reject` |

## Validation Rules

- Zone IDs must be unique
- Each zone must have at least one interface
- An interface cannot belong to multiple zones
- Policy `from` and `to` must reference existing zones
- `from` and `to` must be different

## Examples

### Data Center Segmentation

```yaml
zones:
  enabled: true
  zones:
    - id: internet
      interfaces: [eth0]
      default_policy: deny
    - id: app
      interfaces: [eth1]
      default_policy: allow
    - id: db
      interfaces: [eth2]
      default_policy: deny
    - id: mgmt
      interfaces: [eth3]
      default_policy: allow
  policies:
    - { from: internet, to: app, policy: allow }
    - { from: app, to: db, policy: allow }
    - { from: mgmt, to: app, policy: allow }
    - { from: mgmt, to: db, policy: allow }
    - { from: internet, to: db, policy: deny }
    - { from: db, to: internet, policy: deny }
```

Only the app tier can reach the database, and the management network can reach everything. The internet zone can only reach the app tier.
