# Stop a SYN flood and block its source

A host floods a web service with TCP SYN packets. The agent sees the rate
cross its threshold in the kernel, opens an attack, raises an alert, and an
automated response blacklists the source for five minutes. The flood's source
can no longer reach the service; every other client still can. The block is
recorded in the audit trail under the policy that took it.

<video controls preload="metadata" poster="/video/ddos.jpg" src="/video/ddos.mp4" width="100%"></video>

Recorded on Linux 7.0 against the [Compose lab](./index.md#the-lab). Every
output below is what that run printed.

## What it uses

- `xdp-ratelimit`, which tracks the SYN rate in the kernel, before a socket
  buffer is allocated, and reports what crosses `threshold_pps` to the agent.
  Rate limiting is enabled alongside it, since its guards live in that program.
- A DDoS policy for SYN floods, and an automated response for what it finds:

```yaml
ddos:
  enabled: true
  syn_protection:
    enabled: true
    threshold_mode: true
    threshold_pps: 1000
  policies:
    - id: demo-syn-flood
      attack_type: syn_flood
      detection_threshold_pps: 2000
      mitigation_action: block
      auto_block_duration_secs: 300
      enabled: true

auto_response:
  enabled: true
  policies:
    - name: contain-ddos
      min_severity: high
      components: [ddos]
      action: block
      ttl_secs: 300
```

The response's block is installed in the data path only when the IPS runs in
`block` mode, which `demo/agent.yaml` sets.

## 1. Start the lab

```bash
sudo ./demo.sh up
sudo ./demo.sh agent status
```

<!-- rec ddos 2 -->
```text
eBPFsentinel v0.0.0-dev -- up 6s -- 6 rules loaded

  Programs  5/13 loaded    tc-conntrack ✓ uprobe-dlp ✓ xdp-firewall ✓ tc-ids ✓ xdp-ratelimit ✓

  Conntrack  121 active connections
  DDoS       no active attacks (0 mitigated total)

  Recent Alerts (0 total)
  (none)
```

## 2. The attacker can reach the service

```bash
sudo docker compose exec attacker curl -s -o /dev/null -w '%{http_code}\n' --max-time 3 http://172.30.66.1/
```

<!-- rec ddos 3 -->
```text
200
```

## 3. Flood it for ten seconds

```bash
sudo docker compose exec attacker timeout 10 hping3 -S -p 80 --flood 172.30.66.1
```

<!-- rec ddos 4 -->
```text
HPING 172.30.66.1 (eth0 172.30.66.1): S set, 40 headers + 0 data bytes
hping in flood mode, no replies will be shown

--- 172.30.66.1 hping statistic ---
2518715 packets transmitted, 0 packets received, 100% packet loss
round-trip min/avg/max = 0.0/0.0/0.0 ms
```

In flood mode `hping3` never reads replies, so `0 packets received` says
nothing about the service; the next steps do.

## 4. Read the attack and its alert

```bash
sudo ./demo.sh agent ddos attacks
```

<!-- rec ddos 5 -->
```text
ID      ATTACK TYPE  STATUS     COUNTRY  PEAK PPS  CUR PPS  TOTAL PKTS  SOURCES
ddos-1  syn_flood    detecting  -            2586       31        3806        1

1 active attack(s).
```

`PEAK PPS` is the busiest second the agent saw before the source was cut off.
The attack stays `detecting` rather than `active`: confirming it takes three
seconds above the threshold, and the response did not leave it three seconds.
After thirty quiet seconds it leaves the active list for the history.

```bash
sudo ./demo.sh agent alerts list --component ddos --limit 1
```

<!-- rec ddos 6 -->
```text
ID                            COMPONENT  SEVERITY  RULE ID  ACTION  SRC IP        DST IP       SPORT  DPORT  FP  SRC DOMAIN  DST DOMAIN  MESSAGE
1791388150487611862-ddos-1-0  ddos       critical  ddos-1   block   172.30.66.66  172.30.66.1   3824     80  no  -           -           DDoS SynFlood attack ddos-1 - status: Detecti...

Showing 1/1 alert(s) (offset=0).
```

## 5. The source is blocked, nobody else is

```bash
sudo ./demo.sh agent ips blacklist
```

<!-- rec ddos 7 -->
```text
IP            REASON                                                         AUTO  TTL (s)
172.30.66.66  auto-response:contain-ddos alert=1791388150487611862-ddos-1-0  no        287

1 entry(ies) total.
```

The reason names the policy and the alert, and the entry lifts itself when
the TTL runs out. The attacker now gets no answer, while the `app` container
on the same network is served as before:

```bash
sudo docker compose exec attacker curl -s -o /dev/null -w '%{http_code}\n' --max-time 3 http://172.30.66.1/
```

<!-- rec ddos 8 -->
```text
000
```

```bash
sudo docker compose exec app curl -s -o /dev/null -w '%{http_code}\n' --max-time 3 http://172.30.66.1/
```

<!-- rec ddos 9 -->
```text
200
```

## 6. Find the block in the audit trail

```bash
sudo ./demo.sh agent audit logs --component responses
```

<!-- rec ddos 10 -->
```text
COMPONENT  ACTION      SRC IP        DST IP  SPORT  DPORT  RULE ID       DETAIL
responses  rule_added  172.30.66.66  -           0      0  contain-ddos  auto-response block_ip on 172.30.66.66 for al...

Showing 1/1 entry(ies) (offset=0).
```

The packets dropped during the flood are audited too, under
`--component ddos`, one entry per drop the kernel reported.

## Clean up

```bash
sudo ./demo.sh down
```

## Going further

- [DDoS protection](../features/ddos.md): the attack types, SYN
  cookies, and how thresholds are chosen.
- [Automated response](../features/response.md): severities, components,
  TTLs and revoking a block early.
