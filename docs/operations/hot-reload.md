# Hot Reload

eBPFsentinel supports zero-downtime configuration changes. When the YAML config file is modified, the agent detects the change, validates the new configuration, and applies it — including loading or unloading eBPF kernel programs — without restarting the process.

## Trigger Methods

| Method | Command | Latency |
|--------|---------|---------|
| File watcher | Edit the config file (auto-detected, 500ms debounce) | ~1s |
| SIGHUP | `kill -HUP $(pidof ebpfsentinel-agent)` | immediate |
| REST API | `curl -X POST http://localhost:8080/api/v1/config/reload` | immediate |

## What Gets Reloaded

### Always reloaded (userspace-only)

These apply immediately with no kernel interaction:

- Firewall, IDS, IPS, L7 rules and modes
- Rate limit policies, DDoS policies
- Threat intelligence feeds and IOC lists
- DNS blocklists and reputation settings
- Alerting routes, audit settings
- NAT rules (DNAT, SNAT, NPTv6, hairpin)
- Connection tracking settings
- Load balancer services and backends
- QoS pipes, queues, classifiers
- Zone policies, aliases, routing gateways
- Schedule associations
- JWT public key rotation, OIDC JWKS refresh

### eBPF kernel maps (re-synced)

These kernel-side data structures are updated in-place without reloading the eBPF program:

- `CONFIG_FLAGS` — per-feature enabled/disabled flags read by `tc-ids`, `tc-threatintel`, `xdp-firewall`
- `L7_PORTS` — ports inspected by the IDS L7 engine
- `INTERFACE_GROUPS` — interface-to-group membership bitmask

### eBPF programs (loaded/unloaded dynamically)

When a feature's `enabled` flag changes from `false` to `true` (or vice versa), the corresponding eBPF program is loaded into the kernel and attached to the configured interfaces — or detached and unloaded.

| Program | Config Key | Hook | Dynamic Load | Dynamic Unload |
|---------|-----------|------|:---:|:---:|
| `tc-ids` | `ids.enabled` | TC ingress | Yes | Yes |
| `tc-threatintel` | `threatintel.enabled` | TC ingress | Yes | Yes |
| `tc-dns` | `dns.enabled` | TC ingress | Yes | Yes |
| `tc-conntrack` | `conntrack.enabled` | TC ingress | Yes | Yes |
| `tc-nat-ingress` / `tc-nat-egress` | `nat.enabled` | TC ingress/egress | Yes | Yes |
| `tc-scrub` | `firewall.scrub.enabled` | TC ingress | Yes | Yes |
| `uprobe-dlp` | `dlp.enabled` | uprobe | Yes | Yes |
| `xdp-firewall` | `firewall.enabled` | XDP | Yes | Yes |
| `xdp-ratelimit` | `ratelimit.enabled` | XDP | Yes | Yes |
| `xdp-loadbalancer` | `loadbalancer.enabled` | XDP | Yes | Yes |

## XDP Tail-Call Chain

XDP programs form a tail-call chain that is automatically rewired when programs are added or removed:

```
xdp-firewall ─┬─ slot 0 → xdp-ratelimit ─┬─ slot 0 → syncookie
              ├─ slot 1 → firewall-reject  └─ slot 1 → xdp-loadbalancer
              └─ slot 2 → xdp-loadbalancer (fallback)
```

When a program in the chain is disabled, the tail-call slot is cleared (becomes a no-op) and the remaining programs continue operating. When a new program is enabled, it is wired into the appropriate slot.

The "root" XDP program (the one physically attached to the interface) is selected by priority: firewall > ratelimit > loadbalancer. If the root changes, the new root replaces it on the interface.

> **XDP mode on re-attach**: when a program is re-attached during hot-reload (e.g. enabling the firewall), it uses the `agent.xdp_mode` from the current configuration. This means you can change `xdp_mode` in the YAML and trigger a reload that re-attaches XDP programs to apply the new mode without restarting the agent.

## Map Pinning and State Preservation

eBPF maps are pinned to `/sys/fs/bpf/ebpfsentinel/`. When a program is unloaded and re-loaded, the new instance reuses the existing pinned maps. This preserves:

- Interface group mappings (`INTERFACE_GROUPS`)
- Rate limit counters
- Threat intelligence bloom filter state
- CT config and BTF offsets (`CT_CONFIG`, `CT_NF_CONN_OFFSETS`)

## Validation

Configuration is validated in two phases before any change is applied:

1. **YAML parsing** — syntax, types, missing fields
2. **Domain validation** — CIDR formats, regex compilation, rule limits, mode values

If either phase fails, the reload is rejected and the previous configuration remains active. The error is logged:

```
config reload rejected: invalid IDS rules: regex compile error at rule "bad-pattern"
```

## Monitoring

### Logs

Successful reloads log each phase:

```
firewall configuration reloaded successfully, rule_count: 12, enabled: true, mode: "enforce"
tc-ids enabled via hot-reload
eBPF program disabled and detached, program: "tc_conntrack"
XDP chain topology changed, tail-calls rewired
```

### API

Query the current eBPF program status:

```bash
curl -s http://localhost:8080/api/v1/ebpf/status | jq
```

```json
{
  "programs": [
    { "name": "xdp_firewall", "loaded": true },
    { "name": "tc_ids", "loaded": true },
    { "name": "tc_conntrack", "loaded": false },
    ...
  ]
}
```

### Prometheus Metrics

| Metric | Description |
|--------|-------------|
| `ebpfsentinel_config_reload_total{component, result}` | Counter per domain (firewall, ids, ...) and result (success/failure) |
| `ebpfsentinel_ebpf_program_loaded{program}` | Gauge: 1 if loaded, 0 if not |

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
      protocol: tcp
      dst_port: 22
      threshold: 10
```

The agent detects the file change and:

1. Validates the new configuration
2. Reloads IDS rules into the `IdsAppService`
3. Loads the `tc-ids` eBPF program from disk
4. Attaches it to all configured interfaces (TC ingress)
5. Creates the IDS map manager and wires it to the service
6. Starts the event reader for IDS detections
7. Updates `CONFIG_FLAGS` so other eBPF programs see IDS as active

No packets are lost during this process — the TC program is attached atomically by the kernel.

## Limitations

- **Interface changes** require a restart. Adding or removing entries from `agent.interfaces` is not hot-reloaded.
- **eBPF program binary upgrades** require a restart. The hot-reload loads the same binary that was present at startup. To deploy new eBPF bytecode, restart the agent.
- **TLS certificate changes** for the REST/gRPC server require a restart.
