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
| `hostPID: true` / `pid: host` | Helm `daemonset.hostPID`, compose | Lets the agent see every node process to resolve their libraries |
| `/host/proc` (read-only) | Helm + compose volume mount | Host `/proc` the agent reads (the warden reads the same path) |
| `EBPFSENTINEL_HOST_PROC` | Agent env (set to `/host/proc`) | Points DLP discovery at the mounted host proc; defaults to `/proc` |

The bundled Helm chart and `docker-compose.yml` set these for you. On bare metal
(systemd) the agent already shares the host PID namespace, so `EBPFSENTINEL_HOST_PROC`
keeps its `/proc` default and no mount is needed. Coverage is **dynamically-linked
OpenSSL / BoringSSL only**; Go, statically linked BoringSSL, GnuTLS, wolfSSL,
mbedTLS, s2n-tls and sockets that encrypt in the kernel are Enterprise scope,
Java JSSE and NSS are detected there without being probed, and rustls is not
covered. See the [security model](../architecture/security-model.md#container-dlp-and-host-pid-visibility)
for the `hostPID` trust trade-off.

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
    mode: all                # all or workloads
    cgroups: []              # cgroup v2 paths, required by `workloads`
```

## Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | `bool` | `true` | Enable or disable the DLP module |
| `mode` | `string` | `alert` | `alert` (detect only) or `block` (Professional and above) |
| `patterns` | `[Pattern]` | `[]` | Patterns folded into the built-in set by `id`. On OSS an entry may only re-tune a built-in; a new id needs Professional or above |
| `scope` | `Scope` | `mode: all` | Which cgroups the probes may read plaintext from, enforced in the kernel |

### Scope

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `mode` | `string` | No | `all` | `all` reads every task on the node; `workloads` reads only the tasks under `cgroups` |
| `cgroups` | `[string]` | With `workloads` | `[]` | cgroup v2 paths, relative to `container.resolver.cgroup_root`. A path covers everything below it |

A uprobe belongs to a file, not to a container, so one `libssl` layer shared by
every container on the node arms one probe that fires for all of them. On a
single-tenant host that is the point. On a shared node it means the agent reads
a neighbour's plaintext, so `workloads` names the cgroups whose tasks are in
scope and the probe discards every event from anything else, before the
plaintext is copied out of the kernel. Naming a pod slice covers the containers
under it, up to eight levels of ancestry, so container ids that change on
restart never appear in the configuration.

The agent refuses to start on `mode: workloads` with an empty `cgroups` list -
that pair would arm the probes and drop every event, which reads on a dashboard
as DLP being on while nothing is inspected - and equally on `mode: all` with
cgroups listed, which would silently ignore them. Events the scope discards are
counted as `out_of_scope` on the `DLP_METRICS` counter, so a scope that is too
narrow is visible rather than quiet. At most 4096 cgroups may be named on one
node.

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
