# Examples

Worked scenarios combining multiple eBPFsentinel features for common deployment patterns.

| Scenario | Features Used | Description |
|----------|--------------|-------------|
| [Web Application Protection](scenarios/web-application.md) | Firewall, IDS, L7, Rate Limiting, Conntrack, Alerting | Protect a web application stack |
| [Database Isolation](scenarios/database-isolation.md) | Firewall, IDS, L7, DLP, Audit | Isolate and monitor database servers |
| [PCI Compliance](scenarios/pci-compliance.md) | Firewall, DLP, IDS/IPS, DNS, Audit, Threat Intel, TLS | Full PCI-DSS deployment |
| [Threat Hunting](scenarios/threat-hunting.md) | Threat Intel, DNS Intelligence, Domain Reputation | Proactive threat detection |
| [Kubernetes DDoS Protection](scenarios/kubernetes-ddos.md) | DDoS, Rate Limiting, Firewall, Conntrack, Container Awareness, Netkit | K8s DaemonSet with SYN cookies and pod-aware alerts |

Each scenario includes a complete YAML configuration, CLI commands, and expected behavior.
