# Kubernetes Deployment

> DaemonSet mode supports all features. Add `hostPID: true` for full DLP coverage. See the [deployment compatibility matrix](../../features/deployment-matrix.md) for details.

Deploy eBPFsentinel as a DaemonSet — one agent per node.

## DaemonSet

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
      hostNetwork: true
      dnsPolicy: ClusterFirstWithHostNet
      containers:
        - name: agent
          image: ebpfsentinel:latest
          securityContext:
            privileged: true
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
```

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
      host: "0.0.0.0"
    firewall:
      default_policy: pass
      rules:
        - id: block-telnet
          priority: 10
          action: deny
          protocol: tcp
          dst_port: 23
```

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
  --set agent.logLevel=info \
  --set agent.swaggerUi=true
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
  # Network interfaces to attach eBPF programs (REQUIRED)
  interfaces: [eth0]
  bindAddress: "0.0.0.0"
  httpPort: 8080
  grpcPort: 50051
  metricsPort: 9090
  logLevel: info
  logFormat: json
  swaggerUi: false
  xdpMode: auto       # auto | native | generic | offloaded
  eventWorkers: 4      # parallel event dispatch workers

# -- DaemonSet configuration
daemonset:
  # Enable hostPID for full DLP coverage (uprobe visibility into all node processes).
  # Not required if DLP is disabled or only pod-level DLP is acceptable.
  hostPID: false
  # Resource requests/limits
  resources:
    requests:
      memory: "128Mi"
      cpu: "100m"
    limits:
      memory: "512Mi"
      cpu: "1000m"
  # Extra volume mounts (e.g., GeoIP database, TLS certs)
  extraVolumeMounts: []
  extraVolumes: []
  # Node selector, tolerations, affinity
  nodeSelector: {}
  tolerations:
    - operator: Exists    # schedule on all nodes including control-plane
  affinity: {}

# -- Prometheus metrics
metrics:
  serviceMonitor:
    enabled: false
    interval: 15s
    labels: {}           # extra labels for ServiceMonitor (e.g., release: prometheus)

# -- Security features toggles
# Each domain is enabled/disabled here. Detailed configuration (rules, feeds,
# patterns, policies) belongs in `configOverride` or the mounted ConfigMap —
# the Helm values only expose boolean toggles and simple defaults.
firewall:
  enabled: true
  defaultPolicy: pass   # pass | deny

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

# -- Auth (disabled by default for quick start, enable for production)
auth:
  enabled: false
  # jwt:
  #   secret: ""
  # apiKeys:
  #   - name: grafana
  #     key: ""

# -- Override the full config.yaml (takes precedence over individual settings above)
configOverride: ""
```

### Upgrade & Rollback

```bash
# Upgrade to new version
helm upgrade ebpfsentinel ebpfsentinel/ebpfsentinel \
  --namespace ebpfsentinel --reuse-values

# Rollback
helm rollback ebpfsentinel 1 --namespace ebpfsentinel

# Config-only update (no image change)
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

When `metrics.serviceMonitor.enabled=true`, the chart creates a ServiceMonitor:

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

> **Enterprise**: HA clustering (`enterprise.ha.enabled=true`) and multi-agent-per-node deployments (`enterprise.multiNode.enabled=true`) require an enterprise license key. See the [Enterprise Kubernetes guide](../../../ebpfsentinel-enterprise-docs/operations/deployment/kubernetes.md).

## Requirements

- `hostNetwork: true` — XDP/TC programs attach to host interfaces
- `privileged: true` — eBPF program loading
- `/sys/fs/bpf` hostPath mount — BPF filesystem
- `LimitMEMLOCK=infinity` equivalent (usually automatic with privileged)
- Kernel 6.6+ (see [supported platforms](../../features/deployment-matrix.md))
- Helm 3.x
