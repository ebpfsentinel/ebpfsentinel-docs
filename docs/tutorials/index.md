---
slug: /tutorials
---

# Tutorials

Five scenarios, each run end to end on one Linux host you control, with
nothing to sign up for. The first four were run as written against the lab
in the agent repository, every output shown is what they printed, and each
of those pages carries the recording of that run. The fifth runs on your own
host rather than in the lab, because a policy learned from a machine nobody
documented is the whole point of it, so its outputs are the shape the
commands print rather than a recording of yours.

| Tutorial | What you watch happen | Lab |
|---|---|---|
| [Stop a SYN flood](./ddos.md) | A flood detected in the kernel, its source blocked by an automated response, the block in the audit trail | Compose |
| [Catch a card number inside TLS](./dlp-over-tls.md) | A payment card read off OpenSSL before encryption, alerted on and audited | Compose |
| [Cut off a workload calling an AI provider](./shadow-ai.md) | A TLS handshake naming an AI provider denied, the workload blocked for two minutes | Compose |
| [Roll a rule out through GitOps](./gitops-rollout.md) | A policy change committed, synced to the cluster by Argo CD, and reverted the same way | kind + Argo CD |
| [From observation to a deny-by-default policy](./first-policy-from-observation.md) | A window watching one host, the allow-list it writes, and each workload turned to enforce once its deny has counted nothing | Your own host |

## The lab

The lab is published with the release, like every other artifact, and that
is where you fetch it from:

```bash
curl -fsSLO https://github.com/ebpfsentinel/ebpfsentinel-release/releases/latest/download/ebpfsentinel-demo.tar.gz
tar xzf ebpfsentinel-demo.tar.gz && cd ebpfsentinel-demo
```

It is pinned to the release it came from, and its checksum and signature are
in that release's `SHA256SUMS`. The same lab is `demo/` in a checkout of the
agent repository, where `sudo ./demo.sh up --local` runs it against an agent
built from your working tree instead of the published image.

The host needs Linux 6.9 or later with BTF (`/sys/kernel/btf/vmlinux`),
Docker with the compose plugin, and on Ubuntu 24.04 and later unprivileged
user namespaces allowed for the session:

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
```

`demo.sh` checks all three before starting anything and names what is
missing. The Compose lab puts the agent on a bridge of its own,
`esdemo0` on `172.30.66.0/24`, so nothing it does touches the host's uplink:

| Container | Address | Role |
|---|---|---|
| `agent`, `warden` | host network | the published images: the rootless agent and its broker |
| `target` | `172.30.66.1` | the protected service, HTTP on 80 and HTTPS on 443 |
| `attacker` | `172.30.66.66` | sends the flood |
| `app` | `172.30.66.20` | a workload speaking TLS through OpenSSL |

`sudo ./demo.sh agent <command>` runs `ebpfsentinel-agent <command>` inside
the agent container, so everything after `agent` is the CLI documented in the
[CLI reference](../cli-reference/). The configuration every Compose scenario
reads is `demo/agent.yaml`, unchanged between them.

The GitOps lab is a one-node [kind](https://kind.sigs.k8s.io/) cluster on the
same host, with Argo CD and a git server inside it:

```bash
./gitops/gitops.sh up
eval "$(./gitops/gitops.sh env)"
```

It needs `git` and `curl` beside Docker.
`kind`, `kubectl`, `helm` and the Argo CD manifest are downloaded into
`demo/gitops/.run/` at pinned versions and checked against their published
SHA-256 before they run, so nothing is installed on the host;
`./gitops/gitops.sh down` deletes the cluster and that directory. `env`
prints the two exports, `PATH` and `KUBECONFIG`, that point the shell at them.
