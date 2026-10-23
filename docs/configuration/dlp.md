# DLP Configuration

The `dlp` section configures data loss prevention pattern scanning on decrypted SSL/TLS traffic.

## OSS vs paid tiers

In **OSS** mode, built-in patterns are loaded automatically. A `patterns`
entry whose `id` repeats a built-in re-tunes that pattern - a different
regex or severity, or `enabled: false` to switch it off - and the built-ins
it does not name are kept as they are. Any other id, block mode, and
per-pattern mode overrides are rejected at config validation time.

With a licence carrying `advanced-dlp`, which every paid tier has from **Professional** upwards, all fields are available including custom patterns and block mode.

## Cross-container coverage

DLP inspects TLS across every container on the host by attaching a uprobe to each
workload's own `libssl` / BoringSSL. This is configured at the **deployment**
level, not in the `dlp` config block:

| Setting | Where | Purpose |
|---------|-------|---------|
| `/host/proc` (read-only) | Helm + compose volume mount | Host `/proc` the agent reads (the warden reads the same path) |
| `EBPFSENTINEL_HOST_PROC` | Agent env (set to `/host/proc`) | Points DLP discovery at the mounted host proc; defaults to `/proc` |

There is no `hostPID` row. The uprobe is created against a path and a file
offset with `pid = 0`, so it covers every process mapping that library whatever
pid namespace it runs in; sharing the node's pid namespace added the node's
process table to what the pod could see and no coverage, and `baseline` Pod
Security Admission forbids it. The bundled Helm chart and `docker-compose.yml`
mount the procfs for you and set the variable. On bare metal (systemd) the
agent reads the node's own `/proc`, so `EBPFSENTINEL_HOST_PROC` keeps its
`/proc` default and no mount is needed. Coverage is **dynamically-linked
OpenSSL / BoringSSL only**; Go, statically linked OpenSSL or BoringSSL, GnuTLS, wolfSSL,
mbedTLS, s2n-tls and sockets that encrypt in the kernel are Enterprise scope,
Java JSSE and NSS are detected there without being probed, and rustls is not
covered. See the [security model](../architecture/security-model.md#container-dlp-and-host-procfs-visibility)
for what the procfs mount lets the pod read.

Coverage that wide is a choice: on a shared node, set [`dlp.scope`](#scope) to
`workloads` and name the cgroups whose plaintext this agent may read.

## Reference

```yaml
dlp:
  enabled: true              # enable/disable the DLP module
  mode: alert                # alert or block (Professional and above)
  patterns:                  # custom patterns (Professional and above)
    - id: "pattern-id"
      name: "Pattern Name"
      regex: "regex-pattern"
      severity: critical
      data_type: pci
      mode: block            # per-pattern override (Professional and above)
      description: "Description"
      enabled: true
  scope:
    mode: all                # all or workloads; `all` reads every task on the node
    cgroups: []              # cgroup v2 paths, one way to say `workloads`
    selectors: []            # workload rules, the other way
    refresh_seconds: 15      # how often the selectors are resolved again
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the DLP module |
| `mode` | `string` | `alert` | `alert` (detect only) or `block` (Professional and above) |
| `patterns` | `[Pattern]` | `[]` | Patterns folded into the built-in set by `id`. On OSS an entry may only re-tune a built-in; a new id needs Professional or above |
| `scope` | `Scope` | `mode: all` | Which workloads the probes may read plaintext from, enforced in the kernel |

### Scope

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mode` | `string` | No | `all` | `all` reads every task on the node; `workloads` reads only what `cgroups` and `selectors` name |
| `cgroups` | `[string]` | With `workloads` | `[]` | cgroup v2 paths, relative to `container.resolver.cgroup_root`. A path covers everything below it |
| `selectors` | `[Selector]` | With `workloads` | `[]` | Workload rules resolved against what is running and compiled into the same allow-list |
| `refresh_seconds` | `u64` | No | `15` | How often the selectors are resolved again, `1` to `3600` |

`mode` is the default the whole block rests on, and it is written down rather
than left to an empty map: `all` is every task on the node, `workloads` is
nothing but what a cgroup path or a selector names. A selector list under
`mode: all` is refused, so a document that aims the fence has had to say that
everything else is outside it.

A uprobe belongs to a file, not to a container, so one `libssl` layer shared by
every container on the node arms one probe that fires for all of them. On a
single-tenant host that is the point. On a shared node it means the agent reads
a neighbour's plaintext, so `workloads` names the cgroups whose tasks are in
scope and the probe discards every event from anything else, before the
plaintext is copied out of the kernel. Naming a pod slice covers the containers
under it, up to eight levels of ancestry, so container ids that change on
restart never appear in the configuration.

#### Selector

A cgroup path is exact and it changes: a pod that restarts lands under a new
id, and a document naming ids goes stale without saying so. A selector names
the workload instead, in the vocabulary the rest of the agent already uses,
and the agent resolves it against what is actually running on every pass.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `name` | `string` | No | the matchers | What to call this rule in the log, the API and the command line |
| `action` | `string` | No | `include` | `include` reads the workload, `exclude` refuses to whatever else matched it |
| `tenant` | `string` | No | - | Tenant as the enterprise registry knows it. The open source agent resolves no tenant, so the rule matches nothing there and says so |
| `namespace` | `string` | No | - | Kubernetes namespace, as the pod metadata enricher read it |
| `pod` | `string` | No | - | Pod name |
| `container` | `string` | No | - | Container id, an id prefix of at least twelve characters, or the name the runtime gave it |
| `cgroup` | `string` | No | - | Absolute cgroup v2 path, matching it and everything under it |
| `unit` | `string` | No | - | systemd unit, such as `nginx.service`, compared exactly |
| `exe` | `string` | No | - | Absolute path of the executable, compared exactly |

A rule needs at least one matcher, and the matchers it carries narrow
together: `namespace: payments` with `container: api` is the `api` container
of that namespace and nothing else. Exclusions are evaluated first, so
`action: exclude` on one pod of a selected namespace keeps that pod unread
whatever else matched it. At most 64 selectors may be named on one node.

An `exe` matcher is weaker than it looks, and for two reasons stated here
rather than discovered later: a path names the binary and not the bytes
behind it, and the kernel fence is keyed on the cgroup the task sits in, so
the scope it buys is only as narrow as that cgroup.

A rule that resolves to no workload at load time is **reported** rather than
ignored - on the agent's log, on `GET /api/v1/dlp/scope`, in
`ebpfsentinel-agent dlp scope` and on the dashboard's DLP screen - because a
typo in a pod name switches DLP off for that workload and nothing else on the
system says so. The report names the rule, the matchers it carries and why
nothing matched.

`refresh_seconds` is the width of the window in which a newly selected
workload is not yet inspected: a pod that starts between two passes is read
from the pass that sees it and not before. Lower it on a node whose workloads
churn, and keep in mind that each pass walks the cgroup tree.

The agent refuses to start on `mode: workloads` with an empty `cgroups` list -
that pair would arm the probes and drop every event, which reads on a dashboard
as DLP being on while nothing is inspected - and equally on `mode: all` with
cgroups listed, which would silently ignore them. Events the scope discards are
counted as `out_of_scope` on the `DLP_METRICS` counter, so a scope that is too
narrow is visible rather than quiet. At most 4096 cgroups may be named on one
node.

What the probes read right now is readable rather than inferred:

```bash
ebpfsentinel-agent dlp scope
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" \
  http://localhost:8080/api/v1/dlp/scope
```

Both answer with the workloads in scope and the rule that put each one there,
the workloads a rule took out, the rules that matched nothing, and how many
workloads the agent saw that no rule named. That is the effective scope, not
the configured one, which is the difference between a document and a fence.

### Pattern

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | Yes | - | Unique identifier. OSS only accepts built-in prefixes (`dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`) |
| `name` | `string` | Yes | - | Human-readable pattern name |
| `regex` | `string` | Yes | - | Regex pattern (validated with ReDoS protection limits) |
| `severity` | `string` | Yes | - | `low`, `medium`, `high`, or `critical` |
| `data_type` | `string` | Yes | - | Category: `pci`, `pii`, `credentials`, or custom |
| `mode` | `string` | No | inherits global | Per-pattern mode override (`alert` or `block`, Professional and above) |
| `description` | `string` | No | `""` | Human-readable description |
| `enabled` | `bool` | No | `true` | Enable or disable this specific pattern |

## Built-in Patterns (OSS)

The OSS edition ships with 17 built-in patterns that are always loaded. A
national identifier is reported only when its check digit or issuance rule
confirms the match:

| ID | Name | Category | Severity |
|----|------|----------|----------|
| `dlp-pci-visa` | Visa Card Number | PCI | Critical |
| `dlp-pci-mastercard` | Mastercard Number | PCI | Critical |
| `dlp-pci-amex` | American Express Number | PCI | Critical |
| `dlp-pii-email` | Email Address | PII | Medium |
| `dlp-pii-ssn` | US Social Security Number | PII | Critical |
| `dlp-pii-fr-nir` | French Social Security Number (NIR) | PII | Critical |
| `dlp-pii-uk-nino` | UK National Insurance Number | PII | Critical |
| `dlp-pii-es-dni` | Spanish DNI / NIE | PII | Critical |
| `dlp-pii-it-cf` | Italian Codice Fiscale | PII | Critical |
| `dlp-pii-be-nrn` | Belgian National Register Number | PII | Critical |
| `dlp-pii-ca-sin` | Canadian Social Insurance Number | PII | Critical |
| `dlp-pii-br-cpf` | Brazilian CPF | PII | Critical |
| `dlp-pii-in-aadhaar` | Indian Aadhaar Number | PII | Critical |
| `dlp-cred-aws-key` | AWS Access Key | Credentials | Critical |
| `dlp-cred-github-token` | GitHub Personal Access Token | Credentials | Critical |
| `dlp-cred-password` | Generic Password | Credentials | High |
| `dlp-cred-bearer` | Bearer Token | Credentials | High |

## Examples

### Minimal OSS configuration

```yaml
dlp:
  enabled: true
```

Built-in patterns are loaded automatically. No patterns section needed.

### Switch one built-in pattern off (OSS)

```yaml
dlp:
  enabled: true
  patterns:
    - id: dlp-pii-email          # the id of the built-in to re-tune
      name: Email Address
      regex: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b"
      severity: medium
      data_type: pii
      enabled: false             # too noisy on this host
```

The other sixteen built-ins stay loaded exactly as they ship.

### Disable DLP

```yaml
dlp:
  enabled: false
```

### Aim the fence at two workloads on a shared node

```yaml
dlp:
  enabled: true
  mode: alert
  scope:
    mode: workloads
    refresh_seconds: 15
    selectors:
      # Everything this namespace runs, whatever ids its pods take on
      # restart.
      - name: payments
        namespace: payments
      # One host service, named by its unit rather than its cgroup path.
      - name: billing-host
        unit: billing.service
      # The sidecar whose plaintext nobody is to read, out whatever
      # selected it.
      - name: no-vault
        action: exclude
        container: vault-agent
```

Every other task on the node is out of scope, which is what `mode: workloads`
says. Check it from the node:

```bash
ebpfsentinel-agent dlp scope
```

### Professional and above: PCI-DSS credit card detection with block mode

```yaml
dlp:
  mode: block
  patterns:
    - id: dlp-pci-visa
      name: Visa Card Number
      regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      data_type: pci
      description: "Visa card number"
    - id: dlp-pci-mastercard
      name: Mastercard Number
      regex: "\\b5[1-5][0-9]{14}\\b"
      severity: critical
      data_type: pci
      description: "Mastercard number"
    - id: dlp-pci-amex
      name: Amex Card Number
      regex: "\\b3[47][0-9]{13}\\b"
      severity: critical
      data_type: pci
      description: "American Express number"
```

### Professional and above: Mixed mode with per-pattern override

```yaml
dlp:
  mode: alert
  patterns:
    - id: dlp-pci-visa
      name: Visa Card Number
      regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      data_type: pci
      mode: block              # block credit cards even though global is alert
    - id: dlp-pii-email
      name: Email Address
      regex: "\\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}\\b"
      severity: medium
      data_type: pii
      # inherits global alert mode
    - id: internal-project-code
      name: Internal Project Code
      regex: "PRJ-[A-Z]{3}-\\d{6}"
      severity: high
      data_type: custom
      mode: block
      description: "Internal project identifier leak"
```

## Validation Rules

- Pattern `id` must not be empty
- Pattern `name` must not be empty
- Pattern `regex` must not be empty and must compile (with ReDoS prevention limits: 10 MiB size limit, 200 nesting depth)
- Pattern `data_type` must not be empty
- Pattern `severity` must be one of: `low`, `medium`, `high`, `critical`
- Pattern `mode` (if set) must be `alert` or `block`
- **OSS only**: pattern IDs must start with `dlp-pci-`, `dlp-pii-`, or `dlp-cred-`
- **OSS only**: global `mode` must be `alert`
- **OSS only**: per-pattern `mode` override cannot be `block`
