# DDoS Protection Configuration

The `ddos` section configures kernel-side protections and userspace detection policies for DDoS mitigation.

## Reference

```yaml
ddos:
  enabled: true                    # Enable/disable DDoS protection
  syn_protection:
    enabled: true
    threshold_mode: true           # Enable SYN rate threshold enforcement
    threshold_pps: 10000           # SYN packets per second before rate limiting
  icmp_protection:
    enabled: true
    max_pps: 10                    # Maximum ICMP packets per second
    max_payload_size: 64           # Maximum ICMP payload bytes (oversized = dropped)
  amplification_protection:
    enabled: true
    ports:
      - port: 53                   # DNS
        protocol: "udp"
        max_pps: 1000              # Per-source-per-port PPS limit
      - port: 123                  # NTP
        protocol: "udp"
        max_pps: 500
  connection_tracking:
    enabled: true
    half_open_threshold: 100       # Max half-open connections per source
    rst_threshold: 50              # RST packets/sec per source before drop
    fin_threshold: 50              # FIN packets/sec per source before drop
    ack_threshold: 200             # ACK packets/sec per source before drop
  policies:
    - id: "policy-id"
      attack_type: "syn_flood"
      detection_threshold_pps: 5000
      mitigation_action: "alert"
      auto_block_duration_secs: 300
      enabled: true
```

## Fields

### Top-Level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable DDoS protection |
| `syn_protection` | `SynProtection` | — | SYN flood kernel-side protection |
| `icmp_protection` | `IcmpProtection` | — | ICMP flood kernel-side protection |
| `amplification_protection` | `AmplificationProtection` | — | UDP amplification kernel-side protection |
| `connection_tracking` | `ConnectionTracking` | — | TCP connection tracking |
| `policies` | `[DdosPolicy]` | `[]` | Userspace detection policies |

### SynProtection

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable SYN protection in eBPF |
| `threshold_mode` | `bool` | `true` | Enforce SYN rate threshold |
| `threshold_pps` | `integer` | `10000` | SYN packets per second before rate limiting |

### IcmpProtection

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable ICMP protection in eBPF |
| `max_pps` | `integer` | `10` | Maximum ICMP packets per second |
| `max_payload_size` | `integer` | `64` | Maximum ICMP payload size in bytes |

### AmplificationProtection

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable UDP amplification protection |
| `ports` | `[AmplificationPort]` | `[]` | Per-port rate limits |

### AmplificationPort

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `port` | `integer` | Yes | UDP port number |
| `protocol` | `string` | Yes | Protocol (`udp`) |
| `max_pps` | `integer` | Yes | Maximum packets per second per source IP |

### ConnectionTracking

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `false` | Enable TCP connection tracking |
| `half_open_threshold` | `integer` | `100` | Max half-open connections per source before dropping |
| `rst_threshold` | `integer` | `50` | RST packets/sec per source before dropping |
| `fin_threshold` | `integer` | `50` | FIN packets/sec per source before dropping |
| `ack_threshold` | `integer` | `200` | ACK packets/sec per source before dropping |

### DdosPolicy

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique policy identifier |
| `attack_type` | `string` | Yes | `syn_flood`, `udp_amplification`, `icmp_flood`, `rst_flood`, `fin_flood`, `ack_flood`, `volumetric` |
| `detection_threshold_pps` | `integer` | Yes | Packets per second to trigger detection |
| `mitigation_action` | `string` | Yes | `alert`, `throttle`, `block` |
| `auto_block_duration_secs` | `integer` | Yes | Seconds to block source after detection (0 = indefinite) |
| `enabled` | `bool` | No | Enable/disable this policy (default: `true`) |

## Examples

### Full protection stack

```yaml
ddos:
  enabled: true
  syn_protection:
    enabled: true
    threshold_mode: true
    threshold_pps: 10000
  icmp_protection:
    enabled: true
    max_pps: 10
    max_payload_size: 64
  amplification_protection:
    enabled: true
    ports:
      - port: 53
        protocol: "udp"
        max_pps: 1000
      - port: 123
        protocol: "udp"
        max_pps: 500
      - port: 1900
        protocol: "udp"
        max_pps: 100
  connection_tracking:
    enabled: true
    half_open_threshold: 100
    rst_threshold: 50
    fin_threshold: 50
    ack_threshold: 200
  policies:
    - id: "syn-flood-block"
      attack_type: "syn_flood"
      detection_threshold_pps: 5000
      mitigation_action: "block"
      auto_block_duration_secs: 300
      enabled: true
    - id: "udp-amp-alert"
      attack_type: "udp_amplification"
      detection_threshold_pps: 10000
      mitigation_action: "alert"
      auto_block_duration_secs: 0
      enabled: true
```

### Minimal — SYN protection only

```yaml
ddos:
  enabled: true
  syn_protection:
    enabled: true
    threshold_pps: 5000
```

### Detection-only (no blocking)

```yaml
ddos:
  enabled: true
  policies:
    - id: "syn-detect"
      attack_type: "syn_flood"
      detection_threshold_pps: 5000
      mitigation_action: "alert"
      auto_block_duration_secs: 0
      enabled: true
    - id: "icmp-detect"
      attack_type: "icmp_flood"
      detection_threshold_pps: 1000
      mitigation_action: "alert"
      auto_block_duration_secs: 0
      enabled: true
```
