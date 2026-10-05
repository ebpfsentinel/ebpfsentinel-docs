# DORA Compliance

eBPFsentinel carries part of the ICT risk-management, incident-management and testing
requirements the Digital Operational Resilience Act (EU 2022/2554) places on financial entities:
Chapter II (Articles 6 to 13), Chapter III (Articles 17 to 19) and Chapter IV (Articles 24 and 25).

The [compliance report](../features/enterprise/compliance-reports.md) (Enterprise) judges each
article below on what the running agent reports about itself when the report is generated. An
article whose facts the agent cannot read is reported as not evaluated, never as passed. Only
protection (Art. 9) and detection (Art. 10) are carried by the agent in full; every other article
is capped at `Partial`, because its framework, classification criteria, reporting to the
competent authority and testing programme belong to the entity.

## Article Mapping

### Chapter II - ICT Risk Management

| Article | Requirement | What the agent is judged on | Outside the agent |
|---------|-------------|-----------------------------|-------------------|
| Art. 6 | ICT risk management framework | Datapath loaded, firewall rules, IDS signatures | The framework, its review and its governance |
| Art. 7 | ICT systems, protocols and tools | Datapath loaded, HA peers with an active datapath | Capacity planning across the estate |
| Art. 8 | Identification | Network zones defined, threat intelligence feeds loaded | Asset inventory and dependency mapping |
| Art. 9 | Protection and prevention | Datapath loaded, firewall in block mode, IPS in block mode, rate limiting, L7 rules | - |
| Art. 10 | Detection | Datapath loaded, IDS signatures, ML anomaly detection, alert pipeline | - |
| Art. 11 | Response and recovery | Automated response policies, HA peers | Business continuity policy and its testing |
| Art. 13 | Learning and evolving | Forensic capture, scheduled compliance reports | Post-incident reviews |

### Chapter III - ICT-Related Incident Management

| Article | Requirement | What the agent is judged on | Outside the agent |
|---------|-------------|-----------------------------|-------------------|
| Art. 17 | Incident management process | Alert pipeline, persistent audit trail, SIEM export | The process, roles and escalation |
| Art. 18 | Classification of incidents | Alert pipeline (alerts carry a severity) | The classification criteria of the RTS |
| Art. 19 | Reporting of major incidents | SIEM export, incident webhook registered | Reporting to the competent authority |

### Chapter IV - Digital Operational Resilience Testing

| Article | Requirement | What the agent is judged on | Outside the agent |
|---------|-------------|-----------------------------|-------------------|
| Art. 24 | General testing requirements | Scheduled compliance reports | The testing programme |
| Art. 25 | Testing of ICT tools and systems | IDS signatures loaded | Vulnerability assessments, scenario and penetration tests |

## Configuration

Articles 9 and 10 pass only on an agent that enforces as well as watches:

```yaml
firewall:
  enabled: true
  mode: block
  default_policy: drop

ids:
  enabled: true

ips:
  enabled: true
  mode: block

ratelimit:
  enabled: true

l7:
  enabled: true

alerting:
  enabled: true

audit:
  enabled: true
  retention_days: 365
  storage_path: "/var/lib/ebpfsentinel/audit.redb"
```

```yaml
enterprise:
  forensics:
    enabled: true
  compliance:
    enabled: true
    frameworks: [dora]
    schedule:
      frequency: monthly
      frameworks: [dora]
```

Rules, policies and zones must be loaded, not only the engines switched on: an engine with
nothing to match is read and found wanting. ML anomaly detection (`enterprise.ml`), a SIEM
connector (`enterprise.siem`), response policies and an incident webhook
(`enterprise.response`) and an HA peer (`enterprise.ha`) complete the set. See the
[enterprise configuration](../configuration/enterprise.md) for each block.

## Evidence Collection

- The compliance report itself: `POST /api/v1/compliance/reports` with `"framework": "dora"`,
  exported as JSON, CSV, text or PDF; a monthly schedule keeps a dated series
- Each control's `runtime` evidence names the fact read and what was observed; its `scope`
  evidence names what the entity evidences elsewhere
- Audit trail: `ebpfsentinel-agent audit logs`
- Alerts by component: `ebpfsentinel-agent alerts list --component ids`
