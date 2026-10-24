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
| The same `ClusterRole` widened with `list`, `watch` on `namespaces`, `services`, `networkpolicies` and `endpointslices` | `container.kubernetes.networkPolicy.mode` other than `off` |
| `ServiceMonitor` | `metrics.serviceMonitor.enabled` |
| `PrometheusRule` | `metrics.prometheusRule.enabled` |
| `PodDisruptionBudget` | `podDisruptionBudget.enabled` |
| `NetworkPolicy` | `networkPolicy.enabled` |

Without the Kubernetes enricher the chart creates no RBAC at all and does not
mount the ServiceAccount token into the pod.

## Pod layout

Pod-level settings: `hostNetwork: true`, `dnsPolicy: ClusterFirstWithHostNet`,
`fsGroup: 65534` (so the agent can read the `0640` config file), and `hostPID`
from `daemonset.hostPID`, **which defaults to `false`**.

What makes TLS DLP node-wide is the read-only `/host/proc` mount, not the pid
namespace: the agent resolves each workload's `libssl` through
`/host/proc/<pid>` and the warden creates the uprobe link against that path and
a file offset with `pid = 0`, so it fires for every process mapping the library
whatever namespace it runs in. `daemonset.hostPID: true` adds the node's
process table to what the pod can read and buys no coverage, which is why it
ships off and why the chart refuses to render it under `baseline`.

### Pod Security Admission

`daemonset.podSecurityAdmission` names the level the pod is meant to satisfy
(`privileged`, `baseline` or `restricted`). It enforces nothing by itself - the
namespace label does - but the chart fails to render when these values ask for
something the named level forbids, listing every offending value at once
instead of letting admission reject the pod on the first one it notices.

As shipped the pod is `privileged`, and these are the reasons, named one by
one rather than as a blanket requirement:

| What | Why | Forbidden by |
|---|---|---|
| `hostNetwork: true` | XDP and TC attach to the node's own interfaces, which exist in no other namespace | `baseline` |
| The warden's `CAP_SYS_ADMIN`, `NET_ADMIN`, `NET_RAW`, `SYS_PTRACE`, `BPF`, `PERFMON` | bpffs delegation, conntrack and routes, the pcap pool, reading a neighbour's procfs, creating the DLP uprobe link | `baseline` |
| `seccompProfile: Unconfined` and `appArmorProfile: Unconfined` on both containers | the agent unshares a user namespace and loads eBPF through its token without `CAP_SYS_ADMIN`; the warden issues `fsconfig`, netlink and `bpf` | `baseline` |
| `allowPrivilegeEscalation: true` on the agent | it gains inside its own user namespace the capabilities it holds none of on the host | `restricted` |
| hostPath volumes (`/sys/fs/bpf`, `/sys/kernel/debug`, `/sys/fs/cgroup`, `/proc`, the state directory, `/etc/machine-id`) | the programs, the pinned maps and the node's procfs live on the node, not in the pod | `baseline` |
| Host ports 8080, 50051 and 9090 | `hostNetwork` makes every declared port a host port | `baseline` |

Cross-container DLP is no longer on that list, and `hostPID` is in neither the
chart's list nor an API server's verdict. The rest of the list stands: a node
that needs only the DLP path is still not a `baseline` pod, because the
warden's capabilities, the two `Unconfined` profiles and the hostPath mounts
are each forbidden there on their own.

That list is checked against a cluster rather than reviewed:
`scripts/check-psa-claims.sh` in the agent repository renders the pod, submits
it to a namespace enforcing `baseline` and to one enforcing `privileged`, and
fails when the API server names a control the chart's own list does not, when
either side names `hostPID`, or when the declared level refuses the pod. It was
last run against Kubernetes v1.35.0 on 2026-10-18, for both the community and
the enterprise chart.

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
`/readyz` fails while the eBPF programs are not loaded, while a kernel helper
one of them needs is missing, while an attach is blocked by a program already on
the interface, and while the datapath has gone 60s without a ring-buffer pass -
a wedged reader task, reported as `datapath_stalled_secs`. A reader passes every
10 ms whether or not traffic arrived, so that field is a stuck agent rather than
a quiet network, and the same reading is what withholds the systemd watchdog's
keep-alive on a binary install.

### Stopping a pod

Kubernetes sends `SIGTERM` and removes the endpoint at the same moment, so
without a hook the agent would drain while kube-proxy still routes to it. Three
numbers cover the stop:

| Number | Default | What it bounds |
|--------|---------|----------------|
| `daemonset.preStopSleepSeconds` | `5` | How long the container is held before it is signalled, so every node has dropped this endpoint first. `0` removes the hook |
| the agent's own stop budget | `20s` | The 5s server drain, the 2s capture close inside it, and a brokered warden call holding for up to 10s. Not a value: it is the same budget as `TimeoutStopSec` in the systemd unit |
| `daemonset.terminationGracePeriodSeconds` | `30` | The whole of it. The hook and the stop are counted against this one number, so it has to exceed their sum (5 + 20) or a correct stop ends in `SIGKILL` |

Raising `preStopSleepSeconds` without raising the grace period is what turns an
ordered stop into a killed one. The warden sidecar is a native sidecar, so
Kubernetes stops it after the agent and a brokered call in flight is not cut
from underneath.

The preStop sleep action needs Kubernetes 1.30, which is the chart's floor.

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
| `agent.allowUnauthenticatedApi` | `false` | Lets the agent boot on a non-loopback bind with `auth.enabled: false`. Off, because authentication is on by default; turning it on leaves the firewall, IPS and config-reload routes open to anything that can reach the pod |
| `agent.allowPlaintextApi` | `true` | Lets the agent serve a non-loopback bind without TLS. On, because the pod binds `0.0.0.0` and the chart ships no certificate, so the key and the configuration cross the cluster network in the clear. Mount a certificate under `agent.tls` and set this `false`, or carry mTLS in a service mesh |
| `auth.enabled` | `true` | Establish a principal before the control API answers. `/healthz` and `/readyz` stay public whatever it says |
| `auth.existingSecret` / `auth.secretKey` | `""` / `api-key` | A Secret holding the API key. When empty, the agent draws one at first start under the state volume and prints it once in the pod log |
| `metrics.authRequired` | `false` | Require the key on `/metrics` too. Needs `auth.existingSecret`, since Prometheus cannot read a key the agent drew for itself |
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
| `daemonset.podSecurityAdmission` | `privileged` | The PSA level these values are checked against at render time |
| `daemonset.hostPID` | `false` | Host PID namespace. Off: DLP reads `/host/proc` and the uprobe carries no pid |
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
| `daemonset.minReadySeconds`, `revisionHistoryLimit`, `terminationGracePeriodSeconds` | `0`, `10`, `30` | The grace period covers the preStop hook and the agent's 20s stop budget together |
| `daemonset.preStopSleepSeconds` | `5` | Seconds the agent is held before `SIGTERM`, so the endpoint is out of every node's rules first; `0` removes the hook |

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
| `container.kubernetes.networkPolicy.mode` | `off` | `observe` or `enforce` carries out the cluster's NetworkPolicy on the node's pods, see [Kubernetes NetworkPolicy](../../features/network-policy.md) |
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
    allow_plaintext_api: true
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

## Tested beside a CNI

The agent runs beside the cluster's CNI rather than replacing it. On every
change, CI stands up a two-node cluster networked only by each CNI below, runs
the operator and the agent built from source on it, and reads pod traffic
across nodes, a `NetworkPolicy` enforced by the CNI, the agent's own drops and
the order of the TCX chain on both nodes. This table is generated from those
lanes, so it states what they run and nothing more:

<!-- BEGIN GENERATED CNI MATRIX -->

| CNI | Version | What the lane stands up | Kubernetes |
|-----|---------|-------------------------|------------|
| Cilium | 1.20.4 | veth pod devices, VXLAN tunnel, beside kube-proxy | 1.32.2 |
| Calico | 3.33.0 | iptables dataplane, VXLAN, beside kube-proxy | 1.32.2 |

Untested, because no lane runs it, so nothing is claimed for it: Cilium at any other version, Cilium with netkit pod devices, Cilium replacing kube-proxy, Cilium with native routing, Calico at any other version, Calico with the eBPF dataplane, Calico with BGP and no encapsulation, Canal, Flannel, Antrea, kube-router, OVN-Kubernetes, AWS VPC CNI, Azure CNI, GKE Dataplane V2.

<!-- END GENERATED CNI MATRIX -->

Untested does not mean known broken: it means nobody has read the result, and
the [deployment matrix](../../features/deployment-matrix.md) says what each
device type is expected to do.

## TCX order beside a CNI

A TCX hook runs a chain of programs, and a program that passes or redirects
a packet ends the chain there. The agent's classifiers return "next" on a
pass, so whatever runs after them still sees every packet; a CNI's datapath
does not owe the agent the same, so a program of the agent's attached behind
Cilium's would miss whatever Cilium passes or redirects, without an error
anywhere.

So every TC program the agent attaches goes to the head of the chain, its
own programs together and in startup order, and the chain is read back
after each attach. When a program the agent did not attach runs ahead of or
between its own, the attach is refused rather than left where detections
silently miss traffic: `/readyz` and the log carry the hook, the program ids
ahead of the agent and what to run to see them, for instance

```text
tc_ids on eth0: TCX ingress on eth0: program id(s) 812 run ahead of the agent's
classifiers; a program ahead of the agent that passes or redirects a packet ends
the chain, so detections would silently miss that traffic. Refused rather than
attached behind it: read the chain with `bpftool net show dev eth0`, and restart
the agent once nothing foreign runs before it
```

This happens when something re-attaches at the head after the agent, which
is what a program pinned with the "before" flag does. Cilium and Calico do
not: CI runs the agent beside each of them and reads the chain from the
node with `bpftool` on both hooks.

Reading the chain needs `CAP_NET_ADMIN` in the host's user namespace, which
the agent does not hold in its own; the warden answers that read when the
agent's is refused. Without a warden the attach stands and the log says,
once per hook, `TCX order unverified: the chain could not be read`, because
a chain nobody could read is an unknown rather than a fault.

## Netkit

TC programs attach through TCX (kernel 6.6+, no `clsact` qdisc). On clusters
whose CNI creates netkit pod devices (Cilium 1.16+ with netkit on kernel 6.7+),
`agent.attach_mode` decides how the agent attaches to them:

| `attach_mode` | Behaviour |
|---------------|-----------|
| `auto` (default) | netkit attach on a netkit device, TCX otherwise; a failed netkit attach falls back to TCX |
| `netkit` | netkit only; a non-netkit interface fails its attach |
| `tc` | TCX only |

The agent watches rtnetlink for every pod link - veth, netkit, macvlan, ipvlan
and bridge members - and attaches to each one as it appears, releasing it when
the pod goes (`link hot-plug watcher started` in the log, then one
`hot-plug: workload link attached` line per pod link, carrying the container
id when the pod's cgroup names one). A rollout or a node draining back in
starts many pods at once: messages are folded over 100 ms so each pod link is
attached once, a burst that overruns the socket makes the agent re-read the
link table rather than lose a pod, and a recreated pod's new link is attached
under its new name. The window before a new pod's link is attached is
published as `ebpfsentinel_link_attach_gap_seconds` and the packets it carried
meanwhile as `ebpfsentinel_link_attach_unguarded_packets_total`. See
[workload link hot-plug](../../configuration/agent.md#workload-link-hot-plug).
`attach_mode` has no chart value; set it through `configOverride`.

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
being replaced, so a rollout starts from nothing.

The telemetry installation identifier does not depend on any of that: the chart
mounts the node's `/etc/machine-id` read-only and the identifier is derived from
it, so a node keeps one name across rollouts, an ephemeral state and a second
release. On a node without that file the mount would keep the pod from
starting; set `daemonset.state.machineId=false` there and the identifier is
random and lives with the state.

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

## The API key in a cluster

The control API authenticates by default, so something has to hold the key.
Two ways, and they differ in who can read it:

```bash
# 1. Let the agent draw one. It is printed once per pod, kept under the state
#    volume, and a pod replaced with `daemonset.state.ephemeral=true` draws a
#    new one.
kubectl -n ebpfsentinel logs -l app.kubernetes.io/name=ebpfsentinel -c agent | grep "API key"

# 2. Name a Secret, which is what a dashboard, an operator or a scraper needs,
#    because every pod then answers to the same key.
kubectl -n ebpfsentinel create secret generic ebpfsentinel-auth \
  --from-literal=api-key="sk-$(openssl rand -hex 32)"
helm upgrade --install ebpfsentinel oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel \
  -n ebpfsentinel --set auth.existingSecret=ebpfsentinel-auth
```

The Secret is mounted read-only and its path becomes `auth.bootstrap_key_path`;
no key is ever written into the ConfigMap. `metrics.authRequired` is `false`
out of the box so a ServiceMonitor scrapes the counters without the key; set it
`true` with a Secret named and the ServiceMonitor presents that Secret.

## NetworkPolicy

`networkPolicy.enabled` admits ingress on the HTTP, gRPC and metrics ports and
leaves egress open. The pod runs on the host network, and many CNIs do not
enforce NetworkPolicy on host-network pods, so check your CNI before relying on
it to protect an API that `agent.allowUnauthenticatedApi` left open.

This value is about the agent's own pod. Enforcing the cluster's policies on
the workloads of each node, for a CNI that enforces none, is
`container.kubernetes.networkPolicy.mode`; see
[Kubernetes NetworkPolicy](../../features/network-policy.md).

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
