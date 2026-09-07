# MITRE ATT&CK Mapping

eBPFsentinel maps all security alerts to the [MITRE ATT&CK](https://attack.mitre.org/) framework (v18), providing standardized threat classification for SOC workflows.

## How It Works

Every alert includes `mitre_attack` metadata with three fields:

- **`technique_id`** -- ATT&CK technique identifier (e.g. `T1071`, `T1499.001`)
- **`technique_name`** -- Human-readable technique name
- **`tactic`** -- ATT&CK tactic in kebab-case (e.g. `command-and-control`, `impact`)

Mapping is automatic at alert creation time -- zero runtime cost.

## Coverage Matrix

Every mapping the alert layer holds is below, generated from
`crates/domain/src/alert/mitre.rs` rather than transcribed. "Raised by" is the
condition that produces the alert; a component appears once per condition, so
one component maps to several techniques. An Enterprise row is a mapping that
only exists once the corresponding Enterprise feature is running.

`GET /api/v1/mitre/coverage` returns this matrix filtered to the components the
agent has active, which is a subset of it and never a superset.

<!-- BEGIN GENERATED MITRE COVERAGE -->

| Component | Edition | Raised by | Technique | Technique name | Tactic |
|-----------|---------|-----------|-----------|----------------|--------|
| Firewall | OSS | Firewall deny on SSH (22) | T1110.001 | Password Guessing | credential-access |
| Firewall | OSS | Firewall deny on Telnet (23) | T1021 | Remote Services | lateral-movement |
| Firewall | OSS | Firewall deny on SMTP (25/587) | T1071.003 | Mail Protocols | command-and-control |
| Firewall | OSS | Firewall deny on DNS (53) | T1071.004 | DNS | command-and-control |
| Firewall | OSS | Firewall deny on HTTP/DB ports | T1190 | Exploit Public-Facing Application | initial-access |
| Firewall | OSS | Firewall deny on RDP (3389) | T1021.001 | Remote Desktop Protocol | lateral-movement |
| Firewall | OSS | Firewall deny on SMB (445) | T1021.002 | SMB/Windows Admin Shares | lateral-movement |
| Firewall | OSS | Firewall deny on other ports | T1046 | Network Service Scanning | discovery |
| IPS | OSS | IPS auto-blacklist on SSH (22) | T1110.001 | Password Guessing | credential-access |
| IPS | OSS | IPS auto-blacklist on HTTP/DB | T1190 | Exploit Public-Facing Application | initial-access |
| IPS | OSS | IPS auto-blacklist on other ports | T1046 | Network Service Scanning | discovery |
| Rate limiting | OSS | Rate limit exceeded on SSH (22) | T1110 | Brute Force | credential-access |
| Rate limiting | OSS | Rate limit exceeded on HTTP | T1499.002 | Service Exhaustion Flood | impact |
| Rate limiting | OSS | Rate limit exceeded on other ports | T1498 | Network Denial of Service | impact |
| L7 firewall | OSS | L7 deny on HTTP/HTTPS | T1071.001 | Web Protocols | command-and-control |
| L7 firewall | OSS | L7 deny on FTP | T1071.002 | File Transfer Protocols | command-and-control |
| L7 firewall | OSS | L7 deny on SMTP | T1071.003 | Mail Protocols | command-and-control |
| L7 firewall | OSS | L7 deny on SMB | T1021.002 | SMB/Windows Admin Shares | lateral-movement |
| L7 firewall | OSS | L7 deny on other protocols | T1071 | Application Layer Protocol | command-and-control |
| DDoS | OSS | SYN flood detected | T1499.001 | OS Exhaustion Flood | impact |
| DDoS | OSS | UDP amplification detected | T1498.002 | Reflection Amplification | impact |
| DDoS | OSS | ICMP flood detected | T1498 | Network Denial of Service | impact |
| DDoS | OSS | RST/FIN/ACK flood detected | T1499 | Endpoint Denial of Service | impact |
| DDoS | OSS | Volumetric attack detected | T1498.001 | Direct Network Flood | impact |
| IDS | OSS | IDS match on SSH (22) | T1021.004 | SSH | lateral-movement |
| IDS | OSS | IDS match on HTTP/HTTPS | T1071.001 | Web Protocols | command-and-control |
| IDS | OSS | IDS match on SMTP | T1071.003 | Mail Protocols | command-and-control |
| IDS | OSS | IDS match on DNS (53) | T1071.004 | DNS | command-and-control |
| IDS | OSS | IDS match on RDP (3389) | T1021.001 | Remote Desktop Protocol | lateral-movement |
| IDS | OSS | IDS match on SMB (445) | T1021.002 | SMB/Windows Admin Shares | lateral-movement |
| IDS | OSS | IDS match on other ports | T1071 | Application Layer Protocol | command-and-control |
| Threat intelligence | OSS | IOC hit: malware/C2 on HTTP | T1071.001 | Web Protocols | command-and-control |
| Threat intelligence | OSS | IOC hit: C2 on SMTP | T1071.003 | Mail Protocols | command-and-control |
| Threat intelligence | OSS | IOC hit: malware/C2 on DNS | T1071.004 | DNS | command-and-control |
| Threat intelligence | OSS | IOC hit: scanner | T1595 | Active Scanning | reconnaissance |
| Threat intelligence | OSS | IOC hit: scanner on SSH/RDP | T1110 | Brute Force | credential-access |
| Threat intelligence | OSS | IOC hit: spam source | T1566 | Phishing | initial-access |
| Threat intelligence | OSS | IOC hit: other threat type | T1568 | Dynamic Resolution | command-and-control |
| DLP | OSS | DLP match: PCI or generic | T1041 | Exfiltration Over C2 Channel | exfiltration |
| DLP | OSS | DLP match: PII | T1048 | Exfiltration Over Alternative Protocol | exfiltration |
| DLP | OSS | DLP match: credentials | T1048.003 | Exfiltration Over Unencrypted Non-C2 Protocol | exfiltration |
| DNS intelligence | OSS | DNS blocklist match or encrypted DNS detection | T1071.004 | DNS | command-and-control |
| DNS intelligence | OSS | DNS reputation auto-block | T1568 | Dynamic Resolution | command-and-control |
| ML anomaly detection | Enterprise | ML: traffic volume drift (packet/byte rate) | T1498.001 | Direct Network Flood | impact |
| ML anomaly detection | Enterprise | ML: protocol ratio drift (TCP/UDP/ICMP) | T1572 | Protocol Tunneling | command-and-control |
| ML anomaly detection | Enterprise | ML: port entropy spike | T1046 | Network Service Scanning | discovery |
| ML anomaly detection | Enterprise | ML: source IP diversity spike | T1090 | Proxy | command-and-control |
| ML anomaly detection | Enterprise | ML: destination port diversity spike | T1570 | Lateral Tool Transfer | lateral-movement |
| ML anomaly detection | Enterprise | ML: payload size anomaly | T1074 | Data Staged | collection |
| ML anomaly detection | Enterprise | ML: connection count spike | T1110 | Brute Force | credential-access |
| AI security | Enterprise | Shadow AI: unauthorized AI provider usage | T1567.002 | Exfiltration to Cloud Storage | exfiltration |
| AI security | Enterprise | AI-aware DLP: sensitive data sent to AI provider | T1048 | Exfiltration Over Alternative Protocol | exfiltration |
| AI security | Enterprise | AI exfiltration: large payload to AI provider | T1048.001 | Exfiltration Over Symmetric Encrypted Non-C2 Protocol | exfiltration |
| AI security | Enterprise | Encrypted DNS policy violation | T1071.004 | DNS | command-and-control |
| TLS intelligence | Enterprise | JA4 fingerprint matches known C2/malware tool | T1573.002 | Encrypted Channel: Asymmetric Cryptography | command-and-control |
| TLS intelligence | Enterprise | Rare TLS fingerprint behavior anomaly | T1071.001 | Web Protocols | command-and-control |
| TLS intelligence | Enterprise | Weak or deprecated cipher/protocol usage | T1573.001 | Encrypted Channel: Symmetric Cryptography | command-and-control |
| TLS intelligence | Enterprise | Connection not using post-quantum key exchange | T1600.001 | Weaken Encryption: Reduce Key Space | defense-evasion |
| TLS intelligence | Enterprise | Cipher suite or TLS version downgrade detected | T1573.001 | Encrypted Channel: Symmetric Cryptography | command-and-control |
| TLS intelligence | Enterprise | SNI does not match server certificate CN/SAN | T1557 | Adversary-in-the-Middle | credential-access |
| TLS intelligence | Enterprise | TLS session ticket reused across multiple destinations | T1550 | Use Alternate Authentication Material | defense-evasion |
| TLS intelligence | Enterprise | TLS fingerprint deviates from container peer group baseline | T1071.001 | Web Protocols | command-and-control |

<!-- END GENERATED MITRE COVERAGE -->

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
ebpfsentinel-agent alerts list --tactic exfiltration
ebpfsentinel-agent alerts list --technique T1041
ebpfsentinel-agent mitre coverage
```

## Prometheus Metrics

The `alerts_total` counter includes a `technique_id` label:

```
ebpfsentinel_alerts_total{component="ids",severity="high",technique_id="T1071"} 42
```

## gRPC Streaming

The `StreamAlertsRequest` supports `mitre_tactic` and `mitre_technique_id` filter fields. The `AlertEvent` response includes `mitre_technique_id`, `mitre_technique_name`, and `mitre_tactic`.
