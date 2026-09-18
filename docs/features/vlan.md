# VLAN 802.1Q / 802.1ad (QinQ) Support

> **Edition: OSS** | **Enforcement: XDP, TC**

## Overview

eBPFsentinel supports 802.1Q VLAN filtering and **802.1ad QinQ (double VLAN tagging)** in the kernel-side packet processing path. QinQ allows service providers to encapsulate customer VLAN tags inside a provider VLAN tag (S-VLAN + C-VLAN).

VLAN tags are **parsed, matched and reported**. No program rewrites a tag: the agent does not push, pop or translate a VLAN header on any hook.

## Firewall VLAN Filtering

Firewall rules can match on VLAN ID. Omit `vlan_id` to match any VLAN; set it
to `0` to match untagged traffic only, or to 1-4094 for an exact tag:

```yaml
firewall:
  rules:
    - id: allow-management-vlan
      priority: 5
      action: allow
      vlan_id: 100
      protocol: tcp
      dst_port: 22
    - id: isolate-guest-vlan
      priority: 10
      action: deny
      vlan_id: 200
      dst_ip: "10.0.0.0/8"
```

## VLAN in Threat Intelligence Events

`tc-threatintel` parses the VLAN tag of every frame it inspects, including the
outer tag of a QinQ frame, and carries it on the `PacketEvent` it emits, so the
userspace pipeline sees which VLAN a match arrived on.

The tag stops there. **No alert, audit line or metric carries a VLAN**: the
alert an operator reads names the addresses, the ports, the feed and the action,
and there is no field on it a tag could travel in, so alerts cannot be filtered
by VLAN and no counter is broken down by one. Reaching a per-VLAN view means
matching on the tag in the rule itself, which the firewall and the QoS
classifier do and nothing else does.

The enforcement vocabulary is `alert` or `block` and there is no third value.
It is set for the service and a feed carrying its own `default_action`
overrides it for its own indicators:

```yaml
threatintel:
  mode: block               # Enforcement for every feed naming no default_action
  feeds:
    - id: malware-ips
      name: malware-ips
      url: "https://feeds.example.com/malware.txt"
      format: plaintext
```

There is **no VLAN quarantine action**. `tc-threatintel` is attached to the TC
ingress hook, where re-tagging a matched packet would move it onto no other
segment: the frame is already bound for the local stack. Isolating a source by
VLAN means redirecting it on egress, which is a different program on a different
hook, and no shipped program does it. Use `threatintel.mode: block` to stop the
traffic, or `alert` to report it and pass it on, either for the whole service or
for one feed through its own `default_action`. See
[Configuration: Threat Intelligence](../configuration/threatintel.md).

## QinQ (802.1ad) Double VLAN

When the EtherType is `0x8100` (802.1Q) or `0x88A8` (802.1ad) the eBPF parser
walks the tag, and when a second tag follows it walks that one too, so the IP
header is reached at the right offset on a double-tagged frame.

The **outer** (service) VLAN ID is the one a policy matches on and the one an
event carries. The inner (customer) VLAN ID is not reported separately: a
packet event carries a single VLAN ID, and the inner tag is left in the frame
untouched, because no program adds, removes or rewrites a tag.

## eBPF Implementation

- One shared tag parser in `ebpf-helpers`, used by every program that needs a
  VLAN ID, so all of them report the same tag of a double-tagged frame
- QinQ support: the parser handles stacked VLAN headers (EtherType `0x8100` for 802.1Q, `0x88A8` for 802.1ad)
- Read-only: no program calls `bpf_skb_vlan_push` or `bpf_skb_vlan_pop`, so a tag is never added, removed or rewritten
- `FLAG_VLAN` in `PacketEvent.flags` signals a tagged frame, which is what tells
  a frame tagged with VLAN 0 apart from an untagged one **on the event**; a rule
  asking for `vlan_id: 0` is matched on the ID alone, so it also fires on a
  priority-tagged frame carrying VLAN 0
- `PacketEvent.vlan_id` carries the outer VLAN ID
- **Hardware VLAN offload is recovered on one hook only.** A NIC that strips the
  802.1Q tag before delivering the frame leaves nothing for the parser to read.
  `xdp-firewall` falls back to the `bpf_xdp_metadata_rx_vlan_tag` kfunc (kernel
  6.8+) and recovers the stripped tag; no other program does, so on such a NIC
  the QoS classifier, the IDS, threat intel and the DNS capture see an untagged
  frame. Turn the offload off (`ethtool -K <iface> rxvlan off`) where a tag has
  to be visible to more than the firewall.

## Code Architecture

| Layer | Implementation |
|-------|---------------|
| `ebpf-common` | `PacketEvent.vlan_id` field, `FLAG_VLAN` flag |
| `ebpf-helpers` | `parse_vlan_tags!`, the single 802.1Q and 802.1ad parser |
| `ebpf-programs` | Every program that parses a frame calls that parser: `xdp-firewall`, `xdp-ratelimit`, `xdp-loadbalancer` and the TC programs |
| `domain` | VLAN-aware firewall rule matching |
| `infrastructure` | Config validation for VLAN IDs (0-4094) |
