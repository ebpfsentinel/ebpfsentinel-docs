# Fleet Management

> **Edition: Enterprise**

## Overview

REST API for fleet-wide agent management. Provides agent registration with persistent identity, heartbeat with live rule/config aggregation, identity introspection, config version tracking, and network flow graph visualization. Designed for consumption by K8s operators, Ansible, Terraform, or any fleet management tool.

Gated by the `FleetManagement` license feature.

## Endpoints

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `POST` | `/api/v1/agent/register` | operator | fleet-management | Register agent, get UUIDv7 identity + token. |
| `POST` | `/api/v1/agent/heartbeat` | operator | fleet-management | Report status, receive aggregated health. |
| `GET` | `/api/v1/agent/identity` | viewer | fleet-management | Full agent identity with capabilities. |
| `GET` | `/api/v1/agent/config/version` | viewer | fleet-management | Config SHA-256 hash, when it was applied, whether the file has moved since. |
| `GET` | `/api/v1/agent/addresses?epoch=&since=` | viewer | fleet-management | This node's addresses and the pod, container, guest or host behind each, as what changed since the reader's last answer. |
| `GET` | `/api/v1/agent/remote-identities?address=` | viewer | fleet-management | The peer list this node holds: its version, its age, and the entry for one address. |
| `PUT` | `/api/v1/agent/remote-identities` | operator | fleet-management | Replace the peer list whole; refused whole when any entry is wrong. |
| `GET` | `/api/v1/flows/graph` | viewer | fleet-management | Network flow graph from conntrack data. |
| `GET` | `/api/v1/flows/reachability` | viewer | fleet-management | SBOMs held and workloads observed, with how many components each report reached. |
| `GET` | `/api/v1/flows/reachability/report?workload=` | viewer | fleet-management | One workload's SBOM joined with the flows it originated. |
| `PUT` | `/api/v1/flows/reachability/sbom?workload=` | operator | fleet-management | Keep a CycloneDX or SPDX JSON document as the SBOM of a workload. |
| `DELETE` | `/api/v1/flows/reachability/sbom?workload=` | operator | fleet-management | Forget the SBOM of a workload. |
| `GET` | `/api/v1/flows/reachability/scanner-reports` | viewer | fleet-management | The scanner reports held, each counted against the packages installed now. |
| `GET` | `/api/v1/flows/reachability/scanner-reports/report?name=` | viewer | fleet-management | One scanner report, each finding joined with the installed package it names or the reason it is not. |
| `GET` | `/api/v1/flows/reachability/scanner-reports/evidence?name=` | viewer | fleet-management | The evidence pack of one scanner report, digested and chained into the custody log. |
| `PUT` | `/api/v1/flows/reachability/scanner-reports?name=` | operator | fleet-management | Keep a CycloneDX, SPDX, Trivy, Grype or Harbor JSON report under a name. |
| `DELETE` | `/api/v1/flows/reachability/scanner-reports?name=` | operator | fleet-management | Forget a scanner report. |
| `GET` | `/api/v1/exposure/listeners` | viewer | fleet-management | The sockets this node accepts traffic on, classed against the firewall and the connections accepted. |
| `GET` | `/api/v1/firewall/workload/peers` | viewer | fleet-management | The rules naming a remote workload and which ends decide each. |
| `GET` | `/api/v1/firewall/shadow` | viewer | fleet-management | What each firewall rule in shadow mode would have done. |
| `POST` | `/api/v1/firewall/shadow/{id}/promote` | operator | fleet-management | Put one shadow rule in force, on the reading it was decided on. |
| `GET` | `/api/v1/file-watch/baselines` | viewer | fleet-management | What this node keeps of its watched files, for the console to compare across the fleet. |
| `GET` | `/api/v1/host-rules` | viewer | fleet-management | The loaded host rules and, for a rule in shadow, what it would have done. |
| `GET` | `/api/v1/host-rules/intents` | viewer | fleet-management | What a host rule may name, and which of it this host serves. |
| `POST` | `/api/v1/host-rules/{id}/promote` | operator | fleet-management | Put one host rule in shadow in force, on the reading it was decided on. |

### What authenticates what

Two different credentials are in play, and neither substitutes for the other.

| Credential | Where it travels | Which routes require it |
|------------|------------------|-------------------------|
| The API credential (`Authorization: Bearer <token>` or `X-API-Key: <key>`) | HTTP header | Every one of them, whenever `auth.enabled: true` |
| The agent token minted by registration | The `token` field of the heartbeat request body | `POST /api/v1/agent/heartbeat` only |

With `auth.enabled: true` these endpoints require the API credential like every
other enterprise endpoint, registration included: enrolment is not a bootstrap
exemption, so provision the fleet credential before the first `register` call.

The agent token is a second, narrower proof, and it is checked on the heartbeat
alone. It is what distinguishes this agent from anything else holding the same
API credential, so a fleet-wide read credential cannot be used to heartbeat as a
named node. `agent_id` is not a credential and is never treated as one: it is
returned by `GET /api/v1/agent/identity` and it appears in the log lines the
fleet writes.

The other routes carry no per-agent proof, because none of them asserts an
identity: `register` mints the first token and so cannot require one, while
`identity`, `addresses`, `config/version`, `flows/graph` and the reachability routes act on
this agent's own state for whoever already holds the API credential.

## Agent Registration

**POST** `/api/v1/agent/register`

Registers the agent and returns a persistent identity. Idempotent: re-registering with the same `name` updates labels/endpoint but preserves the `agent_id` and `token`.

### Request

```json
{
  "name": "prod-node-01",
  "labels": {
    "env": "production",
    "region": "eu-west-1",
    "cluster": "k8s-main"
  },
  "api_endpoint": "https://10.0.1.5:8443",
  "tls_fingerprint": "sha256:a1b2c3..."
}
```

Only `name` is required. All other fields are optional.

### Response

```json
{
  "agent_id": "019538a2-7f3b-7def-8123-456789abcdef",
  "name": "prod-node-01",
  "registered_at": 1709913600,
  "token": "e3b0c44298fc1c149afbf4c8996fb924..."
}
```

- `agent_id`: UUIDv7 (time-ordered, globally unique). Not a secret: it is published by `GET /api/v1/agent/identity`
- `token`: 32 random bytes as 64 lowercase hex characters, read from the operating system's random source. It is what the heartbeat is held to, it relates to nothing else the agent publishes, and it is returned exactly once per registration, so store it when you receive it
- `registered_at`: Unix epoch seconds

The token is not derived from `agent_id`, `registered_at` or any other field this
API returns. An agent upgraded from a build that did derive it replaces the
stored token with a random one the first time it starts, once, and logs that it
did; a fleet manager holding the old value gets 401 on the next heartbeat and
must register again to obtain the new one.

### Idempotency

| Scenario | Behavior |
|----------|----------|
| Same `name` | Updates labels/endpoint/capabilities, keeps `agent_id` + `token` |
| Different `name` | Creates new identity (replaces previous) |
| Empty `name` | Returns 400 Bad Request |

### Capability Auto-Detection

On registration, the agent reads its own configuration and reports the sections it has enabled. A capability is claimed when its section carries `enabled: true`, so the list answers what this agent runs rather than what the product offers, and two agents on the same fleet report different lists.

One capability per OSS domain: `firewall`, `ids`, `ips`, `l7`, `ratelimit`, `threatintel`, `conntrack`, `ddos`, `dlp`, `nat`, `loadbalancer`, `qos`, `dns`.

An agent running only a firewall and DNS inspection reports two:

```json
{ "capabilities": ["firewall", "dns"] }
```

An agent with every section disabled reports an empty list. That is a working agent inspecting nothing, and it is meant to be visible as such.

### Identity Persistence

When `data_dir` is configured, the agent writes `agent-identity.json` to disk after each registration. On startup, the persisted identity is loaded so the agent retains its `agent_id` and its token across restarts.

```
{data_dir}/agent-identity.json
```

The file holds the token, so it is a credential file and is written like one:
mode `0600`, and `0700` on the directory when the agent is the one that created
it. A `data_dir` the operator laid out keeps the mode the operator chose, so
check it if you provision that directory yourself. The write goes to a temporary
file beside the target and is renamed into place, so a machine losing power
mid-write comes back with the previous identity rather than with half of the new
one.

## Agent Heartbeat

**POST** `/api/v1/agent/heartbeat`

Aggregates live agent status in < 5 ms (all in-memory reads).

### Request

```json
{
  "agent_id": "019538a2-7f3b-7def-8123-456789abcdef",
  "token": "9f2a4c81d0e75b3648af1c9e2d05b7a3c48e1f60b92d7a5c3e08f14b6d29a7c5"
}
```

Both fields are required. `token` is the value registration returned.

### Response

```json
{
  "status": "healthy",
  "uptime_seconds": 86400,
  "ebpf_loaded": true,
  "active_rules": {
    "firewall": 42,
    "ids": 15,
    "ips": 8,
    "l7": 12,
    "ratelimit": 5
  },
  "metrics_snapshot": {
    "packets_total": 0,
    "alerts_total": 0,
    "cpu_percent": 0.0,
    "memory_bytes": 0
  },
  "agent_version": "0.0.0-dev",
  "config_version": "a1b2c3d4e5f6...",
  "pending_changes": false
}
```

- `status`: The agent's health, judged over its datapath
- `active_rules`: Live rule counts from each domain engine (firewall, IDS, IPS, L7, ratelimit)
- `config_version`: SHA-256 hex of the serialized YAML configuration the running datapath was built from
- `metrics_snapshot`: Reserved for future enrichment (Prometheus metrics are write-only; scrape `/metrics` for live counters)
- `pending_changes`: Whether the configuration file on disk has been edited since that datapath was built

Returns 401 with `{"error": "agent identifier or token not recognised"}` when the
identifier is not the registered one, when the token is not the one registration
handed back, or when no token was sent at all. One message covers all three, so a
caller learns nothing from which of them it got wrong.

### Health

`status` is one of three words, and it is a judgement over the datapath rather than over the HTTP surface: an agent answering this request while nothing is attached is exactly the failure the word exists to make visible.

| `status` | What it means |
|----------|---------------|
| `healthy` | The datapath is loaded and every program that reported a state is attached |
| `degraded` | The datapath is loaded and at least one program is not attached. The agent is protecting part of what it was asked to protect |
| `unhealthy` | No datapath. The agent is answering requests and inspecting nothing |

A node whose NAT programs failed to attach reports:

```json
{
  "status": "degraded",
  "ebpf_loaded": true
}
```

A node that came up with no datapath at all reports:

```json
{
  "status": "unhealthy",
  "ebpf_loaded": false
}
```

## Agent Identity

**GET** `/api/v1/agent/identity`

Full introspection of the registered agent.

### Response

```json
{
  "agent_id": "019538a2-7f3b-7def-8123-456789abcdef",
  "name": "prod-node-01",
  "labels": { "env": "production" },
  "api_endpoint": "https://10.0.1.5:8443",
  "agent_version": "0.0.0-dev",
  "enterprise": true,
  "capabilities": ["firewall", "ids", "conntrack", "nat", "dns"],
  "ebpf_programs": [
    { "name": "tc-conntrack", "loaded": true },
    { "name": "tc-dns", "loaded": true },
    { "name": "tc-ids", "loaded": true },
    { "name": "tc-nat-egress", "loaded": true },
    { "name": "tc-nat-ingress", "loaded": false },
    { "name": "xdp-firewall", "loaded": true }
  ],
  "tls": {
    "enabled": true,
    "pq_mode": "Prefer"
  },
  "registered_at": 1709913600,
  "uptime_seconds": 86400,
  "operator_managed": true,
  "operator_endpoint": "https://operator.internal"
}
```

- `enterprise`: Always `true` for enterprise agents
- `ebpf_programs`: The programs this agent attempted to load, each with its own load state, sorted by name
- `tls.pq_mode`: Post-quantum key exchange mode, as the agent was configured: `Prefer`, `Require` or `Disable`. See [Post-Quantum TLS](../pq-tls.md)
- `operator_managed`: Whether a Kubernetes operator owns this agent's configuration. This is the only route that says so, and a console that edits a configuration the operator reconciles is writing a change the next reconcile undoes
- `operator_endpoint`: Where that operator's own console is, when it publishes one. Absent from the answer rather than `null` when it does not

Each entry carries that program's own state, so a node whose NAT ingress program was rejected while its firewall attached reports `tc-nat-ingress: false` beside `xdp-firewall: true`, and the heartbeat above it reports `degraded`.

The list is what the datapath registered rather than a fixed catalogue: a program this build never attempted is absent rather than reported as `false`, and an agent that loaded nothing returns an empty list. The same states are readable per program on `/metrics` as `ebpfsentinel_ebpf_program_status`, under the same names, for the programs the configuration asks for: a feature turned off publishes no series there, so a zero on the gauge is always a load that was refused, while this list keeps answering for the program.

Returns 404 if the agent has not been registered.

## Config Version

**GET** `/api/v1/agent/config/version`

Lightweight endpoint (< 100 bytes response) for config drift detection.

### Response

```json
{
  "config_version": "a1b2c3d4e5f6...",
  "last_reload": 1709913600,
  "pending_changes": false
}
```

- `config_version`: SHA-256 hex of the serialized YAML configuration the running datapath was built from
- `last_reload`: Unix epoch of when that configuration was applied, which is startup
- `pending_changes`: Whether the configuration file on disk has been edited since

`pending_changes` means the same thing here as it does on the heartbeat, and both routes compute it the one way: the file named by `--config` is loaded at the moment you ask, and its hash compared with the one being enforced. It is `false` on a freshly started agent, and `false` again for a file that no longer parses, because a configuration this agent would refuse is not a change waiting to be applied.

The hash is taken over the configuration the file parses to rather than over its bytes, so reformatting it or adding a comment is not drift.

The enterprise agent applies its configuration once, at startup: unlike the OSS agent it has no file watcher, no `SIGHUP` reload and no `/api/v1/config/reload` route, so `pending_changes: true` means a restart is outstanding rather than a reload.

Fleet managers can poll this endpoint to detect config drift across agents by comparing `config_version` hashes.

## Node Addresses

**GET** `/api/v1/agent/addresses?epoch=&since=`

A flow carries its workload on the node that opened it, and the node at the
other end sees an address. This endpoint is the half that names a node's
addresses for the rest of the fleet: each address the node holds, with the
pod, the container, the virtual machine or the host behind it. It is read on
demand from the process table and from the network namespaces its processes
sit in, so it needs `process_table.enabled` (the default) and, in a
container, the host's procfs mounted where `EBPFSENTINEL_HOST_PROC` points.
Without either the answer is `503` with the reason.

The list is versioned. A reader passes back the `epoch` and `version` of its
last answer and is told what changed since: `removed` first, then `upserts`.
An answer with `full: true` replaces what the reader held, which is what a
first reading, a restarted agent (a new `epoch`) and a reader too far behind
are all handed. Removals are what keep a remote node from naming a workload
that has gone: a pod deleted and its address handed to another is a removal
followed by an upsert, never a stale name.

### Response

```json
{
  "epoch": 1793012345678901234,
  "version": 42,
  "full": false,
  "upserts": [
    {
      "address": "10.244.1.17",
      "kind": "pod",
      "pod": "checkout-7d9f",
      "namespace": "shop",
      "service_account": "checkout",
      "pod_labels": { "app": "checkout" },
      "namespace_labels": { "kubernetes.io/metadata.name": "shop" }
    },
    {
      "address": "10.0.1.5",
      "kind": "host",
      "services": [
        { "protocol": "tcp", "port": 5432, "unit": "postgresql.service", "exe": "/usr/lib/postgresql/16/bin/postgres" }
      ]
    }
  ],
  "removed": ["10.244.1.9"],
  "conflicts": 0
}
```

| `kind` | What holds the address |
|---|---|
| `pod` | A Kubernetes pod; its containers share the address, so it is named once, by the pod |
| `container` | A container with a network namespace of its own, by its runtime name and image, or by its id |
| `guest` | A KubeVirt virtual machine, through its launcher pod |
| `host` | The node itself; a process on the host network shares the node's addresses, so a systemd unit or a host-network pod is named on the ports it listens on, under `services` |

### What is left out

- **Addresses nobody off the node can reach**: loopback, link-local,
  multicast and the unspecified address.
- **An address two workloads hold.** Two containers that are not one pod
  sharing a namespace, or a container holding an address the host holds too,
  is an address the node cannot attribute. It names neither and counts it in
  `conflicts`, because naming one of the two would hand a remote policy the
  wrong workload.
- **Guests of libvirt and Proxmox.** The host holds no record binding a
  guest's address to its device; the guest's own traffic carries it, which
  is a reading rather than a fact the node owns. Only KubeVirt guests, whose
  address is their launcher pod's, are named.

## Peer Addresses

**GET** `/api/v1/agent/remote-identities?address=`
**PUT** `/api/v1/agent/remote-identities`

A node names only its own workloads. What another node holds reaches it
through the console: every thirty seconds the dashboard reads each node's
addresses, keeps each tenant's lists apart, and hands every node the
addresses of the other nodes of its own tenant, each labelled with the node
that reported it. Nothing travels between nodes directly, and no overlay
or CNI is involved: the list rides the same authenticated channel as every
other write the console makes.

The node keeps the last list it was handed, with its version and the time
it arrived. A node that loses the console keeps that list and says how old
it is under `age_seconds`; it never fills a gap itself, so an address no
list names stays unnamed rather than being guessed. The console hands a new
list only when its version differs from the one the node reports, the
version being a digest of the sorted entries.

```json
{
  "version": "5d0f9c2a41b7e8f6a3c1d4e9b2f7a6c0",
  "received_at": "2026-11-01T10:12:40Z",
  "age_seconds": 12,
  "entries": 418,
  "conflicts": 1,
  "entry": {
    "node": "worker-3",
    "address": "10.244.3.17",
    "kind": "pod",
    "pod": "checkout-7d9f",
    "namespace": "shop",
    "service_account": "checkout",
    "pod_labels": { "app": "checkout" },
    "namespace_labels": { "kubernetes.io/metadata.name": "shop" }
  }
}
```

`entry` is present only when `?address=` names an address the list holds;
an entry carries the [node address](#node-addresses) fields plus `node`.
Before the first list, `version`, `received_at` and `age_seconds` are absent
and `entries` is `0`.

A list is taken whole or refused whole with `422`, so a node never holds
half of one:

- a list with no version;
- more than 65,536 entries;
- the same address twice;
- an address nobody off a node can reach (loopback, link-local, multicast,
  unspecified).

An address two nodes of one tenant both claim is in neither node's entries:
the console names it to nobody and counts it in `conflicts`, for the same
reason a node leaves out an address two of its own workloads hold. A node
whose licence does not carry `fleet-management` serves neither route and is
not asked.

## Rules on Remote Workloads

**GET** `/api/v1/firewall/workload/peers`

A workload firewall rule may name its destination by the workload on another node, under `workload.peer`, and the peer list above is what turns that name into addresses. The tables are written again within five seconds of a new list or a reload, and emptied while the node holds none.

```json
{
  "loaded": true,
  "list_version": "5d0f9c2a41b7e8f6a3c1d4e9b2f7a6c0",
  "destinations": 37,
  "sources": 12,
  "refused": 0,
  "rules": [
    { "rule": "allow-api-to-db", "decided_at": "both" },
    {
      "rule": "deny-curl-to-db",
      "decided_at": "source",
      "source_only_reason": "the source is named by exe, which no address carries"
    }
  ]
}
```

`both` means the node a TCP connection arrives at decides it too, against the source address; `source` means only the node it leaves can, and says why. **Behind a source NAT the destination cannot know**: a connection arriving from a translated address names a host and no workload, so the destination refuses nothing and the rule holds at the source alone. The rules, the limits and the same-node case are in [Workload Firewall Rules](../../configuration/workload-firewall.md#destinations-by-remote-workload).

The same list names the other end of a flow. A connection, an exported flow and an alert whose remote address is on another node carry a `peer` half in their workload block - node, kind, pod, namespace and the rest of what that node published - led by `source: remote_list` and the list version, so a name the console relayed is never read as one the kernel saw. The fields are in [the workload block](../../api-reference/rest-api.md#the-workload-block).

## Network Flow Graph

**GET** `/api/v1/flows/graph`

Builds a directed graph of network flows from connection tracking data.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `max_nodes` | usize | 500 | Maximum number of IP nodes in the graph |
| `min_bytes` | u64 | none | Minimum total bytes (fwd + rev) per connection |
| `protocol` | u8 | none | Filter by IP protocol (6 = TCP, 17 = UDP) |
| `limit` | usize | 10000 | Maximum connections to read from conntrack |

### Response

```json
{
  "nodes": [
    { "ip": "10.0.1.5", "bytes": 1500000, "flows": 42 },
    { "ip": "10.0.2.10", "bytes": 800000, "flows": 15 }
  ],
  "edges": [
    {
      "src": "10.0.1.5",
      "dst": "10.0.2.10",
      "protocol": 6,
      "bytes": 1500000,
      "flows": 42
    }
  ]
}
```

### Graph Construction

1. Connections are read from the conntrack table (up to `limit`)
2. Filtered by `protocol` and `min_bytes` if specified
3. Aggregated by `(src_ip, dst_ip, protocol)` - multiple connections between the same pair are merged
4. Sorted by bytes descending
5. Capped at `max_nodes` unique IPs (edges requiring new IPs beyond the cap are dropped)

Nodes and edges are both sorted by bytes descending.

An edge says how much and how often and never since when: the conntrack table
it is folded from reports counters and a state and no moment a flow started or
was last seen at, so the graph carries no instant at all.

## SBOM Reachability

An SBOM lists every package an image carries, and most of them never do
anything on the network. The reachability report joins the SBOM of one workload
with the outbound flows observed from that workload, so the components that
correspond to observed activity are told apart from the ones that do not.

The report is a **correlation**, and it says so in its own `limits` field: it
shows that an executable the SBOM attributes to a component originated a flow,
never that a package opened a socket. A library loaded into that executable is
reached only through it, and the report cannot tell which library of the process
made the call.

### Uploading an SBOM

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  --data-binary @checkout.cdx.json \
  "http://localhost:8444/api/v1/flows/reachability/sbom?workload=payments/checkout"
```

- **Formats**: CycloneDX JSON (`bomFormat: "CycloneDX"`) and SPDX JSON
  (`spdxVersion: "SPDX-2.x"`), detected from the document. Anything else is a
  `400`.
- **Size**: at most 32 MiB and 50 000 components; components past the cap are
  counted in `components_dropped` rather than kept.
- **Workload name**: the name the rest of the agent gives the workload -
  `namespace/controller` on Kubernetes, then the systemd unit, the image name or
  the executable's file name. The overview lists the names flows were observed
  under, so the right one can be read off it before uploading.
- **Persistence**: each document is kept under `<fleet data_dir>/sbom/` (or
  `/var/lib/ebpfsentinel/sbom/` without one), `0600` inside a `0700` directory,
  and reloaded at start. A document the parser refuses on reload is logged and
  left on disk.

Uploading again replaces the previous document. `DELETE` forgets it.

### How flows are observed

Every 10 seconds the agent reads the connection table and keeps the TCP and UDP
flows a local process originated, each with the workload and the executable path
of that process. A flow this host accepted is left out, because its remote end
is a client rather than a destination. A flow no local process could be found
for is counted as `unattributed_flows` and never joined. The ledger is bounded:
4 096 workloads, 256 executables per workload and 64 destinations per executable,
with anything past a cap counted rather than kept.

A flow shorter than the sampling interval can open and close between two reads,
so a component reported `not_observed` was not seen, which is not the same as
proven unreachable.

### How a component is joined

| Join | When | Confidence |
|------|------|------------|
| `file_path` | The SBOM lists a file of the component (CycloneDX `evidence.occurrences`, Syft `syft:location` properties, SPDX `hasFiles` or `CONTAINS`) at the path of an executable that originated a flow | `high` when the process identity was read from the kernel, `medium` otherwise |
| `executable_name` | The component lists no file, and its name matches the executable's file name | `medium` when the identity was read, `low` otherwise |

Executables that originated flows and match no component are listed under
`unmatched_executables`: a binary the SBOM does not account for is itself worth
reading.

### Which ecosystems it covers

Every ecosystem the SBOM generator listed, because the components come from
the document and not from the node: a Node module, a Python package, a jar or
a Rust crate is in the report when the generator found it. What the node
contributes is the executable that took or made traffic, so such a component
joins only through a file the SBOM lists at an executable's path, or by
its name; a Python package or a Node module is loaded by an interpreter and
joins through no executable of its own, and a Rust crate is linked into a
binary that a generator names only when it was built with `cargo auditable`.
What the agent reads from the node by itself, without an SBOM, is on
[Installed Packages](../installed-packages.md#ecosystems-not-covered).

### What a component listens on

The same report says which components take traffic in, not only which ones
send it out. Each component carries `listens_on`: every socket an executable
joined to it listens on, read from the node's
[listening socket inventory](../listening-sockets.md) and joined by the same
rule as the flows, so a file the SBOM lists at the path of a listening
executable ties that socket to the component. Each entry carries the
`address`, the `port`, the `protocol` and its `exposure` class -
`exposed_used`, `exposed_unused`, `exposed_unmeasured`, `closed_by_policy` or
`loopback_only` - as the inventory classed it against the firewall and the
connections accepted.

A component with an `exposed_unused` socket ships a listener the firewall lets
the network reach and nobody has used since the hooks attached: the package
with that executable is surface without a purpose, which is usually the first
one to take out of the image. The list is empty when the socket hooks are not
attached, because the inventory then knows nothing, and it names only the
sockets bound since they attached.

The agent serves the inventory itself at `GET /api/v1/exposure/listeners`, in
the same body as the open source agent, so one query answers in the same words
whichever edition a node runs.

### Report fields

| Field | Meaning |
|-------|---------|
| `components_total`, `components_with_files`, `components_reached` | How many components the SBOM holds, how many list a file, how many were joined to a flow |
| `workload_observed`, `observed_since_ns` | Whether any flow was seen from this workload, and since when |
| `components[]` | Per component: `status` (`reached` or `not_observed`), `join`, `confidence`, `identity`, the `executables` and `destinations` it was joined through, `last_seen_ns`, and `listens_on` |
| `unmatched_executables[]` | Executables that originated flows and match no component |
| `limits[]` | What the report cannot say, written into the answer itself |

### Importing your scanner's report

The agent holds no vulnerability database and fetches no feed. What it reads is
the report your own scanner already wrote, and it answers which of those
findings name a package this host has installed.

```bash
trivy image --format json -o app.trivy.json registry.example/app:1.4
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  --data-binary @app.trivy.json \
  "http://localhost:8444/api/v1/flows/reachability/scanner-reports?name=registry.example/app:1.4"
```

- **Formats**, detected from the document: CycloneDX JSON carrying a
  `vulnerabilities` section, SPDX 2 JSON whose packages carry
  `SECURITY`/`advisory` references, and the native JSON of Trivy
  (`--format json`), Grype (`-o json`) and Harbor (the vulnerability report
  its API returns). A CycloneDX or SPDX document with no vulnerability at all
  is an SBOM rather than a scan, and is refused with a `400` naming the SBOM
  route instead.
- **Size**: at most 64 MiB and 200 000 findings; findings past the cap are
  counted in `findings_past_cap`. The same vulnerability listed twice for the
  same package, as Trivy does once per target, is kept once and counted in
  `duplicates`.
- **Persistence**: under `<fleet data_dir>/scanner-reports/` beside the SBOMs,
  with the same modes, reloaded at start.

Nothing is dropped silently. A record of the report that cannot become a
finding is listed in `dropped[]` with its reason:

| `reason` | The record |
|----------|------------|
| `no_vulnerability_id` | names no vulnerability identifier |
| `no_package_identity` | names no package: no name and no package URL |
| `unknown_component` | points at a component the document does not define |

And each finding that cannot be joined to an installed package says why, in
`mapping.unmapped[]`:

| `reason` | What it means, and what to do |
|----------|-------------------------------|
| `inventory_not_read` | The agent has not read its packages yet, or `package_inventory` is turned off. |
| `ecosystem_not_read` | The package belongs to an ecosystem the agent keeps no inventory of, such as npm or PyPI; see [the ecosystems not covered](../installed-packages.md#ecosystems-not-covered). |
| `not_installed` | No package of that name is installed in any root the agent read: the report may describe another image. |
| `version_not_installed` | The package is installed at another version, listed in `installed_versions`: the report may be older than the host. |

A finding joined to a package lists where it is installed in
`mapping.mapped[].installed[]`: the root (the host or a container), the
database that lists it (`dpkg`, `rpm`, `apk`) or `go` with the program built
from the module, and the version the host has. An epoch written on one side
only is not a difference, since scanners and package URLs often leave it off.
The severity and the fixed version are the scanner's own words, carried
unchanged: the agent computes neither.

#### What the host shows about each package

Each entry of `installed[]` carries six `facts`, read off the same package
inventory and the node's listening sockets at the moment the report is
asked for. Each is `yes`, `no` or `not_read`, with a `because` sentence
naming what it was read off, so an operator who disagrees with an order built
on them can see exactly where:

| Fact | `yes` when |
|------|------------|
| `runs` | A live process runs a program the package installs. A library mapped by somebody else's program is `no` here and `yes` below. |
| `mapped` | A live process maps a file the package installs, in the root it is installed in, at the version the finding names. |
| `listens` | One of the processes mapping it accepts traffic on a socket. |
| `received_traffic` | One of those sockets accepted a TCP connection since the hooks attached. A UDP socket's use is not counted, and says so as `not_read`. |
| `reachable_from_outside` | The packet firewall lets a source outside the private ranges reach one of those sockets. A socket open to the private ranges only is `no`, and the reason says east-west. |
| `blocked_by_policy` | The firewall drops every packet bound for every one of those sockets. |

Beside them are the evidence: the processes mapping the package, the files of
it they map, and every socket of theirs with who may reach it and how many
connections it accepted. Where the socket hooks are not attached, the four
socket facts are `not_read` rather than `no`, because nothing was looked at.
For a Go module the process is the program built from it.

#### The order, and why each finding is where it is

The report's `ranking` puts the joined findings in order without a score. A
single number is what a security team learns to distrust, and it cannot
defend a long report shrinking to a short one in a review; a reason per
position can. Each finding is first given a `standing`, read off the facts of
the most urgent of its installations:

| `standing` | The facts |
|------------|-----------|
| `exposed_and_used` | It listens, a socket is open to sources outside the private ranges, the policy does not close it, and it took traffic. |
| `exposed` | The same, with no traffic counted. |
| `east_west` | It listens, on the private ranges or the loopback only. |
| `mapped_sockets_not_read` | It is mapped and the socket hooks are not attached. |
| `undetermined` | What the processes map was not read. |
| `mapped_not_listening` | It is mapped and nothing mapping it listens. |
| `closed_by_policy` | It listens and the policy drops everything bound for it. |
| `not_mapped` | No live process maps a file of it. |

Inside a standing the order is the scanner's own severity word, then a
running program before a library only mapped, then the identifier. Each
entry's `reasons` say which of those placed it: the standing with the fact it
rests on (a finding moved down because its library is never mapped says
`moved down: no live process maps a file libxml2 installs`), then what put it
below the finding before it. `standings` counts the findings in each, so the
reduction from what the scanner listed to what is exposed and used is read
off the report itself. What is not known ranks above what is known to be
quiet, never below it.

#### What moved since the last reading

A standing is true on the day it was read, and an estate changes faster than
a scan cadence. Every five minutes the agent reads the facts of every held
report again and compares them with the reading before; the report's `drift`
lists what moved, newest first, each change with the finding, the package,
what moved (`joined`, `standing`, or one of the six facts) and its value
before and after:

- a library never mapped that a new release now loads: `mapped` from `no` to
  `yes`, and its standing leaves `not_mapped`;
- a port that opened: `listens` from `no` to `yes`;
- a policy that stopped blocking: `blocked_by_policy` from `yes` to `no`, and
  the standing leaves `closed_by_policy`;
- a package installed, removed or moved to another version: `joined`, with
  no value on the side where the finding named nothing installed.

The first reading after an upload or a restart is the baseline and records
nothing; uploading a report under the same name starts over. At most 4,096
changes are kept per report, and `changes_let_go` counts the older ones let
go.

#### The evidence pack

`GET /api/v1/flows/reachability/scanner-reports/evidence?name=` answers what
an auditor is handed for vulnerability management: PCI DSS 4.0 6.3 and 11.3,
NIS2 article 21(2)(e), DORA article 8 and ISO/IEC 27001:2022 A.8.8, each
named with what the pack shows towards it and what it does not. The pack
holds two statements and never mixes them:

- `asserted` is what the customer's scanner said, as it said it: the format,
  the tool and the subject the report names, when it was uploaded, the
  SHA-256 of the file as uploaded (so the auditor matches the file they hold
  with the one ranked), how many findings it listed and how many records were
  not read. The agent checked none of it.
- `observed` is what the agent read on this host: when the packages were
  read, the count per standing, each joined finding in its order with its
  reasons and its six facts (each `yes`, `no` or `not_read`, with the reason
  in words), and each finding the host does not account for with why.

The agent does not scan. 11.3 says so in the pack itself: the periodic scans
are the external scanner's, and what the agent adds is which of its findings
run, listen and are reachable. `evidence_sha256` is SHA-256 over the pack's
compact JSON with `evidence_sha256` and `custody` left out, computed the way
a compliance report's is (see
[Evidence digest and custody](compliance-reports.md#evidence-digest-and-custody)).
When the forensics custody log is kept, every pack handed out is chained into
it as a `report` entry named `scanner-evidence:<name>`, and `custody` gives
the entry's position and tag; without the log, or when the entry could not
be written, the pack carries no `custody` rather than an invented one.

### In the dashboard

The dashboard's **Package reachability** screen, shown when the licence carries
`fleet-management`, lists every workload each agent observed beside the SBOM
that agent holds for it, and counts the workloads no SBOM describes. Opening a
workload shows its report with the reached components first, the executables no
component names, and the report's `limits` printed as the agent wrote them. A
member holding the right to push agent configuration can hand a CycloneDX or
SPDX JSON file to one agent for one workload, or take it back; the document is
proxied to that agent alone, because the flows it is joined with are that
agent's. Each reached component lists the sockets it listens on beside the
destinations it reached, with their exposure class.

The **Exposure** screen, under the same licence feature, reads the inventory of
every agent in scope: one row per listening socket with its node, its workload,
its class, what decided whether the network reaches it and how many connections
it accepted, the reachable sockets nobody used listed first, and the nodes whose
socket hooks are not attached named rather than counted as closed. Below it, the
changes since a date the reader picks: what opened, what closed and what changed
class, node by node, between the first day kept on or after that date and the
latest. The dashboard server reads every agent once an hour and keeps one
reading a day per node for 456 days in its history store, so the comparison
needs that store; without it the screen says so. A node read on only one of the
two days is named as not compared rather than shown as having opened or closed
everything.

## Putting a Shadow Rule in Force

A firewall rule in shadow mode decides nothing: it counts what it would have
done beside what the rules in force did (see
[Shadow rules](../firewall.md#shadow-rules)). This edition adds the step after
the reading: putting one of those rules in force on the node that was read.

`GET /api/v1/firewall/shadow` answers the same body as the open source agent.
`POST /api/v1/firewall/shadow/{id}/promote` takes the start of the reading the
decision was made on:

```json
{ "counting_since_ns": 1789990000000000000 }
```

The rule is switched to `enforce` in the running rule set only if that reading
is still the current one. The counters restart whenever the set of shadow
rules changes, so a decision taken on an older reading is refused with `409`
and the reason, and the reader reads again. The value is compared to within
one microsecond, because a browser holds this nanosecond count as a double and
rounds its last digits. A rule already in force or disabled is also `409`; an
id no rule carries is `404`.

The answer names the rule, its new mode, the reading it was decided on and
that reading's counts:

```json
{
  "rule_id": "block-legacy-smb",
  "mode": "enforce",
  "counting_since_ns": 1789990000000000000,
  "reading": { "rule_id": "block-legacy-smb", "would": "deny", "packets": 1240, "flows": 18,
               "changed_packets": 310, "changed_flows": 4, "...": "..." }
}
```

Every promotion writes one line to the audit log as a rule update, naming who
promoted it and on what evidence:

```text
firewall: shadow rule 'block-legacy-smb' promoted to enforce by alice on a reading of 1240 packets over 18 flows, 310 packets and 4 flows the rules in force decided otherwise, counting since 1789990000000000000 ns
```

A rule that held no datapath slot counted nothing, and the line says so rather
than presenting its zeros as a clean reading.

**The promotion changes the running rule set, not the configuration file.** A
rule that came from the file returns to shadow mode the next time the file is
loaded, unless the file says `mode: enforce`. Change the file in the same
change window, or through whatever produces it.

### In the dashboard

The **Firewall** screen, once a host is chosen, lists that host's shadow rules
below the rules in force. Each one carries one word before its numbers: it
would change traffic, it agrees with the rules in force, it has matched
nothing yet, or it holds no datapath slot and counts nothing. The rules that
would change traffic come first, and the sampled flows are listed with the
verdict the rules in force gave them, the ones the shadow rule would decide
otherwise marked. A member holding the right to push agent configuration can
put a rule in force; the screen asks twice, the second time saying what the
rule will do, and sends the reading on screen so a stale one is refused by the
agent rather than applied. The request is proxied to that one agent only. With
the whole estate selected the panel asks for a host, because shadow counters
are one machine's traffic.

## Putting a Host Rule in Force

A [host rule](../host-rules.md) in shadow raises nothing and stops nothing: it
counts the events it would have acted on, per workload it would have hit. This
edition runs the process table and the host rules on every node, whatever its
place in a high-availability pair, and adds the same step after the reading as
for the firewall.

`GET /api/v1/host-rules` and `GET /api/v1/host-rules/intents` answer the same
bodies as the open source agent. The intentions served by the socket
inventory and the two hidden sweeps, `packet_socket.appears`, `port.hidden`
and `process.hidden`, are reported as not served here, because this edition
does not run them.
`POST /api/v1/host-rules/{id}/promote` takes the start of the reading the
decision was made on, `shadow_since_ns` from the list:

```json
{ "shadow_since_ns": 1789990000000000000 }
```

The readings start with the agent and do not restart while it runs, so the
value is compared to within one microsecond and anything further is a reading
of an earlier run, refused with `409`. A rule already in force is also `409`,
and an id no rule carries is `404`. A rule whose `then` holds `kill_process` is
refused with `409` on an agent that cannot stop a process, which is every
enterprise agent today, rather than put in force to raise alerts promising an
action nothing takes.

The answer names the rule, its new mode and the reading it was decided on:

```json
{
  "rule_id": "shipped-shell-from-web-server",
  "mode": "enforce",
  "shadow_since_ns": 1789990000000000000,
  "reading": { "events": 3, "workloads": [{ "workload": "web-7f9c", "events": 3 }], "unsampled": 0 }
}
```

From then on the rule raises an alert for each match, stored beside the
datapath's at `GET /api/v1/alerts`. Every promotion writes one line to the
audit log as a rule update:

```text
host rules: shadow rule 'shipped-shell-from-web-server' promoted to enforce by alice on a reading of 3 events (web-7f9c 3; 0 more not sampled by workload), reading since 1789990000000000000 ns
```

**The promotion changes the running rules, not the configuration file**, and
is not kept across a restart: the rule is in shadow again the next time the
agent starts, unless the file says `mode: enforce`.

## Firewall Policy in Tiers

One firewall list sorted by priority is enough for one team. When a platform
team decides some rules for every node and each node keeps rules of its own,
the two need an order that holds whatever priorities either side picks.
`enterprise.firewall_tiers` gives the rules that order: a tier is a named list
of rules, the tiers are evaluated in the order they are written, and inside a
tier the rules are evaluated by their own priority. The first rule that
matches decides, as before.

Each tier ends one of three ways:

| `end` | What a packet no rule of the tier matched does |
|-------|------------------------------------------------|
| `pass` (default) | Goes on to the next tier |
| `allow` | Is allowed; no later tier sees it |
| `deny` | Is dropped; no later tier sees it |

The community `firewall.rules` list is the tier named `default`. Name it in the
list to place it; leave it out and it comes last. It takes no rules and no
`end` in this block: its rules are the ones under `firewall.rules` and it
passes what they do not match. Traffic every tier passed meets
`firewall.default_policy`, as it always did. With no tier configured the
rules are not touched, so an estate that never names a tier sees no change.

```yaml
enterprise:
  firewall_tiers:
    - name: platform
      end: pass
      rules:
        - id: deny-known-bad-range
          priority: 10
          action: deny
          protocol: any
          src_ip: 203.0.113.0/24
    - name: default
    - name: quarantine
      end: deny
      rules:
        - id: allow-dns
          priority: 10
          action: allow
          protocol: udp
          dst_port: 53
```

Here `deny-known-bad-range` is evaluated before every rule of the node's own
list, whatever priority those carry, and anything the node's list and the
quarantine tier both left undecided is dropped by the quarantine tier's end
rather than by the default policy.

### How the order reaches the datapath

The datapath walks one list in priority order, and the tiers are compiled into
that list when the configuration is loaded rather than evaluated in the
kernel. Tier `n`, counted from zero, adds `n x 10000000` to the priority of
each of its rules, so the first tier's rules keep the priorities they were
written with, and a tier ending in `allow` or `deny` becomes one more rule
matching every packet at the bottom of its band, with the id
`tier-end-<name>` and the priority `(n + 1) x 10000000 - 1`. The verdicts are
the ones a walk tier by tier would give. Those are the priorities and ids the
REST API, the CLI and the dashboard show for the running rules.

### Validation

The tiers are refused as a whole, which stops the agent at startup and leaves
the running rules in place on a reload, when:

- a name is not 1 to 48 lowercase letters, digits or inner hyphens, or is used twice;
- more than 16 tiers are named, `default` counted whether it is named or not;
- the `default` tier is given rules or an `end`;
- a rule priority inside a tier is outside 1 to 9999998;
- a rule id is used twice across the tiers and `firewall.rules`, or takes the `tier-end-<name>` id of a tier that ends in `allow` or `deny`.

The block is read again from the configuration file on every reload, beside the
rules it orders. Without the `fleet-management` licence feature the tiers are
ignored with a warning and the rules are evaluated as one list.

### The provider tier

A service provider running a customer's estate holds the tier named `provider`.
It is evaluated before every other tier, so no rule the customer writes reaches
a packet it decided, and only the role named in its `owner_role` may change it:

```yaml
enterprise:
  firewall_tiers:
    - name: provider
      owner_role: mssp-provider
      end: pass
      rules:
        - id: deny-tor-exits
          priority: 10
          action: deny
          protocol: any
          src_ip: 198.51.100.0/24
    - name: default
```

The tier is refused, which stops the agent at startup and leaves the running
rules in place on a reload, when it is not written first, when it names no
`owner_role`, or when another tier names one. It needs the `multi-tenancy`
licence feature beside `fleet-management`: a provider tier on a licence without
it is refused rather than ignored, because an estate that loaded the provider's
rules as the customer's own would let the customer change them.

The fence covers every write that could change the tier: adding or replacing a
rule (`POST /api/v1/firewall/rules`) whose id is one of the tier's or whose
priority falls in its band, deleting one of its rules
(`DELETE /api/v1/firewall/rules/{id}`), and promoting a shadow rule into it
(`POST /api/v1/firewall/shadow/{id}/promote`). The caller must hold the owner
role itself: the customer's administrator holds a role above it and is still
refused, and so is a request carrying no identity. A refusal is a `403` whose
body names the code `PROVIDER_TIER`. Reading is not fenced, and the customer's
console marks each of the tier's rules as the provider's.

`GET /api/v1/firewall/tiers` lists the tiers the agent runs, in evaluation
order, with the priority band each one holds, the ids of its rules and whether
it is the provider's. It is served when the `fleet-management` licence feature
is held.

On Kubernetes the operator carries the same tiers: `EnterpriseSettings` declares
them in `firewallTiers` (`name`, `end`, `ownerRole`) and a `FirewallPolicy` places
its rules in one through `tier`. A rule naming a tier nothing declared is refused
when the configuration is rendered, and admission refuses a `FirewallPolicy`
naming the `provider` tier in a namespace a `TenantPolicy` holds, since that is a
customer's namespace.

## File Drift Across the Fleet

Each node lists, at `GET /api/v1/file-watch/baselines`, the fingerprint of
every file it keeps beneath its watched paths: kind, content digest, link
target, permission bits, owner and group, and the digest of each extended
attribute. Never a byte of content, and never the size, time, device or inode,
which differ between hosts holding the same file. A node keeping more than
10000 says so with `truncated`.

The dashboard asks every node of a tenant and groups the answers by path, on its own
`/api/v1/{tenant}/file-watch/drift` route. A path every node that answered holds
alike is agreed; a path held two ways, or held on some nodes and absent on
others, is divergent, and the answer names the nodes holding each fingerprint.
Where one fingerprint is held by more than half the nodes that listed their
files, it is what the fleet expects, and those together form the expected
state, written in the shape a node lists its own. A node whose file watch is
off, or that did not answer, is named and not counted.

The File drift screen shows the divergent paths and saves the expected state
as `expected-baselines.json`. Handed back to a node through
[`enterprise.file_watch.expected_baselines`](../../configuration/file-watch.md#across-a-fleet),
a path that node has never kept is compared against the fleet on first sight
rather than learned, so a host joining with a tampered file says so instead of
taking the tampered file as its baseline.

The comparison is done in the console the customer runs, from the nodes the
customer runs: no fingerprint leaves the estate.

## Configuration

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  fleet:
    enabled: true
    data_dir: /var/lib/ebpfsentinel/fleet
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | bool | `false` | Enable fleet management endpoints |
| `data_dir` | string | none | Directory for persisting agent identity (optional) |

### Validation

- `data_dir` cannot be an empty string when set (rejected at startup)
- Directory is created automatically if it does not exist

## Prometheus Metrics

All fleet operations are instrumented under the `ebpfsentinel_ent_` prefix:

| Metric | Type | Description |
|--------|------|-------------|
| `ebpfsentinel_ent_fleet_registrations_total` | Counter | Agent registrations processed |
| `ebpfsentinel_ent_fleet_heartbeats_total` | Counter | Agent heartbeats received |
| `ebpfsentinel_ent_fleet_identity_queries_total` | Counter | Identity queries served |
| `ebpfsentinel_ent_fleet_config_version_queries_total` | Counter | Config version queries served |
| `ebpfsentinel_ent_fleet_flow_graph_queries_total` | Counter | Flow graph queries served |

## Domain Architecture

```
enterprise-domain/src/fleet/
├── mod.rs          # Module declaration
├── entity.rs       # DTOs: RegistrationRequest, HeartbeatResponse, FlowGraph, etc.
├── engine.rs       # FleetEngine: registration, idempotency, config hashing
├── error.rs        # FleetError: NotRegistered, NotAuthenticated, InvalidRequest
├── flow_graph.rs   # FlowGraphBuilder: connection aggregation + graph construction
└── report.rs       # Capability and AgentHealth: what an agent claims to run and how the datapath judges it
```

The handler (`enterprise-adapters/src/http/fleet_handler.rs`) bridges domain logic with OSS `ServiceHandles` for live rule counts and conntrack data.

## Integration Patterns

### Ansible / Terraform

```bash
# Register, keeping both halves of the answer: the token is returned once
curl -X POST http://agent:8444/api/v1/agent/register \
  -H "X-API-Key: $EBPFSENTINEL_API_KEY" \
  -d '{"name":"node-01","labels":{"env":"prod"}}' \
  | jq -r '.agent_id, .token' > /etc/ebpfsentinel/fleet-identity

# Heartbeat (cron every 30s)
curl -X POST http://agent:8444/api/v1/agent/heartbeat \
  -H "X-API-Key: $EBPFSENTINEL_API_KEY" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"token\":\"${AGENT_TOKEN}\"}"

# Config drift check
curl -H "X-API-Key: $EBPFSENTINEL_API_KEY" \
  http://agent:8444/api/v1/agent/config/version
```

### Kubernetes Operator

A controller watching `EBPFSentinelAgent` CRDs uses the three routes as:
1. `/api/v1/agent/register` on pod creation, storing the returned token in a `Secret`
2. `/api/v1/agent/heartbeat` on a timer, reading that token back. Not a liveness probe: a probe carries no request body, so it can present no token and would be refused
3. `/api/v1/agent/config/version` to detect config drift and trigger rolling updates
