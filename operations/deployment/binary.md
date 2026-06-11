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

```bash
sudo ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
```

## systemd Service

Create `/etc/systemd/system/ebpfsentinel.service`:

```ini
[Unit]
Description=eBPFsentinel Network Security Agent
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure
RestartSec=5
LimitMEMLOCK=infinity

# Security
NoNewPrivileges=no
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/var/lib/ebpfsentinel /var/log/ebpfsentinel

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

**Note:** `LimitMEMLOCK=infinity` is required for eBPF map allocation. eBPF loads **only** through a BPF token — the agent never needs `CAP_BPF`. A privileged `ExecStartPre` (installed by `dist/install.sh`) mounts the delegated bpffs before the agent starts.

## Rootless operation (BPF token)

The shipped unit already runs the agent rootless: a privileged `ExecStartPre` mounts the delegated bpffs, the agent runs as `User=ebpfsentinel`, and only the feature-scoped capabilities `CAP_NET_RAW` (pcap capture) and `CAP_NET_ADMIN` (conntrack flow-kill + Multi-WAN) are granted — **no `CAP_BPF`, no `CAP_SYS_ADMIN`**. There is no capability-based loading path. See the [BPF token guide](bpf-token.md) for the full capability matrix.

## Directories

| Path | Purpose |
|------|---------|
| `/etc/ebpfsentinel/` | Configuration files |
| `/var/lib/ebpfsentinel/` | Persistent data (audit trail, redb) |
| `/var/log/ebpfsentinel/` | Log files (if using log sender) |
