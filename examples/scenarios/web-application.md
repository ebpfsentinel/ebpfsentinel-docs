# Web Application Protection

Protect a web application stack with firewall rules, IDS, L7 filtering, rate limiting, and alerting.

## Scenario

- Web servers on `10.0.1.0/24` serving HTTP/HTTPS
- API servers on `10.0.2.0/24` serving REST APIs
- Management network on `192.168.0.0/16`
- Public internet access to ports 80 and 443 only

## Configuration

```yaml
agent:
  interfaces: [eth0]

firewall:
  default_policy: drop
  rules:
    - id: allow-web-http
      priority: 10
      action: allow
      protocol: tcp
      dst_ip: "10.0.1.0/24"
      dst_port: "80-443"
    - id: allow-api
      priority: 20
      action: allow
      protocol: tcp
      dst_ip: "10.0.2.0/24"
      dst_port: "443"
    - id: allow-ssh-mgmt
      priority: 30
      action: allow
      protocol: tcp
      src_ip: "192.168.0.0/16"
      dst_port: 22
    - id: allow-dns
      priority: 40
      action: allow
      protocol: udp
      dst_port: 53
    - id: log-dropped
      priority: 1000
      action: log

ids:
  mode: alert
  rules:
    - id: web-sqli
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1|drop\\s+table)"
      severity: critical
      description: "SQL injection"
    - id: web-xss
      pattern: "(?i)(<script|javascript:|on\\w+\\s*=)"
      severity: high
      description: "XSS attempt"
    - id: web-path-traversal
      pattern: "\\.\\.(/|\\\\)"
      severity: high
      description: "Path traversal"

l7:
  rules:
    - id: block-admin-external
      priority: 10
      action: deny
      protocol: http
      path: "/admin.*"
      description: "Block admin panel from non-mgmt"
    - id: block-internal-api
      priority: 20
      action: deny
      protocol: http
      path: "/api/internal/.*"

ratelimit:
  rules:
    - id: web-ratelimit
      rate: 1000
      burst: 2000
      algorithm: token_bucket
      scope: per_ip
    - id: syn-protection
      rate: 50
      burst: 100
      algorithm: syn_cookie
      scope: per_ip

alerting:
  routes:
    - name: web-critical
      severity: [critical, high]
      senders: [webhook-ops]
  senders:
    - name: webhook-ops
      type: webhook
      url: "https://hooks.slack.com/services/YOUR/WEBHOOK"
```

## Verification

```bash
# Start the agent
sudo ebpfsentinel-agent --config config/web-app.yaml

# Verify rules
ebpfsentinel-agent firewall list
ebpfsentinel-agent l7 list
ebpfsentinel-agent ratelimit list

# Test IDS detection
curl http://10.0.1.1/ -d "' OR 1=1 --"
ebpfsentinel-agent alerts list --component ids

# Check metrics
curl http://localhost:8080/metrics | grep packets_total
```
