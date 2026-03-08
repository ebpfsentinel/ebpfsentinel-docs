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

Both programs support IPv4 and IPv6 with full checksum recalculation.

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
