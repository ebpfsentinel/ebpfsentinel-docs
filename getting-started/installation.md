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

eBPF requires `--privileged` and `--network host`:

```bash
docker run --privileged --network host \
  -v ./config:/etc/ebpfsentinel \
  ebpfsentinel
```

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
      containers:
        - name: agent
          image: ebpfsentinel:latest
          securityContext:
            privileged: true
          volumeMounts:
            - name: config
              mountPath: /etc/ebpfsentinel
            - name: bpf
              mountPath: /sys/fs/bpf
      volumes:
        - name: config
          configMap:
            name: ebpfsentinel-config
        - name: bpf
          hostPath:
            path: /sys/fs/bpf
```

See [Kubernetes Deployment](../operations/deployment/kubernetes.md) for full manifests including RBAC, ConfigMap, and service definitions.

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
