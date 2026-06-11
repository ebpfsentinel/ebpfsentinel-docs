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

eBPF loads only through a BPF token (kernel 6.9+) — the agent runs rootless,
never `--privileged`. Mount the delegated bpffs once (the only privileged step),
then run with `CAP_BPF` dropped:

```bash
sudo ./dist/ebpfsentinel-token-setup.sh /sys/fs/bpf/ebpfsentinel

docker run --network host \
  --cap-drop ALL --cap-add NET_RAW --cap-add NET_ADMIN \
  --security-opt no-new-privileges:true \
  -v ./config:/etc/ebpfsentinel \
  -v /sys/fs/bpf:/sys/fs/bpf \
  ebpfsentinel
```

`docker compose up -d` wires the privileged bpffs-mount init service
automatically — see [Docker deployment](../operations/deployment/docker.md).

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
      # A privileged bpf-token-setup init container mounts the delegated bpffs;
      # the agent container then runs rootless (no CAP_BPF / privileged). See the
      # full manifest for the init container + mount-propagation wiring.
      containers:
        - name: agent
          image: ebpfsentinel:latest
          securityContext:
            privileged: false
            capabilities:
              drop: [ALL]
              add: [NET_RAW, NET_ADMIN]   # feature-scoped; drop if unused
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

See [Kubernetes Deployment](../operations/deployment/kubernetes.md) and the [BPF token guide](../operations/deployment/bpf-token.md) for full manifests (init container, RBAC, ConfigMap, services).

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
