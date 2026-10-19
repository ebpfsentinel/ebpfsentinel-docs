# From observation to a deny-by-default policy

One host, one sitting. At the end of it, every workload on your homelab node has an allow-list built from what it actually dialled, a closing deny under it, and you have decided - rule by rule - which of them refuse and which only count.

This is the one tutorial on this site that runs on **your** host rather than in the [lab](./index.md#the-lab), because the whole point of learning mode is a machine nobody has an inventory for. There is no recording of it: the output below is the shape the commands print, with the addresses and unit names of the host they were run on, and yours will differ in every line.

Allow about two hours, of which you spend fifteen minutes at the keyboard.

## Before you start

- The agent is installed and running on the node, Linux 6.9 or later with BTF.
- `learning.enabled` is left at its default, `true`. Nothing is observed until you open a window.
- You can edit the agent's configuration file, by default `/etc/ebpfsentinel/ebpfsentinel.yaml`.
- Give the node its ordinary work during the window. A learning window over an idle host writes an allow-list for an idle host.

## 1. Open a window

Watch the whole node for an hour:

```bash
ebpfsentinel-agent learning start -d 3600
```

```text
id:          learn-1760000000
status:      running
scope:       the whole node
window:      0s elapsed of 3600s, 3600s left
edges:       0 of 8192 (0 observations, 0 unattributed, 0 out of scope)
last new:    nothing seen yet
```

Now use the host the way it is normally used. Pull your container images, let the backup run, open the services you expose, run whatever cron would have run. What you do not exercise now is what will be missing from the document, and the cheapest moment to fix that is while the window is open.

## 2. Watch it fill

```bash
ebpfsentinel-agent learning status
```

```text
id:          learn-1760000000
status:      running
scope:       the whole node
window:      1840s elapsed of 3600s, 1760s left
edges:       23 of 8192 (184 observations, 2 unattributed, 0 out of scope)
last new:    412s ago
```

Two figures decide whether to keep waiting:

- **`last new`** is how long since the window found a destination it had not seen. While it is seconds, the host is still showing you new behaviour. Once it is in the tens of minutes, the window has probably seen what there is to see.
- **`edges` against the ceiling.** If `dropped:` appears, the window is full and the reading is incomplete; stop it, raise `learning.max_edges`, and run it again rather than writing a policy from a truncated list.

The two `unattributed` readings are flows the agent could not tie to a workload. They are counted, never invented into a rule.

## 3. Close it and read the document

```bash
ebpfsentinel-agent learning stop
ebpfsentinel-agent learning policy -f /etc/ebpfsentinel/learned.yaml
```

```text
23 rules for 4 workloads written to /etc/ebpfsentinel/learned.yaml
```

Open the file. It starts with what the window could not know:

```yaml
# What this node reached, written as the rules that would allow it.
#
# Window:       learn-1760000000
# Scope:        the whole node
# Observed:     3600s of the 3600s asked for, status completed
# Flows folded: 361 readings, 2 of them naming no workload, 0 outside the scope
# Destinations: 23 distinct, across 4 workloads, written as 27 rules
#
# A destination this node did not reach during the window is not in this
# document. That is what the document is: a reading of one window, not a
# specification of what the node is allowed to do. Read it, cut what should
# not be there, add what the window did not catch.
#
# Every rule below is in observe mode, so applying this document refuses
# nothing: it counts what it would have refused. Moving a rule to enforce is
# a decision somebody takes, never a default.
#
firewall:
  rules:
    - id: learn-backup-service-1
      priority: 1000
      action: allow
      protocol: tcp
      dst_ip: 10.0.0.12/32
      dst_port: 22
      workload:
        unit: backup.service
        mode: observe
    # 4 addresses in this prefix were reached: 10.0.0.3, 10.0.0.7, 10.0.0.11, 10.0.0.21.
    # The rule allows the whole prefix, which is wider than what was observed.
    - id: learn-caddy-service-3
      priority: 1004
      action: allow
      protocol: tcp
      dst_ip: 10.0.0.0/24
      dst_port: "8080-8082"
      workload:
        unit: caddy.service
        mode: observe
    # what makes the rules above an allow-list: everything else this workload
    # opens. It counts while the mode is observe, and refuses the day somebody
    # moves it to enforce.
    - id: learn-caddy-service-4-deny-rest
      priority: 1005
      action: deny
      protocol: any
      workload:
        unit: caddy.service
        mode: observe
```

## 4. Edit it before it goes anywhere

This is the step the whole tutorial exists for. Three passes over the file:

1. **Cut what should not have happened.** A destination being in the document means the host reached it, not that it was supposed to. A workload talking to an address you do not recognise is a finding, not a rule.
2. **Refuse the generalisations you do not want.** Every rule whose destination is a prefix carries a comment naming the addresses it was built from, as `learn-caddy-service-3` does above. Either keep the /24 because the range is genuinely one service, or replace it with the four addresses from the comment.
3. **Add what the window did not catch.** Your nightly backup target, the quarterly licence check, the failover path that was not taken today. These are exactly the rules that are missing, and the only place they exist is in your head.

## 5. Load it in observe mode

Paste the rules into the `firewall.rules` list of the agent's configuration file, keeping the rest of the `firewall` section as it is, and reload:

```bash
ebpfsentinel-agent config reload
ebpfsentinel-agent firewall workload
```

```text
RULE                              VERDICT  MODE     SELECTOR              DESTINATION                               DENIALS
learn-backup-service-1            allow    observe  unit=backup.service   proto 6 to 10.0.0.12/32 port 22                 0
learn-caddy-service-3             allow    observe  unit=caddy.service    proto 6 to 10.0.0.0/24 ports 8080-8082          0
learn-caddy-service-4-deny-rest   deny     observe  unit=caddy.service    to anywhere                                     0

No rule in force refuses: every one of them only counts.
```

That last line is the agent telling you the state you asked for: every rule is in `observe` mode, so the closing deny counts what it would have refused and lets the connection through. Leave the node alone for a day, or a week if a weekly job matters to you.

## 6. Read what the denies counted

```bash
ebpfsentinel-agent firewall workload
```

A closing deny whose `DENIALS` column is still zero means that workload went a whole period without reaching anything outside its allow-list: it is ready to enforce. A closing deny that has counted is telling you the document is short, and `firewall reach` says what the workload was trying to do:

```bash
ebpfsentinel-agent firewall reach --unit caddy.service
```

Add the missing destination as an ordinary rule, reload, and wait again. Each round makes the list shorter.

## 7. Turn the deny on, one workload at a time

For the workload whose deny counted nothing, change `mode: observe` to `mode: enforce` on **every rule naming that workload** - the allows and the closing deny together - and reload:

```bash
ebpfsentinel-agent config reload
```

That workload is now deny-by-default: it reaches what the list allows and nothing else, decided in the kernel as each connection is opened. Every refusal names the rule that refused and lands in the alert stream:

```bash
ebpfsentinel-agent alerts list --component workload-firewall
```

Do the next workload when its deny has counted nothing for a period you trust. Enforcing them one at a time is what keeps a mistake to one service.

## What you did not get

- **A policy for behaviour that did not happen.** Everything in step 4 stays true a month later: a window is a reading, and the rules nobody observed are still yours to write.
- **An identity.** A workload rule names an executable, a unit, a cgroup or a container, and an executable path is forgeable by anything that can write one. It is an operational control, not an authentication: see [Workload firewall rules](../configuration/workload-firewall.md).
- **Anything for traffic this node only forwarded.** Learning mode records connections the node opened, so a router or a gateway learns about its own workloads, not about what passes through it.

## Where to go next

- [Learning mode](../features/learning-mode.md) - the window, the scopes, the collapsing and what it cannot know.
- [Learning mode configuration](../configuration/learning.md) - the four keys and what they cost.
- [Workload firewall rules](../configuration/workload-firewall.md) - the rule language the document is written in.
