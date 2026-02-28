# Performance Tuning

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
