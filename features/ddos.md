# DDoS Protection

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: xdp-ratelimit** | **Domain: ddos**

## Overview

eBPFsentinel provides dedicated DDoS protection combining **kernel-side enforcement** (eBPF/XDP) with **userspace detection** (EWMA-based anomaly detection and attack state machine). This is a separate domain from rate limiting — rate limiting controls per-IP traffic rates, while DDoS protection detects and mitigates coordinated attack patterns.

## How It Works

### Two-Layer Defense

1. **Kernel-side (eBPF)** — XDP programs enforce immediate protections: SYN rate tracking, ICMP rate limiting, UDP amplification filtering, and TCP connection tracking. These run at wire speed before the kernel allocates an SKB.
2. **Userspace (DDoS Engine)** — Analyzes traffic patterns with Exponentially Weighted Moving Average (EWMA, α=0.3), manages attack state transitions, and applies policy-based mitigation decisions.

### Attack Types

| Attack Type | Detection | eBPF Protection |
|-------------|-----------|-----------------|
| **SYN Flood** | SYN rate exceeds threshold | SYN rate tracking per source IP |
| **UDP Amplification** | Per-source-per-port rate spike | Per-port rate limiting for known amplification ports (DNS, NTP, etc.) |
| **ICMP Flood** | ICMP packet rate exceeds threshold | Rate limiting + oversized payload detection |
| **RST Flood** | RST packet rate exceeds threshold | Connection tracking with RST rate threshold |
| **FIN Flood** | FIN packet rate exceeds threshold | Connection tracking with FIN rate threshold |
| **ACK Flood** | ACK packet rate exceeds threshold | Connection tracking with ACK rate threshold |
| **Volumetric** | Overall traffic volume spike | Combined rate and volume analysis |

### eBPF-Side Protections

Four independent protection subsystems run in XDP:

**SYN Protection** — Tracks SYN packet rates per source IP. When threshold mode is enabled, sources exceeding the configured PPS threshold are rate-limited.

**ICMP Protection** — Enforces a maximum ICMP packet rate and detects oversized ICMP payloads (potential tunneling or amplification).

**UDP Amplification Protection** — Per-source-per-port rate limiting on known amplification ports (DNS/53, NTP/123, SSDP/1900, etc.). Each port has an independent PPS threshold.

**Connection Tracking** — Monitors TCP connection state to detect half-open connection floods and abnormal RST/FIN/ACK rates. Thresholds are independently configurable.

### Userspace Detection Engine

The DDoS engine uses EWMA (α=0.3) to smooth traffic rate calculations and a state machine to track attack lifecycle:

```
            ┌───────────┐
            │ Detecting │ ← initial state (rate exceeds threshold)
            └─────┬─────┘
                  │ rate sustained > 3 seconds
                  ▼
            ┌───────────┐
            │  Active   │ ← mitigation action applied
            └─────┬─────┘
                  │ rate below threshold > 30 seconds
                  ▼
            ┌───────────┐
            │ Mitigated │ ← attack subsiding
            └─────┬─────┘
                  │ rate below threshold > 5 minutes
                  ▼
            ┌───────────┐
            │  Expired  │ ← attack over, entry cleaned up
            └───────────┘
```

**Mitigation Actions:**
- **Alert** — log the attack, no enforcement
- **Throttle** — reduce traffic rate from the source
- **Block** — drop all traffic from the source for `auto_block_duration_secs`

**Engine Limits:**
- Maximum 100 policies
- Maximum 64 concurrent active attacks
- Maximum 100 attack history entries

## Configuration

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
  connection_tracking:
    enabled: true
    half_open_threshold: 100
    rst_threshold: 50
    fin_threshold: 50
    ack_threshold: 200
  policies:
    - id: "syn-flood-detect"
      attack_type: "syn_flood"
      detection_threshold_pps: 5000
      mitigation_action: "alert"
      auto_block_duration_secs: 300
      enabled: true
```

See [Configuration: DDoS Protection](../configuration/ddos.md) for the full reference.

## CLI Usage

```bash
# View DDoS protection status (enabled, active attacks, mitigated count)
ebpfsentinel-agent ddos status

# List active DDoS attacks
ebpfsentinel-agent ddos attacks

# List historical attacks (default: last 100)
ebpfsentinel-agent ddos history
ebpfsentinel-agent ddos history --limit 50

# List configured DDoS policies
ebpfsentinel-agent ddos policies

# Add a policy from inline JSON
ebpfsentinel-agent ddos add --json '{
  "id": "udp-amp-block",
  "attack_type": "udp_amplification",
  "detection_threshold_pps": 10000,
  "mitigation_action": "block",
  "auto_block_duration_secs": 600,
  "enabled": true
}'

# Delete a policy by ID
ebpfsentinel-agent ddos delete udp-amp-block

# JSON output for scripting
ebpfsentinel-agent --output json ddos status
ebpfsentinel-agent --output json ddos attacks
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ddos/status` | Protection status (enabled, active attacks, mitigated count, policy count) |
| GET | `/api/v1/ddos/attacks` | List active DDoS attacks |
| GET | `/api/v1/ddos/attacks/history` | List historical attacks (`?limit=100`) |
| GET | `/api/v1/ddos/policies` | List DDoS policies |
| POST | `/api/v1/ddos/policies` | Create a DDoS policy (requires `admin` role) |
| DELETE | `/api/v1/ddos/policies/{id}` | Delete a DDoS policy (requires `admin` role) |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/xdp-ratelimit/` | XDP kernel-side protections (SYN, ICMP, UDP amp, conntrack) |
| `domain` | `crates/domain/src/ddos/` | DDoS engine (entity, engine, error) — attack detection + state machine |
| `ports` | `crates/ports/src/primary/ddos.rs` | Port trait |
| `application` | `crates/application/src/ddos_service_impl.rs` | App service |
| `adapters` | `crates/adapters/src/http/ddos_handler.rs` | HTTP handler |
| `infrastructure` | `crates/infrastructure/src/config/ddos.rs` | DDoS config (protections + policies) |

## Metrics

### Kernel-Side (eBPF PerCpuArray)

| Slot | Metric | Description |
|------|--------|-------------|
| 0 | `SYN_RECEIVED` | SYN packets observed |
| 1 | `SYNCOOKIES_SENT` | SYN cookies issued |
| 2 | `ICMP_PASSED` | ICMP packets passed |
| 3 | `ICMP_DROPPED` | ICMP packets dropped (rate exceeded or oversized) |
| 4 | `AMP_PASSED` | Amplification port packets passed |
| 5 | `AMP_DROPPED` | Amplification port packets dropped |
| 6 | `OVERSIZED_ICMP` | Oversized ICMP payloads detected |
| 7 | `ERRORS` | Processing errors |
| 8 | `EVENTS_DROPPED` | RingBuf events dropped (backpressure) |
| 9 | `CONN_TRACKED` | TCP connections tracked |
| 10 | `HALF_OPEN_DROPS` | Half-open connection limit drops |
| 11 | `RST_FLOOD_DROPS` | RST flood drops |
| 12 | `FIN_FLOOD_DROPS` | FIN flood drops |
| 13 | `ACK_FLOOD_DROPS` | ACK flood drops |

### Userspace (Prometheus)

- `ebpfsentinel_ddos_attacks_active` — currently active attack mitigations
- `ebpfsentinel_ddos_attacks_total{attack_type}` — total attacks detected by type
- `ebpfsentinel_ddos_blocked_total` — total packets blocked by DDoS policies
- `ebpfsentinel_rules_loaded{domain="ddos"}` — number of loaded DDoS policies
