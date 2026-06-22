# Performance Tuning

## XDP Attachment Mode

The single highest-impact tuning knob. Native XDP runs inside the NIC driver — packets never allocate an `sk_buff`. Generic XDP (the fallback on unsupported drivers) runs after SKB allocation, losing the zero-copy advantage.

```yaml
agent:
  xdp_mode: native    # auto | native | generic | offloaded
```

| Mode | When to use |
|------|-------------|
| `native` | Production on supported drivers (`virtio_net`, `mlx5`, `i40e`, `ena`, `gve`, etc.) |
| `generic` | Development, veth pairs, unsupported drivers |
| `auto` |  Safe default — kernel tries native first |
| `offloaded` | Netronome NFP SmartNICs only |

Check your driver: `ethtool -i eth0 | grep driver`. If it supports native XDP, set `xdp_mode: native` explicitly — this avoids any ambiguity and logs the confirmed mode at startup.

> **Note**: `xdp_mode` is read at program attachment time. Changing it requires a restart or a hot-reload that re-attaches XDP programs (e.g. toggling the firewall off and on).

## IDS Sampling

For high-traffic environments, enable kernel-side sampling to reduce userspace load:

```yaml
ids:
  sample_rate: 100      # Inspect 1-in-100 packets
  sample_mode: random   # random (per-packet) or hash (per-flow)
```

`hash` mode provides consistent per-flow sampling — all packets from the same flow are either inspected or skipped. `random` mode is truly random per-packet.

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
  cache_size: 100000     # Default — good for most environments
  cache_ttl: 3600        # Reduce for dynamic environments
```

Monitor `ebpfsentinel_dns_cache_size` to see actual usage.

## Firewall Rule Optimization

- **CIDR-only rules** use LPM tries (O(log n)) — faster than rules with port/protocol filters
- **Fewer rules** = faster linear scan for non-CIDR rules
- **Lower priority numbers** for frequently-matched rules (evaluated first)
- Maximum 4096 rules per address family

## eBPF Map Sizes

The kernel allocates memory for eBPF maps at load time. Large maps increase memory usage:

```bash
# Check kernel map memory
sudo bpftool map list
```

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
