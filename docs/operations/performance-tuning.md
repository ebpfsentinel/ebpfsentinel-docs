# Performance Tuning

## XDP Attachment Mode

The single highest-impact tuning knob. Native XDP runs inside the NIC driver - packets never allocate an `sk_buff`. Generic XDP (the fallback on unsupported drivers) runs after SKB allocation, losing the zero-copy advantage.

```yaml
agent:
  xdp_mode: native    # auto | native | generic | offloaded
```

| Mode | When to use |
|------|-------------|
| `native` | Production on supported drivers (`virtio_net`, `mlx5`, `i40e`, `ena`, `gve`, etc.) |
| `generic` | Development, veth pairs, unsupported drivers |
| `auto` | The default: the kernel picks native where the driver has it |
| `offloaded` | Netronome NFP SmartNICs only |

Check your driver: `ethtool -i eth0 | grep driver`. A requested mode the interface refuses does not stop the agent: the attach falls back to `auto` and logs `XDP kfunc attach failed with requested mode, falling back to auto`. Read the mode the kernel actually granted from the attach log or from the `ebpfsentinel_xdp_attach_mode` gauge rather than from the configuration.

**On `virtio_net`, native XDP turns off the guest receive offloads.** Without a program attached the host hands the guest TCP already coalesced (`rx-gro-hw: on`), so 1 Gbps of TCP arrives as about 5,000 packets a second; with one attached the driver takes the offloads away, because an XDP program has to see one frame at a time, and the same 1 Gbps arrives as about 93,000 MTU-sized frames. Measured on a 4-vCPU KubeVirt guest on Kube-OVN, that is about 0.15 of a core more at 1 Gbps and about 0.4 at 2.5 Gbps than the same guest with no agent, and TCP retransmissions where there were none. Most of that is the kernel stack handling eighteen times as many packets rather than the eBPF programs themselves, and it is the price of native XDP on that driver: generic mode keeps the offloads but runs every program after the `sk_buff` is built.

> **Note**: `xdp_mode` is read at program attachment time. Changing it requires a restart or a hot-reload that re-attaches XDP programs (e.g. toggling the firewall off and on).

## IDS Sampling

Sampling cuts the work done on IDS and IPS events:

```yaml
ids:
  sampling:
    mode: random    # none | random | hash | country_based
    rate: 0.01      # share sampled, 0.0 to 1.0
```

`ips.sampling` takes the same keys and gates the IPS blacklist counter.

| Mode | Keys | Effect |
|------|------|--------|
| `none` | - | Every event is evaluated (the default) |
| `random` | `rate` | The `tc-ids` classifier draws per packet and emits a match only when the draw falls under `rate` |
| `hash` | `rate` | Evaluated when a hash of the source and destination addresses falls under `rate` |
| `country_based` | `high_risk_countries`, `high_risk_rate` (default 1.0), `default_rate` (default 0.1) | `high_risk_rate` for sources in the listed countries, `default_rate` for the rest |

`random` is the one mode that lightens the kernel-to-userspace path: the agent writes the rate into the `IDS_SAMPLING_CONFIG` map and `tc-ids` skips the ring-buffer write for a packet it did not draw, so a sampled-out match costs neither a ring-buffer slot nor a userspace wakeup. A drop decided by an IPS rule in block mode is enforced whatever the draw; only its event is sampled. What the kernel does not sample - a captured L7 payload matched by a content rule, and the IPS blacklist counter - selects on a hash of the address pair at the same rate.

`hash` and `country_based` decide on the address pair after the kernel has emitted the event: an address pair evaluated once is evaluated every time, and one skipped is always skipped. They save rule evaluation, alert routing and the IPS counter, not the ring-buffer traffic. Keep that in mind before sampling a detection that needs to see a given source, since a sampled-out pair never raises an alert.

## Rate Limiting Algorithm Selection

```yaml
ratelimit:
  default_algorithm: token_bucket   # token_bucket | fixed_window | sliding_window | leaky_bucket
  default_rate: 1000
  default_burst: 2000
```

| Algorithm | Behaviour |
|-----------|-----------|
| `token_bucket` | The default. Allows bursts up to `burst`, refills at `rate` |
| `fixed_window` | Counts per window and resets at its edge, so a burst straddling two windows can pass twice the rate |
| `sliding_window` | Eight sub-slots per window, which smooths the edge effect of `fixed_window` |
| `leaky_bucket` | A level that rises by one per packet up to `burst` and drains at `rate`. It is a meter, not a queue: a packet over the level is dropped rather than delayed, so it admits the same bursts as `token_bucket` |

Every bucket is stored in the same fixed-size slot whatever its algorithm, so the choice changes the enforcement curve and not the map memory. Pick it for the behaviour you want.

A rule names one source address (`src_ip`); every source no rule names gets its own bucket from the section defaults, and the number of sources tracked at once is `ratelimit.max_buckets` (see [eBPF Map Sizes](#ebpf-map-sizes)). SYN flood protection is not a rate-limit algorithm: it is the SYN cookie path of the DDoS guard (`ddos`).

## DNS Cache Sizing

Size the DNS cache based on the number of unique domains in your environment:

```yaml
dns:
  cache:
    max_entries: 100000       # Default
    min_ttl_secs: 60          # Floor applied to short record TTLs
    purge_interval_secs: 30   # How often expired entries are swept
```

Monitor `ebpfsentinel_dns_cache_entries` against `max_entries`, and `ebpfsentinel_dns_cache_evictions_total`: evictions climbing while the cache sits at its ceiling means it is too small for the estate.

## Firewall Rule Optimization

- **CIDR-only rules** (an address match and nothing else) go into LPM tries and are looked up in logarithmic time whatever their number.
- **Every other rule** is scanned linearly in priority order, lowest number first, and the first match wins. Fewer such rules is a faster scan.
- **Priority is precedence, not a speed knob.** Moving a rule to a lower number changes which rule wins for traffic several rules match, so reorder for the verdict you want, not for speed.
- Maximum 4096 rules per address family.

## eBPF Map Sizes

The kernel allocates every map's memory at load time and locks it, whether the slots are used or not. That memory is charged to the cgroup that created the maps, so a container limit has to hold the agent's resident size plus the maps, and it is not visible in the process's RSS:

```bash
# Kernel map memory, per map and in total
sudo bpftool map show -j | python3 -c 'import json,sys; m=json.load(sys.stdin); print(sum(x.get("bytes_memlock",0) for x in m)//1000000, "MB")'
```

Map memory has two parts:

- **A fixed part** that does not depend on the machine: rule arrays, the conntrack source counters, the DNS and IDS pattern tables, the ring buffers. About 56 MB with every feature on.
- **A per-CPU part** that is paid once per possible CPU: the tables the kernel fills on its own are per-CPU LRU hashes, so a table of 65,536 slots costs 65,536 slots on every CPU the kernel could ever bring online, which is `/sys/devices/system/cpu/possible` rather than the CPUs running now. A configuration that fits a 4-vCPU test VM is sixteen times larger on a 64-core node, and a VM whose hypervisor reserves CPUs for hotplug pays for those too: a 4-vCPU KubeVirt guest declares 16 possible CPUs and locks four times what the same guest would without hotplug.

The per-CPU tables take their capacity from the configuration at agent start, at 40 to 90 bytes a slot per CPU depending on the table:

| Key | Default | Tables it sizes |
|---|---|---|
| `ratelimit.max_buckets` | 65,536 | the rate-limit bucket table |
| `ddos.max_tracked_sources` | 16,384 | the five per-source DDoS tables (SYN rate, ICMP rate, amplification rate, half-open counts, flood counters) |
| `ddos.connection_tracking.max_entries` | 65,536 | the DDoS connection table |
| `threatintel.max_entries` | derived | the IOC tables (IPv4, IPv6, and a bloom filter for each); not per CPU. Unset, it is the enabled feeds' `max_iocs` added up and rounded up to a power of two, and a configuration with no feed gets the floor of 4,096 |

With the defaults and every feature on, the maps lock about 99 MB on 4 CPUs, of which about 43 MB is the per-CPU part, so about 11 MB more per additional CPU: about 230 MB on 16. The agent logs the plan it applied at start (`eBPF table capacities`, at info level), and a capacity changed by a configuration reload is reported and applied at the next start, because a pinned map keeps the size it was created with.

Size the tables for the estate rather than the worst case: `max_tracked_sources` is how many distinct source addresses the DDoS guards need to remember at once, `max_buckets` how many sources the rate limiter tracks, and each evicts its least recently seen entry when full. A rate-limit rule keyed on one address needs one slot per CPU, not 65,536.

## Logging

Reduce log verbosity in production:

```yaml
agent:
  log_level: "warn"     # error | warn | info | debug | trace
  log_format: "json"    # json | text
```

`RUST_LOG` overrides `log_level` and takes per-module directives: `RUST_LOG=warn,domain::ids=info`.

Debug statements are compiled into release builds and filtered at runtime by the level, so below `debug` they cost a level check and nothing else. Set `log_level: "debug"` only during troubleshooting: on a busy node the per-event lines are what costs.

## Resource Limits

The Helm chart runs two containers per node and sets requests and limits for both:

```yaml
daemonset:
  resources:            # the agent
    requests:
      memory: "128Mi"
      cpu: "100m"
    limits:
      memory: "512Mi"
      cpu: "1000m"
  warden:
    resources:          # the warden
      requests:
        memory: "64Mi"
        cpu: "50m"
      limits:
        memory: "256Mi"
        cpu: "1000m"
```

These are the chart defaults. The agent's memory limit has to hold its resident size plus the locked map memory charged to its cgroup, which with every feature on is already about 99 MB on 4 CPUs and grows with the CPU count (see [eBPF Map Sizes](#ebpf-map-sizes)). On a large node raise the agent's limit or shrink the per-CPU tables.

Monitor `ebpfsentinel_memory_usage_bytes` and `ebpfsentinel_cpu_usage_percent` to right-size; the first is the process's resident set and does not include the maps.
