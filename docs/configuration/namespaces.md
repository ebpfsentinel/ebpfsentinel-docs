# Namespaces Configuration

The `namespaces` section binds each eBPFsentinel namespace to the addresses its
workloads use. A namespace is an ownership label: an `operator` identity whose
`namespaces` claim holds it may write firewall rules scoped to it (see
[Authentication](../features/authentication.md)). The label alone does not
narrow what a rule matches, since one interface carries several namespaces, so
this section is what keeps an operator's rule on their own traffic.

## Reference

```yaml
namespaces:
  prod:
    cidrs: ["10.1.0.0/16", "fd00:1::/64"]
  staging:
    cidrs: ["10.2.0.0/16"]
```

## Fields

Each entry under `namespaces` is a namespace name mapped to its configuration:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cidrs` | list | required | IPv4 or IPv6 CIDRs the namespace owns. At least one |

Namespace names follow the rule of a `namespace:` scope: 1-63 characters,
lowercase alphanumeric plus `-`. A bad name, an empty list or a CIDR that does
not parse fails the configuration load.

## What an operator may write

When an `operator` creates a rule with `scope: { namespace: <name> }` through
the API, the agent refuses it with `403 NAMESPACE_TRAFFIC_FORBIDDEN` unless:

- the namespace is declared here, and
- the rule's `src_ip` or `dst_ip` is a literal CIDR that sits inside one of
  the namespace's `cidrs`.

A negated side (`negate_src`, `negate_dst`) matches everything outside its
address, and an alias side is resolved later from a set the operator does not
own, so neither counts as bounding the rule. A rule with no address at all
would match the whole node and is refused.

The `admin` role is not bound by this section, and neither are rules written in
the configuration file, since whoever edits the file already holds the node.
Deleting a rule needs no address check: the namespace claim is enough.
