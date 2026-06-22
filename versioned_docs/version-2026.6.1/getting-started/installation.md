# Installation

## Build from Source

### Clone and Build

```bash
git clone https://github.com/ebpfsentinel/ebpfsentinel.git
cd ebpfsentinel/ebpfsentinel

# Build eBPF kernel programs (requires nightly)
cargo xtask ebpf-build

# Build userspace agent
cargo build --release
```

The binary is at `target/release/ebpfsentinel-agent`.

### Verify the Build

```bash
./target/release/ebpfsentinel-agent version
```

## Docker

### Build the Image

```bash
docker build -t ebpfsentinel .
```

### Run

eBPF loads only through a BPF token (kernel 6.9+). The image entrypoint is the
launcher (`ebpfsentinel-token-launch`); it creates the token in a child user
namespace and execs the agent unprivileged, so the container only needs
`CAP_SYS_ADMIN` for that bootstrap — no separate setup step:

```bash
docker run --network host \
  --cap-add SYS_ADMIN --cap-add NET_RAW \
  --security-opt apparmor=unconfined \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  ebpfsentinel
```

`docker compose up -d` wires the same single service automatically — see
[Docker deployment](../operations/deployment/docker.md).

### Docker Compose

```bash
# Edit config/ebpfsentinel.yaml with your interfaces
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

## Kubernetes

Deploy as a DaemonSet (one agent per node):

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ebpfsentinel
  namespace: ebpfsentinel
spec:
  selector:
    matchLabels:
      app: ebpfsentinel
  template:
    metadata:
      labels:
        app: ebpfsentinel
    spec:
      hostNetwork: true
      # No init container — the image entrypoint (ebpfsentinel-token-launch)
      # sets up the delegated bpffs + token in a child userns, then execs the
      # agent there. CAP_SYS_ADMIN is for that bootstrap; the agent is rootless.
      containers:
        - name: agent
          image: ebpfsentinel:latest
          args: ["--config", "/etc/ebpfsentinel/config.yaml"]
          securityContext:
            allowPrivilegeEscalation: true
            capabilities:
              drop: [ALL]
              add: [SYS_ADMIN]            # launcher bootstrap only
          volumeMounts:
            - name: config
              mountPath: /etc/ebpfsentinel
            - name: bpf
              mountPath: /sys/fs/bpf
              mountPropagation: HostToContainer
      volumes:
        - name: config
          configMap:
            name: ebpfsentinel-config
        - name: bpf
          hostPath:
            path: /sys/fs/bpf
```

See [Kubernetes Deployment](../operations/deployment/kubernetes.md) and the [BPF token guide](../operations/deployment/bpf-token.md) for full manifests (RBAC, ConfigMap, services, the launcher token phase).

## Post-Installation

After installing, verify the agent starts correctly:

```bash
# Start the agent
sudo ./ebpfsentinel-agent --config config/ebpfsentinel.yaml

# Check health (in another terminal)
curl http://localhost:8080/healthz
# {"status":"ok"}

# Check eBPF programs loaded
curl http://localhost:8080/api/v1/ebpf/status
```

Next: [Quickstart](quickstart.md) — configure your first security rules.
