# NAT (Network Address Translation)

eBPFsentinel provides kernel-speed NAT via two TC classifier programs (`tc-nat-ingress` and `tc-nat-egress`) with userspace rule management. Six NAT types cover standard deployment patterns from simple port forwarding to full bidirectional 1:1 NAT.

## NAT Types

| Type | Direction | Description |
|------|-----------|-------------|
| `snat` | Egress | Rewrite source address (optionally with port range) |
| `dnat` | Ingress | Rewrite destination address and/or port |
| `masquerade` | Egress | SNAT using the outgoing interface's IP (dynamic) |
| `one_to_one` | Both | Bidirectional 1:1 mapping between external and internal IPs |
| `redirect` | Ingress | DNAT to localhost on a specific port |
| `port_forward` | Ingress | Map external port range to internal address + port range |

## Rule Structure

Each NAT rule specifies:

- **id**: Unique rule identifier
- **priority**: Lower values match first (default: 100)
- **nat_type**: One of the 6 types above
- **match_src / match_dst**: CIDR-based source/destination matching
- **match_dst_port**: Destination port or range to match
- **match_protocol**: Protocol filter (`tcp`, `udp`, or both)
- **match_src_alias / match_dst_alias**: Reference [IP aliases](aliases.md) instead of raw CIDRs
- **enabled**: Enable/disable without deleting

## Limits

- Maximum 256 SNAT rules and 256 DNAT rules
- Port ranges must have `start <= end`

## eBPF Programs

| Program | Hook | Function |
|---------|------|----------|
| `tc-nat-ingress` | TC ingress | Applies DNAT rules, rewrites destination IP/port, updates checksums |
| `tc-nat-egress` | TC egress | Applies SNAT rules, rewrites source IP/port, updates checksums |

Both programs support IPv4 and IPv6 with full checksum recalculation. Rule scanning uses [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) to iterate over the NAT rule table without hitting the eBPF verifier loop limit.

## Integration

- **Conntrack**: NAT mappings are paired with connection tracking entries for bidirectional translation
- **Aliases**: Rules can reference named alias sets via `match_src_alias` / `match_dst_alias`
- **Firewall**: NAT is applied after firewall rules (ingress) or before firewall rules (egress)

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/nat/status` | Enabled status and rule count |
| GET | `/api/v1/nat/rules` | List all NAT rules (SNAT + DNAT with direction field) |

See [REST API Reference](../api-reference/rest-api.md) for details.

## NPTv6 (RFC 6296)

Stateless, bidirectional IPv6-to-IPv6 Network Prefix Translation per [RFC 6296](https://datatracker.ietf.org/doc/html/rfc6296). NPTv6 replaces the prefix portion of an IPv6 address while preserving the interface identifier, enabling address independence without the statefulness of traditional NAT.

Key properties:

- **Stateless**: no connection tracking required — each packet is translated independently
- **Bidirectional**: egress rewrites `internal_prefix → external_prefix` (source in `tc-nat-egress`), ingress rewrites `external_prefix → internal_prefix` (destination in `tc-nat-ingress`)
- **No port rewriting**: only the network prefix is modified, L4 headers are untouched
- **Checksum-neutral**: a pre-computed adjustment word ensures the IPv6 pseudo-header checksum remains valid without per-packet recalculation
- **Priority**: NPTv6 rules are checked **before** stateful NAT rules in both ingress and egress programs

### Configuration

```yaml
nat:
  nptv6_rules:
    - id: site-a
      internal_prefix: "fd00:1::"
      external_prefix: "2001:db8:1::"
      prefix_len: 48
    - id: site-b
      internal_prefix: "fd00:2::"
      external_prefix: "2001:db8:2::"
      prefix_len: 48
```

### REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/nat/nptv6` | List all NPTv6 rules |
| POST | `/api/v1/nat/nptv6` | Create an NPTv6 rule |
| DELETE | `/api/v1/nat/nptv6/{id}` | Delete an NPTv6 rule |

### CLI

```bash
ebpfsentinel nat nptv6 list
ebpfsentinel nat nptv6 create --id site-a --internal-prefix fd00:1:: --external-prefix 2001:db8:1:: --prefix-len 48
ebpfsentinel nat nptv6 delete --id site-a
```

## Hairpin NAT (NAT Reflection)

Hairpin NAT allows internal clients to access DNAT services via the external (public) IP address, even when the client and server reside on the same internal subnet. Without hairpin NAT, the server would reply directly to the client (bypassing the firewall), and the client would drop the response because it expects a reply from the external IP.

### How It Works

When an internal client sends traffic to the external IP and a matching DNAT rule exists:

1. **Forward path** (internal client → external IP):
   - The DNAT rule rewrites the destination to the internal server (standard DNAT)
   - An additional SNAT rewrites the source to the firewall's LAN IP (`hairpin_snat_ip`)
   - A reverse mapping is stored in the `NAT_HAIRPIN_CT` LRU map

2. **Return path** (internal server → firewall LAN IP):
   - The hairpin conntrack entry is looked up
   - Both translations are reversed: destination → original client IP, source → external IP
   - The client receives the reply from the expected external IP

Both forward and return paths are handled entirely in `tc-nat-ingress`. This is IPv4 only — IPv6 uses globally routable addresses, making hairpin NAT unnecessary.

### Configuration

```yaml
nat:
  hairpin:
    enabled: true
    internal_subnet: "192.168.1.0/24"
    hairpin_snat_ip: "192.168.1.1"
```

Hairpin NAT supports hot reload — changes take effect without restarting the agent.
