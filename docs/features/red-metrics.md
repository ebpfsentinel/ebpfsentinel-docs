# Requests, Errors and Duration per Service

> **Edition: OSS** | **Enforcement: Userspace** | **Domain: l7**

## What it shows

For every service on the node, how many requests it received or sent, how many
failed and how long each one took: the RED signals, read off the traffic the
L7 capture already inspects. Nothing is installed inside the application and
no sidecar runs beside it.

- **Protocols:** HTTP/1.x, Redis, PostgreSQL, MySQL and DNS over TCP. TLS and
  every protocol whose failure is not readable in clear are not measured.
- **Outcome:** each request ends `ok`, `error`, or `unanswered` when no answer
  came within 30 seconds. Only answered requests are timed.
- **Service:** the workload at each end of the connection, named from its
  Kubernetes controller, systemd unit, container image or executable, in that
  order, and `unattributed` when neither end runs on the node.

## One example

```promql
# Error ratio per service over five minutes
sum by (service) (rate(ebpfsentinel_l7_requests_total{outcome="error"}[5m]))
  / sum by (service) (rate(ebpfsentinel_l7_requests_total[5m]))

# 95th percentile duration per service
histogram_quantile(0.95,
  sum by (service, le) (rate(ebpfsentinel_l7_request_duration_seconds_bucket[5m])))
```

The two series are `ebpfsentinel_l7_requests_total{service, role, protocol, outcome}`
and `ebpfsentinel_l7_request_duration_seconds{service, role, protocol}`, listed in the
[metrics reference](../api-reference/prometheus-metrics.md#l7-requests-per-service).

## Configuration

There is no switch of its own: whatever the L7 capture inspects is measured,
so the request and its answer must cross an interface the agent inspects, on
a port the capture covers. The capture's keys are in
[L7 configuration](../configuration/l7.md).

The bounds on every label, the histogram buckets and the measured cost per
request are in
[Requests, errors and duration per service](l7-firewall.md#requests-errors-and-duration-per-service).
