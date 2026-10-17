# Troubleshooting

## Agent Won't Start

### Kernel version too old

```
kernel is below the mandatory minimum 6.9 (kernel 6.8 is below the required minimum 6.9; ...) - eBPFsentinel refuses to start.
```

The agent reads `/proc/sys/kernel/osrelease` before anything else and exits below 6.9: BPF token delegation, the only way it loads eBPF, needs 6.9. There is no degraded mode. Upgrade the kernel.

### BTF not available

```
failed to read vmlinux BTF at /sys/kernel/btf/vmlinux: No such file or directory (os error 2)
```

The version check does not look at BTF, so the agent starts, but the programs that resolve kfuncs against kernel BTF fail to load and the error lands in the log and in `/api/v1/ebpf/status`. The kernel was built without `CONFIG_DEBUG_INFO_BTF=y`; install a BTF-enabled kernel for your distribution.

### "BPF token unavailable - running in API-only mode"

```
BPF token creation failed against `/sys/fs/bpf/ebpfsentinel`: ... point EBPFSENTINEL_WARDEN_SOCK at a running warden.
```

eBPF loads only through a BPF token, and the token needs a bpffs delegated by the warden. The agent stays up, serves the API and loads nothing (`/readyz` answers 503). Check, in order:

1. the warden is running and its socket exists: `systemctl status ebpfsentinel-warden`, `ls -l /run/ebpfsentinel/warden.sock`;
2. the agent has `EBPFSENTINEL_WARDEN_SOCK` pointing at that socket (the shipped unit sets it);
3. the agent runs as the uid the warden was started with (`--uid 0` in the shipped unit); the warden refuses any other peer;
4. unprivileged user namespaces are allowed on the host. On Ubuntu 24.04 and later `kernel.apparmor_restrict_unprivileged_userns=1` blocks them unless the agent's AppArmor profile is loaded, which `install.sh` does.

There is no `setcap cap_bpf` fallback. See the [BPF token guide](deployment/bpf-token.md#troubleshooting).

### Interface not found

```
resolve ifindex for `eth0`: No such file or directory (os error 2)
```

An interface named in `agent.interfaces` does not exist. The programs load but cannot attach there, the failure is listed in `attach_blocked` and `/readyz` answers 503. Check available interfaces with `ip link show` and update `agent.interfaces`. An empty list is refused at startup (`agent.interfaces: at least one interface is required`).

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

### "another agent already holds /var/lib/ebpfsentinel/data/agent.lock"

```
refusing to start: another agent already holds /var/lib/ebpfsentinel/data/agent.lock (pid 2184); stop the running agent or point this one at its own state directory
```

One node runs one agent. Startup wipes the pinned maps it finds, because the kernel offers no way to ask whether a pin is still in use, and opens the redb stores for writing: a second process would unpin the maps the first one is still serving from, and neither would report anything wrong. So the agent takes an exclusive lock on a file beside its stores and refuses to start if it is held.

The pid in the message is the holder as it recorded itself. Check it, then either stop that agent (`systemctl stop ebpfsentinel`) or, if you meant to run two agents on one host, give the second one its own `audit.storage_path` - and note that the two will still collide over `/sys/fs/bpf/ebpfsentinel`, which is not something the lock can see.

The lock is held by the open file, not by its contents, so the kernel releases it when the process ends however it ends. A crashed agent leaves nothing to clean up and the lock file is never deleted by hand.

### BPF filesystem not mounted

```
[warden] move_mount: No such file or directory (os error 2)
```

The agent mounts its delegated bpffs at `/sys/fs/bpf/ebpfsentinel`, which needs `/sys/fs/bpf` to be a bpffs itself (systemd mounts it at boot on every mainstream distribution). If `mount | grep /sys/fs/bpf` shows nothing, mount it:

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

1. Verify IDS is enabled and rules are loaded:
   ```bash
   ebpfsentinel-agent ids status
   ebpfsentinel-agent ids rules
   ```

2. Check sampling. With `ids.sampling.mode` set to `random` or `hash`, only the `ids.sampling.rate` fraction (0.0 to 1.0) of events is evaluated; `country_based` uses `high_risk_rate` and `default_rate` (0.1 unless set). The default mode is `none`, which evaluates everything.

3. Test a rule manually:
   ```bash
   # Send traffic matching a rule
   curl http://target-host/ -d "union select * from users"
   ```

4. Check per-rule `threshold` settings - with `type: threshold` a rule alerts only after `count` matches within `window_secs`, tracked by `track_by`.

## High CPU Usage

1. Check processing latency:
   ```bash
   curl -s http://localhost:9090/metrics | grep -E 'packet_processing_duration|worker_processing_duration'
   ```

2. Enable IDS sampling to reduce userspace load:
   ```yaml
   ids:
     sampling:
       mode: random
       rate: 0.01    # Inspect 1 in 100
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
     cache:
       max_entries: 10000
   ```

3. Check IPS blacklist size:
   ```bash
   ebpfsentinel-agent ips blacklist
   ```

## Config Reload Fails

1. Check the reload response. The endpoint validates the file on disk before applying it and answers 400 `INVALID_CONFIG` with the reason when it does not load:
   ```bash
   ebpfsentinel-agent config reload
   # or
   curl -v -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/config/reload
   ```
   With authentication on, the `viewer` role is refused with 403 `INSUFFICIENT_ROLE`.

2. Check agent logs for validation errors:
   ```bash
   journalctl -u ebpfsentinel -f
   ```

3. Validate the config file manually - look for YAML syntax errors, invalid CIDRs, or invalid regex patterns. A reload does not re-read everything; see [Hot reload](hot-reload.md) for what needs a restart.

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
