# Kubernetes Deployment

> DaemonSet mode supports all features. The agent requires kernel 6.9+
> and loads eBPF **exclusively** through a **BPF token** — there is no
> capability-based fallback. The container entrypoint is the launcher
> (`ebpfsentinel-token-launch`), which creates the token in a child user
> namespace and then execs the agent unprivileged; the pod is granted
> `CAP_SYS_ADMIN` for that bootstrap only. See the
> [BPF token guide](bpf-token.md) and the
> [deployment compatibility matrix](../../features/deployment-matrix.md)
> for details.

Deploy eBPFsentinel as a DaemonSet — one agent per node.

> **Rootless agent option:** to keep the agent container itself off `CAP_SYS_ADMIN`
> (non-root + `cap-drop: ALL`), use the **split-broker** layout
> (`dist/kubernetes/bpf-token-broker-daemonset.yaml`, or Helm
> `daemonset.brokerSidecar.enabled=true`). See the
> [BPF token guide](bpf-token.md#the-warden-broker).

## BPF token creation phase

The agent requires kernel 6.9+ and loads eBPF only through a
**[BPF token](bpf-token.md)**. Token creation happens **in-process** when
the container starts — there is **no init container** and no setup script.
The image entrypoint is `ebpfsentinel-token-launch`, which:

1. starts as container root (`CAP_SYS_ADMIN`) and inherits the kernel
   module BTF fds,
2. unshares a **child user namespace**, `fsopen("bpf")`s and applies
   `delegate_*=any` to mount the delegated bpffs at
   `/sys/fs/bpf/ebpfsentinel` (`BPF_TOKEN_CREATE` is `EOPNOTSUPP` outside a
   user namespace — hence the launcher),
3. pre-opens the `AF_PACKET` pcap sockets, then execs the agent **inside
   that user namespace**, where it calls `BPF_TOKEN_CREATE` and loads every
   program through the token holding no host capabilities.

So the pod's `securityContext` grants `CAP_SYS_ADMIN` with
`allowPrivilegeEscalation: true` for the launcher bootstrap; the
long-running agent is unprivileged. The agent config only needs
`agent.bpf_token.bpffs_path` to match the launcher's `--bpffs` (both
default `/sys/fs/bpf/ebpfsentinel`) — see the [ConfigMap](#configmap).

> **Note:** nested user namespaces + bpffs delegation inside a pod can
> require cluster-specific runtime config (the node must allow unprivileged
> user namespaces; some Pod Security Admission levels or runtimes block
> `CAP_SYS_ADMIN`). Validate on your cluster before rolling out fleet-wide.

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
      # No init container — the image entrypoint (ebpfsentinel-token-launch)
      # sets up the delegated bpffs + token in a child userns, then execs the
      # agent there. The agent's args below are appended to that entrypoint.
      containers:
        - name: agent
          image: ebpfsentinel:latest
          args: ["--config", "/etc/ebpfsentinel/config.yaml"]
          securityContext:
            # CAP_SYS_ADMIN is consumed by the launcher (bpffs delegation +
            # module BTF fds + userns creation); the agent it execs is
            # unprivileged. There is no capability-based eBPF loading path.
            allowPrivilegeEscalation: true
            # Unconfined: the launcher does mount/move_mount (bpffs delegation)
            # and writes /proc/self/uid_map after unshare(CLONE_NEWUSER). On
            # AppArmor nodes (e.g. Ubuntu) the default container profile blocks
            # these; the default seccomp profile must not filter mount either.
            appArmorProfile:
              type: Unconfined
            seccompProfile:
              type: Unconfined
            capabilities:
              drop: [ALL]
              add:
                - SYS_ADMIN         # launcher bootstrap only; eBPF loads via the BPF token
                - NET_RAW           # launcher pre-opens the AF_PACKET pcap pool; drop if you never capture
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
              # the launcher mounts the delegated bpffs in its own private mount
              # namespace; the container only needs to see the host bpffs
              mountPropagation: HostToContainer
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
            # The agent rejects a world-readable config; configMap volumes
            # default to 0644, so pin a stricter mode.
            defaultMode: 0640
        - name: bpf
          # Real node: the host bpffs is writable, so bind it in. On nested
          # runtimes (kind, minikube) the node's own /sys/fs/bpf may be
          # read-only — use an in-pod tmpfs instead:
          #   emptyDir: { medium: Memory }
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
| 6.9+ | BPF token (only path) | Pod grants `CAP_SYS_ADMIN` for the launcher bootstrap; the agent runs unprivileged |

> There is **no capability-based fallback**. eBPF loads exclusively through
> the token; if the launcher cannot delegate the bpffs (user namespaces
> disabled, runtime blocks `CAP_SYS_ADMIN`), the agent starts in API-only
> mode with no eBPF attached. The only knob is
> `agent.bpf_token.bpffs_path`, which must match the launcher `--bpffs`.

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
      attach_mode: auto              # netkit for Cilium pods, TC clsact otherwise
      bpf_token:
        # Path of the delegated bpffs the launcher mounts; must match its
        # --bpffs. eBPF loads exclusively through the token created here.
        bpffs_path: /sys/fs/bpf/ebpfsentinel
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

## Cilium / netkit pod networking

On clusters where the CNI gives pods **netkit** interfaces instead of veth
pairs (Cilium **1.16+**, kernel **6.7+**), eBPFsentinel attaches its TC
datapath (`tc-ids`, `tc-threatintel`, `tc-dns`, `tc-conntrack`,
`tc-nat-ingress`, `tc-nat-egress`, `tc-scrub`, `tc-qos`) directly to the
netkit device via `BPF_LINK_CREATE` (`BPF_NETKIT_PRIMARY`), skipping the TC
clsact qdisc.

No extra configuration is needed: `agent.attach_mode` defaults to `auto`,
which uses netkit when the interface is a netkit device and falls back to TC
clsact otherwise — the same DaemonSet works on bare metal, veth, and netkit
clusters. A background watcher polls every 5 s and **hot-plugs** newly
scheduled pod interfaces, attaching all loaded TC programs without an agent
restart (and detaching when the pod is deleted). It also correlates each new
device with the pod network namespaces that appeared in the same cycle, so
hot-plug log lines carry the owning pod's PID and namespace inode.

Set `attach_mode: netkit` to **require** netkit (the agent fails to start if
an interface is not a netkit device) or `attach_mode: tc` to force clsact
everywhere. See the [TC attachment mode](../../configuration/agent.md#tc-attachment-mode)
reference for the full behaviour. The agent Helm chart leaves `attach_mode`
at its `auto` default; override it through `configOverride` if you need a
non-default mode.

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
  # BPF token delegation. eBPF loads EXCLUSIVELY through the token; the only
  # knob is where the launcher mounts the delegated bpffs (must match its
  # --bpffs). There is no enable/fallback toggle — token is the only path.
  bpfToken:
    bpffsPath: /sys/fs/bpf/ebpfsentinel

# -- DaemonSet security context & scheduling
daemonset:
  # Required for uprobe DLP to see processes outside the pod (default: false)
  hostPID: false
  # CAP_SYS_ADMIN is consumed by the launcher entrypoint (bpffs delegation +
  # module BTF fds + userns creation); the agent it execs is unprivileged.
  # allowPrivilegeEscalation must be true so the launcher can do that bootstrap.
  securityContext:
    capabilities:
      drop: [ALL]
      add: [SYS_ADMIN, NET_RAW]   # NET_RAW: launcher pre-opens the pcap pool
    allowPrivilegeEscalation: true
    # Launcher does mount/move_mount + uid_map write; the default container
    # AppArmor/seccomp profile blocks these on hardened (e.g. Ubuntu) nodes.
    appArmorProfile:
      type: Unconfined
    seccompProfile:
      type: Unconfined
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
- `CAP_SYS_ADMIN` + `allowPrivilegeEscalation: true` on the agent
  container — consumed by the launcher entrypoint for bpffs delegation;
  the agent it execs is unprivileged. **No init container.**
- `CAP_NET_RAW` (optional) — lets the launcher pre-open the `AF_PACKET`
  pcap socket pool; drop it if you never run packet capture
- `appArmorProfile.type: Unconfined` + `seccompProfile.type: Unconfined` —
  the launcher issues `mount`/`move_mount` and writes `/proc/self/uid_map`,
  which the default container AppArmor/seccomp profile blocks on hardened
  nodes (e.g. Ubuntu)
- The node must **allow unprivileged user namespaces** — the launcher
  creates the token inside a child userns (`BPF_TOKEN_CREATE` is
  `EOPNOTSUPP` otherwise)
- `/sys/fs/bpf` hostPath mount (`mountPropagation: HostToContainer` on the
  agent container) — a container's `/sys` is read-only, so the launcher needs
  this writable host bpffs to create the delegated mountpoint. On nested
  runtimes (kind, minikube) whose `/sys/fs/bpf` is itself read-only, use an
  in-pod `emptyDir: { medium: Memory }` instead
- `/proc` and `/sys/fs/cgroup` hostPath mounts (read-only) — required
  by the container resolver when running inside a pod
- Helm 3.x

### When the token cannot be created

There is **no capability-based fallback** — eBPF loads only through the
token. If the node disallows unprivileged user namespaces, or the runtime
/ Pod Security Admission level blocks `CAP_SYS_ADMIN`, the launcher cannot
delegate the bpffs and the agent starts in **API-only mode** (no eBPF
attached, `ebpfsentinel_bpf_token_used` reads `0`). Fix the cluster
runtime config rather than reaching for a capability set — granting
`CAP_BPF`/`CAP_NET_ADMIN` does **not** create an alternate loading path.
See the [BPF token guide](bpf-token.md#troubleshooting).
