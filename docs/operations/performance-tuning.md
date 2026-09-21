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
| `auto` |  Safe default - kernel tries native first |
| `offloaded` | Netronome NFP SmartNICs only |

Check your driver: `ethtool -i eth0 | grep driver`. If it supports native XDP, set `xdp_mode: native` explicitly - this avoids any ambiguity and logs the confirmed mode at startup.

> **Note**: `xdp_mode` is read at program attachment time. Changing it requires a restart or a hot-reload that re-attaches XDP programs (e.g. toggling the firewall off and on).

## IDS Sampling

For high-traffic environments, enable kernel-side sampling to reduce userspace load:

```yaml
ids:
  sample_rate: 100      # Inspect 1-in-100 packets
  sample_mode: random   # random (per-packet) or hash (per-flow)
```

`hash` mode provides consistent per-flow sampling - all packets from the same
flow are either inspected or skipped.

`random` is random in the kernel and deterministic above it. The IDS program
draws `bpf_get_prandom_u32` per packet, so a flow inspected once may be skipped
next time. The same setting also gates the IPS blacklist counter in userspace,
and there it selects on a hash of the address pair like `hash` does, with a
different mixing constant: a source counted once is counted every time. Nothing
in either layer keeps per-flow state to make the two agree.

## Rate Limiting Algorithm Selection

| Algorithm | CPU Cost | Memory | Best For |
|-----------|----------|--------|----------|
| `token_bucket` | Low | Low | General-purpose rate limiting |
| `fixed_window` | Lowest | Lowest | Simple rate caps |
| `sliding_window` | Medium | Medium | Smooth enforcement |
| `leaky_bucket` | Medium | Medium | Constant output rate |
| `syn_cookie` | Low | Minimal | SYN flood protection only |

For maximum throughput, use `token_bucket` with `per_ip` scope.

## DNS Cache Sizing

Size the DNS cache based on the number of unique domains in your environment:

```yaml
dns:
  cache_size: 100000     # Default - good for most environments
  cache_ttl: 3600        # Reduce for dynamic environments
```

Monitor `ebpfsentinel_dns_cache_entries` to see actual usage.

## Firewall Rule Optimization

- **CIDR-only rules** use LPM tries (O(log n)) - faster than rules with port/protocol filters
- **Fewer rules** = faster linear scan for non-CIDR rules
- **Lower priority numbers** for frequently-matched rules (evaluated first)
- Maximum 4096 rules per address family

## eBPF Map Sizes

The kernel allocates every map's memory at load time and locks it, whether the slots are used or not. That memory is charged to the cgroup that created the maps, so a container limit has to hold the agent's resident size plus the maps, and it is not visible in the process's RSS:

```bash
# Kernel map memory, per map and in total
sudo bpftool map show -j | python3 -c 'import json,sys; m=json.load(sys.stdin); print(sum(x.get("bytes_memlock",0) for x in m)//1000000, "MB")'
```

Map memory has two parts:

- **A fixed part** that does not depend on the machine: rule arrays, the conntrack source counters, the DNS and IDS pattern tables, the ring buffers. About 56 MB with every feature on.
- **A per-CPU part** that is paid once per online CPU: the tables the kernel fills on its own are per-CPU LRU hashes, so a table of 65,536 slots costs 65,536 slots on every CPU. A configuration that fits a 4-vCPU test VM is sixteen times larger on a 64-core node.

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
  log_level: "warn"     # Only warnings and errors
  log_format: "json"    # Structured for log shippers
```

Per-module: `RUST_LOG=warn,domain::ids=info`

> **Note:** eBPF hot-path logging (packet processing, map lookups, event emission) is compiled as `debug!()` only. In production builds or with `log_level` above `debug`, these log statements are effectively no-ops with zero overhead. Set `log_level: "debug"` only during development or troubleshooting.

## Resource Limits

For Kubernetes, set appropriate resource requests/limits:

```yaml
resources:
  requests:
    memory: "128Mi"
    cpu: "100m"
  limits:
    memory: "512Mi"
    cpu: "1000m"
```

Monitor `ebpfsentinel_memory_usage_bytes` and `ebpfsentinel_cpu_usage_percent` to right-size.
