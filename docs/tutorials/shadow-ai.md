# Cut off a workload calling an AI provider

A workload opens a TLS connection to an AI provider's API. The handshake
names the provider in clear text, in its Server Name Indication, before any
encryption. An L7 rule matches that name, raises an alert, and an automated
response blocks the workload for two minutes. The block is recorded in the
audit trail under the policy that took it.

<video controls preload="metadata" poster="/video/shadow-ai.jpg" src="/video/shadow-ai.mp4" width="100%"></video>

Recorded on Linux 7.0 against the [Compose lab](./index.md#the-lab). Every
output below is what that run printed. In the lab, `api.openai.com` resolves
to the target container, so no request leaves the host.

## What it uses

Two L7 rules on the SNI, and one automated response for what they find:

```yaml
l7:
  enabled: true
  ports: [80, 443]
  rules:
    - id: shadow-ai-openai
      priority: 10
      action: deny
      protocol: tls
      sni: "*.openai.com"
    - id: shadow-ai-anthropic
      priority: 11
      action: deny
      protocol: tls
      sni: "*.anthropic.com"

auto_response:
  enabled: true
  policies:
    - name: contain-shadow-ai
      min_severity: medium
      components: [l7]
      action: block
      ttl_secs: 120
```

The response's block is installed in the data path only when the IPS runs in
`block` mode, which `demo/agent.yaml` sets. In `alert` mode the same policy
records the block and enforces nothing.

## 1. Start the lab

```bash
sudo ./demo.sh up
sudo ./demo.sh agent l7 list
```

<!-- rec shadow-ai 2 -->
```text
ID                   PRI  ACTION  SRC IP  DST IP  DST PORT  ENABLED
shadow-ai-openai      10  deny    -       -              -  yes
shadow-ai-anthropic   11  deny    -       -              -  yes

2 rule(s) total.
```

## 2. The workload reaches the internal service

```bash
sudo docker compose exec app curl -sk -o /dev/null -w '%{http_code}\n' --max-time 3 https://172.30.66.1/
```

<!-- rec shadow-ai 3 -->
```text
200
```

## 3. The workload calls the AI provider

```bash
sudo docker compose exec app curl -sk -o /dev/null -w '%{http_code}\n' --max-time 3 https://api.openai.com/v1/models
```

<!-- rec shadow-ai 4 -->
```text
200
```

That first request gets through. The L7 firewall judges a copy of the
handshake in user space, so by the time the rule matches, the packet is
already on its way: a `deny` is a decision and an alert, not a drop of that
packet. What stops the workload is the response that follows.

## 4. Read the alert

```bash
sudo ./demo.sh agent alerts list --component l7
```

<!-- rec shadow-ai 5 -->
```text
ID                                      COMPONENT  SEVERITY  RULE ID           ACTION  SRC IP        DST IP       SPORT  DPORT  FP  SRC DOMAIN  DST DOMAIN  MESSAGE
1791388237473397976-shadow-ai-openai-0  l7         medium    shadow-ai-openai  block   172.30.66.20  172.30.66.1  57166    443  no  -           -           L7 tls deny rule=shadow-ai-openai

Showing 1/1 alert(s) (offset=0).
```

## 5. The workload is cut off

```bash
sudo ./demo.sh agent ips blacklist
```

<!-- rec shadow-ai 6 -->
```text
IP            REASON                                                                        AUTO  TTL (s)
172.30.66.20  auto-response:contain-shadow-ai alert=1791388237473397976-shadow-ai-openai-0  no        117

1 entry(ies) total.
```

The workload's address is blocked for 120 seconds, and the reason names the
policy and the alert. It now reaches nothing, the internal service included:

```bash
sudo docker compose exec app curl -sk -o /dev/null -w '%{http_code}\n' --max-time 3 https://172.30.66.1/
```

<!-- rec shadow-ai 7 -->
```text
000
```

`000` is `curl` giving up after three seconds without an answer. When the TTL
runs out the block is lifted on its own and the lift is audited too.

## 6. Find the block in the audit trail

```bash
sudo ./demo.sh agent audit logs --component responses
```

<!-- rec shadow-ai 8 -->
```text
COMPONENT  ACTION      SRC IP        DST IP  SPORT  DPORT  RULE ID            DETAIL
responses  rule_added  172.30.66.20  -           0      0  contain-shadow-ai  auto-response block_ip on 172.30.66.20 for al...

Showing 1/1 entry(ies) (offset=0).
```

The rule ID column is the policy's name; `-o json` prints the whole detail:
the action, the address, the alert that caused it and the TTL.

## Clean up

```bash
sudo ./demo.sh down
```

## Going further

- [L7 firewall](../features/l7-firewall.md): the thirteen protocols, every
  field a rule can match, and why enforcement is a response.
- [Automated response](../features/response.md): severities, components,
  TTLs and revoking a block early.
