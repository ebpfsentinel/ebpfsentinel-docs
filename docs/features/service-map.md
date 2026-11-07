# Service Map

> **Edition: OSS** | **Enforcement: Userspace** | **Domain: l7**

## What it shows

Who called whom, read off the same requests the
[per-service metrics](red-metrics.md) count. One edge per client, server,
server port and protocol, carrying its request count, its errors, its
unanswered requests and the summed duration of the answered ones. An end is a
named service when its process runs on the node, and its address otherwise.

Each edge says which side the agent saw it from: `server` when the server runs
on the node, `client` when only the client does, and `transit` when the
request merely crossed it.

## One example

```bash
ebpfsentinel-agent flows services            # last 15 minutes
ebpfsentinel-agent flows services -m 60 -o json
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" \
  "http://localhost:8080/api/v1/services/graph?minutes=5"
```

A reading covers 1 to 60 one-minute buckets. Each minute holds at most 4,096
distinct edges, and a request whose edge does not fit is counted in `dropped`,
so a reading says how much it is missing.

## Across the fleet

The dashboard's **Service map** screen asks every agent in scope for its graph
and merges the answers, counting a call seen by two agents once. How the merge
ranks the readings is in
[Across the fleet](l7-firewall.md#across-the-fleet).

## Configuration

None of its own: the map is built from what the L7 capture inspects, configured
in [L7 configuration](../configuration/l7.md). The command is
[`flows services`](../cli-reference/index.md#flows-services).
