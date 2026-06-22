# Data Loss Prevention (DLP)

> **Edition: OSS (core) + Enterprise (advanced)** | **eBPF Program: uprobe-dlp**

## Overview

DLP scans decrypted network traffic for sensitive data patterns — credit card numbers, Social Security Numbers, API keys, JWTs, and more. The `uprobe-dlp` eBPF program attaches to SSL/TLS library functions to capture plaintext before encryption, forwarding it to the userspace DLP engine for pattern matching.

## How It Works

1. **Per-container discovery** — TLS plaintext only exists inside a userspace
   `libssl` / BoringSSL, and a uprobe fires only for processes mapping that exact
   inode. So the agent parses `/proc/<pid>/maps` for every process on the host,
   finds each SSL library, and deduplicates by `(device, inode)` — pods of the
   same image share one overlayfs lower layer, so a single probe covers them all.
2. **uprobe attachment** — the `uprobe-dlp` program is attached to `SSL_write` /
   `SSL_read` (entry + return) once per unique library inode, so the agent sees
   **every container's** TLS, not only its own.
3. **Lifecycle tracking** — a watcher re-scans periodically, attaching to
   libraries newly mapped by appearing containers and detaching a library's
   probes once no process maps it any more.
4. **Plaintext capture** — decrypted payload bytes are emitted via RingBuf to
   userspace.
5. **Pattern matching** — the DLP engine evaluates the payload against the
   configured regex patterns.
6. **Source attribution** — the captured event's `cgroup_id` is resolved to the
   originating container / pod, so the alert names the workload that leaked.
7. **Alert generation** — matches produce alerts with the pattern ID, severity,
   redacted context, and container provenance.

DLP is **userspace-only** for pattern matching — there is no eBPF map synchronization needed (unlike IDS/IPS where rules are pushed to kernel maps).

In the rootless deployment the agent runs `cap-drop: ALL`, so the privileged
uprobe attach (reading a neighbouring container's `/proc/<pid>/root` and creating
the BPF link) is brokered to the **warden** sidecar, which returns the link
descriptor over the control socket. See the
[security model](../architecture/security-model.md#container-dlp-and-host-pid-visibility)
for the `hostPID` / `/host/proc` requirements this entails.

All regex patterns (built-in and enterprise custom) are **pre-compiled at config load** with safety limits to prevent ReDoS:

- **10 MiB** maximum compiled regex size
- **200** maximum nesting depth
- **4 KiB** maximum regex source length per pattern

## OSS vs Enterprise

The DLP module is available in both editions, with the following differences:

| Capability | OSS | Enterprise |
|------------|:---:|:----------:|
| Built-in patterns (PCI, PII, credentials) | Yes | Yes |
| Custom regex patterns | No | Yes |
| Alert mode (detect & report) | Yes | Yes |
| Block mode (detect & drop) | No | Yes |
| Per-pattern mode override | No | Yes |
| Hot-reload of custom patterns | No | Yes |
| Enable/disable toggle | Yes | Yes |

### Built-in Patterns (OSS)

The OSS edition ships with **9 built-in patterns** across 3 categories, covering the most common data loss scenarios:

| Category | Prefix | Patterns |
|----------|--------|----------|
| **PCI** (Payment Card) | `dlp-pci-*` | Visa, Mastercard, Amex card numbers |
| **PII** (Personal Info) | `dlp-pii-*` | SSN, email addresses, phone numbers |
| **Credentials** | `dlp-cred-*` | AWS keys, API keys, JWT tokens |

These patterns are always loaded at startup and cannot be removed. They operate in **alert mode only**.

### Enterprise Patterns

With the `enterprise` feature, organizations can:

- Define **custom regex patterns** with arbitrary IDs
- Use **block mode** to actively drop connections leaking sensitive data
- Override the global mode on a **per-pattern basis** (e.g., alert for emails, block for credit cards)
- **Hot-reload** pattern changes without restarting the agent

See [Enterprise DLP](enterprise/dlp.md) for details.

## Container-Aware DLP

The agent inspects TLS across **every container on the host**, not only its own
process. It resolves each workload's `libssl` / BoringSSL through the host
`/proc`, attaches a uprobe per unique library inode (deduplicated so same-image
pods share one probe set), and tracks containers as they appear and disappear.

When the container resolver is enabled (see
[Container Awareness](container-awareness.md)), every DLP alert is
automatically enriched with the workload that produced the leak:

- `container` — runtime (`docker`/`containerd`/`crio`/`podman`) and
  canonical container id resolved from the event's `cgroup_id`
- `container_metadata` — Docker image + labels (Docker enricher) or
  pod name, namespace, labels, service account, and owner reference
  (Kubernetes enricher)

For Kubernetes deployments this means DLP alerts carry the pod and
namespace that leaked the data — no manual IP-to-workload correlation
required downstream. SIEM exports, the gRPC alert stream, the REST API,
and the audit trail all carry the enrichment.

### Coverage and limits

The OSS agent covers **dynamically-linked OpenSSL and BoringSSL** (`libssl.so`,
`libboringssl.so`) across all containers. The deployment must share the host PID
namespace and mount the host `/proc` so the agent can resolve neighbouring
containers' libraries — see the
[security model](../architecture/security-model.md#container-dlp-and-host-pid-visibility).

Out of scope for OSS:

- **Statically-linked TLS runtimes** — Go (`crypto/tls`), Rust (rustls), Java
  (JSSE), or proxies that link BoringSSL statically — export no `libssl` symbol
  to probe. Per-runtime symbol resolution is an **Enterprise** extension.
- **kTLS kernel-offloaded sockets** — plaintext lives kernel-side, a separate
  hook path.

## Configuration

### OSS Configuration

In OSS mode, DLP configuration is limited to enabling/disabling the module:

```yaml
dlp:
  enabled: true    # default: true
  mode: alert      # only alert is supported in OSS
```

Built-in patterns are loaded automatically and do not need to be listed in the configuration file. Any attempt to add custom patterns or set `mode: block` in OSS will be rejected at startup with a validation error.

### Enterprise Configuration

```yaml
dlp:
  enabled: true
  mode: alert            # alert or block (global default)
  patterns:
    - id: dlp-pci-custom-visa
      name: Custom Visa
      regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
      severity: critical
      data_type: pci
      description: "Visa card number"
    - id: internal-project-code
      name: Internal Project Code
      regex: "PRJ-[A-Z]{3}-\\d{6}"
      severity: high
      data_type: custom
      mode: block          # per-pattern override
      description: "Internal project code leak"
```

See [Configuration: DLP](../configuration/dlp.md) for the full reference.

## CLI Usage

```bash
# View DLP alerts
ebpfsentinel-agent alerts list --component dlp --severity critical

# Mark a false positive
ebpfsentinel-agent alerts mark-fp alert-dlp-001
```

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/alerts` | List alerts (filter by `component=dlp`) |
| POST | `/api/v1/alerts/{id}/false-positive` | Mark alert as false positive |

## Code Architecture

| Crate | Path | Role |
|-------|------|------|
| `ebpf-programs` | `crates/ebpf-programs/uprobe-dlp/` | uprobe kernel program |
| `domain` | `crates/domain/src/dlp/` | DLP engine (entity, engine, error) |
| `ports` | `crates/ports/src/primary/dlp.rs` | Port trait |
| `application` | `crates/application/src/dlp_service_impl.rs` | App service |

### Feature Gating

Enterprise DLP capabilities are activated by the separate enterprise repository, which enables the `enterprise` Cargo feature. The OSS codebase enforces limits at every layer:

- **Domain layer** (`DlpEngine`): `add_pattern()` and `reload()` reject non-builtin pattern IDs in OSS
- **Application layer** (`DlpAppService`): `set_mode()` rejects `Block` mode in OSS
- **Infrastructure layer** (config validation): rejects custom IDs, block mode, and per-pattern block overrides in OSS
- **Agent layer** (startup + reload): OSS always loads built-in defaults in alert mode; hot-reload only toggles enabled/disabled

## Metrics

- `ebpfsentinel_alerts_total{component="dlp", severity}` — DLP alerts generated
- `ebpfsentinel_processing_duration_seconds{domain="dlp"}` — pattern matching latency
