# Monitoring the operator

The [Kubernetes operator](../features/enterprise/kubernetes-operator.md)
turns resources into agent configuration. When it stops, nothing breaks at
once: every agent keeps running the document it was last given. What stops
is change. A policy edited after that point reaches no node, and nothing on
the node says so. This page covers the few signals that show that state, and
the alerts the chart ships on them.

## Where the figures come from

Every replica serves Prometheus text on its health port, `8081`, at
`/metrics`, the standby included. The standby's leader gauge is what shows a
missing leader or two of them.

```bash
kubectl -n ebpfsentinel port-forward deploy/ebpfsentinel-operator 8081
curl -s localhost:8081/metrics | grep -v '^#'
```

| Metric | Type | Labels | What it answers |
|--------|------|--------|-----------------|
| `ebpfsentinel_operator_leader` | Gauge | - | Is this replica the one reconciling (1) or a standby (0)? |
| `ebpfsentinel_operator_reconcile_total` | Counter | `controller`, `result` | How many passes ran, and how they ended (`success` or `error`) |
| `ebpfsentinel_operator_reconcile_errors_total` | Counter | `controller` | How many passes failed and were requeued |
| `ebpfsentinel_operator_reconcile_duration_seconds` | Histogram | `controller`, `result` | How long a pass takes |
| `ebpfsentinel_operator_reconcile_in_flight` | Gauge | `controller` | How many passes are running right now |
| `ebpfsentinel_operator_objects` | Gauge | `kind`, `namespace`, `ready` | How many resources of each kind are ready, not ready, or not yet reported |

`controller` is the kind a controller reconciles, such as `FirewallPolicy`,
or `ebpfsentinelagent` for the agent controller. `namespace` on the object
census is the watched namespace, and is empty when the operator watches the
whole cluster. The census is read from the operator's own cache every thirty
seconds, so it costs the API server nothing.

The load balancer figures (VIP speakers, Service address pools, BGP sessions)
are listed with the
[feature they describe](../features/enterprise/kubernetes-operator.md#resources).

There is no queue-depth series. The controller runtime the operator is built
on does not expose its scheduling queue, so a figure under that name would
be an estimate. `reconcile_in_flight` is the honest substitute: a value that
stays at its ceiling while `reconcile_duration_seconds` climbs means passes
are waiting on each other.

## Scraping with the Prometheus Operator

Two chart values, both off by default because both need the
`monitoring.coreos.com` CRDs:

```yaml
service:
  create: true            # the ServiceMonitor scrapes this Service
metrics:
  serviceMonitor:
    enabled: true
    interval: 30s
    scrapeTimeout: 10s
    labels:
      release: prometheus # whatever your Prometheus serviceMonitorSelector wants
  prometheusRule:
    enabled: true
    labels:
      release: prometheus # whatever its ruleSelector wants
```

The `ServiceMonitor` without `service.create` is refused at render time
instead of producing a monitor that selects nothing.

The ServiceMonitor leaves `honorLabels` at its default, so the target's own
`namespace` label (the namespace the operator runs in) is the one every
series carries, and the census's watched namespace is renamed
`exported_namespace`. The shipped rules filter on the first, so two
operators installed in two namespaces each raise their own alerts.

A collector that reads pod annotations rather than ServiceMonitors needs
neither value: point it at port `8081`, path `/metrics`, through
`podAnnotations`.

## The alerts

Five rules, one for each condition that needs a person, rather than one per
metric. Each carries a `runbook_url` pointing at its section below.

### EbpfSentinelOperatorNoLeader

**Critical, after 5 minutes.** No replica reports holding the lease, or no
replica is scraped at all. Nothing is reconciled: agents keep their last
document, and edits wait.

- `kubectl -n ebpfsentinel get pods -l app.kubernetes.io/name=ebpfsentinel-operator`.
  A pod in `CrashLoopBackOff` whose log names the licence is an expired
  licence, or one without `kubernetes-operator`.
- `kubectl -n ebpfsentinel get lease` shows who last held it and
  when. A holder that no longer exists gives way once the lease lapses.
- A running pod that never takes the lease cannot reach the API server.
  Its log says so.

### EbpfSentinelOperatorSplitLeadership

**Critical, after 2 minutes.** Two replicas each believe they hold the lease.
Both write every agent's configuration, and each undoes the other's write.

- The usual cause is a clock skewed by more than the lease duration on one
  node. Check `chronyc tracking` or the node's equivalent.
- Delete the pod on the skewed node. The survivor keeps the lease, and the
  replacement waits as a standby.

### EbpfSentinelOperatorReconcileErrors

**Warning, after 15 minutes above 10% of passes.** One controller fails more
than one pass in ten. Every failed pass files a `ReconcileFailed` event on
the resource it was reconciling, carrying the error:

```bash
kubectl get events -A --field-selector reason=ReconcileFailed
```

- An error naming a Secret is a reference to a Secret or key that does not
  exist. Fix the resource or create the Secret.
- An error naming an agent's address is an agent the operator cannot reach.
  Check the agent pod and any network policy between the two namespaces.
- `forbidden` is an RBAC rule missing for the scope the chart was installed
  with. Compare `watchNamespaces` with the namespaces the resources are in.

### EbpfSentinelOperatorReconcileSlow

**Warning, after 15 minutes above 5 seconds at the 99th percentile.** A pass
normally finishes in well under a second. Slow passes mean slow answers from
the API server, which other controllers will be seeing too, or from agents.

- Compare with `reconcile_in_flight` for the same controller. A ceiling there
  means work is queuing behind the slow passes.
- `apiserver_request_duration_seconds` on the control plane tells the two
  causes apart.

### EbpfSentinelResourcesNotReady

**Warning, after 30 minutes.** Resources of one kind have stayed not ready
for half an hour. The operator is running, but what an author asked for is
not running everywhere they asked. The resource's conditions and events say
why:

```bash
kubectl get firewallpolicies -A -o wide
kubectl describe firewallpolicy edge-baseline
```

- `NoMatchingAgents`: no agent in the namespace selects the resource.
- `RenderPending` that never clears: an agent is not picking up its new
  configuration. Check the agent pod for a reload failure.
- `Refused` events: another resource sets the same value and wins.
  [What the operator says on a resource](../features/enterprise/kubernetes-operator.md#what-the-operator-says-on-a-resource)
  covers each reason.
