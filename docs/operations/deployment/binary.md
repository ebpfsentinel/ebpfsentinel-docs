# Binary Deployment

> All features are fully supported in binary deployment. See the [deployment compatibility matrix](../../features/deployment-matrix.md) for comparison with other modes.

## Build

```bash
cargo xtask ebpf-build && cargo build --release
```

The binary is at `target/release/ebpfsentinel-agent`.

## Install

Copy the binary and create a configuration:

```bash
sudo cp target/release/ebpfsentinel-agent /usr/local/bin/
sudo mkdir -p /etc/ebpfsentinel
sudo cp config/ebpfsentinel.yaml /etc/ebpfsentinel/config.yaml
sudo chmod 640 /etc/ebpfsentinel/config.yaml
```

## Run

eBPF loads only through a BPF token, which requires a user namespace, so the
agent is started via the launcher rather than directly — running the agent
binary on its own would fail `BPF_TOKEN_CREATE` (`EOPNOTSUPP` outside a user
namespace) and fall back to API-only mode:

```bash
sudo ebpfsentinel-token-launch \
  --bpffs /sys/fs/bpf/ebpfsentinel \
  /usr/local/bin/ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
```

The launcher sets up the delegated bpffs and creates the token in a child user
namespace, then execs the agent there unprivileged. See the
[BPF token guide](bpf-token.md) for the full sequence.

## systemd Service

Create `/etc/systemd/system/ebpfsentinel.service`:

This mirrors the shipped unit (`dist/ebpfsentinel.service`, installed by
`dist/install.sh`). `ExecStart` is the **launcher**, not the agent:

```ini
[Unit]
Description=eBPFsentinel Network Security Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# Launcher runs as root, sets up the delegated bpffs + token in a child user
# namespace, then execs the agent there unprivileged (no CAP_BPF/CAP_SYS_ADMIN
# on the long-running agent). The token authorizes every eBPF syscall.
ExecStart=/usr/local/bin/ebpfsentinel-token-launch \
    --bpffs /sys/fs/bpf/ebpfsentinel \
    /usr/local/bin/ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
Restart=on-failure
RestartSec=5
LimitMEMLOCK=infinity

# Do NOT set NoNewPrivileges — it would block the launcher's user-namespace setup.

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ebpfsentinel
sudo systemctl status ebpfsentinel

# Reload config
sudo systemctl reload ebpfsentinel
```

**Note:** `LimitMEMLOCK=infinity` is required for eBPF map allocation. eBPF loads **only** through a BPF token — there is no capability-based loading path.

## Rootless operation (BPF token)

The service starts as root only long enough for the launcher to set up the delegated bpffs and create the token; it then unshares a **child user namespace** and execs the agent there. The long-running agent holds **no host capabilities** (no `CAP_BPF`, no `CAP_SYS_ADMIN`) — the token authorizes every eBPF syscall, and the launcher pre-opens the `AF_PACKET` capture sockets so pcap works without `CAP_NET_RAW` in the agent. Host-netns helpers that need init-namespace capabilities (`conntrack -D` teardown, Multi-WAN route apply, VIP gratuitous ARP) are unavailable to the userns agent and degrade gracefully; their eBPF equivalents (IPS_DYING flow-kill, `xdp-vip-announcer`) keep working. See the [BPF token guide](bpf-token.md) for the full capability matrix.

## Directories

| Path | Purpose |
|------|---------|
| `/etc/ebpfsentinel/` | Configuration files |
| `/var/lib/ebpfsentinel/` | Persistent data (audit trail, redb) |
| `/var/log/ebpfsentinel/` | Log files (if using log sender) |
