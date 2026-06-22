# MITRE ATT&CK Mapping

eBPFsentinel maps all security alerts to the [MITRE ATT&CK](https://attack.mitre.org/) framework (v18), providing standardized threat classification for SOC workflows.

## How It Works

Every alert includes `mitre_attack` metadata with three fields:

- **`technique_id`** -- ATT&CK technique identifier (e.g. `T1071`, `T1499.001`)
- **`technique_name`** -- Human-readable technique name
- **`tactic`** -- ATT&CK tactic in kebab-case (e.g. `command-and-control`, `impact`)

Mapping is automatic at alert creation time -- zero runtime cost.

## Coverage Matrix

| Component | Technique ID | Technique Name | Tactic |
|-----------|-------------|----------------|--------|
| IDS | T1071 | Application Layer Protocol | command-and-control |
| Threat Intel (malware/C2) | T1071.001 | Web Protocols | command-and-control |
| Threat Intel (scanner) | T1595 | Active Scanning | reconnaissance |
| Threat Intel (spam) | T1566 | Phishing | initial-access |
| Threat Intel (other) | T1568 | Dynamic Resolution | command-and-control |
| DLP (PCI/generic) | T1041 | Exfiltration Over C2 Channel | exfiltration |
| DLP (PII) | T1048 | Exfiltration Over Alternative Protocol | exfiltration |
| DLP (credentials) | T1048.003 | Exfiltration Over Unencrypted Non-C2 Protocol | exfiltration |
| DDoS (SYN flood) | T1499.001 | OS Exhaustion Flood | impact |
| DDoS (UDP amplification) | T1498.002 | Reflection Amplification | impact |
| DDoS (ICMP flood) | T1498 | Network Denial of Service | impact |
| DDoS (RST/FIN/ACK flood) | T1499 | Endpoint Denial of Service | impact |
| DDoS (volumetric) | T1498.001 | Direct Network Flood | impact |

## API

### Filter alerts by technique or tactic

```
GET /api/v1/alerts?tactic=exfiltration
GET /api/v1/alerts?technique=T1041
```

### Coverage dashboard

```
GET /api/v1/mitre/coverage
```

Returns the full coverage matrix filtered by active components, with per-tactic summary.

## CLI

```bash
ebpfsentinel alerts list --tactic exfiltration
ebpfsentinel alerts list --technique T1041
ebpfsentinel mitre coverage
```

## Prometheus Metrics

The `alerts_total` counter includes a `technique_id` label:

```
ebpfsentinel_alerts_total{component="ids",severity="high",technique_id="T1071"} 42
```

## gRPC Streaming

The `StreamAlertsRequest` supports `mitre_tactic` and `mitre_technique_id` filter fields. The `AlertEvent` response includes `mitre_technique_id`, `mitre_technique_name`, and `mitre_tactic`.
