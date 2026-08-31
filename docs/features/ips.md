# Intrusion Prevention System (IPS)

> **Edition: OSS** | **eBPF Program: Shared with IDS (tc-ids)**

## Overview

The IPS extends the IDS with automatic blocking. When a rule matches in block mode, the source IP is added to a blacklist and subsequent packets from that IP are dropped. The IPS shares the `tc-ids` eBPF program with the IDS: `ips.rules` and `ids.rules` live in the same kernel pattern maps, and the difference is in the userspace response.

## How It Works

1. `ips.rules` are loaded into the same pattern maps as `ids.rules`, so `tc-ids` matches both sets. `ids.enabled: false` therefore also silences the IPS rules
2. A match against an IPS rule raises an alert on the `ips` component, carrying the rule's own severity and mode. A rule carrying a `pattern` is matched against the captured TCP payload in userspace rather than on the port alone, exactly as an IDS content rule is (see [Content patterns](../configuration/ids.md#content-patterns))
3. A rule in `block` mode feeds the auto-blacklist counter for the source IP. A rule in `alert` mode is reported and stops there
4. Once the source crosses `auto_blacklist_threshold` within the detection window, it is blacklisted with a TTL
5. In `ips.mode: block` the blacklisted address is installed as a host route (/32 or /128) in the firewall LPM maps, so the kernel drops its packets without userspace involvement
6. Whitelisted IPs are never blacklisted regardless of rule matches, and sampled-out packets never reach the counter

Because both rule sets share the kernel maps, a rule id may not be reused between `ids.rules` and `ips.rules`, and two rules that watch the same `(protocol, dst_port)` pair cannot both be installed: the IPS rule wins, and the shadowed rule is named in a startup warning.

The listing says so too, so a conflict does not have to be caught in the boot log. A rule that lost its slot carries a `kernel_slot` block in `GET /api/v1/ids/rules` and `GET /api/v1/ips/rules`, naming the rule that took it, and `ebpfsentinel-agent ips list` prints the same conflicts under the table. Its `evaluated_in_userspace` field is what matters: a shadowed detection rule is replayed in userspace and still fires, while a shadowed IPS rule is not replayed and enforces nothing until the ports are separated.

### Blacklist Management

- **Auto-blacklist** - IPs are added automatically when block-mode rules match often enough
- **TTL** - blacklist entries expire after `max_blacklist_duration_secs`, which is also the window over which detections are counted
- **Dry run** - `ips.mode: alert` still records what would have been blocked, but installs nothing in the kernel
- **Capacity** - once `max_blacklist_size` is reached, further blacklisting is refused until entries expire, nothing is evicted
- **Whitelist** - IPs that should never be blocked (management networks, known-good services)
- **Manual control** - add or remove IPs via CLI or REST API, which take the same kernel path as auto-blacklisting

### Per-Country Blacklist Thresholds

The IPS supports `country_thresholds` — per-country overrides of `auto_blacklist_threshold`. IPs from high-risk countries can be blacklisted after fewer detections:

```yaml
ips:
  auto_blacklist_threshold: 5
  country_thresholds:
    RU: 2          # Blacklist Russian IPs after 2 detections
    CN: 3          # 3 detections for Chinese IPs
    KP: 1          # Immediate blacklisting for North Korean IPs
```

### Subnet Injection (LPM)

Every blacklisted address is installed as a host route (/32 or /128) in the firewall LPM Trie maps through the `LpmCoordinator`, under a dedicated `ips` source so it never collides with alias or GeoIP entries.

When the blacklisted IP comes from a country listed in `country_thresholds`, the IPS additionally injects the source's /24 subnet (IPv4) or /48 subnet (IPv6). This provides kernel-side blocking of the surrounding address space, catching related attack infrastructure. Both host routes and subnet entries are removed when the blacklist TTL expires, and neither is installed while the module runs in `alert` mode.

## Configuration

```yaml
ips:
  mode: block
  max_blacklist_duration_secs: 3600  # Blacklist TTL and detection window
  whitelist:
    - "10.0.0.0/8"             # Management network
    - "192.168.1.1"            # Monitoring server
  rules:
    - id: block-reverse-shell
      description: "Reverse shell callback, auto-block source"
      severity: critical
      mode: block
      protocol: tcp
      dst_port: 4444
      threshold:
        type: both
        count: 3
        window_secs: 60
        track_by: src_ip
    - id: alert-rdp-probe
      description: "RDP probe, alert only"
      severity: medium
      mode: alert
      protocol: tcp
      dst_port: 3389
```

See [Configuration: IPS](../configuration/ips.md) for the full reference.

## CLI Usage

```bash
# List IPS rules
ebpfsentinel-agent ips list

# View blacklisted IPs
ebpfsentinel-agent ips blacklist

# View domain-based blocks (DNS blocklist or reputation)
ebpfsentinel-agent ips domain-blocks

# Change a rule's mode
ebpfsentinel-agent ips set-mode block-reverse-shell --mode alert
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ips/rules` | List IPS rules |
| PATCH | `/api/v1/ips/rules/{id}` | Update rule mode (alert/block), re-syncing the kernel pattern maps |
| GET | `/api/v1/ips/blacklist` | List blacklisted IPs |
| POST | `/api/v1/ips/blacklist` | Blacklist an IP, installing its host route |
| DELETE | `/api/v1/ips/blacklist/{ip}` | Remove an IP from the blacklist and from the kernel |
| GET | `/api/v1/ips/domain-blocks` | List domain-based blocks |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/ips/` | IPS engine (blacklist, whitelist logic) |
| `ports` | `crates/ports/src/primary/ips.rs` | Port trait |
| `application` | `crates/application/src/ips_service_impl.rs` | App service (blacklist, whitelist, kernel enforcement) |
| `application` | `crates/application/src/ids_service_impl.rs` | Owns the shared rule array and syncs both rule sets into the kernel pattern maps |

## Metrics

- `ebpfsentinel_ips_blacklist_size` - current blacklist entry count
- `ebpfsentinel_ips_blocks_total` - enforcement actions applied
- `ebpfsentinel_auto_responses_total{policy}` - auto-response enforcements applied, by the policy that matched
- `ebpfsentinel_ids_ct_dying_total` - conntrack entries marked `IPS_DYING` by a flow kill
- `ebpfsentinel_alerts_total{component="ips", severity}` - IPS alerts generated
- `ebpfsentinel_alerts_dropped_total{reason="throttle"}` - alerts suppressed by the per-rule rate limit
