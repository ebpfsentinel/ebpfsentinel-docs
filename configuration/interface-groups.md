# Interface Groups Configuration

The `interface_groups` section defines named groups of network interfaces for multi-interface rule scoping. Rules across firewall, QoS, and other domains can target specific groups via the `interfaces` field instead of listing individual interfaces.

## Reference

```yaml
interface_groups:
  lan:
    interfaces: [eth0, eth1]
  wan:
    interfaces: [eth2]
  dmz:
    interfaces: [eth3]
```

## Fields

Each entry under `interface_groups` is a group name mapped to its configuration:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `interfaces` | list | required | List of interface names in this group |

Maximum 31 groups (groups are stored as a 31-bit mask, with bit 31 reserved for inversion).

## Inversion

When referencing interface groups in rules (firewall, QoS classifiers, QoS pipes, etc.), prefix the group name with `"!"` to invert the match. For example, `"!lan"` means "all interfaces except those in the lan group."

```yaml
qos:
  pipes:
    - id: shaped-wan
      bandwidth: "100mbps"
      interfaces: ["!lan"]     # Applies to all interfaces NOT in the lan group
```

## Example

```yaml
interface_groups:
  lan:
    interfaces: [eth0, eth1]
  wan:
    interfaces: [eth2]
  dmz:
    interfaces: [eth3, veth0]
  mgmt:
    interfaces: [eth4]

firewall:
  rules:
    - id: allow-lan-to-dmz
      priority: 10
      action: allow
      protocol: tcp
      interfaces: ["lan"]
    - id: block-wan-inbound
      priority: 20
      action: deny
      protocol: any
      interfaces: ["wan"]
```
