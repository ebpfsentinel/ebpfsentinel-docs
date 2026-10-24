# Put a firewall in front of a Docker host

One Docker host, one sitting. At the end of it, a published port answers only
who you said it may, each container carries its own egress policy in its
compose file, containers on one bridge reach only the peers they need, and a
container you name resolves only the names you gave it.

Like [From observation to a deny-by-default policy](./first-policy-from-observation.md),
this runs on **your** host rather than in the [lab](./index.md#the-lab),
because the point is the Docker host you already have. There is no recording:
where output is shown it is the shape the commands print, and yours will
differ in every address.

Allow about an hour and a half, most of it spent letting a learning window
watch the stack.

## Before you start

- The agent runs on the host from the release's compose file, as described on
  the [Docker deployment page](../operations/deployment/docker.md), with the
  Docker socket mounted read-only and `container.docker.enabled: true`.
- `agent.interfaces` names the interface traffic from your network arrives
  on, called `eth0` below.
- You have a second machine on the same network to test from. Traffic sent
  from the host to itself never crosses `eth0`, so it proves nothing about a
  published port.
- `ebpfsentinel-agent <command>` below runs the CLI inside the agent
  container, for example through `docker compose exec agent ebpfsentinel-agent`.

## 1. The published port the host firewall does not see

Publish a port the way everybody does:

```bash
docker run -d --name admin -p 8080:80 nginx:1.27
```

From the second machine, `curl -s -o /dev/null -w '%{http_code}\n' http://<host>:8080`
prints `200`. Now try the rule most people write first, on the host:

```bash
sudo iptables -I INPUT -p tcp --dport 8080 -j DROP
```

The same `curl` still prints `200`. Docker rewrote the packet in `PREROUTING`
and routed it through `FORWARD`; `INPUT` was never on its path. Remove the
rule again with `sudo iptables -D INPUT -p tcp --dport 8080 -j DROP`.

The agent's XDP firewall decides the packet on `eth0`, before netfilter has
touched it, so the packet still carries the published port. Add to the
agent's configuration:

```yaml
firewall:
  enabled: true
  mode: block
  rules:
    - id: no-admin-from-outside
      priority: 10
      action: deny
      protocol: tcp
      dst_port: 8080    # the published port, not the container's 80
```

and reload:

```bash
ebpfsentinel-agent config reload
```

From the second machine, `curl --max-time 3` now gives up with a timeout, and
`ebpfsentinel-agent firewall list` shows `no-admin-from-outside` among the
rules in force. To let one admin workstation through, add an `allow` rule with
its `src_ip` and a lower `priority` number. Remove the `admin` container when
you are done with it: `docker rm -f admin`.

## 2. A stack that carries its own policy

Create the network the rest of this tutorial uses, with an address plan you
choose, so the gateway is known before any container starts:

```bash
docker network create --subnet 172.31.7.0/24 --gateway 172.31.7.1 homelab
```

Turn label policy on beside the enricher and restart the agent, so the
workload firewall's hooks are loaded:

```yaml
container:
  docker:
    enabled: true
    label_policy: true
```

Write a small stack, `compose.yaml`, where each service says what it may
reach:

```yaml
services:
  web:
    image: nginx:1.27
    networks: [homelab]
    labels:
      io.ebpfsentinel.policy.mode: observe
      io.ebpfsentinel.policy.egress.allow: "tcp/443, tcp/5432@172.31.7.0/24"
      io.ebpfsentinel.policy.egress.default: deny
  db:
    image: postgres:17
    networks: [homelab]
    environment:
      POSTGRES_PASSWORD: example
    labels:
      io.ebpfsentinel.policy.mode: observe
      io.ebpfsentinel.policy.egress.default: deny

networks:
  homelab:
    external: true
```

```bash
docker compose up -d
ebpfsentinel-agent firewall labels
ebpfsentinel-agent firewall workload
```

`firewall labels` lists every container whose labels were refused, with the
label and the reason; an empty answer means both were read. `firewall workload`
lists the rules the labels became, selected by container id, each in
`observe` mode with a `DENIALS` count of zero. Leave the stack running for a
while and read the counts again: a closing deny that counted something is the
list being short, and `ebpfsentinel-agent firewall reach --container-name web`
lists every rule naming that container, in the order the kernel walks them. When a container's deny has counted nothing
for a period you trust, change its `io.ebpfsentinel.policy.mode` to `enforce`
and run `docker compose up -d` again. The new labels are followed through the
Docker event stream, with no reload.

## 3. Containers on one bridge stop seeing each other

`web` and `db` are on the same bridge, and Docker lets them reach each other
on every port. A learning window turns what they actually do into a written
segmentation. Open one, give the stack its ordinary traffic, then render it:

```bash
ebpfsentinel-agent learning start -d 3600
# ... use the stack the way it is normally used ...
ebpfsentinel-agent learning stop
ebpfsentinel-agent learning segmentation -f /etc/ebpfsentinel/bridges.yaml
```

The document gives each container the embedded resolver at `127.0.0.11`, the
bridge's gateway and the peers it was seen reaching, `web` to `db` on 5432
here, then refuses the rest of the subnet. A container the window never saw
gets no rule and is named in the header instead. Every rule is in `observe`
mode. Read it, paste its rules into `firewall.rules`, reload, and move each
container's rules to `enforce` once its closing deny has counted nothing, as
in [From observation to a deny-by-default policy](./first-policy-from-observation.md#7-turn-the-deny-on-one-workload-at-a-time).
The [learning mode](../features/learning-mode.md#segmenting-a-docker-bridge)
page says what the document cannot know.

## 4. A container resolves only the names it needs

`web` has no business resolving anything but the API it calls. Make the agent
the resolver on the `homelab` gateway and give `web` its list:

```yaml
dns:
  allowlist:
    enabled: true
    listen: 172.31.7.1:53
    upstream: [1.1.1.1:53, 9.9.9.9:53]
    containers:
      - container: web
        domains: [api.github.com]
```

The resolver is bound when the agent starts, so restart it rather than
reloading. Binding port 53 needs `CAP_NET_BIND_SERVICE`, and the agent refuses
to start if the address cannot be bound. Then point the stack at it, by adding
to each service:

```yaml
    dns: [172.31.7.1]
```

and running `docker compose up -d`. From inside `web`:

```bash
docker compose exec web getent hosts api.github.com   # answers
docker compose exec web getent hosts example.com      # answers nothing
```

The second query was answered `REFUSED` by the agent and never reached an
upstream. It is in the alert stream with the rule id `dns-allowlist:web`:

```bash
ebpfsentinel-agent alerts list
ebpfsentinel-agent metrics | grep dns_allowlist
```

```text
ebpfsentinel_dns_allowlist_queries_total{container="web",verdict="allowed"} 1
ebpfsentinel_dns_allowlist_queries_total{container="web",verdict="refused"} 1
```

`db` is not named in the list, so its queries are forwarded untouched.

A container can ignore the resolver it was given and send queries anywhere,
so close that door with its labels: allow port 53 only towards the embedded
resolver and the agent, and let the default refuse the rest.

```yaml
      io.ebpfsentinel.policy.egress.allow: "tcp/443, tcp/5432@172.31.7.0/24, udp/53@127.0.0.11, tcp/53@127.0.0.11, udp/53@172.31.7.1, tcp/53@172.31.7.1"
      io.ebpfsentinel.policy.egress.default: deny
```

## What this does not do

- **A container on the host network.** It shares the host's sockets and
  addresses, so it has no bridge address for the resolver to recognise and no
  peer to be segmented from; police it with ordinary workload rules naming its
  executable or unit.
- **A name resolved before the list was turned on.** An address a container
  already holds keeps working; the list decides lookups, and the labels decide
  connections.
- **A policy for behaviour that did not happen.** The segmentation document
  is a reading of one window, and what the stack did not do while it was open
  is still yours to add.

## Where to go next

- [Docker deployment](../operations/deployment/docker.md) - every option this tutorial used, in full.
- [DNS configuration](../configuration/dns.md#allowlist) - the allow-list's fields and limits.
- [Workload firewall rules](../configuration/workload-firewall.md) - the rule language labels are translated into.
