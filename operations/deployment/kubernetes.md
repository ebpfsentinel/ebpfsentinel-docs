# Kubernetes Deployment

> DaemonSet mode supports all features. Runs with **granular capabilities**
> instead of `privileged: true` on kernel 5.8+. See the
> [deployment compatibility matrix](../../features/deployment-matrix.md)
> for details.

Deploy eBPFsentinel as a DaemonSet — one agent per node.

## Least-Privilege DaemonSet

The manifest below runs the agent **without `privileged: true`**. Linux
capabilities are dropped to the minimum set required for eBPF program
loading, network attachment, and (optionally) container awareness.

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
      containers:
        - name: agent
          image: ebpfsentinel:latest
          securityContext:
            privileged: false
            allowPrivilegeEscalation: false
            capabilities:
              drop: [ALL]
              add:
                - BPF               # program loading (kernel 5.8+)
                - NET_ADMIN         # XDP/TC attach
                - SYS_PTRACE        # /proc inspection, uprobe attach
                - PERFMON           # perf/uprobe events
                - SYS_RESOURCE      # RLIMIT_MEMLOCK
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
| < 5.8 | Not supported | No `CAP_BPF` / `CAP_PERFMON` |
| 5.8 – 6.8 | `privileged: true` fallback | `CAP_BPF` available, no BPF token or arena maps |
| 6.9+ | Least-privilege | Full feature set (BPF token, arena maps, all kfuncs) |

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

# -- DaemonSet security context & scheduling
daemonset:
  # Least-privilege mode (kernel 5.8+). Set to `true` only for kernels <5.8.
  privileged: false
  # Capability set added to the container. The chart drops ALL by default
  # and adds only the entries below.
  capabilities:
    - BPF
    - NET_ADMIN
    - SYS_PTRACE
    - PERFMON
    - SYS_RESOURCE
  # Required for uprobe DLP to see processes outside the pod
  hostPID: true
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

- `hostNetwork: true` — XDP/TC programs attach to host interfaces
- `hostPID: true` — uprobe DLP visibility across the node
- `CAP_BPF`, `CAP_NET_ADMIN`, `CAP_PERFMON`, `CAP_SYS_PTRACE`,
  `CAP_SYS_RESOURCE` — least-privilege capability set (kernel 5.8+)
- `/sys/fs/bpf` hostPath mount — BPF filesystem
- `/proc` and `/sys/fs/cgroup` hostPath mounts (read-only) — required
  by the container resolver when running inside a pod
- `LimitMEMLOCK=infinity` equivalent (automatic with `CAP_SYS_RESOURCE`)
- Kernel 5.8+ for least-privilege mode, 6.6+ recommended
- Helm 3.x

### Privileged fallback (kernel <5.8)

If you must run on an old kernel, swap `securityContext` for:

```yaml
securityContext:
  privileged: true
```

and drop the `capabilities` block. Everything else in the manifest is
unchanged.
