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
outer tag of a QinQ frame, and carries it on the event it emits. A match is
therefore attributable to the VLAN it arrived on, and alerts can be filtered by
VLAN downstream.

The enforcement vocabulary is `alert` or `block` and there is no third value:

```yaml
threatintel:
  mode: block               # Enforcement is decided here, for every feed at once
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
traffic, or `alert` to report it and pass it on. The mode is global: it decides
what happens to a match from any feed. See
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
- `FLAG_VLAN` in `PacketEvent.flags` signals a tagged frame, which is what
  tells a frame tagged with VLAN 0 apart from an untagged one
- `PacketEvent.vlan_id` carries the outer VLAN ID

## Code Architecture

| Layer | Implementation |
|-------|---------------|
| `ebpf-common` | `PacketEvent.vlan_id` field, `FLAG_VLAN` flag |
| `ebpf-helpers` | `parse_vlan_tags!`, the single 802.1Q and 802.1ad parser |
| `ebpf-programs` | `xdp-firewall` and the TC programs call that parser |
| `domain` | VLAN-aware firewall rule matching |
| `infrastructure` | Config validation for VLAN IDs (0-4094) |
