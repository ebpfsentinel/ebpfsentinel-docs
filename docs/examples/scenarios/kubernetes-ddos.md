# Kubernetes DDoS Protection

Protect a Kubernetes cluster with DDoS mitigation, rate limiting, and container-aware alerting via DaemonSet deployment.

## Scenario

- Kubernetes cluster with Cilium CNI (netkit devices)
- Public-facing services on ports 80, 443
- Need SYN flood protection + per-IP rate limiting
- Container-aware alerts (pod name, namespace, labels)

## DaemonSet Deployment

```yaml
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: ebpfsentinel
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
      hostPID: true
      serviceAccountName: ebpfsentinel
      containers:
        - name: agent
          image: ebpfsentinel:latest
          securityContext:
            capabilities:
              add: [BPF, NET_ADMIN, PERFMON, SYS_PTRACE, SYS_RESOURCE]
          volumeMounts:
            - name: config
              mountPath: /etc/ebpfsentinel
            - name: proc
              mountPath: /host/proc
              readOnly: true
            - name: docker-sock
              mountPath: /var/run/docker.sock
              readOnly: true
      volumes:
        - name: config
          configMap:
            name: ebpfsentinel-config
        - name: proc
          hostPath:
            path: /proc
        - name: docker-sock
          hostPath:
            path: /var/run/docker.sock
```

## Agent Configuration

```yaml
agent:
  interfaces: [eth0]
  attach_mode: auto            # netkit for Cilium pods, TC for host interfaces

conntrack:
  enabled: true

container:
  resolver:
    enabled: true
    proc_path: /host/proc
  kubernetes:
    enabled: true

firewall:
  default_policy: drop
  rules:
    - id: allow-web
      priority: 10
      action: allow
      protocol: tcp
      dst_port: "80-443"
    - id: allow-dns
      priority: 20
      action: allow
      protocol: udp
      dst_port: 53
    - id: allow-kubelet
      priority: 30
      action: allow
      protocol: tcp
      src_ip: "10.0.0.0/8"
      dst_port: "10250-10252"

ratelimit:
  rules:
    - id: global-rate
      rate: 5000
      burst: 10000
      algorithm: token_bucket
      scope: per_ip

ddos:
  syn:
    enabled: true
    threshold: 1000
    action: syncookie
  icmp:
    enabled: true
    rate_limit: 100
    oversized_threshold: 1024
  amplification:
    enabled: true
    ports: [53, 123, 1900, 11211]

alerting:
  routes:
    - name: k8s-critical
      destination: webhook
      min_severity: high
      webhook_url: "https://hooks.example.com/k8s-soc"
```

## Verification

```bash
# Check netkit hot-plug is active
ebpfsentinel-agent status

# Verify DDoS protection
ebpfsentinel-agent ddos status
ebpfsentinel-agent ddos syn-stats

# Watch live connections with pod enrichment
ebpfsentinel-agent conntrack watch

# Monitor rate limiting
ebpfsentinel-agent ratelimit list

# Check alerts include pod context
ebpfsentinel-agent alerts list --component ddos -o json | jq '.[] | {severity, pod_name, namespace}'

# Metrics for Grafana
curl http://localhost:9090/metrics | grep -E "ddos|ratelimit"
```
