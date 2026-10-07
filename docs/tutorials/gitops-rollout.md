# Roll a policy out with GitOps, and roll it back

The agent's whole configuration is one file in a git repository. Argo CD keeps
the cluster equal to that repository, so a policy change is a commit, rolling
it out is a push, and rolling it back is `git revert`. Nobody runs a command
against a node, and the history of what every node enforced is the git log.

<video controls preload="metadata" poster="/video/gitops-rollout.jpg" src="/video/gitops-rollout.mp4" width="100%"></video>

Recorded on Linux 7.0 against the [GitOps lab](./index.md#the-lab): a
one-node kind cluster, Argo CD and a git server, all on the one host. Every
output below is what that run printed.

## What it uses

The agent's Helm chart, run as a DaemonSet, one agent per node. Its values
file carries the agent's configuration in `configOverride`, and the chart
stamps a checksum of that configuration on the pod template, so a change to
the policy restarts the agents with it. Argo CD watches the repository, here
every fifteen seconds, and applies what it finds:

```yaml
spec:
  source:
    repoURL: git://git.gitops.svc.cluster.local/estate.git
    targetRevision: main
    path: chart
    helm:
      valueFiles:
        - ../agent.yaml
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

`selfHeal` also puts back a hand edit made in the cluster: the repository is
the only place a change sticks.

## 1. Start the lab

From the `demo/` directory of a checkout, then in a scratch directory:

```bash
./gitops/gitops.sh up
eval "$(./gitops/gitops.sh env)"
DEMO=$PWD; cd "$(mktemp -d)"
git clone -q git://localhost:9418/estate.git && ls estate
```

<!-- rec gitops 0 -->
```text
agent.yaml
chart
```

`chart/` is the agent's chart, vendored and never edited; `agent.yaml` is the
policy. Argo CD has rolled it out:

```bash
kubectl -n argocd get application estate
```

<!-- rec gitops 1 -->
```text
NAME     SYNC STATUS   HEALTH STATUS
estate   Synced        Healthy
```

The policy the lab starts from has no L7 rule:

```bash
kubectl -n ebpfsentinel exec ds/ebpfsentinel -c agent -- ebpfsentinel-agent l7 list
```

<!-- rec gitops 2 -->
```text
No L7 rules configured.
```

## 2. Commit a policy change

The change is the one the [shadow AI tutorial](./shadow-ai.md) runs: two L7
rules on the TLS server name and an automated response that blocks a workload
calling an AI provider.

```bash
cp "$DEMO/gitops/changes/agent.yaml" estate/agent.yaml && git -C estate diff --stat
```

<!-- rec gitops 3 -->
```text
 agent.yaml | 23 +++++++++++++++++++++++
 1 file changed, 23 insertions(+)
```

```bash
git -C estate commit -qam "Cut off workloads calling an AI provider" && git -C estate push -q && git -C estate log --oneline
```

<!-- rec gitops 4 -->
```text
f6b3e53 Cut off workloads calling an AI provider
b625704 Agent on every node, SYN flood mitigation on
```

## 3. Watch it reach the node

Argo CD picks the commit up on its next look at the repository and applies it;
the new configuration changes the pod template's checksum, and the DaemonSet
replaces the agent on every node. In this run that took just under a minute
from the push.

```bash
kubectl -n ebpfsentinel rollout status ds/ebpfsentinel --timeout 3m
kubectl -n ebpfsentinel exec ds/ebpfsentinel -c agent -- ebpfsentinel-agent l7 list
```

<!-- rec gitops 5 -->
```text
Waiting for daemon set "ebpfsentinel" rollout to finish: 0 of 1 updated pods are available...
daemon set "ebpfsentinel" successfully rolled out
```

<!-- rec gitops 6 -->
```text
ID                   PRI  ACTION  SRC IP  DST IP  DST PORT  ENABLED
shadow-ai-openai      10  deny    -       -              -  yes
shadow-ai-anthropic   11  deny    -       -              -  yes

2 rule(s) total.
```

## 4. Roll it back

```bash
git -C estate revert --no-edit HEAD >/dev/null && git -C estate push -q && git -C estate log --oneline
```

<!-- rec gitops 7 -->
```text
1f25355 Revert "Cut off workloads calling an AI provider"
f6b3e53 Cut off workloads calling an AI provider
b625704 Agent on every node, SYN flood mitigation on
```

The revert is a commit like any other, so the history keeps the rule, who
added it and who took it out.

```bash
kubectl -n ebpfsentinel rollout status ds/ebpfsentinel --timeout 3m
kubectl -n ebpfsentinel exec ds/ebpfsentinel -c agent -- ebpfsentinel-agent l7 list
```

<!-- rec gitops 8 -->
```text
Waiting for daemon set "ebpfsentinel" rollout to finish: 0 of 1 updated pods are available...
daemon set "ebpfsentinel" successfully rolled out
```

<!-- rec gitops 9 -->
```text
No L7 rules configured.
```

## Clean up

```bash
"$DEMO/gitops/gitops.sh" down
```

## Going further

- [Kubernetes deployment](../operations/deployment/kubernetes.md): the chart's
  values, the BPF token and what a real node needs.
- [Hot reload](../operations/hot-reload.md): which changes an agent takes
  without a restart.
