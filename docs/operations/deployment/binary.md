# Binary Deployment

> All features are fully supported in binary deployment. See the [deployment compatibility matrix](../../features/deployment-matrix.md) for comparison with other modes.

A bare-metal install is two processes under systemd:

| Unit | Binary | Role |
|------|--------|------|
| `ebpfsentinel-warden` | `/usr/local/bin/warden` | Privileged broker: delegates a bpffs to the agent once at startup, then performs the host-namespace operations the agent cannot (conntrack, routes, ARP, the pcap socket pool) |
| `ebpfsentinel` | `/usr/local/bin/ebpfsentinel-agent` | The agent: unshares its own user namespace, loads its eBPF through a BPF token, serves the API |

Requirements: kernel 6.9 or later (the agent refuses to start below it), BTF at `/sys/kernel/btf/vmlinux`, unprivileged user namespaces enabled. `libpcap` is optional and only needed for manual packet capture.

## Build

```bash
cargo xtask ebpf-build
cargo build --release --bin ebpfsentinel-agent --bin warden
```

This produces:

| Artifact | Path |
|----------|------|
| Agent | `target/release/ebpfsentinel-agent` |
| Warden | `target/release/warden` |
| eBPF objects (one file per program) | `target/bpfel-unknown-none/release/` |

## Install

### In one command

```bash
curl -sSL https://get.ebpfsentinel.io | sudo bash
```

That script installs nothing of its own. It looks the latest release up on [the releases page](https://github.com/ebpfsentinel/ebpfsentinel-release/releases), downloads the tarball for the host's architecture and the release's `ebpfsentinel-SHA256SUMS`, checks that file's keyless signature when `cosign` is installed and the tarball against it in every case, then runs the `install.sh` shipped inside the tarball, described below. Read it before piping it into a root shell: `curl -sSL https://get.ebpfsentinel.io` prints it.

| Variable | Effect |
|----------|--------|
| `EBPFSENTINEL_RELEASE=<release>` | Install that release instead of the latest one |
| `EBPFSENTINEL_EDITION=enterprise` | Install the [enterprise build](enterprise.md) instead |
| `EBPFSENTINEL_REQUIRE_SIGNATURE=1` | Refuse to install when `cosign` is absent, rather than checking the checksum alone |

```bash
curl -sSL https://get.ebpfsentinel.io | sudo EBPFSENTINEL_REQUIRE_SIGNATURE=1 bash
```

### From a release tarball

The release tarball carries both binaries, the eBPF objects under `ebpf/`, the default config, both units, the AppArmor profile, the sysctl drop-in and `install.sh`. Each release on the [releases page](https://github.com/ebpfsentinel/ebpfsentinel-release/releases) carries one per architecture, with its signature:

```bash
curl -fsSLO https://github.com/ebpfsentinel/ebpfsentinel-release/releases/download/v<release>/ebpfsentinel-<version>-linux-<arch>.tar.gz
tar xzf ebpfsentinel-<version>-linux-<arch>.tar.gz
cd ebpfsentinel-<version>-linux-<arch>
sudo ./install.sh
```

`install.sh` checks the kernel version and BTF, then:

- installs `ebpfsentinel-agent` and `warden` into `/usr/local/bin/`;
- copies the eBPF objects into `/usr/local/lib/ebpfsentinel/`;
- installs the default config to `/etc/ebpfsentinel/config.yaml` with mode `0640`, and leaves an existing one untouched;
- creates `/var/lib/ebpfsentinel/`, `/var/lib/ebpfsentinel/captures/`, `/var/lib/ebpfsentinel/data/` and `/var/lib/ebpfsentinel/auth/` (mode `0700`, where the agent writes the key it draws for itself);
- installs both systemd units and runs `systemctl daemon-reload`;
- on hosts where `kernel.apparmor_restrict_unprivileged_userns=1` (Ubuntu 24.04 and later), loads the per-binary AppArmor profile, or installs the sysctl drop-in when `apparmor_parser` is absent.

It does not enable or start anything.

### From a source build

The same steps by hand, from the repository root after the build above:

```bash
sudo install -Dm755 target/release/ebpfsentinel-agent /usr/local/bin/ebpfsentinel-agent
sudo install -Dm755 target/release/warden /usr/local/bin/warden
sudo mkdir -p /usr/local/lib/ebpfsentinel
sudo cp target/bpfel-unknown-none/release/* /usr/local/lib/ebpfsentinel/
sudo install -Dm640 config/ebpfsentinel.yaml /etc/ebpfsentinel/config.yaml
sudo mkdir -p /var/lib/ebpfsentinel/captures /var/lib/ebpfsentinel/data
sudo install -d -m 700 /var/lib/ebpfsentinel/auth
sudo install -Dm644 dist/ebpfsentinel-warden.service /etc/systemd/system/ebpfsentinel-warden.service
sudo install -Dm644 dist/ebpfsentinel.service /etc/systemd/system/ebpfsentinel.service
sudo systemctl daemon-reload
```

The config must not be world-readable: the agent refuses to start on a file with the other-read bit set (`... is world-readable (mode ...) - chmod 640 or stricter`), because it may carry API keys and alert credentials.

The agent looks for its eBPF objects in `EBPF_PROGRAM_DIR`, then `agent.ebpf_program_dir`, then `/usr/local/lib/ebpfsentinel`.

## Run

```bash
sudo systemctl enable --now ebpfsentinel-warden ebpfsentinel
sudo systemctl status ebpfsentinel

# Re-read the config file (sends SIGHUP, same as POST /api/v1/config/reload)
sudo systemctl reload ebpfsentinel
```

What the shipped units do:

- **`ebpfsentinel-warden.service`** runs `warden serve /run/ebpfsentinel/warden.sock --uid 0`. `RuntimeDirectory=ebpfsentinel` creates `/run/ebpfsentinel`; `--uid 0` is the only peer uid the warden accepts on its socket.
- **`ebpfsentinel.service`** sets `EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock`, waits up to ten seconds for that socket to appear, then runs `ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml` from `WorkingDirectory=/var/lib/ebpfsentinel`. It carries `LimitMEMLOCK=infinity` for eBPF map allocation and `ExecReload` for `systemctl reload`. It `Wants` the warden rather than `Requires` it, so a warden restart does not stop the agent.

Do not add `NoNewPrivileges=` to the agent unit: it blocks the user-namespace setup.

### The API key

The control API authenticates. With no method named in the configuration, the
agent writes a key into `/var/lib/ebpfsentinel/auth/api-key` at first start,
`0600` in a `0700` directory, and prints it once:

```bash
sudo journalctl -u ebpfsentinel | grep "API key"
sudo cat /var/lib/ebpfsentinel/auth/api-key
```

A command run on the same host finds that file by itself, so `sudo
ebpfsentinel-agent status` works with nothing else supplied. Elsewhere, and
for `curl`, name it:

```bash
export EBPFSENTINEL_TOKEN=$(sudo cat /var/lib/ebpfsentinel/auth/api-key)
curl -s -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" localhost:8080/api/v1/ebpf/status
```

Deleting the file draws a new key at the next start. Configuring
`auth.api_keys`, a JWT secret or OIDC replaces it, and the agent then writes
none. The agent binds `127.0.0.1` by default; binding anywhere else without
TLS is refused, see [TLS](../../configuration/tls.md).

### Restart, watchdog and stop budget

`Restart=on-failure` covers an agent that exits. It does nothing for one that is
still running and no longer working: a ring-buffer reader wedged in a record
handler leaves the process alive, the API answering and no packet being
inspected. So the agent reports its own liveness to systemd, and the unit
carries four numbers that work together:

| Directive | Value | What it bounds |
|-----------|-------|----------------|
| `WatchdogSec` | `90s` | How long systemd waits for a keep-alive before killing the agent. The agent pings every 45s, half the interval, so one late ping is never fatal |
| `TimeoutStopSec` | `20s` | How long a stop may take before `SIGKILL`. Covers the 5s server drain, the 2s capture close inside it and a brokered warden call holding for up to 10s |
| `StartLimitBurst` / `StartLimitIntervalSec` | `5` / `300` | Five starts inside five minutes. Past that the unit stays failed instead of re-entering the eBPF loader every `RestartSec=5s` forever |

The keep-alive is sent only while a reader is still passing over its ring
buffers, which it does every 10 ms whether or not traffic arrived. Sixty
seconds without a pass is treated as a stall: the agent stops pinging, systemd
kills and restarts it within the remaining window, and the same reading answers
`503` on `/readyz` with a `datapath_stalled_secs` field, so a systemd host and a
Kubernetes node notice the same fault. A datapath that never started - no token,
every program refused - is not a stall and is never restarted for one; it is
reported through `ebpf_loaded` and `attach_blocked` instead.

`NotifyAccess=main` is what lets the ping through. Without it systemd sets no
`NOTIFY_SOCKET`, the agent finds no watchdog to feed and starts none, and
`WatchdogSec` would kill a healthy agent every 90s. The unit stays
`Type=simple`: the agent does not send `READY=1`.

A stall is a bug, so the restart is not the end of it. The journal carries
`withholding the watchdog ping` with the idle time at the point the agent gave
up, which is the line to attach to a report.

Running the agent by hand needs the warden running first:

```bash
sudo warden serve /run/ebpfsentinel/warden.sock --uid 0 &
sudo EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock \
  ebpfsentinel-agent --config /etc/ebpfsentinel/config.yaml
```

Without `EBPFSENTINEL_WARDEN_SOCK` the agent cannot create a BPF token, logs `BPF token unavailable - running in API-only mode`, and serves the API with no eBPF loaded (`/readyz` answers 503).

## How the agent loads eBPF without host capabilities

eBPF loads only through a BPF token; there is no capability-based loading path. At startup the agent:

1. unshares a user namespace;
2. opens a bpffs with `fsopen` and hands it to the warden over the socket;
3. the warden sets the `delegate_*` mount options and hands it back;
4. the agent mounts it, re-executes itself inside the namespace and creates the token.

The agent keeps one connection to the warden per thing it brokers and reuses it for the life of the process; the warden answers each connection on a thread of its own. A connection that says nothing for ten minutes is closed by the warden and the agent reconnects on its next call, which costs a handshake and nothing else - except for the connection the capture sockets were served over, which is kept however long it idles, because the warden holds those sockets against it and freeing them while the agent still reads from them would hand the same socket to the next caller. A peer that connects and does not introduce itself within ten seconds is dropped.

The unit runs the agent as root only so that user-namespace root maps to real root and the bpffs mountpoint can be created under `/sys/fs/bpf`. Once in its namespace the agent holds no capability over the host: no `CAP_BPF`, no `CAP_SYS_ADMIN`, no `CAP_NET_ADMIN`. The operations that need init-namespace capabilities (conntrack entry deletion, Multi-WAN route changes, gratuitous ARP, opening `AF_PACKET` capture sockets) are brokered by the warden rather than lost. See the [BPF token guide](bpf-token.md) for the full sequence and its troubleshooting.

## Directories

| Path | Purpose |
|------|---------|
| `/etc/ebpfsentinel/config.yaml` | Configuration (mode `0640`) |
| `/usr/local/lib/ebpfsentinel/` | eBPF object files |
| `/var/lib/ebpfsentinel/data/` | redb stores under the default config: `audit.redb`, `alerts.redb`, `rule_changes.redb` (`audit.storage_path` is relative and resolves against the unit's working directory) |
| `/var/lib/ebpfsentinel/data/agent.lock` | The exclusive lock one agent per node holds, beside the stores it protects; released by the kernel when the process ends |
| `/var/lib/ebpfsentinel/captures/` | Packet capture files (`{id}.pcap`) |
| `/var/lib/ebpfsentinel/geoip/` | GeoIP databases (default `geoip.db_dir`) |
| `/var/lib/ebpfsentinel/telemetry/installation` | Anonymous telemetry installation identifier |
| `/run/ebpfsentinel/warden.sock` | Warden socket |

Logs go to the journal (`journalctl -u ebpfsentinel -u ebpfsentinel-warden`); the agent writes no log file.
