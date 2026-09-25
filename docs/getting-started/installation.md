# Installation

## Build from Source

### Clone and Build

```bash
git clone https://github.com/ebpfsentinel/ebpfsentinel.git
cd ebpfsentinel/ebpfsentinel

# Build eBPF kernel programs (requires nightly)
cargo xtask ebpf-build

# Build the agent and the warden broker
cargo build --release --bin ebpfsentinel-agent --bin warden
```

The binaries are `target/release/ebpfsentinel-agent` and `target/release/warden`;
the eBPF objects land in `target/bpfel-unknown-none/release/`.

### Verify the Build

```bash
./target/release/ebpfsentinel-agent version
```

## Docker

A deployment is two containers built from two images: the privileged **warden**
broker and the rootless **agent**. The agent drops every capability, unshares its
own user namespace, has the warden delegate a bpffs over a shared socket and
loads its eBPF through a BPF token (kernel 6.9+).

### Build the Images

```bash
docker build -f Dockerfile.agent  -t ebpfsentinel .
docker build -f Dockerfile.warden -t ebpfsentinel-warden .
```

### Docker Compose

`docker-compose.yml` in the repository root wires both services and the socket
volume they share: the warden holds `SYS_ADMIN`, `NET_ADMIN`, `NET_RAW`,
`SYS_PTRACE`, `BPF` and `PERFMON`, the agent runs as uid 65534 with
`cap_drop: [ALL]`.

```bash
# Edit config/ebpfsentinel.yaml with your interfaces
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

See [Docker deployment](../operations/deployment/docker.md) for the host
prerequisites (config ownership, AppArmor user namespaces) and a two-container
`docker run` equivalent.

## Kubernetes

Install the Helm chart, which deploys a DaemonSet (one pod per node) carrying the
warden as a native sidecar beside the agent:

```bash
helm install ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  --version <version> -n ebpfsentinel --create-namespace
```

The chart needs Kubernetes 1.29 or later. See
[Kubernetes Deployment](../operations/deployment/kubernetes.md) for the values and
the [BPF token guide](../operations/deployment/bpf-token.md) for the startup
sequence.

## Post-Installation

After installing, verify the agent starts correctly:

```bash
# Start the warden, then the agent against its socket
sudo ./warden serve /run/ebpfsentinel/warden.sock --uid 0 &
sudo EBPFSENTINEL_WARDEN_SOCK=/run/ebpfsentinel/warden.sock \
  ./ebpfsentinel-agent --config config/ebpfsentinel.yaml

# Check health (in another terminal)
curl http://localhost:8080/healthz
# {"status":"ok"}

# Check eBPF programs loaded
curl http://localhost:8080/api/v1/ebpf/status
```

Next: [Quickstart](quickstart.md) - configure your first security rules.
