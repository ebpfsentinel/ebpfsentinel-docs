# Workload Firewall Rules

A firewall rule normally names addresses and ports. A workload rule names the thing that opened the connection as well: an executable, a systemd unit, a cgroup or a container. It is decided by the `cgroup-workload-firewall` programs at the moment the task calls `connect()`, `sendmsg()` or `bind()`, before a packet exists, which is why it needs no LSM, no kernel boot flag and no `lsm=bpf` on the kernel command line. Every other firewall rule on the node keeps working exactly as before.

A rule that names a workload lives in the same `firewall.rules` list as every other rule, with one extra block:

```yaml
firewall:
  rules:
    - id: allow-curl-to-registry
      priority: 100
      action: allow
      protocol: tcp
      dst_ip: 10.20.0.0/16
      dst_port: 443
      workload:
        exe: /usr/bin/curl
        mode: enforce
```

## The four matchers

| Field | Type | Matching | Example |
|-------|------|----------|---------|
| `exe` | string | Exact, absolute path of the executable the task is running | `/usr/bin/curl` |
| `unit` | string | Exact systemd unit name, derived from the task's cgroup path | `nginx.service` |
| `cgroup` | string | Absolute cgroup v2 path, matching that cgroup **and everything under it** | `/system.slice/nginx.service` |
| `container` | string | Container name as the runtime gave it, a full container id, or an id prefix of at least 12 characters | `payments-api` |
| `mode` | string | `observe` (default) or `enforce` | `enforce` |

A selector must name at least one of the four. Naming several is an AND: every matcher present must be true of the same task. A matcher may not be empty, may not carry a control character and may not exceed 4096 bytes; `exe` and `cgroup` must be absolute paths. The block refuses unknown keys, so a misspelled matcher fails the load rather than quietly producing a rule that names no workload.

### Three semantics worth knowing before writing one

- **A fact the agent could not read never matches.** If the node cannot tell which executable a task is running, a rule naming `exe` does not apply to it. A rule firing on "we do not know" is a refusal nobody can explain.
- **A rule naming a workload and no address is about that workload anywhere.** Leave `dst_ip` and `dst_port` out and the rule decides every connection that workload opens.
- **A rule naming both is the intersection**: that workload, to that destination.

### Matchers a workload rule may not carry

There is no packet at the socket layer, so ten matchers are refused at load time with the reason on the line that has to be edited: `src_ip` (and `src_alias`), `src_port` (and `src_port_alias`), `vlan_id`, `src_mac`, `dst_mac`, `state`, `flags`, `icmp_type` and `icmp_code`, `dscp_match` and `dscp_mark`, and `interfaces`. The kernel has chosen neither a source address, a source port nor a route when `connect()` is called, and there is no frame to read a tag, an address or a flag from. The `reject` action is refused for the same reason: there is no packet to answer with a reset, so a workload rule either allows or denies, and a denied task gets `EPERM` from its own syscall like any other error.

## Modes

`mode` defaults to `observe`, deliberately. An observing rule counts what it would have refused and lets the syscall through, so the first policy anybody writes cannot take an application offline. Turning a rule to `enforce` changes which counter moves, not how much.

The document is also what loads the programs: a configuration with no workload rule attaches nothing. A configuration whose workload rules are in `enforce` mode stops the agent on a host where the hooks did not attach, rather than running on with an enforcement policy that is not being enforced. On a reload, a document that cannot be applied is rejected whole and the rules already in force are left alone.

At most 64 workload rules may be in force at once. The ceiling is a kernel-side bitmap, one bit per rule, and it is checked when the policy is published.

## An example per platform

### A systemd unit

Everything `nginx.service` opens, to anywhere, refused unless it is to the upstream pool. Two rules, the ordinary priority order deciding which one wins:

```yaml
firewall:
  rules:
    - id: allow-nginx-upstream
      priority: 100
      action: allow
      protocol: tcp
      dst_ip: 10.30.0.0/24
      dst_port: 8080
      workload:
        unit: nginx.service
        mode: enforce
    - id: deny-nginx-elsewhere
      priority: 200
      action: deny
      workload:
        unit: nginx.service
        mode: enforce
```

`unit` is read from the task's cgroup path, so it works for anything systemd started, including a unit started in a slice of its own.

### A Docker container

By name while the policy is being written, which survives a `docker rm` and a recreate:

```yaml
firewall:
  rules:
    - id: observe-payments-egress
      priority: 150
      action: deny
      workload:
        container: payments-api
        mode: observe
```

By id when the rule must name one specific container and nothing else, a prefix of at least 12 characters being enough:

```yaml
      workload:
        container: 3f2a9c1b4d7e
```

A container matcher needs the container resolver, which is on by default; see [Container Awareness](container.md). The whole of a Docker container, including anything it spawns, can also be named through its cgroup:

```yaml
      workload:
        cgroup: /system.slice/docker-3f2a9c1b4d7e8a....scope
```

### A Kubernetes pod

The `container` matcher carries the container name from the pod spec, not the pod name, because that is what the runtime labels the cgroup with:

```yaml
firewall:
  rules:
    - id: allow-api-to-database
      priority: 100
      action: allow
      protocol: tcp
      dst_ip: 10.96.14.7/32
      dst_port: 5432
      workload:
        container: api
        mode: enforce
    - id: deny-api-elsewhere
      priority: 200
      action: deny
      workload:
        container: api
        mode: enforce
```

A whole pod, every container in it, is a cgroup rule against the pod slice:

```yaml
      workload:
        cgroup: /kubepods.slice/kubepods-burstable.slice/kubepods-burstable-pod9f3c....slice
```

A cgroup matcher includes everything under the path, so the pod slice covers each container's own scope without naming them.

## An executable path is forgeable

`exe` is the path the kernel reports for the running binary, and anything that can write a file can arrange for a path to look like the one in the rule: copy a binary to `/usr/bin/curl` on a writable mount, bind-mount over it, or run from a namespace where that path is something else. A workload rule is therefore an operational control - it stops the normal behaviour of normal software, which is what most egress incidents are made of - and it is not an identity. What would close it is identifying the binary by the hash of its contents rather than by where it sits, and that is **not shipped**: there is no `exe_hash` matcher and no hashing in the agent today. Until there is, every alert a workload rule raises says which identity it carried, so a reader can see that a path was what matched. The `unit`, `cgroup` and `container` matchers are not paths and do not share this weakness, though they are only as trustworthy as whatever can create a unit or start a container on the node.

## What it costs and what it reports

Counters are published under `ebpfsentinel_packets_total{interface="WORKLOAD_METRICS"}`, one slot per hook plus `allowed`, `refused`, `would_refuse`, `unresolved`, `no_rule` and `event_lost`. Each denial also increments `ebpfsentinel_workload_denials_total{rule_id, mode}` and raises an alert naming the rule, the workload and the destination. `unresolved` is the task that executed and connected before the policy learned what it was; it is counted rather than hidden.

To see what a given workload may reach, ask the agent rather than reading the document:

```bash
ebpfsentinel-agent firewall reach --exe /usr/bin/curl
ebpfsentinel-agent firewall workload
```

See the [CLI reference](../cli-reference/index.md) for both commands, and [Socket Attribution](attribution.md) for the hooks that name the task in the first place.
