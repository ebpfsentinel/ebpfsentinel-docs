# Quickstart

Get eBPFsentinel running with firewall rules, IDS detection, and rate limiting in 5 minutes.

## 1. Install

Everything comes from the [release repository](https://github.com/ebpfsentinel/ebpfsentinel-release/releases),
signed and listed in the release's `ebpfsentinel-SHA256SUMS`; nothing here asks you to clone a
repository. On Debian or Ubuntu:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://ebpfsentinel.github.io/ebpfsentinel-release/ebpfsentinel.gpg \
  | sudo tee /etc/apt/keyrings/ebpfsentinel.gpg > /dev/null
echo "deb [signed-by=/etc/apt/keyrings/ebpfsentinel.gpg] https://ebpfsentinel.github.io/ebpfsentinel-release/apt stable main" \
  | sudo tee /etc/apt/sources.list.d/ebpfsentinel.list
sudo apt-get update && sudo apt-get install ebpfsentinel
```

[Installation](installation.md) has the Fedora repository, the verified release tarball for a host
with no third-party repository, the two-container Docker deployment and the Helm chart. Every one
of them installs the same two processes: the rootless agent, and the privileged **warden** broker
that delegates it a bpffs and performs the few operations it cannot. The agent without the warden
starts, serves its API and attaches nothing.

## 2. Minimal Configuration

A host that looks like a router, a k3s node or a hypervisor should start from the matching [host profile](profiles.md) rather than from this file, which is deliberately the smallest thing that does something.

Write `/etc/ebpfsentinel/config.yaml` (mode `0640`: the agent refuses a world-readable file):

```yaml
agent:
  interfaces: [eth0]    # Replace with your interface

firewall:
  mode: block
  # Traffic no rule names passes. Start here, read what the rules match,
  # and only then consider the drop policy below.
  default_policy: pass
  rules:
    - id: deny-rpcbind
      priority: 10
      action: deny
      protocol: tcp
      dst_port: 111

ids:
  mode: alert
  rules:
    - id: detect-sql-injection
      protocol: tcp
      dst_port: 80
      pattern: "(?i)(union\\s+select|or\\s+1\\s*=\\s*1)"
      severity: high
      description: "SQL injection attempt"

ratelimit:
  enabled: true
  # Each source address gets its own bucket at these values.
  default_rate: 10000
  default_burst: 20000
  default_algorithm: token_bucket
```

### Moving to a drop policy

:::warning

`default_policy: drop` with `mode: block` drops every packet on the listed interfaces that no rule
allows, including the replies to connections the host opened itself and your own SSH session if
it arrives on another port or interface. On a remote host, get it wrong and the console is the
only way back in.

:::

When you do move to it, keep three things in the same file: the anti-lockout rule pinned to the
interface and port you administer the host through, an allow for established and related flows,
and an explicit allow for every service the host offers.

```yaml
firewall:
  mode: block
  default_policy: drop
  anti_lockout:
    enabled: true
    interfaces: ["eth0"]   # the interface your SSH session arrives on
    ports: [22]            # the agent's own API port is always kept open
  rules:
    - id: allow-established
      priority: 1
      action: allow
      state: [established, related]
    - id: allow-web
      priority: 20
      action: allow
      protocol: tcp
      dst_port: "80-443"
    - id: allow-icmp
      priority: 100
      action: allow
      protocol: icmp
```

[Shadow mode](../configuration/firewall.md#shadow-mode) lets a rule count what it would have
done before it decides anything, which is how a drop policy is tried on a host you cannot afford
to lose.

## 3. Start the Agent

The warden first, then the agent:

```bash
sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel
journalctl -u ebpfsentinel -f
```

Or in the foreground, to watch it load. The agent still needs the warden's socket:

```bash
sudo systemctl start ebpfsentinel-warden
sudo EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock \
  ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
```

Once the programs are attached the log carries `eBPF programs loaded` with their count. If it
says `BPF token unavailable - running in API-only mode` instead, the agent did not reach the
warden; on Ubuntu 24.04 and later the cause is usually the user-namespace restriction, which the
[BPF token guide](../operations/deployment/bpf-token.md) answers with the agent's own AppArmor
profile. What your kernel allows is answered by:

```bash
sudo ebpfsentinel-agent ebpf host-check
```

## 4. Take the API key

The control API authenticates by default. The configuration above names no
method, so the agent drew one for itself at first start and printed it once:

```text
{"level":"INFO","path":"/var/lib/ebpfsentinel/auth/api-key","api_key":"sk-...","message":"no authentication method was configured, so an API key was generated: send it as 'Authorization: Bearer <key>'. It is shown this once and kept at the path above"}
```

Keep it where the CLI and `curl` will find it:

```bash
export EBPFSENTINEL_TOKEN=$(sudo cat /var/lib/ebpfsentinel/auth/api-key)
```

`ebpfsentinel-agent` reads `EBPFSENTINEL_TOKEN` (or takes `--token`) and sends
it on every call. `/healthz` and `/readyz` answer without it. Configuring
`api_keys`, `jwt` or `oidc` under `auth:` replaces the generated key; see
[Authentication](../configuration/auth.md).

## 5. Verify

```bash
# Agent dashboard - programs loaded, conntrack, DDoS, recent alerts
ebpfsentinel-agent status

# Watch alerts in real-time (Ctrl+C to stop)
ebpfsentinel-agent watch

# Top talkers - most active connections by traffic volume
ebpfsentinel-agent top

# Network flows - aggregated connection map
ebpfsentinel-agent flows

# List firewall rules
ebpfsentinel-agent firewall list

# Health check (HTTP)
curl http://localhost:8080/healthz
```

## 6. Add Rules at Runtime

No restart needed - use the REST API or CLI:

```bash
# Add a firewall rule via CLI
ebpfsentinel-agent firewall add --json '{
  "id": "block-telnet",
  "priority": 5,
  "action": "deny",
  "protocol": "tcp",
  "dst_port": 23
}'

# Add a rate limit rule for one source host
ebpfsentinel-agent ratelimit add --json '{
  "id": "api-limit",
  "rate": 100,
  "burst": 200,
  "src_ip": "203.0.113.7",
  "algorithm": "sliding_window"
}'

# Check alerts
ebpfsentinel-agent alerts list --severity high --limit 10
```

## 7. Enable More Features

Add sections to your config file and reload:

```bash
# Edit the config
sudo $EDITOR /etc/ebpfsentinel/config.yaml

# Reload without restart (sends SIGHUP)
sudo systemctl reload ebpfsentinel
# Or via API:
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -X POST http://localhost:8080/api/v1/config/reload
```

### Add Threat Intelligence

```yaml
threatintel:
  feeds:
    - id: abuse-ch-ipblocklist
      name: "Abuse.ch IP Blocklist"
      url: "https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.txt"
      format: plaintext
      refresh_interval_secs: 3600
      default_action: block
```

### Add DLP

```yaml
dlp:
  enabled: true      # built-in patterns: card numbers, personal data, credentials
  mode: alert        # alert is the open-source mode
```

### Add Alerting

```yaml
alerting:
  routes:
    - name: critical-alerts
      destination: webhook
      min_severity: high
      webhook_url: "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
```

## Next Steps

- [Core Concepts](concepts.md) - understand the architecture
- [Feature Overview](../features/overview.md) - see all available features
- [Configuration Overview](../configuration/overview.md) - full configuration reference
- [CLI Reference](../cli-reference/index.md) - all CLI commands
