# Catch a card number inside TLS

A workload posts a payment card number to a service over HTTPS. Nothing on
the wire is readable, yet the agent reads the request where it is still clear
text: inside OpenSSL, as the client writes it and as the server reads it. It
raises an alert and writes the finding to the audit trail.

<video controls preload="metadata" poster="/video/dlp-over-tls.jpg" src="/video/dlp-over-tls.mp4" width="100%"></video>

Recorded on Linux 7.0 against the [Compose lab](./index.md#the-lab). Every
output below is what that run printed.

## What it uses

- `uprobe-dlp`, an eBPF program attached to `SSL_write` and `SSL_read` in
  the OpenSSL library of every container on the host. The agent finds them by
  scanning `/proc` and follows containers as they start.
- The seventeen built-in patterns, card numbers among them, in `alert` mode:

```yaml
dlp:
  enabled: true
  mode: alert
```

Alert mode is what the open source agent does: it reports and audits. Blocking
the write and adding your own patterns are [Enterprise
features](../features/enterprise/dlp.md).

## 1. Start the lab

```bash
sudo ./demo.sh up
sudo ./demo.sh agent dlp status
```

<!-- rec dlp 2 -->
```text
Data Loss Prevention
  Enabled:   yes
  Mode:      alert
  Patterns:  17
```

Give the agent a few seconds after `up`: it attaches to each container's
OpenSSL as it finds it.

## 2. Send a card number over HTTPS

The `app` container posts a test Visa number to the target, over TLS:

```bash
sudo docker compose exec app curl -sk -o /dev/null -w '%{http_code}\n' \
  https://172.30.66.1/orders -d 'card=4111111111111111&name=demo'
```

<!-- rec dlp 3 -->
```text
200
```

The request succeeds. Alert mode never stands in the way of traffic.

## 3. Read the alert

```bash
sudo ./demo.sh agent alerts list --component dlp
```

<!-- rec dlp 4 -->
```text
ID                                  COMPONENT  SEVERITY  RULE ID       ACTION  SRC IP  DST IP  SPORT  DPORT  FP  SRC DOMAIN  DST DOMAIN  MESSAGE
1791388205961623718-dlp-pci-visa-1  dlp        critical  dlp-pci-visa  alert   -       -           0      0  no  -           -           DLP pattern Visa Card Number (pci) matched on...
1791388205961619945-dlp-pci-visa-0  dlp        critical  dlp-pci-visa  alert   -       -           0      0  no  -           -           DLP pattern Visa Card Number (pci) matched on...

Showing 2/2 alert(s) (offset=0).
```

Two alerts for one request, because both ends of the connection run OpenSSL
on this host: `curl` as it wrote the number, the target's Python `ssl` module
as it read it. The address columns are empty: a uprobe sees a process's
buffer, not a packet, and that is why it sees the clear text. The number
itself is not kept: the alert carries the pattern, the process id and a
redacted excerpt, which `-o json` prints in full.

## 4. Find it in the audit trail

```bash
sudo ./demo.sh agent audit logs --component dlp
```

<!-- rec dlp 5 -->
```text
COMPONENT  ACTION            SRC IP  DST IP  SPORT  DPORT  RULE ID       DETAIL
dlp        policy_violation  -       -           0      0  dlp-pci-visa  DLP Visa Card Number (pci) pid=11868
dlp        policy_violation  -       -           0      0  dlp-pci-visa  DLP Visa Card Number (pci) pid=11868

Showing 2/2 entry(ies) (offset=0).
```

Each entry names the pattern and the process; `-o json` prints it in full.

## Clean up

```bash
sudo ./demo.sh down
```

## Going further

- [DLP](../features/dlp.md): the patterns, the libraries it attaches to, and
  what a statically linked binary needs.
- [Container awareness](../features/container-awareness.md): how a finding is
  tied to the container that produced it.
