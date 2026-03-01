# Intrusion Prevention System (IPS)

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: Shared with IDS (tc-ids)**

## Overview

The IPS extends the IDS with automatic blocking. When a rule matches in block mode, the source IP is added to a blacklist and subsequent packets from that IP are dropped. The IPS shares the `tc-ids` eBPF program with the IDS — the difference is in the userspace response.

## How It Works

1. The IDS engine detects a match against a rule configured for `block` mode
2. The IPS engine adds the source IP to the blacklist (with optional TTL)
3. The blacklisted IP is synced to an eBPF map so the kernel drops future packets without userspace involvement
4. Whitelisted IPs are never blacklisted regardless of rule matches

### Blacklist Management

- **Auto-blacklist** — IPs are added automatically when block-mode rules match
- **TTL** — blacklist entries expire after a configurable duration
- **Whitelist** — IPs that should never be blocked (management networks, known-good services)
- **Manual control** — add or remove IPs via CLI or REST API

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

When an IP from a country listed in `country_thresholds` is blacklisted, the IPS also injects the source's /24 subnet (IPv4) or /48 subnet (IPv6) into the firewall LPM Trie maps via the `LpmCoordinator`. This provides kernel-side blocking of the surrounding address space, catching related attack infrastructure. Subnet entries are removed when the blacklist TTL expires.

## Configuration

```yaml
ips:
  mode: block
  blacklist_ttl: 3600          # Seconds before auto-removal (0 = permanent)
  whitelist:
    - "10.0.0.0/8"             # Management network
    - "192.168.1.1"            # Monitoring server
  rules:
    - id: block-sql-injection
      pattern: "(?i)(union\\s+select|drop\\s+table)"
      severity: critical
      mode: block
      description: "SQL injection — auto-block source"
      threshold:
        mode: both
        count: 3
        window: 60
    - id: alert-port-scan
      pattern: ""
      severity: medium
      mode: alert
      description: "Port scan detection — alert only"
```

See [Configuration: IPS](../configuration/ips.md) for the full reference.

## CLI Usage

```bash
# List IPS rules
ebpfsentinel-agent ips list

# View blacklisted IPs
ebpfsentinel-agent ips blacklist

# Change a rule's mode
ebpfsentinel-agent ips set-mode block-sql-injection --mode alert
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ips/rules` | List IPS rules |
| PATCH | `/api/v1/ips/rules/{id}` | Update rule mode (alert/block) |
| GET | `/api/v1/ips/blacklist` | List blacklisted IPs |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `domain` | `crates/domain/src/ips/` | IPS engine (blacklist, whitelist logic) |
| `ports` | `crates/ports/src/primary/ips.rs` | Port trait |
| `application` | `crates/application/src/ips_service_impl.rs` | App service |

## Metrics

- `ebpfsentinel_ips_blacklist_size` — current blacklist entry count
- `ebpfsentinel_alerts_total{component="ips", severity}` — IPS alerts generated
- `ebpfsentinel_threshold_suppressed_total{component="ips", rule_id}` — threshold-suppressed alerts
