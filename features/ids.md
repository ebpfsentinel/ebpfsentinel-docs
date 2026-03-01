# Intrusion Detection System (IDS)

> **Edition: OSS** | **Status: Shipped** | **eBPF Program: tc-ids**

## Overview

The IDS inspects packet payloads against regex-based signature rules. The kernel-side TC classifier performs initial filtering — sampling, L7 protocol detection, and backpressure — while the userspace engine runs full regex evaluation and alert generation.

## How It Works

### Kernel Side (tc-ids)

The TC classifier program:

1. **Sampling** — `bpf_get_prandom_u32` selects packets based on the configured sample rate, reducing userspace load
2. **L7 protocol detection** — `bpf_strncmp` matches protocol signatures (HTTP, TLS, SSH) in the first bytes of the payload
3. **RingBuf backpressure** — `bpf_ringbuf_query` checks buffer fill level; if >75% full, events are skipped
4. **Event emission** — matching packets are forwarded to userspace via RingBuf as `PacketEvent` structures

### Userspace Side

The IDS engine:

1. Receives `PacketEvent` from the event dispatcher
2. Evaluates each event against configured regex rules
3. Applies **threshold detection** (per-rule limit, threshold, and combined modes)
4. Generates alerts with severity, matched rule ID, and packet context

### Threshold Detection

Three threshold modes control alert volume:

| Mode | Behavior |
|------|----------|
| `limit` | Alert on the first N matches within a time window, then suppress |
| `threshold` | Alert only after N matches within a time window |
| `both` | Alert after N matches, then suppress until the window resets |

### Sampling Modes

| Mode | Description |
|------|-------------|
| `random` | Kernel-side `bpf_get_prandom_u32` with configurable rate (1-in-N) |
| `hash` | Hash-based consistent sampling on flow tuple |
| `country_based` | Full inspection for high-risk countries, reduced rate for others |

**Country-Based Sampling** — Sources from `high_risk_countries` (e.g. `[RU, CN, KP, IR]`) are inspected at `high_risk_rate` (default: 1.0 = 100%), while all other sources use `default_rate` (e.g. 0.1 = 10%). This focuses IDS resources on traffic from high-risk regions without dropping inspection entirely for the rest.

### Per-Country Threshold Overrides

Each IDS rule supports `country_thresholds` — per-country threshold configuration that overrides the rule's default threshold. This allows stricter detection for traffic from specific countries:

```yaml
rules:
  - id: ids-ssh-bruteforce
    severity: high
    protocol: tcp
    dst_port: 22
    threshold:
      type: threshold
      count: 5
      window_secs: 60
      track_by: src_ip
    country_thresholds:
      RU:
        type: threshold
        count: 2            # Alert after only 2 attempts from Russia
        window_secs: 60
        track_by: src_ip
```

## Configuration

```yaml
ids:
  mode: alert           # alert or block (block requires IPS)
  sample_rate: 100      # Sample 1-in-100 packets (0 = no sampling)
  sample_mode: random   # random or hash
  rules:
    - id: detect-sql-injection
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: high
      description: "SQL injection attempt"
    - id: detect-xss
      pattern: "(?i)(<script|javascript:|on\\w+\\s*=)"
      severity: high
      description: "Cross-site scripting attempt"
    - id: detect-shell-shock
      pattern: "\\(\\)\\s*\\{"
      severity: critical
      description: "Shellshock exploit attempt"
      threshold:
        mode: threshold
        count: 5
        window: 60
```

See [Configuration: IDS](../configuration/ids.md) for the full reference.

## CLI Usage

```bash
# List IDS rules (via IPS endpoint — IDS and IPS share rule management)
ebpfsentinel-agent ips list

# View alerts
ebpfsentinel-agent alerts list --component ids --severity high --limit 50

# Mark a false positive
ebpfsentinel-agent alerts mark-fp alert-001
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/ips/rules` | List IDS/IPS rules |
| GET | `/api/v1/alerts` | List alerts (filter by `component=ids`) |
| POST | `/api/v1/alerts/{id}/false-positive` | Mark alert as false positive |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/tc-ids/` | TC classifier kernel program |
| `domain` | `crates/domain/src/ids/` | IDS engine (entity, engine, error) |
| `ports` | `crates/ports/src/primary/ids.rs` | Port trait |
| `application` | `crates/application/src/ids_service_impl.rs` | App service |

## Metrics

- `ebpfsentinel_alerts_total{component="ids", severity}` — IDS alerts generated
- `ebpfsentinel_events_sampled_total{component="ids"}` — events skipped by sampling
- `ebpfsentinel_threshold_suppressed_total{component="ids", rule_id}` — threshold-suppressed alerts
- `ebpfsentinel_processing_duration_seconds{domain="ids"}` — engine evaluation latency
