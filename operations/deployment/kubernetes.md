# Kubernetes Deployment

> DaemonSet mode supports all features. The agent requires kernel 6.9+
> and loads eBPF through **BPF token delegation** by default — the agent
> container runs unprivileged with only `CAP_NET_RAW`. See the
> [deployment compatibility matrix](../../features/deployment-matrix.md)
> for details.

Deploy eBPFsentinel as a DaemonSet — one agent per node.

## BPF Token DaemonSet (default)

The agent requires kernel 6.9+, so the standard deployment loads eBPF
through **[BPF token delegation](bpf-token.md)**: a privileged init
container mounts a delegated bpffs, and the agent container then runs
**without `privileged: true`** and with only `CAP_NET_RAW` (pcap
capture) — no `CAP_BPF` / `CAP_NET_ADMIN` / `CAP_SYS_ADMIN`. The agent
config must set `agent.bpf_token.enabled: true` (the default) — see the
[ConfigMap](#configmap) below.

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ebpfsentinel
  namespace: ebpfsentinel
  labels:
    app: ebpfsentinel
spec:
  selector:
    matchLabels:
      app: ebpfsentinel
  template:
    metadata:
      labels:
        app: ebpfsentinel
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "9090"
    spec:
      serviceAccountName: ebpfsentinel
      hostNetwork: true
      hostPID: true                  # needed for uprobe DLP visibility
      dnsPolicy: ClusterFirstWithHostNet
      initContainers:
        - name: bpf-token-setup      # mounts the delegated bpffs (privileged)
          image: ebpfsentinel:latest
          command: ["/usr/local/bin/ebpfsentinel-token-setup.sh"]
          args: ["/sys/fs/bpf/ebpfsentinel"]
          securityContext:
            privileged: true
          volumeMounts:
            - name: bpf
              mountPath: /sys/fs/bpf
              mountPropagation: Bidirectional
      containers:
        - name: agent
          image: ebpfsentinel:latest
          securityContext:
            privileged: false
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
              add:
                - NET_RAW           # libpcap packet capture only; eBPF loads via the BPF token
          env:
            - name: EBPFSENTINEL_NODE_NAME
              valueFrom:
                fieldRef:
                  fieldPath: spec.nodeName
          ports:
            - containerPort: 8080
              name: http
            - containerPort: 50051
              name: grpc
            - containerPort: 9090
              name: metrics
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          readinessProbe:
            httpGet:
              path: /readyz
              port: http
            initialDelaySeconds: 5
            periodSeconds: 10
          volumeMounts:
            - name: config
              mountPath: /etc/ebpfsentinel
            - name: bpf
              mountPath: /sys/fs/bpf
            - name: proc
              mountPath: /host/proc
              readOnly: true
            - name: cgroup
              mountPath: /host/sys/fs/cgroup
              readOnly: true
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "1000m"
      volumes:
        - name: config
          configMap:
            name: ebpfsentinel-config
        - name: bpf
          hostPath:
            path: /sys/fs/bpf
        - name: proc
          hostPath:
            path: /proc
        - name: cgroup
          hostPath:
            path: /sys/fs/cgroup
```

### Kernel version matrix

| Kernel | Supported path | Notes |
|--------|----------------|-------|
| < 6.9 | **Not supported** | The agent requires 6.9+ (BPF token, ARENA maps, kfuncs) |
| 6.9+ | BPF token (default) | Agent container needs only `CAP_NET_RAW`; eBPF loads via the token |

> Set `agent.bpf_token.fallback_allow_capabilities: false` to require the
> token. With it left `true`, a token failure falls back to the scoped
> capability set (`CAP_BPF` + `CAP_NET_ADMIN` + `CAP_SYS_ADMIN` +
> `CAP_NET_RAW`) — which then must be granted in the container's
> `securityContext`.

## ServiceAccount, ClusterRole & ClusterRoleBinding

The Kubernetes metadata enricher needs `get`, `list`, `watch` on the
`pods` resource cluster-wide. Install the following alongside the
DaemonSet:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ebpfsentinel
  namespace: ebpfsentinel
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ebpfsentinel-pod-reader
rules:
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ebpfsentinel-pod-reader
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ebpfsentinel-pod-reader
subjects:
  - kind: ServiceAccount
    name: ebpfsentinel
    namespace: ebpfsentinel
```

The OSS agent only reads `pods` — no other API group. You can audit
this with `kubectl describe clusterrole ebpfsentinel-pod-reader`.

## ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ebpfsentinel-config
  namespace: ebpfsentinel
data:
  config.yaml: |
    agent:
      interfaces: [eth0]
      bind_address: "0.0.0.0"
      bpf_token:
        enabled: true                  # default; eBPF loads via the BPF token
        bpffs_path: /sys/fs/bpf/ebpfsentinel
        fallback_allow_capabilities: false   # require the token (no silent cap fallback)
    container:
      resolver:
        enabled: true
        proc_path: /host/proc         # points at the hostPath mount
      kubernetes:
        enabled: true                  # K8s enricher
        node_name: ""                  # auto-detect from EBPFSENTINEL_NODE_NAME
    firewall:
      default_policy: pass
      rules:
        - id: block-telnet
          priority: 10
          action: deny
          protocol: tcp
          dst_port: 23
```

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `EBPFSENTINEL_NODE_NAME` | Injected from `fieldRef: spec.nodeName`; tells the K8s enricher which node to scope its pod watcher to |
| `KUBERNETES_SERVICE_HOST` | Set automatically by kubelet; used to detect the cluster environment |
| `RUST_LOG` | Optional log-level override |

## Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: ebpfsentinel
```

## Deployment

```bash
kubectl apply -f namespace.yaml
kubectl apply -f rbac.yaml
kubectl apply -f configmap.yaml
kubectl apply -f daemonset.yaml

# Verify
kubectl -n ebpfsentinel get pods
kubectl -n ebpfsentinel logs -l app=ebpfsentinel

# Config update (triggers rolling restart)
kubectl -n ebpfsentinel edit configmap ebpfsentinel-config
kubectl -n ebpfsentinel rollout restart daemonset/ebpfsentinel
```

## Helm Chart

### Install

```bash
helm repo add ebpfsentinel https://charts.ebpfsentinel.io
helm repo update

# Minimal install (OSS, single agent per node)
helm install ebpfsentinel ebpfsentinel/ebpfsentinel \
  --namespace ebpfsentinel --create-namespace \
  --set agent.interfaces='{eth0}'

# With Prometheus ServiceMonitor + custom config
helm install ebpfsentinel ebpfsentinel/ebpfsentinel \
  --namespace ebpfsentinel --create-namespace \
  --set agent.interfaces='{eth0}' \
  --set metrics.serviceMonitor.enabled=true \
  --set container.kubernetes.enabled=true
```

### values.yaml Reference

```yaml
# -- Container image
image:
  repository: ghcr.io/ebpfsentinel/ebpfsentinel
  tag: ""  # defaults to chart appVersion
  pullPolicy: IfNotPresent

# -- Agent configuration (maps to config.yaml)
agent:
  interfaces: [eth0]
  bindAddress: "0.0.0.0"
  httpPort: 8080
  grpcPort: 50051
  metricsPort: 9090
  logLevel: info
  logFormat: json
  swaggerUi: false
  xdpMode: auto
  eventWorkers: 4
  # BPF token delegation (default). Renders the token-setup init container
  # and drops the agent container to CAP_NET_RAW. Set enabled=false to use
  # the scoped capability set in daemonset.securityContext instead.
  bpfToken:
    enabled: true
    bpffsPath: /sys/fs/bpf/ebpfsentinel
    fallbackAllowCapabilities: false

# -- DaemonSet security context & scheduling
daemonset:
  # Required for uprobe DLP to see processes outside the pod (default: false)
  hostPID: false
  # Fallback capability set, used only when agent.bpfToken.enabled=false.
  # The chart drops ALL and adds only these.
  securityContext:
    capabilities:
      drop: [ALL]
      add:
        - BPF
        - NET_ADMIN
        - SYS_ADMIN
        - NET_RAW
    # privileged: true
  # Extra volumes & mounts for container awareness (see below)
  volumes:
    proc: true               # mounts /proc → /host/proc (read-only)
    cgroup: true             # mounts /sys/fs/cgroup (read-only)
    dockerSocket: false      # mounts /var/run/docker.sock (read-only)
  resources:
    requests:
      memory: "128Mi"
      cpu: "100m"
    limits:
      memory: "512Mi"
      cpu: "1000m"
  extraVolumeMounts: []
  extraVolumes: []
  nodeSelector: {}
  tolerations:
    - operator: Exists
  affinity: {}

# -- RBAC resources for the Kubernetes metadata enricher
rbac:
  create: true                # creates ClusterRole + ClusterRoleBinding

serviceAccount:
  create: true
  name: ebpfsentinel

# -- Container awareness
container:
  resolver:
    enabled: true
    procPath: /host/proc
  docker:
    enabled: false
    socket: /var/run/docker.sock
    cacheSize: 1024
    cacheTtlSeconds: 300
  kubernetes:
    enabled: true             # opt-in; turn off on non-K8s deployments
    nodeName: ""              # auto-detect from EBPFSENTINEL_NODE_NAME

# -- Prometheus metrics
metrics:
  serviceMonitor:
    enabled: false
    interval: 15s
    labels: {}

# -- Security features toggles
firewall:
  enabled: true
  defaultPolicy: pass

ids:
  enabled: true

ratelimit:
  enabled: false

threatintel:
  enabled: false

dlp:
  enabled: false

ddos:
  enabled: false

dns:
  enabled: false

auth:
  enabled: false

# -- Override the full config.yaml (takes precedence over individual settings)
configOverride: ""
```

### Upgrade & Rollback

```bash
helm upgrade ebpfsentinel ebpfsentinel/ebpfsentinel \
  --namespace ebpfsentinel --reuse-values

helm rollback ebpfsentinel 1 --namespace ebpfsentinel

helm upgrade ebpfsentinel ebpfsentinel/ebpfsentinel \
  --namespace ebpfsentinel --reuse-values \
  --set ids.mode=enforce
```

### Uninstall

```bash
helm uninstall ebpfsentinel --namespace ebpfsentinel
kubectl delete namespace ebpfsentinel
```

### ServiceMonitor (Prometheus Operator)

When `metrics.serviceMonitor.enabled=true`, the chart creates a
ServiceMonitor:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: ebpfsentinel
  namespace: ebpfsentinel
  labels:
    app: ebpfsentinel
spec:
  selector:
    matchLabels:
      app: ebpfsentinel
  endpoints:
    - port: metrics
      interval: 15s
      path: /metrics
```

> **Enterprise**: HA clustering (`enterprise.ha.enabled=true`) and
> multi-agent-per-node deployments (`enterprise.multiNode.enabled=true`)
> require an enterprise license key. See the Enterprise Kubernetes
> guide in the `ebpfsentinel-enterprise` documentation.

## Requirements

- Kernel 6.9+ with BTF — the agent's minimum (BPF token, ARENA maps, kfuncs)
- `hostNetwork: true` — XDP/TC programs attach to host interfaces
- `hostPID: true` — uprobe DLP visibility across the node
- A privileged `bpf-token-setup` init container — mounts the delegated
  bpffs; the agent container then needs only `CAP_NET_RAW` (pcap capture)
- `/sys/fs/bpf` hostPath mount (`mountPropagation: Bidirectional` on the
  init container) — BPF filesystem + delegated token mount
- `/proc` and `/sys/fs/cgroup` hostPath mounts (read-only) — required
  by the container resolver when running inside a pod
- Helm 3.x

### Capability fallback (token unavailable)

To run without the BPF token (e.g. a host where the bpffs cannot be
delegated), set `agent.bpf_token.fallback_allow_capabilities: true` (or
`agent.bpfToken.enabled: false` in the chart), drop the init container,
and grant the scoped capability set on the agent container instead:

```yaml
securityContext:
  capabilities:
    drop: [ALL]
    add: [BPF, NET_ADMIN, SYS_ADMIN, NET_RAW]
```
