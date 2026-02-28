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

**Note:** `LimitMEMLOCK=infinity` is required for eBPF map allocation. The service must run as root or with `CAP_BPF` + `CAP_NET_ADMIN` capabilities.

## Capabilities (Non-Root)

```bash
sudo setcap cap_bpf,cap_net_admin+ep /usr/local/bin/ebpfsentinel-agent
```

Then remove `User=root` and the agent can run as a non-root user. However, some eBPF features may require additional capabilities depending on your kernel version.

## Directories

| Path | Purpose |
|------|---------|
| `/etc/ebpfsentinel/` | Configuration files |
| `/var/lib/ebpfsentinel/` | Persistent data (audit trail, redb) |
| `/var/log/ebpfsentinel/` | Log files (if using log sender) |
