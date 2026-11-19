# Interface Groups Configuration

The `interface_groups` section defines named groups of network interfaces for multi-interface rule scoping. Rules across firewall, QoS, and other domains can target specific groups via the `interfaces` field instead of listing individual interfaces.

## Reference

```yaml
agent:
  interfaces: [eth0, eth1, eth2, eth3]

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
| `interfaces` | list | required | List of interface names in this group; each must also be listed in `agent.interfaces`, or the configuration load fails |

Maximum 31 groups (groups are stored as a 31-bit mask, with bit 31 reserved for inversion).

The same 31 bits also carry firewall rules scoped to one interface: every
interface in `agent.interfaces` takes the next free bit after the named groups,
in the order it is listed, so the kernel can hold a rule to that interface. An
interface left without a bit cannot carry an interface-scoped rule, and such a
rule fails the configuration load. Keep groups plus interfaces within 31.

Containers do not take bits. An IDS rule meant for one container or pod names
it in a `workload` block instead, decided on the container's cgroup with no
ceiling of 31, see [IDS workload scope](ids.md#workload-scope).

## Inversion

A firewall rule names groups in `interfaces`. To hold a rule to one
interface without a group, write `scope: { interface: eth0 }` instead: a
bare interface name in `interfaces` is read as a group and refused if no
group carries it.

Every rule list scoped by group is held to the declared names when the
configuration loads: firewall and IDS rules, rate limit rules, the three NAT
rule lists and QoS pipes and classifiers. A name no group declares refuses
the whole file, the way a firewall rule always did, rather than leaving that
section empty behind a warning. Under the operator the same check runs before
the document is written: the agent keeps the configuration it runs, the
resource naming the group is never reported as carried, and the agent's
events name it.

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
agent:
  interfaces: [eth0, eth1, eth2, eth3, eth4, veth0]

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
