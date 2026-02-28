# Troubleshooting

## Agent Won't Start

### Kernel version too old

```
Error: failed to load eBPF program: kernel version too old
```

Check: `uname -r` must be >= 5.17. Upgrade your kernel.

### BTF not available

```
Error: BTF not found at /sys/kernel/btf/vmlinux
```

Your kernel was built without `CONFIG_DEBUG_INFO_BTF=y`. Install a BTF-enabled kernel for your distribution.

### Insufficient capabilities

```
Error: permission denied loading eBPF program
```

Run as root or set capabilities:

```bash
sudo setcap cap_bpf,cap_net_admin+ep ./ebpfsentinel-agent
```

### Interface not found

```
Error: interface eth0 not found
```

Check available interfaces: `ip link show`. Update `agent.interfaces` in your config.

### BPF filesystem not mounted

```
Error: /sys/fs/bpf not mounted
```

Mount it:

```bash
sudo mount -t bpf bpf /sys/fs/bpf
```

## No Traffic Captured

1. Verify the interface is correct and has traffic:
   ```bash
   tcpdump -i eth0 -c 10
   ```

2. Check eBPF programs are loaded:
   ```bash
   sudo bpftool prog list
   curl http://localhost:8080/api/v1/ebpf/status
   ```

3. Check eBPF maps have data:
   ```bash
   sudo bpftool map list
   sudo bpftool map dump id <MAP_ID>
   ```

## IDS Not Generating Alerts

1. Verify rules are loaded:
   ```bash
   ebpfsentinel-agent ips list
   ```

2. Check sampling — if `sample_rate` is high, most packets are skipped:
   ```bash
   curl http://localhost:8080/metrics | grep sampled
   ```

3. Test a rule manually:
   ```bash
   # Send traffic matching a rule
   curl http://target-host/ -d "union select * from users"
   ```

4. Check threshold settings — `threshold` mode requires N matches before alerting.

## High CPU Usage

1. Check per-domain latency:
   ```bash
   curl http://localhost:8080/metrics | grep processing_duration
   ```

2. Enable IDS sampling to reduce userspace load:
   ```yaml
   ids:
     sample_rate: 100    # Inspect 1-in-100
   ```

3. Profile with perf:
   ```bash
   sudo perf top -p $(pidof ebpfsentinel-agent)
   ```

## High Memory Usage

1. Check DNS cache size:
   ```bash
   ebpfsentinel-agent dns stats
   ```

2. Reduce cache if needed:
   ```yaml
   dns:
     cache_size: 10000
   ```

3. Check IPS blacklist size:
   ```bash
   ebpfsentinel-agent ips blacklist
   ```

## Config Reload Fails

1. Check the reload endpoint response:
   ```bash
   curl -v -X POST http://localhost:8080/api/v1/config/reload
   ```

2. Check agent logs for validation errors:
   ```bash
   journalctl -u ebpfsentinel -f
   ```

3. Validate the config file manually — look for YAML syntax errors, invalid CIDRs, or invalid regex patterns.

## Debugging Tools

```bash
# List loaded eBPF programs
sudo bpftool prog list

# Inspect a specific program
sudo bpftool prog show id <ID>

# Dump map contents
sudo bpftool map dump id <ID>

# Trace eBPF program execution
sudo bpftool prog tracelog

# System call tracing
sudo strace -p $(pidof ebpfsentinel-agent) -e bpf

# Performance profiling
sudo perf record -p $(pidof ebpfsentinel-agent) -g -- sleep 30
sudo perf report
```
