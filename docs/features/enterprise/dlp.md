# Enterprise DLP

> **Edition: Professional and above** (`advanced-dlp`), extended TLS library coverage **Enterprise and above**

## Overview

Enterprise DLP extends the OSS DLP module with a high-performance Vectorscan scanning engine, custom pattern definitions, block mode enforcement, per-pattern mode overrides, and TLS deep inspection for encrypted traffic scanning.

## Vectorscan Engine

Enterprise replaces the OSS regex-based scanner with [Vectorscan](https://github.com/VectorCamp/vectorscan) (Hyperscan-compatible), providing 10+ Gbps multi-pattern matching throughput.

Key capabilities:
- **Block mode scanning** - single contiguous buffer, all patterns in one pass
- **Start-of-match reporting** - every pattern is compiled with SOM_LEFTMOST, so a match carries the offset it started at and not only where it ended
- **Every match returned** - the scan does not stop on the first hit, so one buffer carrying two kinds of secret reports both, and the block decision is taken per match afterwards
- **Scratch pooling** - zero-allocation scanning in steady state

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

The compiled database and the map that turns a database id back into a pattern
are installed together or not at all. A pattern the compiler refuses is an error
the caller sees, and the scanner is left exactly as it was: the previous
patterns keep matching with their own indices, and the next valid reload takes
effect normally.

### What block mode means for detection

Scanning is **block mode only**: each event carries one contiguous excerpt and
that excerpt is scanned on its own, with no state kept between events. Two
limits follow, and both are worth sizing your expectations against:

- **A secret split across two writes is not detected.** Each `SSL_write` (or
  equivalent) produces its own event. A credit card number whose first eight
  digits land in one write and whose last eight land in the next matches
  neither excerpt, so neither event alerts. Applications that write a payload in
  small pieces - a chunked HTTP body, a streaming JSON encoder, a line-at-a-time
  logger - are the ones this affects.
- **A secret past the excerpt limit is not detected.** The excerpt is capped at
  4096 bytes per event and the pattern has to match inside that window, so a
  secret sitting deep in a larger payload is not seen.

Vectorscan itself offers a streaming mode that would carry match state across
chunks, and a vectored mode for scatter-gather buffers. **Neither is wired into
the product**: streaming needs per-flow state whose memory has to be bounded and
evicted on the datapath, which this build does not do. They are listed here as
absent rather than left out, because a reader who knows Hyperscan would
otherwise assume the modes are in use.

The practical mitigation is pattern design: prefer patterns that match a
self-contained token (an API key with its prefix, a full PAN, a private-key
header line) over patterns that need a long surrounding context to fire.

## Custom Patterns

Define organization-specific patterns with arbitrary IDs:

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

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

OSS is limited to the 17 built-in patterns (`dlp-pci-*`, `dlp-pii-*`, `dlp-cred-*`). Professional and above allow any pattern ID.

**Validation at config load:**
- Custom pattern IDs validated for uniqueness against each other; a custom ID colliding with a built-in is refused at startup, when the custom list is merged into the built-ins
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
      - id: acme-card-token
        name: ACME Card Token
        regex: "\\bACME-[0-9]{16}\\b"
        severity: critical
        data_type: pci
        mode: block                # override: block this pattern
      - id: acme-staff-email
        name: Staff Email
        regex: "[a-z]+@acme\\.example"
        severity: medium
        data_type: pii
        # inherits global alert mode
```

A custom pattern carries an ID of its own. Reusing a built-in ID here - `dlp-pci-visa`, `dlp-pii-email` or any of the other seven - is refused at startup rather than treated as an override, so the agent does not start. The built-ins are re-tuned or switched off in the OSS `dlp.patterns` section, which keeps its meaning under Enterprise.

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
- Thread-safe cache per domain (generate once, reuse until it expires)
- Short-lived certificates (24h) for MITM, backdated five minutes so a client whose clock is
  slightly behind still accepts them
- The cache holds at most 1024 certificates, and so at most 1024 live private keys. An entry is
  dropped once its own certificate has expired, and when the bound is reached the entry closest to
  expiring goes first. `ebpfsentinel_ent_tls_cert_cache_size` is how many are held right now

**Privacy Note:** TLS deep inspection requires explicit opt-in. The CA certificate must be deployed to all monitored endpoints.

## Extended TLS Library Coverage

> **Seven of the nine libraries are read; two are discovery only.**
> GnuTLS, wolfSSL, mbedTLS, s2n-tls and statically linked OpenSSL or
> BoringSSL are attached where an entry point resolves: their write and read entry points take the same
> `(handle, buffer, length)` shape as OpenSSL's, so the existing
> `uprobe-dlp` programs read them correctly at the offsets the scan
> resolved. Go `crypto/tls` is attached through programs of its own, which
> read Go's register ABI. Kernel TLS is attached through programs of its
> own as well, on the kernel's software send and receive functions rather
> than on any image. Java JSSE and NSS are discovered, reported and left
> unattached, because each needs a program the agent does not carry - see
> the per-library table below for the reason in each case. Attaching there
> anyway would produce a probe that fires and captures nothing, which reads
> as coverage.
>
> For the two unattached libraries the agent publishes the attachment
> plan, so an operator can see exactly which binaries and symbols would
> be probed and verify the resolved offsets against the build they
> belong to. Each such plan carries `no_probe_reason` on
> `GET /api/v1/enterprise/tls-probes/plans`, the sentence saying why
> nothing is attached for that library, so an empty offset is never read
> as a resolver that failed on a build it could have handled.

The OSS `uprobe-dlp` program hooks `SSL_write` / `SSL_read` in a mapped
`libssl.so` or `libboringssl.so`, so it covers dynamically-linked OpenSSL and
dynamically-linked BoringSSL. An application that manages TLS with no such
shared object mapped - a static link, or a runtime with its own stack - is
invisible to OSS DLP. Enterprise widens coverage to eight more TLS
implementations so decrypted plaintext can be scanned regardless of the TLS
library the workload links against.

### Supported libraries

| Library | Detection | Hook target | Status | Typical workloads |
|---------|-----------|-------------|--------|-------------------|
| **Go `crypto/tls`** | `.gopclntab` ELF section + `.go.buildinfo` version parse; functions found in `.symtab`, or in `.gopclntab` for a stripped binary | Entry uprobes on `crypto/tls.(*Conn).Write` / `.Read`, plus one uprobe on every return instruction of `Read` | **Attached** on amd64 (Go 1.17+) and arm64 (Go 1.18+); older releases pass arguments on the stack and are discovery only | CoreDNS, etcd, most Go microservices, Kubernetes controllers, HashiCorp tooling |
| **Java JSSE** | Binary-path heuristic + `libjava.so`/`libnet.so`/`libsunec.so` in `/proc/{pid}/maps` | None: `libjava.so` and `libnet.so` carry the socket, not the plaintext | Discovery only, and settled rather than pending - JSSE frames and encrypts inside the JVM, behind a JNI frame, so the plaintext lives in a heap object with no native call site taking a buffer and a length. Reading it would mean loading a JVMTI or `-javaagent` component into the application, which is a different product and one many estates forbid. Terminate the JVM's TLS at a proxy linked against a readable library to inspect it | Spring Boot, Kafka clients, JDBC drivers, Tomcat |
| **Statically linked OpenSSL or BoringSSL** | No `libssl.so` mapped, and the binary read for what it contains: `SSL_write`/`SSL_read` in whichever symbol table survived, the version strings each project writes into `.rodata`, and the entry points themselves. The process name decides nothing, so a build called anything at all is detected and a build that is neither project is labelled `unknown_static` rather than mislabelled | `SSL_write` / `SSL_read` uprobes at resolved binary offsets | **Attached** when an entry point resolves; a stripped build with no symbol table is reported as not covered, with its build id | Envoy proxies, istio-proxy, Cilium agent, CockroachDB, gVisor |
| **kTLS (kernel TLS)** | `/proc/net/tls_stat` counters (`TlsCurrTxSw`, `TlsCurrRxSw`, `…Device`) | kprobes on the kernel's own `tls_sw_sendmsg` / `tls_sw_recvmsg`, no image and no offset | **Attached** when the counters report an active software socket; hardware-offloaded sockets take a different path and stay unread | nginx and HAProxy built with kernel TLS, OpenSSL 3 with `Options KTLS` |
| **GnuTLS** | `libgnutls.so*` found in `/proc/{pid}/maps` | `gnutls_record_send` / `gnutls_record_recv` uprobes in the shared library | **Attached** | curl builds linked against GnuTLS, wget, LDAP clients, older Debian stacks |
| **wolfSSL** | `libwolfssl.so*` found in `/proc/{pid}/maps` | `wolfSSL_write` / `wolfSSL_read` uprobes in the shared library | **Attached** | embedded and IoT workloads, appliance firmware, constrained gateways |
| **mbedTLS** | `libmbedtls.so*` found in `/proc/{pid}/maps` | `mbedtls_ssl_write` / `mbedtls_ssl_read` uprobes in the shared library | **Attached** | IoT stacks, OpenVPN builds linked against mbedTLS, embedded Linux images |
| **s2n-tls** | `libs2n.so*` found in `/proc/{pid}/maps` | `s2n_send` / `s2n_recv` uprobes in the shared library; the fourth argument, a blocked-status out-parameter, is never read | **Attached** | AWS SDK for C and C++, AWS-native services and sidecars |
| **NSS** | `libssl3.so` found in `/proc/{pid}/maps` | `PR_Write` / `PR_Read` in `libnspr4.so` | Discovery only - NSPR layers those two calls over files and plaintext sockets as well as over TLS, so a probe there reports an ordinary file write as a TLS payload. Confirming the SSL layer on the descriptor means dereferencing `PRFileDesc->methods`, which needs a program of its own | Firefox, Thunderbird, older curl builds, RHEL tooling linked against NSS |

An attached library is probed after the scan cycle that discovered it, not
only at startup: a container that starts an hour in brings a library the
first scan never saw. A binary already probed - by this path or by the OSS
`libssl` scan - is skipped, so re-attaching is safe and never doubles a
captured buffer. Probes are owned by the datapath generation that created
them, so a failover tears them down with everything else and the next
scan cycle re-attaches on the new generation.

Distribution packages ship these libraries stripped, so the offsets come
from whichever symbol table survives: the full table when one is present,
the dynamic exports otherwise. A stock `libgnutls.so.30` is therefore
probed as shipped, with no debug package required, and so is a stock
`libwolfssl.so`, `libmbedtls.so` or `libs2n.so`.

A build that exports neither name - a statically linked binary stripped of
its symbol table, or one built with hidden visibility - resolves no
offsets. It is reported as discovered, counted under `offsets_unresolved`,
and left alone rather than probed at the start of the file.

### What this host actually reads

A tick next to "DLP" is one answer for four different workloads, and it is
wrong about one of them on nearly every estate:

| Class of workload | What the agent attaches to | Verdict |
|---|---|---|
| Links a TLS library as a shared object | the object's exported entry points, once per inode | covered, `dynamic_symbols` |
| Go binary | the Go runtime's own `crypto/tls` entry points, read out of the pclntab | covered, `go_runtime` |
| Static build that kept its symbol table | the two entry points the linker left in the binary | covered, `static_symbols` |
| Static build stripped of its symbol table | nothing: there is no name to attach to | not covered, `no_symbol` |

So the scan publishes a verdict per process rather than a capability per
product. `GET /api/v1/enterprise/tls-probes/coverage` answers with one entry
per process carrying TLS, uncovered first, and one verdict per surface that
process speaks TLS on - a process linking two libraries has two. The entry
carries the workload the process belongs to where the agent resolved one, so
a reader sees a pod and a namespace rather than a pid.

A surface is read, and says how:

| `means` | What it means |
|---|---|
| `dynamic_symbols` | the library exports its send and receive entry points and the probe sits on the object every process mapping it shares |
| `static_symbols` | a static build kept those two entry points in its symbol table |
| `go_runtime` | the Go runtime's entry points, resolved from the binary's own pclntab |
| `kernel_tls` | the kernel terminates the session, so the cleartext is read on the kernel's send and receive path and no userspace symbol is needed |
| `catalogue` | a stripped static build, read at the offsets the signed [offset catalogue](#the-offset-catalogue) publishes for its build id |

Or it is not read, and says why and what to do:

| `gap` | What it means | What you can do |
|---|---|---|
| `no_symbol` | no entry point could be resolved in this build. Usually a static build linked with its symbol table stripped; for a Go binary it is also what a build older than the register calling convention looks like, since its arguments are on the stack and the probe programs read registers | send us the build id the surface carries, so its offsets can be published and this build becomes readable without a rebuild; or terminate TLS in the kernel, which reads the cleartext whatever the binary links |
| `detection_only` | the library was identified and this agent attaches nothing to it - Java JSSE and NSS, each for the reason in the table above | terminate TLS in the kernel, or route the workload through a termination point this agent reads |
| `not_in_catalogue` | a stripped static build, looked up in the offset catalogue this agent holds and not found there | send us the build id so the next catalogue carries it; for an image rebuilt in-house, which no catalogue entry ever covers, terminate TLS in the kernel instead |

Two things the report is deliberate about. The share it carries,
`covered_permille`, counts **surfaces** rather than processes, because a host
whose one busy proxy is unread and whose forty idle daemons are read is not a
97 percent host; and it is absent rather than nought on a host where nothing
speaks TLS, because zero of zero is nothing to cover. And `build_ids_to_send`
is the list a customer sends us: every build id behind an uncovered surface,
once each. A build id that arrives is a row in the
[offset catalogue](#the-offset-catalogue), which is how a stripped build becomes
readable without the customer rebuilding it.

The same report is printed on the machine, by a binary that needs no running
agent and no API:

```bash
ebpfsentinel-enterprise-agent dlp coverage
```

```
DLP coverage
============
Surfaces read:  2 of 4 (50.0 percent)
Processes:      3 carrying TLS (1 covered, 1 partial, 1 not covered)
Kernel TLS:     inactive
Catalogue:      version 12 in force, 214 stripped builds covered

[not_covered] pid 2411 shop/checkout-7f9c
    NOT READ unknown_static   /usr/local/bin/envoy (not_in_catalogue)
             This build carries no symbol table, and the offset catalogue this agent holds has no entry for its build id.
             Send us this build id so the next catalogue carries it; an image rebuilt in-house is never in the catalogue, so for one of those terminate TLS in the kernel instead.
             build id 7f3c9a1b22d4
```

`--json` prints the same report as the API answers it, for a host where the
answer is going into a ticket rather than onto a screen.

### The offset catalogue

A static build that kept its symbol table names its own send and receive entry
points, and the probe attaches there. A stripped one names nothing: Envoy,
istio-proxy and most of the large proxies ship that way, so a host running them
would carry its busiest TLS traffic past the DLP engine unread. The code is still
in the binary, at an offset that is a property of the build rather than of the
host, so it can be resolved once, on our side, from a build of the same sources
that kept its symbols, and published.

That is the offset catalogue: the `tls-offsets` set of the
[content channel](content-channel.md), one entry per build id, delivered and
verified the same way as the rules and the patterns and served wherever TLS
intelligence is licensed. When the scan meets a stripped build, it looks the
build id up there; a hit is a surface read with `means: catalogue`, a miss is
`not_in_catalogue`. An entry is only ever published after a probe at those
offsets, attached to a container running that exact image digest, has read a
known cleartext sent through it, because an offset nobody proved is a probe
reading garbage on every estate running that build.

**An entry covers one image and nothing else.** It is keyed by the build id of
the binary we resolved, so the same release rebuilt from the same sources by
anyone else - an internal image with a patched base, a hardened rebuild, a
different compiler - has another build id and is never covered by it, however
close the two are. For an image you build yourself, keep the symbol table in
the binary you ship, which this agent reads without any catalogue, or terminate
TLS in the kernel.

**When your build is not in it,** the coverage report says so on the surface,
with the build id, and lists it again under `build_ids_to_send`. Send those ids
in writing; once the image is proven, the entry ships with the next content
bundle and the surface turns covered without a restart or a rebuild on your
side. Until then the remedy on the surface stands: terminate TLS in the kernel,
which reads the cleartext whatever the binary links.

**A catalogue that fails verification is not used.** The agent reads the file
only from bytes matching the digest the content set was signed with, and refuses
the whole file for one bad entry rather than trusting the rest. A refused
catalogue is reported, with its reason, on the coverage answer and on the first
lines of `dlp coverage`, and stripped builds are then reported as `no_symbol`,
exactly as on a host that never received one:

| `catalogue.state` | What it means |
|---|---|
| `absent` | no catalogue was ever applied on this host |
| `in_force` | the catalogue of `version` is read, covering `entries` stripped builds |
| `refused` | the catalogue of `version` was not used; `refusal` names why (`not_signed`, `digest_mismatch`, `malformed`, `unsupported_schema`, `too_large`, `too_many_entries`, `invalid_entry`, `duplicate`, `unreadable`) and `detail` says it in a sentence |

### Architecture

```
                          TlsProbeManager
                                │
           ┌────────────────┬───┴────┬────────────────┬──────────────┐
           │                │        │                │              │
       GoProbes        JavaProbes   StaticTls     KtlsProbes   SharedLibs
           │                │        │                │              │
   ELF .gopclntab      path+maps  symbols, .rodata  /proc/net/   maps marker
   + .go.buildinfo     heuristic  markers, entries   tls_stat   + symbol scan
           │                │        │                │              │
           │                │        │                │        GnuTLS, wolfSSL,
           │                │        │                │        mbedTLS, s2n-tls,
           │                │        │                │        NSS (one table)
           │                │        │                │              │
           └────────────────┴────────┴────────────────┴──────────────┘
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

- resolves every mapped shared library first, one plan per object, so a
  process contributes to each library it links rather than to one of them;
- then runs the per-executable detectors in priority order (Go → Java →
  BoringSSL static) - a binary is classified once and subsequent detectors
  are skipped for that path. The flavour of the executable does not decide
  whether its libraries are scanned: a JVM reaching NSS through JNI, or a
  Go binary linked against GnuTLS, is reported as both;
- aggregates pids per `(library, device, inode, binary_path)` so probe
  attachment runs once per unique image, and two containers running
  different images under one path - `/usr/bin/envoy` in both - are two
  plans rather than one plan listed twice;
- emits a kTLS plan whenever `/proc/net/tls_stat` reports active
  software counters and the `ktls` flag is on;
- collects per-process errors as structured warnings (invalid ELF,
  truncated `/proc` file, `object` parse failure…) without aborting
  the scan.

### Reading an image a container owns

A uprobe is a `(file inode, file offset)` pair, so a path on its own does not
identify a file: `/usr/bin/envoy` means a different file in each container that
carries one, and the node agent lives in none of them. Every read is therefore
taken through the process that owns the path:

| What is read | Where it is read from |
|---|---|
| The executable | `/proc/{pid}/exe`, the magic link, never the path it points at |
| A mapped shared library | `/proc/{pid}/root/{path}`, the process's own mount namespace |
| A library whose file was replaced or unlinked | `/proc/{pid}/map_files/{range}`, which still opens the mapped inode |

Under the brokered posture the warden spells the same paths from its own
`/proc`, so the two acquisition paths see the same bytes. Each plan carries the
`(device, inode)` the read resolved, and the attach step resolves the plan's
path back through one of the pids that mapped it and refuses the attach if the
inode it opens is not the inode the offsets were measured against. An image
deleted after the scan, or replaced between scan and attach, fails the attach
rather than arming a probe at an offset that now means something else.

An image is opened once per inode per scan cycle, not once per process, and it
is never copied: the scan reads the ELF header, the symbol tables, the handful
of sections a detector needs and, for a Go binary, the bytes of two functions,
straight out of the open file. **There is no size limit**, because there is no
longer an allocation for one to bound - the limit that used to exist was in
practice the list of images the scan declined to look at, and on a node running
a service mesh that list was envoy, istio-proxy, cilium-agent, kubelet and k3s.
A skip is never silent. A process whose image the cycle already opened joins the
plan that opened it; an image nobody can open emits a warning counted under
`binary_unreadable` on
`ebpfsentinel_ent_tls_probes_scan_warnings_total`, and
`/api/v1/enterprise/tls-probes/warnings` names the path.

On a 256 MiB image, resolving a symbol pair this way takes about 257 us and
peaks at 76 KiB of heap, against about 121 ms and 256 MiB for the same work on
a copy of the file. Both ratios grow with the image, because one path is linear
in file size and the other in the size of the symbol tables.

### Go specifics

Go does not follow the C calling convention, so the OpenSSL programs cannot
read it. Three programs of its own do: the write and read entries take the
connection, the buffer pointer and its length from the first three argument
registers (RAX, RBX, RCX on amd64; X0, X1, X2 on arm64), and the read result is
taken from the first result register.

The read result is not taken through a uretprobe. A uretprobe swaps the return
address on the stack, and Go moves a goroutine's stack whenever it grows, so the
process would fault on its next return. The agent decodes `(*Conn).Read`
instead and places a plain uprobe on each of its return instructions. Read
calls in flight are keyed by process and goroutine, so two goroutines reading at
once never mix up their buffers.

Before anything is attached, each resolved function must open with the register
ABI's stack-bound check, a read of the goroutine's stack guard off the g
register. An offset that fails this, or a `Read` that does not decode cleanly,
attaches nothing: a probe placed in the middle of an instruction would corrupt
the process it is meant to observe.

Two limits remain. A Go release older than 1.17 on amd64, or 1.18 on arm64,
passes arguments on the stack and is reported without being probed. And a read
buffer that lives on the goroutine's own stack can be moved if the stack grows
during the call, in which case that one read is captured from the old address
and the scan sees stale bytes. Buffers allocated by `bufio`, `io.ReadAll` and
the HTTP stacks live on the heap and are not affected.

### Kernel TLS specifics

A kernel TLS socket encrypts inside the kernel, so by the time the data is on
the wire there is no userspace call to probe and by the time it reaches the
socket there is no library in the path. The probes go on the kernel's own
software send and receive functions, `tls_sw_sendmsg` and `tls_sw_recvmsg`, and
see plaintext for every process on the host at once, whatever language or
library it was written against. There is no image, no symbol offset and no
build id: the link names a kernel symbol and the kernel resolves it, which is
why the published plan for this entry reports `null` where the others report a
path.

The buffer is reached through the `msghdr` the caller passed, which points into
the caller's own memory, so the plaintext is copied with the same user-space
read the uprobes use. Finding it means walking `msghdr` into its `iov_iter` and
out to the first segment, and those member offsets differ between kernel
releases. They are read out of the running kernel's own BTF at startup and
pushed into the program through a map, so a kernel whose layout moved produces
different offsets rather than a wrong read; a kernel that exposes no BTF leaves
the offsets unset and the programs capture nothing rather than reading at a
guess.

Two things are deliberately not counted. A send that OpenSSL already handed to
`SSL_write` is seen twice - once by the uprobe, once here - so the uprobe
stamps the thread and the kernel probe skips a buffer it already captured,
counted as `ktls_suppressed`. And a socket whose crypto was offloaded to the
network card never enters the software path at all: those sockets show up in
the `…Device` counters, are reported, and are not read. Reading them would mean
probing a different point, before the hand-off to the card.

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
      static_tls:      { enabled: true }   # OpenSSL or BoringSSL linked into the binary
      ktls:            { enabled: true }   # kprobes on the kernel's own software TLS path
      gnutls:          { enabled: true }
      wolfssl:         { enabled: true }
      mbedtls:         { enabled: true }
      s2n_tls:         { enabled: true }
      nss:             { enabled: true }  # reported, never probed
```

Each per-library block is a flag - set `enabled: false` to skip the
corresponding detector entirely. The scan interval minimum of 5s is
enforced at config load, not silently clamped.

### Metrics

The `ExtendedTlsMetrics` port emits per-library counters and a scan
duration gauge. All metrics are registered under the
`ebpfsentinel_ent` prefix in the enterprise Prometheus registry:

| Metric | Type | Labels | Meaning |
|--------|------|--------|---------|
| `ebpfsentinel_ent_tls_probes_binaries_discovered_total` | Counter | `library` | Binaries discovered by the extended TLS probe scanner, labelled by TLS library |
| `ebpfsentinel_ent_tls_probes_attached_total` | Counter | `library` | Probes newly attached. Counted once per binary, not once per scan cycle, so a steady state stops incrementing |
| `ebpfsentinel_ent_tls_probes_attach_failures_total` | Counter | `library`, `reason` | Plans that produced no probe. `reason` is `unsupported_abi` for a discovery-only library, `offsets_unresolved` for a build that exports neither symbol, `attach_error` when the kernel or the warden refused, `non_utf8_path` for a binary path that is not valid UTF-8 |
| `ebpfsentinel_ent_tls_probes_binaries_tracked` | Gauge | `library` | Unique binaries currently tracked per TLS library |
| `ebpfsentinel_ent_tls_probes_scan_duration_seconds` | Gauge | - | Most recent `TlsProbeManager::scan` duration in seconds |
| `ebpfsentinel_ent_tls_probes_scan_warnings_total` | Counter | `library` | Warnings collected during a scan (invalid ELF, proc parse, IO error, …) |

An HA standby holds no datapath, so it discovers libraries but attaches
nothing. That case increments neither the attach counter nor the failure
counter: a standby is not failing to attach, it has nothing to attach to.
After a promotion the probes appear on the next scan cycle, so with the
default 30s interval a newly promoted node reaches full DLP coverage
within one interval rather than at the next agent restart.

### Admin API

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/tls-probes/status` | viewer | tls-intelligence | High-level scanner health: last scan timestamp (ns), last scan duration (seconds), number of processes scanned, total discovered plans, `ktls_active` flag. |
| `GET` | `/api/v1/enterprise/tls-probes/plans` | viewer | tls-intelligence | Full latest `ScanResult`: every `(library, binary_path, binary_dev, binary_ino, pids, symbol offsets, build_id, kernel_hook)` tuple plus the raw kTLS counters read from `/proc/net/tls_stat`. |
| `GET` | `/api/v1/enterprise/tls-probes/warnings` | viewer | tls-intelligence | Warnings collected during the most recent scan (invalid ELF, missing symbol, `/proc` read failure, …). |
| `GET` | `/api/v1/enterprise/tls-probes/coverage` | viewer | tls-intelligence | The verdict per process described in [What this host actually reads](#what-this-host-actually-reads): one entry per process carrying TLS, uncovered first, each surface read or not read with the means or the reason, the share of surfaces read in thousandths, the build ids to send, and the state of the [offset catalogue](#the-offset-catalogue) the verdicts were reached with. |

`build_id` is the hex GNU build id of the image the offsets were resolved
against. It is what makes two scans comparable: an offset that moved while the
build id stayed the same is a resolution problem, and an offset that moved along
with the build id is simply a different binary at the same path. A stripped
binary reports `null` rather than failing the plan, and the kTLS entry reports
`null` because a kernel hook has no image of its own. The identity is stamped
once, from the first process seen mapping that path; a later process at the same
path adds its pid but never restamps - it is the same inode, since a
replacement file is a plan of its own. `binary_dev` and `binary_ino` are that
inode as the scanned process's own namespace resolves it, and are `null` only
when the scan could not stat the file.

All four endpoints are read-only and gated behind the `tls-intelligence`
license feature, which Enterprise and above carry. Configuration is managed via the enterprise YAML
(`enterprise.advanced_dlp.extended_tls`), not via the API.

### Requirements

- `CAP_SYS_PTRACE` for inspecting `/proc/{pid}/maps` and attaching
  uprobes to other processes
- A read-only `/host/proc` mount, named by `EBPFSENTINEL_HOST_PROC`, when the
  agent must reach processes outside its own pod. Not `hostPID`: the scan reads
  a procfs and the uprobe is placed on an inode and an offset, so the node's
  pid namespace adds nothing a `baseline` namespace would have to be opened for
- Nothing extra for the kernel TLS probes: they attach by symbol name
  through `kprobe_multi`, which the agent's own kernel floor already
  carries, and a host whose `tls` module was never loaded exports neither
  symbol and reports the attach as failed rather than as coverage

Every hook feeds the same DLP alert/block/per-pattern engine - the
extended TLS layer widens the visible surface without changing the
pattern configuration or the alert schema.

## Hot-Reload

Pattern changes take effect without restarting the agent:
- Add, remove, or modify patterns at runtime
- Change global or per-pattern mode
- Toggle individual patterns enabled/disabled
- Atomic database recompilation (old database serves scans until new one is ready)

## REST API

The active TLS probe endpoints documented under Admin API above sit on the same port and are gated behind `tls-intelligence` rather than `advanced-dlp`.

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/dlp/status` | viewer | advanced-dlp | Enterprise DLP engine status. |
| `GET` | `/api/v1/enterprise/dlp/patterns` | viewer | advanced-dlp | List all DLP patterns. |
| `POST` | `/api/v1/enterprise/dlp/patterns` | operator | advanced-dlp | Add a custom pattern. |
| `DELETE` | `/api/v1/enterprise/dlp/patterns/{id}` | operator | advanced-dlp | Remove a custom pattern. |
| `PATCH` | `/api/v1/enterprise/dlp/patterns/{id}/mode` | operator | advanced-dlp | Change pattern mode. |

## Feature Gating

Advanced DLP requires a valid license with the `advanced-dlp` feature, which every paid tier carries from Professional upwards. Without a license:
- Custom pattern IDs are rejected
- Block mode is rejected
- TLS deep inspection is disabled
- Falls back to OSS DLP (17 built-in patterns, alert mode only)

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
