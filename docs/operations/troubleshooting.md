# Troubleshooting

## Agent Won't Start

### Kernel version too old

```
Error: failed to load eBPF program: kernel version too old
```

Check: `uname -r` must be >= 6.9. Upgrade your kernel. BPF token delegation requires kernel 6.9+.

### BTF not available

```
Error: BTF not found at /sys/kernel/btf/vmlinux
```

Your kernel was built without `CONFIG_DEBUG_INFO_BTF=y`. Install a BTF-enabled kernel for your distribution.

### eBPF fails to load / "BPF token unavailable — API-only mode"

```
Error: permission denied loading eBPF program
```

eBPF loads only through a BPF token, which requires a user namespace. Start the
agent via the launcher (not directly) so the token is created:

```bash
sudo ebpfsentinel-token-launch \
  --bpffs /sys/fs/bpf/ebpfsentinel \
  ./ebpfsentinel-agent --config config/ebpfsentinel.yaml
```

If it still fails, the host likely disallows unprivileged user namespaces or the
launcher lacks `CAP_SYS_ADMIN`. There is no `setcap cap_bpf` fallback. See the
[BPF token guide](deployment/bpf-token.md#troubleshooting).

### Interface not found

```
Error: interface eth0 not found
```

Check available interfaces: `ip link show`. Update `agent.interfaces` in your config.

### Programs load but nothing attaches, and `/readyz` stays 503

The kernel allows exactly one XDP program per interface. Under Docker and
Kubernetes the container runtime or CNI frequently owns that slot already, so
the agent's program loads and then loses the attach. Ask the agent what is in
the way:

```bash
curl -s http://localhost:8080/readyz | jq .attach_blocked
curl -s http://localhost:8080/api/v1/ebpf/status | jq .attach_blocked
```

```json
[
  {
    "program": "xdp-firewall",
    "interface": "eth0",
    "reason": "interface eth0 already has an XDP program attached (id 42, generic). It is held by a BPF link, so only the process owning that link can replace it. The kernel allows one XDP program per interface, so this one cannot attach on top. Native and generic XDP cannot both be active on one interface, so matching `agent.xdp_mode` to the attachment already there is the other way out.",
    "nested_xdp": true
  }
]
```

Confirm from the other side with `ip link show eth0` (look for the `xdp` marker)
or `sudo bpftool net list`. Options, in order of preference:

1. Attach to a different interface - one the runtime does not manage.
2. Have whatever owns the slot release it, if it is not load-bearing.
3. Accept the loss for that interface: the TC and uprobe programs still attach,
   so IDS, DLP and threat intel keep working without the XDP fast path.

When the reason mentions native and generic XDP, the slot is occupied in a mode
other than the one requested. Setting `agent.xdp_mode` to the mode already in
use does not free the slot, but it does remove the mode conflict as a second,
separate cause.

An empty `attach_blocked` with `"ebpf_loaded": false` is a different problem -
the agent has not finished loading, or loading failed outright. Check the log.

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
