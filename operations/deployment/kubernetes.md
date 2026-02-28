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

## Requirements

- `hostNetwork: true` — XDP/TC programs attach to host interfaces
- `privileged: true` — eBPF program loading
- `/sys/fs/bpf` hostPath mount — BPF filesystem
- `LimitMEMLOCK=infinity` equivalent (usually automatic with privileged)
