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

When the outer EtherType is `0x88A8` (802.1ad), the eBPF parser recognizes a QinQ frame and parses both the outer S-VLAN and inner C-VLAN tags before reaching the IP header. The outer (service) VLAN ID is available for policy matching, while the inner (customer) VLAN ID is preserved.

## eBPF Implementation

- Inline `VlanHdr` struct for 802.1Q and 802.1ad header parsing
- QinQ support: the parser handles stacked VLAN headers (EtherType `0x8100` for 802.1Q, `0x88A8` for 802.1ad)
- Read-only: no program calls `bpf_skb_vlan_push` or `bpf_skb_vlan_pop`, so a tag is never added, removed or rewritten
- `FLAG_VLAN` in `PacketEvent.flags` signals VLAN-tagged packets to userspace
- `PacketEvent.vlan_id` carries the original VLAN ID

## Code Architecture

| Layer | Implementation |
|-------|---------------|
| `ebpf-common` | `PacketEvent.vlan_id` field, `FLAG_VLAN` flag |
| `ebpf-programs` | VLAN and QinQ header parsing in `xdp-firewall` and the TC programs |
| `domain` | VLAN-aware firewall rule matching |
| `infrastructure` | Config validation for VLAN IDs (0-4094) |
