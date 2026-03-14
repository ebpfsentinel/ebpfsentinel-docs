# VLAN 802.1Q / 802.1ad (QinQ) Support

> **Edition: OSS** | **Status: Shipped** | **Enforcement: XDP, TC**

## Overview

eBPFsentinel supports 802.1Q VLAN filtering, quarantine tagging, and **802.1ad QinQ (double VLAN tagging)** in the kernel-side packet processing path. QinQ allows service providers to encapsulate customer VLAN tags inside a provider VLAN tag (S-VLAN + C-VLAN).

## Firewall VLAN Filtering

Firewall rules can match on VLAN ID (0 = any VLAN, >0 = exact match):

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

## VLAN Quarantine

Threat intelligence can tag matching traffic with a quarantine VLAN using `bpf_skb_vlan_push`:

```yaml
threatintel:
  quarantine_vlan: 999
  feeds:
    - name: malware-ips
      url: "https://feeds.example.com/malware.txt"
      format: plaintext
      action: quarantine    # Tags with VLAN 999 instead of dropping
```

## QinQ (802.1ad) Double VLAN

When the outer EtherType is `0x88A8` (802.1ad), the eBPF parser recognizes a QinQ frame and parses both the outer S-VLAN and inner C-VLAN tags before reaching the IP header. The outer (service) VLAN ID is available for policy matching, while the inner (customer) VLAN ID is preserved.

## eBPF Implementation

- Inline `VlanHdr` struct for 802.1Q and 802.1ad header parsing
- QinQ support: the parser handles stacked VLAN headers (EtherType `0x8100` for 802.1Q, `0x88A8` for 802.1ad)
- `bpf_skb_vlan_push` / `bpf_skb_vlan_pop` for VLAN rewriting in TC programs
- `FLAG_VLAN` in `PacketEvent.flags` signals VLAN-tagged packets to userspace
- `PacketEvent.vlan_id` carries the original VLAN ID

## Code Architecture

| Layer | Implementation |
|-------|---------------|
| `ebpf-common` | `PacketEvent.vlan_id` field, `FLAG_VLAN` flag |
| `ebpf-programs` | VLAN header parsing, `bpf_skb_vlan_push`/`bpf_skb_vlan_pop` |
| `domain` | VLAN-aware firewall rule matching |
| `infrastructure` | Config validation for VLAN IDs (0–4094) |
