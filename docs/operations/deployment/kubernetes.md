# Kubernetes Deployment

> DaemonSet mode supports all features. The agent requires kernel 6.9+
> and loads eBPF **exclusively** through a **BPF token** - there is no
> capability-based fallback. See the [BPF token guide](bpf-token.md) and the
> [deployment compatibility matrix](../../features/deployment-matrix.md).

The agent runs as a DaemonSet, one pod per node, installed by the Helm chart
`charts/ebpfsentinel`. Each pod carries two containers:

| Container | User | Capabilities | Role |
|-----------|------|--------------|------|
| `warden` | 0 | `SYS_ADMIN`, `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`, `BPF`, `PERFMON` | Privileged broker, run as a native sidecar (an init container with `restartPolicy: Always`). Delegates a bpffs to the agent once, then performs the host-namespace operations the agent cannot: conntrack teardown, routes, gratuitous ARP, the pcap socket pool and the DLP uprobe attach |
| `agent` | 65534 | none (`drop: [ALL]`) | The agent. Unshares its own user namespace, has the warden stamp the bpffs it opened, loads its eBPF through the token and serves the API |

Native sidecars need **Kubernetes 1.29 or later** (on 1.28 they sit behind an alpha feature gate that is off by default), and the chart's `kubeVersion` refuses an older cluster. The two containers share the
warden socket through an `emptyDir`; the agent finds it through
`EBPFSENTINEL_WARDEN_SOCK`.

## Install

The chart is published as an OCI artifact:

```bash
helm install ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  --version <version> \
  --namespace ebpfsentinel --create-namespace \
  --set agent.interfaces='{eth0}'
```

From a checkout of the agent repository, install the chart directory instead:

```bash
helm install ebpfsentinel charts/ebpfsentinel \
  --namespace ebpfsentinel --create-namespace \
  --set agent.interfaces='{eth0}'
```

`agent.interfaces` names the node interfaces the eBPF programs attach to. The
pod runs with `hostNetwork: true`, so these are the node's own interface names.

Verify:

```bash
kubectl -n ebpfsentinel get pods -o wide
kubectl -n ebpfsentinel logs ds/ebpfsentinel -c agent | grep -i token
kubectl -n ebpfsentinel exec ds/ebpfsentinel -c agent -- \
  ebpfsentinel-agent metrics | grep bpf_token_used
```

`ebpfsentinel_bpf_token_used 1` means eBPF was loaded through the token. The
image is distroless: there is no shell and no `curl` in it, so use the agent's
own subcommands through `kubectl exec`.

## What the chart renders

| Object | When |
|--------|------|
| `ServiceAccount` | `serviceAccount.create` (default `true`) |
| `ConfigMap` holding `config.yaml` | always |
| `Service`, headless `ClusterIP`, ports `http` 8080, `grpc` 50051, `metrics` 9090 | always |
| `DaemonSet` | always |
| `ClusterRole` + `ClusterRoleBinding` (`pods`: `get`, `list`, `watch`) | `container.kubernetes.enabled` |
| `ServiceMonitor` | `metrics.serviceMonitor.enabled` |
| `PrometheusRule` | `metrics.prometheusRule.enabled` |
| `PodDisruptionBudget` | `podDisruptionBudget.enabled` |
| `NetworkPolicy` | `networkPolicy.enabled` |

Without the Kubernetes enricher the chart creates no RBAC at all and does not
mount the ServiceAccount token into the pod.

## Pod layout

Pod-level settings: `hostNetwork: true`, `dnsPolicy: ClusterFirstWithHostNet`,
`fsGroup: 65534` (so the agent can read the `0640` config file), and `hostPID`
from `daemonset.hostPID` (default `true`).

`hostPID` is what makes TLS DLP node-wide: the agent resolves each workload's
`libssl` through `/host/proc/<pid>` and the warden attaches the uprobe against
the host pid. It also lets the pod see every process on the node. With
`daemonset.hostPID: false` the uprobe covers only the libraries the agent itself
maps.

Both containers run with AppArmor and seccomp `Unconfined`: the agent issues
`unshare`, `mount` and `bpf` without holding `CAP_SYS_ADMIN`, which the default
seccomp profile would refuse, and the warden issues `fsconfig`, netlink,
`AF_PACKET` and `bpf`.

Environment set on the agent:

| Variable | Value |
|----------|-------|
| `EBPFSENTINEL_WARDEN_SOCK` | the warden socket in the shared `emptyDir` |
| `EBPFSENTINEL_BPFFS` | `daemonset.bpfToken.bpffsPath` (default `/sys/fs/bpf/ebpfsentinel`) |
| `EBPFSENTINEL_HOST_PROC` | `/host/proc` |
| `EBPFSENTINEL_NODE_NAME` | the node name, from `spec.nodeName` |

Volumes:

| Volume | Source | Mounted at |
|--------|--------|------------|
| warden socket | `emptyDir` | both containers |
| config | the ConfigMap, mode `0640` | `/etc/ebpfsentinel` |
| bpf | host `/sys/fs/bpf`, propagation `HostToContainer`; or an in-memory `emptyDir` when `daemonset.bpfToken.bpffsEmptyDir` is `true` | `/sys/fs/bpf` |
| debugfs | host `/sys/kernel/debug`, read-only | `/sys/kernel/debug` |
| cgroup | host `/sys/fs/cgroup`, read-only | `/sys/fs/cgroup` |
| host proc | host `/proc`, read-only | `/host/proc` (both containers) |
| state | host `daemonset.state.hostPath`, by default `/var/lib/ebpfsentinel/k8s/<namespace>/<release>` (`DirectoryOrCreate`); an `emptyDir` when `daemonset.state.ephemeral` is `true` | `/var/lib/ebpfsentinel` (agent, `state-dir`) |

Set `daemonset.bpfToken.bpffsEmptyDir=true` on nested runtimes such as kind and
minikube, whose node `/sys/fs/bpf` is read-only or absent. On a real node leave
it `false`.

Probes: liveness on `/healthz`, readiness on `/readyz`, both on the `http` port.

### Node prerequisite on Ubuntu 24.04 and later

These kernels set `kernel.apparmor_restrict_unprivileged_userns=1`. The agent
runs as uid 65534 and must create a user namespace, and the pod's own
`appArmorProfile: Unconfined` does not lift a host-level gate. On each such node
either set the sysctl to `0` (a node bootstrap step, a `/etc/sysctl.d/` drop-in
or a privileged init DaemonSet), or load a per-binary AppArmor profile granting
`userns`. Nodes without the restriction (most non-Ubuntu kernels, Talos) need
nothing.

### Kernel version matrix

| Kernel | Supported path | Notes |
|--------|----------------|-------|
| < 6.9 | **Not supported** | The agent requires 6.9+ (BPF token delegation and the kfunc surface) |
| 6.9+ | BPF token (only path) | The warden holds the host capabilities; the agent holds none |

If the token cannot be created (user namespaces disabled, the warden absent,
the AppArmor gate above), the agent logs
`BPF token unavailable - running in API-only mode`, serves the API with no eBPF
attached, reports `ebpfsentinel_bpf_token_used 0` and answers `503` on
`/readyz`, so the pod never becomes Ready.

## Values reference

### Images

| Key | Default |
|-----|---------|
| `image.repository` | `ghcr.io/ebpfsentinel/ebpfsentinel` |
| `image.tag` | the chart's `appVersion` when empty |
| `wardenImage.repository` | `ghcr.io/ebpfsentinel/ebpfsentinel-warden` |
| `wardenImage.tag` | the chart's `appVersion` when empty |
| `imagePullSecrets` | `[]` |

### Agent

| Key | Default | Description |
|-----|---------|-------------|
| `agent.interfaces` | `[eth0]` | Node interfaces to attach to |
| `agent.bindAddress` | `0.0.0.0` | Listen address for HTTP, gRPC and metrics |
| `agent.allowUnauthenticatedApi` | `true` | Lets the agent boot on a non-loopback bind with auth off. Turn `auth.enabled` on for production, or restrict access with a NetworkPolicy |
| `agent.httpPort` / `grpcPort` / `metricsPort` | `8080` / `50051` / `9090` | Ports |
| `agent.logLevel` / `logFormat` | `info` / `json` | Logging |
| `agent.swaggerUi` | `false` | Swagger UI at `/swagger-ui` |
| `agent.grpcReflection` | `false` | gRPC reflection |
| `agent.xdpMode` | `auto` | `auto`, `native`, `generic` or `offloaded` |
| `agent.eventWorkers` | `4` | Event dispatch workers |
| `agent.tls.enabled` | `false` | TLS on the HTTP and gRPC listeners; `certPath`, `keyPath`, `pqMode` (`prefer`, `require`, `disable`) and `allowTls12` beside it. Mount the files through `daemonset.extraVolumes` and `extraVolumeMounts` under `/etc/ebpfsentinel/` |

### DaemonSet

| Key | Default | Description |
|-----|---------|-------------|
| `daemonset.hostPID` | `true` | Host PID namespace, for node-wide TLS DLP |
| `daemonset.bpfToken.bpffsPath` | `/sys/fs/bpf/ebpfsentinel` | Drives both `EBPFSENTINEL_BPFFS` and the agent's `bpf_token.bpffs_path`, so the two cannot drift |
| `daemonset.bpfToken.bpffsEmptyDir` | `false` | In-pod tmpfs bpffs, for kind and minikube |
| `daemonset.state.hostPath` | `""` | Host directory backing `/var/lib/ebpfsentinel`; empty means `/var/lib/ebpfsentinel/k8s/<namespace>/<release>` |
| `daemonset.state.ephemeral` | `false` | Keep the state in an `emptyDir`, lost when the pod is replaced |
| `daemonset.warden.securityContext` | uid 0, the six capabilities above, Unconfined | Warden security context |
| `daemonset.warden.resources` | 64Mi/50m requests, 256Mi/1 CPU limits | Warden resources |
| `daemonset.securityContext` | uid/gid 65534, `drop: [ALL]`, Unconfined | Agent security context |
| `daemonset.resources` | 128Mi/100m requests, 512Mi/1 CPU limits | Agent resources |
| `daemonset.updateStrategy` | `RollingUpdate`, `maxUnavailable: 1` | |
| `daemonset.tolerations` | `[{operator: Exists}]` | Schedules on every node, control plane included |
| `daemonset.nodeSelector`, `affinity`, `priorityClassName` | empty | Scheduling |
| `daemonset.podLabels`, `podAnnotations` | `{}` | |
| `daemonset.extraEnv`, `extraVolumes`, `extraVolumeMounts`, `extraContainers`, `initContainers` | `[]` | Extension points |
| `daemonset.minReadySeconds`, `revisionHistoryLimit`, `terminationGracePeriodSeconds` | `0`, `10`, `30` | |

### Domains

Each domain maps to its section of `config.yaml` and carries only `enabled`:

| Enabled by default | Disabled by default |
|--------------------|---------------------|
| `firewall`, `ids`, `ips`, `dlp`, `ratelimit`, `threatintel`, `dns` | `alerting`, `audit`, `auth`, `conntrack`, `ddos`, `l7`, `nat`, `routing`, `loadbalancer`, `geoip`, `zones`, `qos` |

`geoip.source` takes the GeoIP source block as-is. Rules, feeds, keys and every
other domain setting go through `configOverride`.

### Other values

| Key | Default | Description |
|-----|---------|-------------|
| `container.kubernetes.enabled` | `false` | Kubernetes pod metadata on alerts, see below |
| `container.kubernetes.labelFilter` | `[]` | `key=value` pairs narrowing the pod watcher |
| `auto_response` | `enabled: false` | Rendered as the `auto_response` section |
| `auto_capture` | `enabled: false` | Rendered as the `auto_capture` section |
| `aliases` | `{}` | Named IP and port aliases, e.g. `trusted: {type: ip_set, values: ["10.0.0.0/8"]}` |
| `interface_groups` | `{}` | Interface groups, e.g. `lan: {interfaces: [eth0, eth1]}` |
| `metrics.serviceMonitor` | `enabled: false`, `interval: 15s`, `labels: {}` | |
| `metrics.prometheusRule` | `enabled: false`, `labels: {}`, `rules: []` | Empty `rules` uses the built-in set |
| `podDisruptionBudget` | `enabled: false`, `maxUnavailable: 1` | |
| `networkPolicy` | `enabled: false`, `extraIngress: []`, `extraEgress: []` | Ingress on the three ports, egress unrestricted |
| `serviceAccount` | `create: true`, `name: ""`, `annotations: {}` | |
| `configOverride` | `""` | A whole `config.yaml`; when set, every `agent.*` value and domain toggle is ignored |

Structured blocks are easier to pass as a file than with `--set`:

```yaml
# response-values.yaml
auto_response:
  enabled: true
  policies:
    - name: block-critical
      min_severity: critical
      action: block
      ttl_secs: 3600
```

```bash
helm upgrade --install ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  --version <version> -n ebpfsentinel -f response-values.yaml
```

### Full configuration

`configOverride` replaces the rendered file with your own. Keep `agent.interfaces`,
the ports and `bpf_token.bpffs_path` consistent with the pod: the probes read the
`http` port and the bpffs path must match `daemonset.bpfToken.bpffsPath`.

```yaml
configOverride: |
  agent:
    interfaces: [eth0]
    bind_address: 0.0.0.0
    allow_unauthenticated_api: true
    http_port: 8080
    grpc_port: 50051
    metrics_port: 9090
    bpf_token:
      bpffs_path: /sys/fs/bpf/ebpfsentinel
  firewall:
    enabled: true
    default_policy: pass
    rules: []
```

See the [configuration reference](../../configuration/overview.md) for every section.

## Config updates

The pod template carries a checksum of the rendered ConfigMap, so a
`helm upgrade` that changes the configuration rolls the DaemonSet. Pods are
replaced one node at a time (`maxUnavailable: 1`).

## Kubernetes pod metadata on alerts

```bash
helm upgrade --install ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  --version <version> -n ebpfsentinel \
  --set container.kubernetes.enabled=true
```

With the enricher on, the chart:

- renders `container.kubernetes` into the config;
- creates a `ClusterRole` with `get`, `list` and `watch` on `pods` and binds it
  to the ServiceAccount;
- mounts the ServiceAccount token into the pod;
- passes `EBPFSENTINEL_NODE_NAME` so the agent watches only the pods of its own
  node.

Alerts then carry the pod name, namespace and labels of the container that
produced them. The enricher stays off when `KUBERNETES_SERVICE_HOST` is absent.
See [container configuration](../../configuration/container.md).

## Netkit

TC programs attach through TCX (kernel 6.6+, no `clsact` qdisc). On clusters
whose CNI creates netkit pod devices (Cilium 1.16+ with netkit on kernel 6.7+),
`agent.attach_mode` decides how the agent attaches to them:

| `attach_mode` | Behaviour |
|---------------|-----------|
| `auto` (default) | netkit attach on a netkit device, TCX otherwise; a failed netkit attach falls back to TCX |
| `netkit` | netkit only; a non-netkit interface fails its attach |
| `tc` | TCX only |

The agent polls for new netkit devices every five seconds and attaches to them
as they appear (`netkit hot-plug watcher started (5s poll, auto-attach enabled)`
in the log). `attach_mode` has no chart value; set it through `configOverride`.

## State

The agent writes its state under `/var/lib/ebpfsentinel`: the redb stores
under `data/` when `audit` is enabled, packet captures under `captures/`,
downloaded GeoIP databases and the anonymous telemetry installation identifier.
The chart mounts the `state` volume there, and the agent creates `data/` and
`captures/` itself when the volume starts empty.

By default the volume is a node directory,
`/var/lib/ebpfsentinel/k8s/<namespace>/<release>`, so the stores and the
installation identifier carry over a rollout and two releases on one node keep
apart. `daemonset.state.hostPath` names another directory.

The agent runs as uid 65534 and Kubernetes applies no `fsGroup` to a hostPath,
which the kubelet creates owned by root. A `state-dir` init container runs the
warden image once as root, with `CHOWN` and `FOWNER` and no other capability:
`warden prepare-state` creates the directory, sets it to `0700` and hands it to
uid and gid 65534 before the warden and the agent start. Nothing has to be
prepared on the node.

`daemonset.state.ephemeral=true` puts the state on an `emptyDir` instead and
drops the init container: it survives a container restart but not the pod
being replaced, so a rollout starts from nothing and the agent draws a new
telemetry installation identifier.

## Metrics

With `metrics.prometheusRule.enabled`, the built-in rules are:

| Alert | Expression | For |
|-------|------------|-----|
| `EbpfsentinelAgentDown` | `up{job=~".*ebpfsentinel.*"} == 0` | 2m |
| `EbpfsentinelHighEventDropRate` | `rate(ebpfsentinel_events_dropped_total[5m]) > 10` | 5m |
| `EbpfsentinelHighAlertRate` | `rate(ebpfsentinel_alerts_total[5m]) > 50` | 5m |
| `EbpfsentinelConfigReloadFailure` | `increase(ebpfsentinel_rules_reloads_total{result="failure"}[10m]) > 0` | - |
| `EbpfsentinelHighMemoryUsage` | `ebpfsentinel_memory_usage_bytes > 400 * 1024 * 1024` | 5m |
| `EbpfsentinelEbpfProgramDown` | `ebpfsentinel_ebpf_program_status == 0` | 1m |
| `EbpfsentinelCircuitBreakerOpen` | `ebpfsentinel_alert_sender_circuit_state > 0` | 2m |
| `EbpfsentinelDdosAttackActive` | `ebpfsentinel_ddos_attacks_active > 0` | 1m |

Add the label your Prometheus Operator selects on with
`metrics.serviceMonitor.labels` and `metrics.prometheusRule.labels`, for example
`release: kube-prometheus-stack`.

## NetworkPolicy

`networkPolicy.enabled` admits ingress on the HTTP, gRPC and metrics ports and
leaves egress open. The pod runs on the host network, and many CNIs do not
enforce NetworkPolicy on host-network pods, so check your CNI before relying on
it to protect an API left unauthenticated.

## Upgrade, rollback, uninstall

```bash
helm upgrade ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  --version <version> -n ebpfsentinel --reuse-values
helm rollback ebpfsentinel -n ebpfsentinel
helm uninstall ebpfsentinel -n ebpfsentinel
```

Uninstalling detaches every program: the eBPF links belong to the agent
process and go with it.

## Enterprise

The Enterprise agent has its own chart and license handling. See
[Enterprise deployment](enterprise.md).
