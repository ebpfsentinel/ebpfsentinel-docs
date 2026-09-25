# FAQ

## General

### What is eBPFsentinel?

A high-performance network security agent powered by eBPF, written entirely in Rust. It provides firewall, IDS/IPS, DLP, rate limiting, threat intelligence, L7 filtering, DNS intelligence, and domain reputation in a single binary.

### What license is eBPFsentinel?

GNU Affero General Public License v3.0 (AGPL-3.0). All features documented as OSS are included in the open-source release.

### Does it work on macOS / Windows?

No. eBPFsentinel requires the Linux eBPF subsystem (kernel 6.9+). It is Linux-only.

## Installation & Requirements

### What kernel version do I need?

Linux kernel **6.9 or later** with BTF support (`/sys/kernel/btf/vmlinux` must exist). BPF token delegation requires 6.9+.

### Does it require kernel modules?

No. eBPF programs are loaded by the userspace agent at runtime - no kernel module compilation, no DKMS.

### Does it support ARM64?

Yes. x86_64 is the primary platform; aarch64/ARM64 is cross-tested.

### What capabilities does it need?

eBPF loads **exclusively** through a BPF token (kernel 6.9+), and there is no `CAP_BPF`/`setcap` loading path. A deployment is two processes: the **warden** broker holds the host capabilities (`CAP_SYS_ADMIN`, `CAP_NET_ADMIN`, `CAP_NET_RAW`, plus `CAP_BPF`, `CAP_PERFMON` and `CAP_SYS_PTRACE` for the DLP uprobe), and the **agent** runs with none: it unshares a user namespace, has the warden delegate a bpffs, and loads its programs through the token. Unprivileged user namespaces must be enabled on the host. In Docker the agent runs as uid 65534 with `cap_drop: [ALL]`; `docker compose up -d` wires both containers. See the [BPF token guide](operations/deployment/bpf-token.md).

## Performance

### What is the CPU overhead?

XDP programs run before the kernel network stack, adding minimal overhead. The exact impact depends on rule complexity and traffic volume. IDS sampling (`ids.sampling`) reduces userspace CPU usage for high-traffic environments.

### How fast is the firewall?

XDP runs at the earliest possible hook point - packets can be dropped before the kernel allocates an SKB. CIDR-only rules use LPM tries for O(log n) matching.

### How do I reduce CPU usage?

1. Enable IDS sampling: `ids.sample_rate: 100` (inspect 1-in-100)
2. Use CIDR-only firewall rules (LPM trie - faster than port/protocol rules)
3. Reduce log verbosity: `agent.log_level: "warn"`

## Features

### Can the IDS block traffic?

The IDS itself only detects. Enable **IPS** (Intrusion Prevention) to automatically blacklist source IPs when block-mode rules match.

### Can I customize DLP patterns?

The OSS edition ships with 9 built-in patterns (PCI, PII, credentials) that are always loaded. Custom patterns require the Enterprise edition. See [DLP](features/dlp.md) for details.

### What threat intelligence feed formats are supported?

Plaintext (one IOC per line), CSV (configurable column mapping), JSON (field name mapping), and STIX 2.1 bundles. STIX feeds automatically distribute indicators to the appropriate engines: IPs to threat intel, domains to DNS blocklist and reputation, URLs to L7 firewall.

### How does hot reload work?

Three methods:
1. **SIGHUP**: `kill -HUP $(pidof ebpfsentinel-agent)`
2. **File watcher**: the agent detects config file changes automatically
3. **REST API**: `POST /api/v1/config/reload`

Rules are reloaded without dropping traffic. eBPF maps are updated in-place.

### What L7 protocols are supported?

HTTP, TLS/SNI, gRPC, SMTP, FTP, SMB, SSH, Redis, MySQL, PostgreSQL, DNS-TCP, IMAP, and POP3.

## Operations

### Can I run it without Docker?

Yes. Build from source and run the binary directly. See [Binary Deployment](operations/deployment/binary.md).

### How do I monitor the agent?

Scrape Prometheus metrics from `:9090/metrics`. Use Grafana for dashboards. The agent also provides `/healthz` and `/readyz` endpoints for health checks.

### How do I back up configuration?

The configuration is a single YAML file. Back it up with your existing backup tooling. Audit trail data is stored at the configured `audit.storage_path`.

### Can I connect the CLI to a remote agent?

Yes:

```bash
ebpfsentinel-agent --host 10.0.0.1 --port 8080 status
```

## Security

### Is eBPF safe?

Yes. The kernel eBPF verifier validates all programs before loading:
- All memory accesses are bounds-checked
- Programs must provably terminate
- Only approved helper functions are callable
- No arbitrary kernel memory access

### What if an eBPF program crashes?

eBPF programs cannot crash - the verifier ensures safety at load time. If the userspace agent crashes, eBPF programs continue running in the kernel until the agent is restarted.

### How are API keys secured?

API keys are stored in the config file. Ensure config files are `chmod 640` or stricter. The agent warns on world-readable config files at startup. Use environment variables for sensitive values when possible.

## Troubleshooting

### Agent fails to start with "BTF not found"

Your kernel was built without `CONFIG_DEBUG_INFO_BTF=y`. Install a BTF-enabled kernel for your distribution or upgrade to a newer kernel.

### Agent fails to start with "permission denied" / no eBPF attached

Start the warden first and point the agent at its socket: without `EBPFSENTINEL_WARDEN_SOCK` the agent cannot create a BPF token, logs `BPF token unavailable - running in API-only mode` and attaches nothing. Under systemd, `sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel`; by hand, `sudo warden serve /run/ebpfsentinel/warden.sock --uid 0 &` then `sudo EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock ./ebpfsentinel-agent --config config/ebpfsentinel.yaml`. On Ubuntu 24.04 and later, `uid_map: Operation not permitted` means `kernel.apparmor_restrict_unprivileged_userns=1` is blocking the user namespace: load the shipped AppArmor profile. There is no `setcap` fallback.

### No alerts are generated

1. Check rules are loaded: `ebpfsentinel-agent ips list`
2. Check sampling is not too aggressive: reduce `ids.sample_rate`
3. Check threshold settings: `threshold` mode requires N matches before alerting
4. Check the agent is attached to the right interface

### Config reload fails

Check agent logs for validation errors. Common causes: YAML syntax errors, invalid CIDR notation, invalid regex patterns.

See [Troubleshooting](operations/troubleshooting.md) for more detailed debugging steps.
