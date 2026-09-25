# Hot Reload

eBPFsentinel supports zero-downtime configuration changes. When the YAML config file is modified, the agent detects the change, validates the new configuration, and applies it - including loading or unloading eBPF kernel programs - without restarting the process.

## Trigger Methods

| Method | Command | Latency |
|--------|---------|---------|
| File watcher | Edit the config file (auto-detected, 500ms debounce) | ~1s |
| SIGHUP | `kill -HUP $(pidof ebpfsentinel-agent)` | immediate |
| REST API | `curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/config/reload` | immediate |

## What Gets Reloaded

### Reloaded

Each of these is handed to its service, which rewrites the kernel maps of the program that enforces it when that program is loaded:

- Firewall rules, mode, interface scope and anti-lockout
- Rule schedules
- IDS, IPS and L7 rules, modes and sampling
- Rate limit policies, defaults (`default_rate`, `default_burst`, `default_algorithm`) and country tiers, DDoS policies
- DLP settings: enabled switch, mode and the built-in patterns the file re-tunes
- Connection tracking settings
- NAT rules (DNAT, SNAT, NPTv6) and hairpin
- Aliases, routing gateways, zones
- Load balancer services and the VIP announcer
- QoS pipes, queues and classifiers
- Threat intelligence feeds and mode
- The JWT public key (read again from `auth.jwt.public_key_path`) and the OIDC JWKS (fetched again)

### Not reloaded

These are read once at startup and apply at the next start:

- API keys (`auth.api_keys`)
- DNS blocklists and reputation settings
- Alerting routes and audit settings
- `agent.interfaces` (see [Limitations](#limitations))

### Shared eBPF maps (re-synced)

These are written in place on every reload, without reloading any program:

- `CONFIG_FLAGS` - per-feature enabled flags, read by `tc-ids` and `tc-threatintel`
- `L7_PORTS` - ports `tc-ids` hands to the L7 parser
- `INTERFACE_GROUPS` - interface-to-group membership bitmask

### eBPF programs (loaded/unloaded dynamically)

When a feature's `enabled` flag changes from `false` to `true` (or vice versa), the corresponding eBPF program is loaded into the kernel and attached to the configured interfaces - or detached and unloaded.

| Program | Config Key | Hook | Dynamic Load | Dynamic Unload |
|---------|-----------|------|:---:|:---:|
| `tc-ids` | `ids.enabled` or `l7.enabled` | TC ingress | Yes | Yes |
| `tc-threatintel` | `threatintel.enabled` | TC ingress | Yes | Yes |
| `tc-dns` | `dns.enabled` | TC ingress | Yes | Yes |
| `tc-conntrack` | `conntrack.enabled` | TC ingress | Yes | Yes |
| `tc-nat-ingress` / `tc-nat-egress` | `nat.enabled` | TC ingress/egress | Yes | Yes |
| `tc-scrub` | `firewall.scrub.enabled` | TC ingress | Yes | Yes |
| `uprobe-dlp` | `dlp.enabled` | uprobe | Yes | Yes |
| `xdp-firewall` | `firewall.enabled` | XDP | Yes | Yes |
| `xdp-ratelimit` | `ratelimit.enabled` | XDP | Yes | Yes |
| `xdp-loadbalancer` | `loadbalancer.enabled` | XDP | Yes | Yes |
| `tc-qos` | `qos.enabled` | TC egress | No | No |

`tc-ids` is also how L7 traffic reaches the L7 parser, so it stays loaded while either `ids.enabled` or `l7.enabled` is true. `tc-qos` is loaded at startup or not at all: turning QoS on or off takes a restart, while its pipes, queues and classifiers reload.

A program's metrics readers follow it: the kernel counters of a program a reload loads are exported from the next metrics tick, and those of a program it unloads stop being read.

## XDP Tail-Call Chain

XDP programs form a tail-call chain that is automatically rewired when programs are added or removed:

```
xdp-firewall ─┬─ slot 0 → xdp-ratelimit ─┬─ slot 0 → xdp-ratelimit-syncookie
              ├─ slot 1 → xdp-firewall-reject └─ slot 1 → xdp-loadbalancer
              ├─ slot 2 → xdp-loadbalancer (when ratelimit is off)
              └─ slot 3 → xdp-vip-announcer
```

Only the root, the first of firewall, ratelimit and loadbalancer that is enabled, is attached to the interfaces; the others are loaded as tail-call targets. `xdp-firewall-reject` and `xdp-ratelimit-syncookie` come and go with their parent, and `xdp-vip-announcer` is loaded with the first firewall, at startup or by the reload that first enables it, when `loadbalancer.announce` names a role, and stays loaded, so a firewall loaded again is wired back to it.

When the root stays the same, a program disabled has its slot cleared (the tail call becomes a no-op and the packet continues) and a program enabled is loaded behind the root and wired into its slot.

When the root changes, for instance enabling the firewall in front of a running rate limiter or disabling the firewall in front of one, the chain is rebuilt: every XDP program is unloaded, leaves first, and the enabled ones are loaded again, root first. The lookup maps are pinned, so rules and counters survive; for the time the rebuild takes, traffic crosses the interfaces without XDP filtering.

> **XDP mode on re-attach**: a program a reload attaches uses `agent.xdp_mode` from the new file. A root change therefore applies a new `xdp_mode`; a reload that leaves the root in place does not re-attach it, and the mode it was attached with stays.

## Map Pinning and State Preservation

Every map but the ring buffers is pinned under `/sys/fs/bpf/ebpfsentinel/` by name, and unloading a program leaves its pins in place. A program loaded again reuses the pinned maps, so it keeps:

- Rule and lookup tables (firewall LPM tries, IP sets, NAT, load balancer)
- Interface group and tenant mappings (`INTERFACE_GROUPS`, tenant maps)
- Rate limit buckets and threat intelligence bloom filter state
- CT config and BTF offsets (`CT_CONFIG`, `CT_NF_CONN_OFFSETS`)
- Per-program counters, which carry on rather than restart from zero

The services push their rules again when a program is wired in, so a table that was empty is filled. The pins are removed at shutdown.

A rate limiter a reload enables gets its defaults and its country tiers, which resolve through aliases into its own LPM tries.

A firewall a reload enables for the first time, because the agent started with `firewall.enabled: false`, gets everything a startup firewall gets: the LPM tries go to the alias, IPS and anti-DDoS services, which install what they kept while the datapath had nowhere to put it (the IPS blacklist with its remaining lifetime, the countries the anti-DDoS engine blocked, the content last pushed into external aliases), the IP set map goes to the alias service, the per-zone counters are exported and the VIP announcer is loaded behind it. A firewall loaded again after that reuses the same pinned maps and the managers the services already hold. The per-zone counter export stops with the firewall and starts again with it, from where the pinned counters stand rather than from zero.

## Validation

Configuration is validated in two phases before any change is applied:

1. **Loading** - YAML syntax, types, unknown or missing fields, file permissions
2. **Conversion** - every section that can refuse the file (firewall, IDS, IPS, L7, rate limit, DDoS, NAT, aliases, load balancer, VIP announcer, QoS, threat intelligence) is converted to domain rules: CIDR formats, regex compilation, rule limits, mode values

Nothing is applied until both phases pass. If either fails, the reload is rejected as a whole and the running configuration stays active. The reason is logged as a warning with the error attached:

```
WARN config reload rejected: invalid IDS rules error=...
```

## Monitoring

### Logs

Successful reloads log each phase:

```
INFO config file change detected, reloading
INFO firewall configuration reloaded successfully rule_count=12 enabled=true mode="block"
INFO tc-ids enabled via hot-reload
INFO eBPF program disabled and detached program="tc_conntrack"
INFO XDP chain root changes, rebuilding the chain from="xdp_ratelimit" to="xdp_firewall"
INFO XDP chain topology changed, tail-calls rewired
```

### API

Query the current eBPF program status:

```bash
curl -s http://localhost:8080/api/v1/ebpf/status | jq
```

```json
{
  "programs": [
    { "name": "xdp-firewall", "loaded": true },
    { "name": "tc-ids", "loaded": true },
    { "name": "tc-conntrack", "loaded": false },
    ...
  ]
}
```

The list follows reloads: a program a reload loads or unloads is reported as it now is. An `attach_blocked` array is added when an interface refused an attach.

### Prometheus Metrics

| Metric | Description |
|--------|-------------|
| `ebpfsentinel_rules_reloads_total{component, result}` | Counter per component (`firewall`, `ids`, `nat`, ...) and result (`success`/`failure`) |
| `ebpfsentinel_ebpf_program_status{program}` | Gauge: 1 if loaded, 0 if not; follows reloads |

## Example: Enable IDS at Runtime

Start with IDS disabled:

```yaml
ids:
  enabled: false
```

Edit the config file to enable IDS:

```yaml
ids:
  enabled: true
  rules:
    - id: detect-ssh-brute
      severity: high
      protocol: tcp
      dst_port: 22
      threshold:
        type: threshold
        count: 10
        window_secs: 60
```

The agent detects the file change and:

1. Validates the new configuration
2. Reloads IDS rules into the `IdsAppService`
3. Loads the `tc-ids` eBPF program from disk
4. Attaches it to every configured interface (TC ingress, and egress when `ids.inspect_egress` or the container resolver is on)
5. Writes `CONFIG_FLAGS` and `L7_PORTS` from the new configuration
6. Wires the IDS map manager to the service, which pushes the rules it holds
7. Starts the event reader and the kernel counter reader

No packets are lost during this process - the TC program is attached atomically by the kernel.

## Enterprise agent

The enterprise agent reloads on SIGHUP and on a change to the file, with the same validation and the same service reloads as above. It does not mount `POST /api/v1/config/reload`. The sections the enterprise layer reads (`enterprise.*`, licence, HA, tenants) are read at startup only.

Two things differ, because the enterprise datapath is loaded as one generation per node, the same generation an HA promotion loads:

- **Rules and the shared maps**: written in place, as on the community agent. Enforcement never pauses.
- **A different set of programs** (any `enabled` flag in the table above changing): the whole generation is reloaded on the interfaces the node drives. That is the path an HA takeover takes, so the programs and maps provably belong together, at the cost of a sub-second gap in enforcement on those interfaces. Tenant attributions are written into the new generation before it serves traffic.

The DLP capture path goes back to the Vectorscan engine after every reload, with the enabled switch and the mode the file just set.

On an HA standby a reload only stores the new configuration; the next promotion loads from it. A change to `agent.interfaces` is stored and applies at the next activation: in active-active the interfaces a node drives are the cluster's to assign, so the ones driven now stay driven.

An agent that runs with no datapath (eBPF could not load) logs the reload request and keeps running; the default SIGHUP disposition never terminates it.

Disabling `firewall.enabled` while an HA node holds its fail-closed posture unloads the program that enforces the posture. Leave the firewall on on a cluster that relies on failing closed.

## Limitations

- **Interface changes** require a restart. Programs already loaded stay on the interfaces they were attached to; a program a reload loads is attached to the list in the new file, so editing `agent.interfaces` without a restart leaves programs on different interfaces.
- **eBPF program upgrades** require a restart. A program is read from `/usr/local/lib/ebpfsentinel` when it is loaded, so after new objects are installed, a reload that loads one runs the new bytecode beside programs still running the old. Restart the agent after installing new objects.
- **Turning QoS on or off** requires a restart (see above).
- **TLS certificate changes** for the REST/gRPC server require a restart.
