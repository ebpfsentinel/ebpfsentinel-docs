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

## The matchers

| Field | Type | Matching | Example |
|-------|------|----------|---------|
| `exe` | string | Exact, absolute path of the executable the task is running | `/usr/bin/curl` |
| `unit` | string | Exact systemd unit name, derived from the task's cgroup path | `nginx.service` |
| `cgroup` | string | Absolute cgroup v2 path, matching that cgroup **and everything under it** | `/system.slice/nginx.service` |
| `container` | string | Container name as the runtime gave it, a full container id, or an id prefix of at least 12 characters | `payments-api` |
| `pods` | label selector | Labels of the pod the task runs in, as `match_labels` and `match_expressions` with the Kubernetes meaning | `match_labels: {app: api}` |
| `namespaces` | label selector | Labels of that pod's namespace, in the same shape; a namespace is named by its name through `kubernetes.io/metadata.name` | `match_labels: {kubernetes.io/metadata.name: payments}` |
| `service_account` | string | Exact name of the service account the pod runs as | `api` |
| `mode` | string | `observe` (default) or `enforce` | `enforce` |

A selector must name at least one of the seven. Naming several is an AND: every matcher present must be true of the same task. A matcher may not be empty, may not carry a control character and may not exceed 4096 bytes; `exe` and `cgroup` must be absolute paths. A label selector is refused where the API server would refuse it: `In` and `NotIn` need values, `Exists` and `DoesNotExist` take none, and the operator is spelt as the API spells it. The three Kubernetes matchers need the [Kubernetes enricher](../features/container-awareness.md) running on the node, and its `ClusterRole` reading `namespaces` as well as `pods`; on a node without it a rule naming them loads, matches no task, and the agent says so at startup. A pod's labels, its namespace's labels and its service account are read as the watches report them, not only when a process starts: a relabelled pod or namespace is resolved again about a second after the change, so a long-running server enters or leaves a rule without restarting. The block refuses unknown keys, so a misspelled matcher fails the load rather than quietly producing a rule that names no workload.

### Three semantics worth knowing before writing one

- **A fact the agent could not read never matches.** If the node cannot tell which executable a task is running, a rule naming `exe` does not apply to it. A rule firing on "we do not know" is a refusal nobody can explain.
- **A rule naming a workload and no address is about that workload anywhere.** Leave `dst_ip` and `dst_port` out and the rule decides every connection that workload opens.
- **A rule naming both is the intersection**: that workload, to that destination.

### Matchers a workload rule may not carry

There is no packet at the socket layer, so ten matchers are refused at load time with the reason on the line that has to be edited: `src_ip` (and `src_alias`), `src_port` (and `src_port_alias`), `vlan_id`, `src_mac`, `dst_mac`, `state`, `flags`, `icmp_type` and `icmp_code`, `dscp_match` and `dscp_mark`, and `interfaces`. The kernel has chosen neither a source address, a source port nor a route when `connect()` is called, and there is no frame to read a tag, an address or a flag from. The `reject` action is refused for the same reason: there is no packet to answer with a reset, so a workload rule either allows or denies, and a denied task gets `EPERM` from its own syscall like any other error.

## Destinations by name

A destination that is a host name rather than an address goes in `fqdn`, inside the `workload` block:

```yaml
firewall:
  workload_dns:
    resolvers: ["10.96.0.10"]
    grace_secs: 30
  rules:
    - id: allow-dns-to-cluster-resolver
      priority: 90
      action: allow
      protocol: udp
      dst_ip: 10.96.0.10/32
      dst_port: 53
      workload:
        container: payments
        mode: enforce
    - id: allow-payments-to-psp
      priority: 100
      action: allow
      protocol: tcp
      dst_port: 443
      workload:
        container: payments
        fqdn: ["api.psp.example", "*.cdn.psp.example"]
        mode: enforce
    - id: deny-payments-elsewhere
      priority: 200
      action: deny
      workload:
        container: payments
        mode: enforce
```

| Field | Type | Default | Meaning |
|-------|------|---------|---------|
| `workload.fqdn` | list of strings | `[]` | Names this rule opens. An exact name, or `*.` followed by a domain of at least two labels |
| `firewall.workload_dns.resolvers` | list of addresses or CIDRs | `[]` | The resolvers whose answers are believed. Required as soon as one rule carries `fqdn` |
| `firewall.workload_dns.grace_secs` | integer | `30` | Seconds an address stays open past its record's TTL, at most `300` |

The address of a name is not written in the rule because it is whatever the resolver answered. So the agent reads the DNS traffic of every workload a rule names, on its way in and out of the workload's own sockets, and opens each address in an answer **for the cgroup that asked and for no other**. An address learned by one pod is never reused for another pod, even one that asked for the same name a moment later. An answer is believed only when all of these hold:

- it came from one of `resolvers`;
- it answers a query that same cgroup sent, with the same transaction id and port, less than five seconds earlier;
- it names what was asked;
- it reports success.

CNAME chains are followed for up to eight hops.

**TTL and grace.** Each address stays open for its record's own TTL, capped at one day, plus `grace_secs`. The grace covers the gap between the moment a cached answer lapses and the moment the application asks again. The expiry is checked by the kernel at every `connect()` and `sendmsg()`, so a lapsed address stops opening connections at that instant. A reload drops every learned address, and the workload learns them again from its next resolution.

**Wildcards.** `*.example.com` matches `api.example.com` and nothing deeper. One leftmost label is the only wildcard that can be decided precisely from the name a workload asked for, so every other shape is refused at load time, with the reason, on the line that names it: `*`, `api.*.example.com`, `*example.com` and a wildcard directly under a top-level domain such as `*.com`.

**What a rule by name requires.** A rule carrying `fqdn` must `allow`. It cannot also carry `dst_ip` or `dst_alias`, and its selector cannot be `exe`, because an answer is credited to the cgroup whose socket received it and a cgroup can run several executables. The workload also needs a rule letting it reach its resolver on port 53, as in the first rule above, or its queries are refused before they are asked.

### What a rule by name does not see

- **A resolution the agent did not read opens nothing, and the connection is refused.** That covers DNS over HTTPS, DNS over TLS, DNS over TCP, a resolver not listed in `resolvers`, an address written into the application's configuration, and a name resolved by a sidecar or a node-local cache running in another cgroup. An application that bypasses the cluster resolver fails closed rather than being guessed at. Only the first 512 bytes of a UDP answer are read, and whatever a longer answer carries past them opens nothing.
- **An address shared by many names is opened for every one of them.** A content delivery network serves thousands of names from the same addresses, so once `api.psp.example` resolves to one of them, any other site behind that address is reachable from that pod until the grant lapses. The allowance is coarser than the rule reads, and the rule cannot make it finer, because the connection carries an address and not a name.
- **A connection already open outlives its grant.** Only new connections and new datagrams consult it. A long-lived connection keeps running after the address has lapsed.
- **Capacity is bounded.** At most 16384 addresses are open at once across the node. Past that, a new answer is logged and its address stays closed. The kernel copies DNS packets through a ring buffer: a packet that does not fit is counted under `dns_lost` and teaches nothing, which again lands on the closed side.

## Modes

`mode` defaults to `observe`, deliberately. An observing rule counts what it would have refused and lets the syscall through, so the first policy anybody writes cannot take an application offline. Turning a rule to `enforce` changes which counter moves, not how much.

The document is also what loads the programs: a configuration with no workload rule attaches nothing, unless [quarantining](response.md) is turned on, which rides the same programs and loads them on its own. A configuration whose workload rules are in `enforce` mode stops the agent on a host where the hooks did not attach, rather than running on with an enforcement policy that is not being enforced. On a reload, a document that cannot be applied is rejected whole and the rules already in force are left alone.

The same programs carry out the cluster's `NetworkPolicy` when `container.kubernetes.network_policy.mode` asks for it, and that mode loads them on its own as well. A connection then has to be allowed by both: the policy is asked first, then the workload rules. See [Kubernetes NetworkPolicy](../features/network-policy.md).

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

Counters are published under `ebpfsentinel_packets_total{interface="WORKLOAD_METRICS"}`, one slot per hook plus `allowed`, `refused`, `would_refuse`, `unresolved`, `no_rule`, `event_lost` and `dns_lost`, the last being DNS packets the kernel could not hand to the agent. Each denial also increments `ebpfsentinel_workload_denials_total{rule_id, mode}` and raises an alert naming the rule, the workload and the destination. `unresolved` is the task that executed and connected before the policy learned what it was; it is counted rather than hidden.

To see what a given workload may reach, ask the agent rather than reading the document:

```bash
ebpfsentinel-agent firewall reach --exe /usr/bin/curl
ebpfsentinel-agent firewall workload
ebpfsentinel-agent firewall fqdn
```

`firewall fqdn`, and `GET /api/v1/firewall/workload/fqdn` behind it, lists every name each rule by name has resolved, when it was last refreshed and when it lapses, and shows a pattern nothing has resolved as `never resolved` rather than leaving it out: a rule allowing a name nobody resolves is usually a typo, not a quiet success. Under the Kubernetes operator the same reading, summed over every agent the policy selects, is written to the `FirewallPolicy` status.

See the [CLI reference](../cli-reference/index.md) for these commands, and [Socket Attribution](attribution.md) for the hooks that name the task in the first place.
