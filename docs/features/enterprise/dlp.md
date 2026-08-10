# Enterprise DLP

> **Edition: Enterprise**

## Overview

Enterprise DLP extends the OSS DLP module with a high-performance Vectorscan scanning engine, custom pattern definitions, block mode enforcement, per-pattern mode overrides, and TLS deep inspection for encrypted traffic scanning.

## Vectorscan Engine

Enterprise replaces the OSS regex-based scanner with [Vectorscan](https://github.com/VectorCamp/vectorscan) (Hyperscan-compatible), providing 10+ Gbps multi-pattern matching throughput.

Key capabilities:
- **Block mode scanning** — single contiguous buffer, all patterns in one pass
- **Streaming mode** — patterns that span multiple SSL/TLS chunks
- **Vectored mode** — scatter-gather scanning of non-contiguous buffers
- **Per-pattern flags** — CASELESS, UTF8, SINGLEMATCH, SOM_LEFTMOST, etc.
- **Early termination** — stop scanning on first block-mode match
- **Database serialization** — cache compiled pattern databases
- **Scratch pooling** — zero-allocation scanning in steady state

Architecture:
```
HyperscanDlpEngine
  └── VectorscanScanner (DlpScanner trait)
        ├── Arc<ScannerState> (atomic hot-reload)
        │     ├── BlockDatabase (compiled patterns)
        │     └── ScratchPool (pre-allocated, acquire/release)
        └── RegexScanner (fallback if Vectorscan unavailable)
```

A regex-based fallback is always available for platforms without Vectorscan.

## Custom Patterns

Define organization-specific patterns with arbitrary IDs:

```yaml
enterprise:
  advanced_dlp:
    enabled: true
    mode: alert
    custom_patterns:
      - id: PROJ-CODE
        name: Project Code
        regex: "PROJ-[A-Z]{3}-\\d{6}"
        severity: high
        data_type: internal_code
        description: "Internal project tracking codes"
      - id: EMP-ID
        name: Employee ID
        regex: "EMP-\\d{5}"
        severity: critical
        data_type: employee
        mode: block  # per-pattern override
```

OSS is limited to 9 built-in patterns (`dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`). Enterprise allows any pattern ID.

**Validation at config load:**
- Pattern IDs validated for uniqueness (vs built-in + other custom)
- Regex syntax validated via Vectorscan `expression_info` (catch errors before compilation)
- Severity validated (low, medium, high, critical)
- Invalid patterns rejected with clear error messages including pattern ID

## Block Mode

Block mode actively drops connections when sensitive data is detected:

```yaml
enterprise:
  advanced_dlp:
    mode: block  # global: block all matches
```

OSS is limited to `alert` mode (detect and report only).

### Per-Pattern Mode Override

Apply different enforcement per pattern:

```yaml
enterprise:
  advanced_dlp:
    mode: alert                    # default
    custom_patterns:
      - id: dlp-pci-visa
        name: Visa Card
        regex: "\\b4[0-9]{12}(?:[0-9]{3})?\\b"
        severity: critical
        data_type: pci
        mode: block                # override: block this pattern
      - id: dlp-pii-email
        name: Email
        regex: "[a-z]+@[a-z]+\\.[a-z]+"
        severity: medium
        data_type: pii
        # inherits global alert mode
```

### Scan Results

`scan_with_actions()` returns enriched results with per-match action decisions:

| Field | Description |
|-------|-------------|
| `pattern_id` | Pattern that matched |
| `pattern_name` | Display name |
| `severity` | Low, Medium, High, Critical |
| `data_type` | Category (pci, pii, credentials, custom, etc.) |
| `mode` | Alert or Block |
| `source` | BuiltIn or Custom |
| `byte_offset` | Match start position |
| `byte_length` | Match length |

`should_block()` returns true for block-mode matches.

## TLS Deep Inspection

Scan encrypted traffic by intercepting TLS connections with a configured CA certificate:

```yaml
enterprise:
  advanced_dlp:
    tls_inspection:
      enabled: true
      ca_cert: /etc/ebpfsentinel/ca.crt
      ca_key: /etc/ebpfsentinel/ca.key
      bypass_domains:
        - "*.bank.com"
        - "healthcare.example.org"
      bypass_ips:
        - "10.0.0.0/8"
        - "fd00::/16"
```

### Bypass Lists

Domains and IPs can be exempted from inspection:

- **Exact domain match:** `example.com`
- **Wildcard suffix:** `*.example.com` (matches `sub.example.com` but not `example.com`)
- **IPv4/IPv6 CIDR:** `10.0.0.0/8`, `fd00::/16`
- **Individual IP:** `192.168.1.100`

### Certificate Authority

Dynamic per-SNI certificate generation:
- Leaf certificates signed by the configured CA
- Certificate chain: leaf + CA cert
- Thread-safe cache per domain (generate once, reuse)
- Short-lived certificates (24h) for MITM

**Privacy Note:** TLS deep inspection requires explicit opt-in. The CA certificate must be deployed to all monitored endpoints.

## Extended TLS Library Coverage

> **Two of the five libraries are probed; three are discovery only.**
> GnuTLS and statically linked BoringSSL are attached: their write and
> read entry points take the same `(handle, buffer, length)` shape as
> OpenSSL's, so the existing `uprobe-dlp` programs read them correctly at
> the offsets the scan resolved. Go `crypto/tls`, Java JSSE and kernel
> TLS are discovered, reported and left unattached, because each needs a
> program the agent does not carry - see the per-library table below for
> the reason in each case. Attaching there anyway would produce a probe
> that fires and captures nothing, which reads as coverage.
>
> For the three unattached libraries the agent publishes the attachment
> plan, so an operator can see exactly which binaries and symbols would
> be probed and verify the resolved offsets against the build they
> belong to.

The OSS `uprobe-dlp` program only hooks OpenSSL's `libssl.so.3`
(`SSL_write` / `SSL_read`). Any application that manages TLS outside of
OpenSSL is invisible to OSS DLP. Enterprise widens coverage to five
more TLS implementations so decrypted plaintext can be scanned
regardless of the TLS library the workload links against.

### Supported libraries

| Library | Detection | Hook target | Status | Typical workloads |
|---------|-----------|-------------|--------|-------------------|
| **Go `crypto/tls`** | `.gopclntab` ELF section + `.go.buildinfo` version parse | `crypto/tls.(*Conn).Write` / `.Read` uprobes, Go ≥1.17 register ABI, Go <1.17 stack ABI | Discovery only - the Go register ABI passes the buffer differently, so the OpenSSL-shaped programs would read the wrong register | CoreDNS, etcd, most Go microservices, Kubernetes controllers, HashiCorp tooling |
| **Java JSSE** | Binary-path heuristic + `libjava.so`/`libnet.so`/`libsunec.so` in `/proc/{pid}/maps` | JNI TLS write/read native symbols | Discovery only - plaintext lives in a JVM heap object, not in a flat buffer the probe can copy | Spring Boot, Kafka clients, JDBC drivers, Tomcat |
| **BoringSSL (statically linked)** | No `libssl.so` mapped + `SSL_write`/`SSL_read` present in the binary's own symbol table; fast-path whitelist for `envoy`, `istio-proxy`, `cilium-agent` | `SSL_write` / `SSL_read` uprobes at resolved binary offsets | **Attached** | Envoy proxies, istio-proxy, Cilium agent, CockroachDB, gVisor |
| **kTLS (kernel TLS)** | `/proc/net/tls_stat` counters (`TlsCurrTxSw`, `TlsCurrRxSw`, `…Device`) | kprobes on `tls_sw_sendmsg` / `tls_sw_recvmsg` | Discovery only - a kernel hook, not a uprobe; needs a kprobe program the agent does not carry | nginx + kTLS, HAProxy + kTLS, Linux 5.11+ workloads with kernel TLS offload |
| **GnuTLS** | `libgnutls.so*` found in `/proc/{pid}/maps` | `gnutls_record_send` / `gnutls_record_recv` uprobes in the shared library | **Attached** | curl builds linked against GnuTLS, wget, LDAP clients, older Debian stacks |

An attached library is probed after the scan cycle that discovered it, not
only at startup: a container that starts an hour in brings a library the
first scan never saw. A binary already probed - by this path or by the OSS
`libssl` scan - is skipped, so re-attaching is safe and never doubles a
captured buffer. Probes are owned by the datapath generation that created
them, so a failover tears them down with everything else and the next
scan cycle re-attaches on the new generation.

A statically stripped build of an attached library resolves no offsets. It
is reported as discovered, counted under `offsets_unresolved`, and left
alone rather than probed at the start of the file.

### Architecture

```
                          TlsProbeManager
                                │
           ┌────────────────┬───┴────┬────────────────┬─────────────┐
           │                │        │                │             │
       GoProbes        JavaProbes  BoringSslStatic  KtlsProbes   GnuTlsProbes
           │                │        │                │             │
   ELF .gopclntab      path+maps  symtab scan    /proc/net/    maps+libgnutls
   + .go.buildinfo     heuristic  (libssl-less)   tls_stat     symbol scan
           │                │        │                │             │
           └────────────────┴────────┴────────────────┴─────────────┘
                                │
                  Vec<TlsProbePlan>  (library, binary, offsets, pids)
                                │
                     aya uprobe / kprobe attach
                                │
             DlpEvent → shared RingBuf → DLP pattern engine
```

### Orchestrator

`TlsProbeManager::scan()` takes a batch of `ProcessSnapshot`s (binary
bytes + `/proc/{pid}/maps` dump) plus the optional contents of
`/proc/net/tls_stat` and returns a deduplicated `ScanResult`. The
orchestrator:

- runs every enabled library detector in priority order (Go → Java →
  BoringSSL static → GnuTLS) — a binary is classified once and
  subsequent detectors are skipped for that path;
- aggregates pids per `(library, binary_path)` so probe attachment can
  run once per unique binary;
- emits a kTLS plan whenever `/proc/net/tls_stat` reports active
  software counters and the `ktls` flag is on;
- collects per-process errors as structured warnings (invalid ELF,
  truncated `/proc` file, `object` parse failure…) without aborting
  the scan.

### Container-aware attach

Extended TLS hooking is designed to be fully container-aware: the
enterprise loader walks every process matched by the
[container resolver](../container-awareness.md), inspects its mapped
libraries, and plans the right uprobe set per workload. A Go
microservice and an Envoy sidecar running in neighbouring pods are
discovered independently and tracked by unique canonical binary path.

### Configuration

Extended TLS probing is opt-in and configured under
`enterprise.advanced_dlp.extended_tls`:

```yaml
enterprise:
  advanced_dlp:
    enabled: true
    mode: alert
    extended_tls:
      enabled: true
      scan_interval_seconds: 30      # minimum 5s, enforced by validator
      exclude_paths:                  # binary path prefixes that must not be probed
        - /snap
        - /var/lib/flatpak
      go_tls:          { enabled: true }
      java_jsse:       { enabled: true }
      boringssl_static: { enabled: true }
      ktls:            { enabled: false }  # opt-in, requires kprobe + kernel ≥ 5.11
      gnutls:          { enabled: true }
```

Each per-library block is a flag — set `enabled: false` to skip the
corresponding detector entirely. The scan interval minimum of 5s is
enforced at config load, not silently clamped.

### Metrics

The `ExtendedTlsMetrics` port emits per-library counters and a scan
duration gauge. All metrics are registered under the
`ebpfsentinel_ent` prefix in the enterprise Prometheus registry:

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `ebpfsentinel_ent_tls_probes_binaries_discovered` | Counter | `library` | Binaries discovered by the extended TLS probe scanner, labelled by TLS library |
| `ebpfsentinel_ent_tls_probes_attached` | Counter | `library` | Probes newly attached. Counted once per binary, not once per scan cycle, so a steady state stops incrementing |
| `ebpfsentinel_ent_tls_probes_attach_failures` | Counter | `library`, `reason` | Plans that produced no probe. `reason` is `unsupported_abi` or `unsupported_hook` for a discovery-only library, `offsets_unresolved` for a stripped build, `attach_error` when the kernel or the warden refused, `non_utf8_path` for a binary path that is not valid UTF-8 |
| `ebpfsentinel_ent_tls_probes_binaries_tracked` | Gauge | `library` | Unique binaries currently tracked per TLS library |
| `ebpfsentinel_ent_tls_probes_scan_duration_seconds` | Gauge | — | Most recent `TlsProbeManager::scan` duration in seconds |
| `ebpfsentinel_ent_tls_probes_scan_warnings` | Counter | `library` | Warnings collected during a scan (invalid ELF, proc parse, IO error, …) |

An HA standby holds no datapath, so it discovers libraries but attaches
nothing. That case increments neither the attach counter nor the failure
counter: a standby is not failing to attach, it has nothing to attach to.
After a promotion the probes appear on the next scan cycle, so with the
default 30s interval a newly promoted node reaches full DLP coverage
within one interval rather than at the next agent restart.

### Admin API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/enterprise/tls-probes/status` | High-level scanner health: last scan timestamp (ns), last scan duration (seconds), number of processes scanned, total discovered plans, `ktls_active` flag |
| `GET` | `/api/v1/enterprise/tls-probes/plans` | Full latest `ScanResult`: every `(library, binary_path, pids, symbol offsets, build_id, kernel_hook)` tuple plus the raw kTLS counters read from `/proc/net/tls_stat` |
| `GET` | `/api/v1/enterprise/tls-probes/warnings` | Warnings collected during the most recent scan (invalid ELF, missing symbol, `/proc` read failure, …) |

`build_id` is the hex GNU build id of the image the offsets were resolved
against. It is what makes two scans comparable: an offset that moved while the
build id stayed the same is a resolution problem, and an offset that moved along
with the build id is simply a different binary at the same path. A stripped
binary reports `null` rather than failing the plan, and the kTLS entry reports
`null` because a kernel hook has no image of its own. The identity is stamped
once, from the first process seen mapping that path; a later process at the same
path adds its pid but never restamps, because it may be running a replacement
file whose offsets were never measured.

All three endpoints are read-only and gated behind the `advanced-dlp`
license feature. Configuration is managed via the enterprise YAML
(`enterprise.advanced_dlp.extended_tls`), not via the API.

### Requirements

- `CAP_SYS_PTRACE` for inspecting `/proc/{pid}/maps` and attaching
  uprobes to other processes
- `hostPID: true` (Kubernetes) / `--pid host` (Docker) when the agent
  must reach processes outside its own pod
- Kernel 5.11+ for the kTLS kprobe path; older kernels silently skip
  the kTLS hooks

Every hook feeds the same DLP alert/block/per-pattern engine — the
extended TLS layer widens the visible surface without changing the
pattern configuration or the alert schema.

## Hot-Reload

Pattern changes take effect without restarting the agent:
- Add, remove, or modify patterns at runtime
- Change global or per-pattern mode
- Toggle individual patterns enabled/disabled
- Atomic database recompilation (old database serves scans until new one is ready)

## Feature Gating

Enterprise DLP requires a valid license with the `advanced-dlp` feature. Without a license:
- Custom pattern IDs are rejected
- Block mode is rejected
- TLS deep inspection is disabled
- Falls back to OSS DLP (9 built-in patterns, alert mode only)

## Build Requirements

Vectorscan requires system dependencies:
```bash
sudo apt-get install cmake ragel libboost-dev g++
git clone https://github.com/VectorCamp/vectorscan.git
cd vectorscan && mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON
make -j$(nproc) && sudo make install && sudo ldconfig
```

## Configuration Reference

See [Configuration: DLP](../../configuration/dlp.md) for the full field reference.
