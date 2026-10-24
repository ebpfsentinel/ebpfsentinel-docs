# eBPF Programs

## Overview

eBPFsentinel includes 21 eBPF kernel programs, all written in Rust using the [Aya](https://aya-rs.dev/) framework. Programs are compiled for the `bpfel-unknown-none` target (little-endian BPF) using the nightly Rust toolchain. Twenty form the production datapath; `xdp-pass` is a test-only veth helper.

## Programs

| Program | Hook | Crate Path | Purpose |
|---------|------|-----------|---------|
| `xdp-firewall` | XDP | `crates/ebpf-programs/xdp-firewall/` | L3/L4 stateful packet filtering + reject (XDP_TX) |
| `xdp-ratelimit` | XDP | `crates/ebpf-programs/xdp-ratelimit/` | DDoS protection + per-country rate limit tiers (LPM) |
| `xdp-loadbalancer` | XDP | `crates/ebpf-programs/xdp-loadbalancer/` | L4 load balancing (TCP/UDP/TLS passthrough) |
| `xdp-vip-announcer` | XDP (tail-call) | `crates/ebpf-programs/xdp-vip-announcer/` | L2 VIP ARP responder for the load balancer (forged ARP reply, XDP_TX) |
| `xdp-pass` | XDP | `crates/ebpf-programs/xdp-pass/` | Minimal XDP_PASS attached to a veth peer (test rig only; never in production) |
| `xdp-firewall-reject` | XDP (tail-call) | `crates/ebpf-programs/xdp-firewall-reject/` | TCP RST / ICMP Unreachable forging for REJECT action |
| `xdp-ratelimit-syncookie` | XDP (tail-call) | `crates/ebpf-programs/xdp-ratelimit-syncookie/` | SYN cookie SYN+ACK forging for DDoS protection |
| `tc-conntrack` | TC classifier | `crates/ebpf-programs/tc-conntrack/` | Connection tracking (TCP/UDP/ICMP state machine) |
| `tc-scrub` | TC classifier | `crates/ebpf-programs/tc-scrub/` | Packet normalization (TTL, MSS, DF, IP ID, TCP flags, ECN, TOS, TCP timestamps) |
| `tc-nat-ingress` | TC ingress | `crates/ebpf-programs/tc-nat-ingress/` | DNAT (destination NAT, ingress direction) |
| `tc-nat-egress` | TC egress | `crates/ebpf-programs/tc-nat-egress/` | SNAT (source NAT, egress direction) |
| `tc-ids` | TC classifier | `crates/ebpf-programs/tc-ids/` | Intrusion detection |
| `tc-threatintel` | TC classifier | `crates/ebpf-programs/tc-threatintel/` | Threat intelligence |
| `tc-dns` | TC classifier | `crates/ebpf-programs/tc-dns/` | DNS capture |
| `tc-qos` | TC egress + ingress | `crates/ebpf-programs/tc-qos/` | QoS / traffic shaping (`tc_qos` on egress, `tc_qos_ingress` on ingress) |
| `uprobe-dlp` | uprobe | `crates/ebpf-programs/uprobe-dlp/` | SSL/TLS DLP |
| `cgroup-attribution` | cgroup sock_addr / sock / sock_ops | `crates/ebpf-programs/cgroup-attribution/` | The task behind a socket, recorded against the socket cookie and the five-tuple |
| `cgroup-workload-firewall` | cgroup sock_addr | `crates/ebpf-programs/cgroup-workload-firewall/` | Firewall rules that name a workload, decided in `connect()`, `sendmsg()` and `bind()` |
| `tracepoint-process` | raw tracepoint | `crates/ebpf-programs/tracepoint-process/` | `execve` and exit notifications for the userspace process table |
| `tracepoint-signal` | raw tracepoint | `crates/ebpf-programs/tracepoint-signal/` | Signals an armed thread group at its next system call, refusing the protected ones (loaded only where the capability is on) |
| `lsm-exec-network` | BPF LSM | `crates/ebpf-programs/lsm-exec-network/` | Refuses an internet socket to an executable outside the configured list, at `socket_create` and `socket_connect` (loaded only where the list is on and the BPF LSM is active) |

## Interface Groups (Cross-Cutting)

Six programs (`xdp-firewall`, `xdp-ratelimit`, `tc-nat-ingress`, `tc-nat-egress`, `tc-ids`, `tc-qos`) share a common **interface group** mechanism. Each program has an `INTERFACE_GROUPS` HashMap (key = `u32` ifindex, value = `u32` bitmask, max 64 entries). Rule structs in these programs include a `group_mask` field:

- `group_mask == 0` - **floating rule**, applies to all interfaces (backward compatible default)
- `group_mask != 0` - rule applies only when the interface's bitmask ANDed with `group_mask` is non-zero
- Bit 31 - **inversion flag**: when set, the match is inverted (rule applies to interfaces *not* in the specified groups)

Up to 31 named interface groups are supported. The bitmask check adds negligible overhead (one map lookup + one AND + one compare per rule).

## TC Chain Handoff (Cross-Cutting)

The eight tc classifiers attach on TCX and each returns `TCX_NEXT`, so an ingress skb runs through `tc-ids`, `tc-threatintel`, `tc-dns`, `tc-conntrack`, `tc-nat-ingress`, `tc-scrub` and `tc_qos_ingress` in that order, and an egress skb through `tc-ids` (only when `ids.inspect_egress` or the container resolver is on), `tc-nat-egress` then `tc_qos`. A program whose feature is off is not attached, so it costs nothing in the chain. The frame is parsed once per chain rather than once per program: the first classifier that sees the skb reads the Ethernet header, walks the VLAN and QinQ tags, reads the IP header and the transport ports, and writes the result into the five control-block words the kernel carries with the skb from one TCX program to the next (`skb->cb`). Every classifier after it reads those words back: the L3 and L4 offsets, the protocol, the VLAN identifier, the two ports and the tenant, once a program in the chain has resolved it. `tc-dns` uses the ports to leave before touching the packet when neither is 53.

The control block is not trusted blindly. The kernel overwrites it on an IP receive and on a locally originated skb, so the words carry a magic byte and a check word folded over the five of them, the skb length and the two interface indexes; a mismatch is a re-parse, never a wrong offset. A NAT rewrite invalidates the handoff before it touches the packet, since the ports it carries would be stale afterwards, and the next program parses again. The layout lives in `crates/ebpf-helpers/src/pktmeta.rs`.

## Reloading Without a Hole (Cross-Cutting)

Only one XDP program is attached to an interface: the root of the chain,
which the others are reached from by tail call. Turning a feature on or off
can move that root - the firewall rooted the chain, it is disabled, and the
rate limiter takes its place - and that used to mean detaching one program,
loading the other and attaching it, with the interface carrying nothing in
between.

It does not any more. The old root's links are kept open while the new
program loads, and the attach hands the kernel that same link with the new
program (`BPF_LINK_UPDATE`): the kernel swaps the program under a link that
was never closed, so no packet crosses the interface unexamined. The same
path covers TCX ingress and egress and both sides of a netkit device.

A kernel or an attach type that refuses the replacement falls back to the
old behaviour, detach and attach again, and that is never silent: the agent
logs it with the program named and counts it in
`ebpfsentinel_ebpf_link_handover_fallbacks`, beside
`ebpfsentinel_ebpf_link_handovers` for the replacements that worked. A link
nothing reattached - a program disabled rather than replaced, or an
interface the new root does not cover - is detached once the reconciliation
ends.

## Programs Are Run Before They Are Attached (Cross-Cutting)

The verifier is the hardest reviewer this code has, and nothing asks it until a
program is loaded. A build that compiles says only that the compiler was happy.

`cargo test -p adapters --test ebpf_prog_test_run` loads every object the eBPF
build produced and pushes a crafted TCP SYN through each entry program with
`BPF_PROG_TEST_RUN`, the kernel's own way of running a program with no
interface, no attach and no traffic. The return value is the action the program
decided, so a verifier rejection and a program that starts answering
`XDP_ABORTED` on a well-formed packet both fail a test run rather than coming
up as degraded mode on a host.

It needs the objects, built by `cargo xtask ebpf-build` into
`target/bpfel-unknown-none/release` or wherever `EBPFSENTINEL_EBPF_DIR` points,
and the privilege to load a program. Without either it says what is missing and
passes, because a contributor running `cargo test` on a laptop is not the
audience for a failure about `CAP_BPF`; the eBPF build workflow runs it as root
right after the objects are built, which is where it is meant to bite.

## Maps Written Once Are Frozen (Cross-Cutting)

Three maps carry a reading of the running kernel rather than a piece of
configuration: the `nf_conn` member offsets the firewall and the connection
tracker probe (`CT_NF_CONN_OFFSETS`), and the `msghdr`/`iov_iter` and
`sock_common` offsets the kernel TLS probes read (`KTLS_ITER_OFFSETS`,
`SOCK_OFFSETS`). The eBPF target emits no CO-RE relocations, so userspace
resolves them from `/sys/kernel/btf/vmlinux` and writes them before anything
attaches. That reading cannot change while the process lives.

Each of the three is frozen with `BPF_MAP_FREEZE` immediately behind its one
write, so a later write from userspace fails at the syscall instead of
leaving a program reading kernel structures at offsets nothing asked for.
The maps are pinned and shared, so the second program to load finds the map
the first one already wrote: the value is read back and compared rather than
written again, and only a reading that disagrees with itself is an error.

Everything else stays writable on purpose, because almost nothing else is
read-only: a configuration reload rewrites the feature flags and the
thresholds, a rule API call rewrites the rule tables, a feed refresh replaces
the indicators, an automated response writes a block, and the programs
themselves write their counters. `crates/adapters/src/ebpf/map_freeze.rs`
lists the maps that stay writable with the reason for each, so the question
has an answer in the tree.

The freeze is best effort. A kernel that wants a capability a token-only
agent does not hold refuses the command, which costs the protection and
nothing else: the agent logs the refusal with the map named and counts it in
`ebpfsentinel_ebpf_map_freeze_refusals`, beside `ebpfsentinel_ebpf_frozen_maps`
for the maps that are read-only.

## Shared Types (ebpf-common)

All programs share types via `crates/ebpf-common/`:

- `PacketEvent` (96 bytes) - the standard event emitted to userspace via RingBuf
- `#[repr(C)]` structs for eBPF map keys and values
- Shared constants (`FLAG_IPV6`, `FLAG_VLAN`, etc.)

## Map Sizing (Cross-Cutting)

Rule arrays keep the `max_entries` compiled into the object: that number is the
ceiling userspace writes up to. Tables the kernel fills on its own are sized at
load from the configuration instead, because locked memory is paid for every
slot whether it is used or not, and a per-CPU table pays it once per online
CPU. The agent builds one plan `map name -> max_entries` before the first
object is loaded:

| Map | Follows |
|---|---|
| `THREATINTEL_IOCS`, `THREATINTEL_IOCS_V6`, `THREATINTEL_BLOOM_V4`, `THREATINTEL_BLOOM_V6` | `threatintel.max_entries` |
| `RL_BUCKETS` | `ratelimit.max_buckets` |
| `SYN_RATE_TRACKER`, `ICMP_RATE_BUCKETS`, `AMP_RATE_BUCKETS`, `HALF_OPEN_COUNTERS`, `FLOOD_COUNTERS` | `ddos.max_tracked_sources` |
| `CONN_TABLE` | `ddos.connection_tracking.max_entries` |
| `CT_SRC_COUNTERS` | `conntrack.max_src_states` |
| `NAT_HAIRPIN_CT` | `nat.hairpin.enabled` |
| `REJECT_RATELIMIT` | whether any firewall rule uses `reject` |

A table belonging to a feature that is off is created small rather than empty,
so a reload that turns the feature on can still insert until the next start. A
pinned map keeps the size it was created with, so a size changed by a hot
reload is reported and applied at the next start.

## Ring Buffer Events (Cross-Cutting)

Every program that reports events writes them to a `RingBuf`. Two rules apply
to all of them:

- **Backpressure**: before reserving, `tc-ids`, `tc-threatintel`, `tc-dns`,
  `tc-qos`, `xdp-firewall`, `xdp-ratelimit` and `xdp-loadbalancer` check the
  ring's fill level with `bpf_ringbuf_query` and skip the event above 75%,
  counting it in their `events_dropped` metric. The packet verdict is never
  affected.
- **Batched wakeup**: a record is submitted with `BPF_RB_NO_WAKEUP` until the
  unread backlog reaches 64 KiB, then with `BPF_RB_FORCE_WAKEUP`. The reader
  also drains every 10 ms, so a quiet ring is still read promptly while a busy
  one wakes the agent once per batch rather than once per record. `tc-dns` is
  the exception: it keeps the default wakeup, because a DNS answer has to
  reach the domain cache before the connection it resolved.

## XDP Firewall (xdp-firewall)

The most feature-rich eBPF program. Processes packets through a 5-phase pipeline:

1. **Phase 0 - Overload and conntrack fast-path**: a source in the overload IP set (set 255) is dropped while its mark stands; then the kernel conntrack entry is looked up with `bpf_xdp_ct_lookup`. The state does not skip rule evaluation: it feeds `state` filters, and an established or related flow no rule matched is passed rather than sent to the default policy.
2. **Phase 1 - LPM Trie** (O(log n)): CIDR-only rules in four tries (`FW_LPM_SRC_V4`, `FW_LPM_DST_V4`, `FW_LPM_SRC_V6`, `FW_LPM_DST_V6`).
3. **Phase 1b / 1c - Hash lookups** (O(1)): exact 5-tuple rules, then protocol-and-port rules.
4. **Phase 2 - Linear scan** (`bpf_loop`): rules with port ranges, VLAN, TCP flags, ICMP type/code, MAC, DSCP, aliases, conntrack state, negation. Priority order, first match wins.
5. **Connection limits**: per-source state limits; a source over its rate is marked overloaded and added to the overload set.

Key eBPF features:

- **LPM Trie** maps for O(log n) CIDR matching (4 tries: src/dst × IPv4/IPv6)
- **PROG_ARRAY** tail-call chain (`XDP_PROG_ARRAY`): slot 0 → `xdp-ratelimit`, slot 1 → `xdp-firewall-reject`, slot 2 → `xdp-loadbalancer`, slot 3 → `xdp-vip-announcer` (ARP frames targeting an owned VIP)
- **bpf_fib_lookup** to resolve the interface a packet would leave by, which is how the destination zone is found
- **bpf_check_mtu** for MTU validation before pass/redirect (all 3 XDP programs)
- Inline `VlanHdr` / `Ipv6Hdr` parsing
- `bpf_loop` for iterating large rule sets
- TCP flags matching (`match/mask` notation), ICMP type/code filtering
- MAC address matching (L2), DSCP classification and marking (`dscp_mark` on a passed packet, ECN kept, IPv4 checksum patched incrementally)
- IP set maps for aliases and overload blacklist
- Per-source state counters for connection limit enforcement
- **Reject action** via tail-call to `xdp-firewall-reject` (slot 1) - forges TCP RST (IPv4/IPv6) or ICMP/ICMPv6 Destination Unreachable in a separate program with its own 512-byte stack budget, then transmits back via `XDP_TX`

## XDP Rate Limiter (xdp-ratelimit)

- **LPM Trie** maps for per-country rate limit tiers (`RL_LPM_SRC_V4/V6` → `RL_TIER_CONFIG`). Lookup runs before per-IP matching - if a source IP falls within a country tier's CIDR range, the tier config is used
- **LRU PerCPU Hash** maps for lock-free per-source buckets; the LRU evicts the least recently seen source when the table is full, and a bucket refills from its own timestamp on the next packet, so no timer runs. The table is sized by `ratelimit.max_buckets` at load
- **XDP SYN cookies** - via tail-call to `xdp-ratelimit-syncookie` (`RL_PROG_ARRAY` slot 0), which forges the SYN+ACK with a kernel-issued cookie (`bpf_tcp_raw_gen_syncookie_ipv4/_ipv6`) and sends it with `XDP_TX`; the returning ACK is validated inline in the main program with `bpf_tcp_raw_check_syncookie_ipv4/_ipv6`, so a valid client completes the handshake with the host's own stack
- **bpf_xdp_adjust_tail** for packet resizing during SYN+ACK forging
- **bpf_ktime_get_boot_ns** for suspend-aware timestamps
- 4 algorithms: token bucket, fixed window, sliding window, leaky bucket. SYN cookie forging is not one of them: it is configured under `ddos.syn_protection` and `algorithm: syn_cookie` is rejected at config load

### DDoS Protections (within xdp-ratelimit)

The xdp-ratelimit program also hosts DDoS-specific protections:

- **SYN protection (SYN cookies)** - answers a flood with kernel-issued SYN cookies via `XDP_TX` instead of dropping SYNs; the kernel's own check validates the returning ACK
- **ICMP protection** - rate limiting + oversized payload detection (potential tunneling)
- **UDP amplification protection** - per-source-per-port rate limiting on configurable amplification ports (DNS/53, NTP/123, SSDP/1900, etc.)
- **TCP connection tracking** - half-open connection monitoring, RST/FIN/ACK flood detection with per-source thresholds
- **18-slot PerCpuArray** metrics: SYN_RECEIVED, SYN_FLOOD_DROPS, ICMP_PASSED/DROPPED, AMP_PASSED/DROPPED, OVERSIZED_ICMP, ERRORS, EVENTS_DROPPED, CONN_TRACKED, HALF_OPEN_DROPS, RST/FIN/ACK_FLOOD_DROPS, TOTAL_SEEN, SYNCOOKIE_SENT, SYNCOOKIE_VALID, SYNCOOKIE_INVALID

## XDP Load Balancer (xdp-loadbalancer)

- **Service map** lookup by `(protocol, port)` in `LB_SERVICES` to find service definitions
- **Backend selection**: round robin (per-CPU index), weighted, IP hash, least connections or Maglev
- **Two modes**: DNAT rewrites the destination IP and port for the selected backend; L2 DSR rewrites only the Ethernet header (destination from `LB_BACKEND_MAC`, source = this interface) and leaves the VIP in place so the backend replies to the client directly
- **Forwarding**: DNAT resolves the next hop with `bpf_fib_lookup` and rewrites both MACs from it, then sends with `XDP_TX` on the receiving interface or `XDP_REDIRECT` (DevMap, else `bpf_redirect`) to another; an unresolved neighbour is passed to the stack, and only a missing route falls back to a MAC swap and `XDP_TX`
- **IPv4 checksum**: L3 IP header + L4 TCP/UDP incremental update
- **IPv6 checksum**: L4 pseudo-header incremental update (8 × u16 words for 128-bit address diff + port diff)
- **RingBuf events**: `EVENT_TYPE_LB` with `LB_ACTION_FORWARD` or `LB_ACTION_NO_BACKEND`
- **LB_METRICS PerCpuArray**: per-CPU forwarding counters read by `MetricsReader`
- Health-aware: unhealthy backends are skipped in selection
- **Tail-call integration**: when firewall and/or ratelimit are active on the same interface, the LB runs as a tail-call target (FW slot 2, RL slot 1) instead of attaching directly. Standalone mode when no other XDP program is present.

## XDP VIP Announcer (xdp-vip-announcer)

- **Tail-call target**: `xdp-firewall` dispatches ARP frames to it via `XDP_PROG_ARRAY` slot 3; the LB hot path is never touched
- **Forged ARP reply**: for an ARP "who-has" targeting an owned VIP, rewrites a fixed 28 bytes (`sha` = this node's NIC MAC) and `XDP_TX`s the reply out the receiving interface - bounded, no loop, no SKB
- **Speaker election**: userspace populates the `VIP_SET` map **only** while this node is the elected speaker; a standby node keeps it empty and never answers (split-brain safe)
- **Gratuitous ARP on takeover**: emitted by userspace over a raw `AF_PACKET` socket (not eBPF), so upstream switches relearn the MAC immediately
- **Metrics**: `ebpfsentinel_lb_vip_arp_replies`, `ebpfsentinel_lb_vip_takeovers_total`
- Configured via `loadbalancer.announce`; see [Load balancer → L2 VIP announcer](../features/loadbalancer.md#l2-vip-announcer)

## TC IDS (tc-ids)

- **bpf_get_prandom_u32** against the `IDS_SAMPLING_CONFIG` map for kernel-side sampling. The agent writes the rate there when `ids.sampling.mode` is `random` and clears it for every other mode; a match not drawn is not emitted, while an IPS drop is enforced whatever the draw. `hash` and `country_based` are applied in userspace, on a hash of the address pair
- **bpf_dynptr_from_skb / bpf_dynptr_size** to measure the full packet, fragments included, before the payload copy
- **bpf_ringbuf_query** for adaptive backpressure (skip at >75% fill)
- Rule key is tenant, destination port and protocol with no address, so IPv4 and IPv6 share one table

## TC Threat Intel (tc-threatintel)

- **BPF_MAP_TYPE_BLOOM_FILTER** for fast IOC pre-check (no false negatives)
- **BPF_MAP_TYPE_LRU_HASH** for IOC confirmation maps (`THREATINTEL_IOCS`, `THREATINTEL_IOCS_V6`) - LRU eviction keeps maps within capacity
- VLAN and QinQ tag parsing, carried onto the event; no tag is rewritten
- Separate V6 maps for IPv6 IOC lookups
- RingBuf backpressure

## TC Connection Tracking (tc-conntrack)

- Kernel netfilter is the only connection tracking engine: the program keeps no connection table of its own
- Parses the 5-tuple (IPv4 and IPv6; TCP, UDP, ICMP) and probes the kernel entry with `bpf_skb_ct_lookup`
- Reads `nf_conn->status` and `nf_conn->mark` with `bpf_probe_read_kernel`, at offsets userspace resolves from vmlinux BTF into `CT_NF_CONN_OFFSETS`
- Counts lookups, hits, misses, marked connections and the state seen (new, established, related, invalid) in `CT_METRICS`
- Timeouts, the state machine and eviction are the kernel's

## TC Scrub (tc-scrub)

Packet normalization running after XDP processing:

- **TTL normalization**: Raise TTL to configured minimum via `bpf_l3_csum_replace`
- **MSS clamping**: Scan TCP SYN options, rewrite if exceeding `max_mss`, update L4 checksum
- **DF bit clearing**: Clear Don't Fragment flag, update L3 checksum
- **IP ID randomization**: Set `ip.id = bpf_get_prandom_u32()`, update L3 checksum
- **TCP flags scrubbing**: Clear reserved/NS/CWR/ECE bits (preserves ECN negotiation on SYN)
- **ECN stripping**: Clear ECN bits in IPv4 TOS and IPv6 Traffic Class
- **TOS normalization**: Force TOS/DSCP to configured value (default 0)
- **TCP timestamp stripping**: Remove TCP timestamp option (kind=8) for anti-fingerprinting
- **IPv6 hop limit**: raise the hop limit to a configured minimum
- **Fragment drop**: refuse IPv4 fragments outright when configured
- Configuration via the `SCRUB_CONFIG` array map (14-byte `ScrubFlags` struct)

## TC NAT Ingress (tc-nat-ingress)

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation (destination rewrite), checked before DNAT rules
- **Hairpin NAT**: detects internal-to-internal DNAT, applies additional SNAT, stores reverse mapping in `NAT_HAIRPIN_CT` LRU map (IPv4 only)
- Destination NAT (DNAT) for incoming packets
- Port mapping and IP rewriting
- `bpf_loop` for NAT rule scanning without hitting verifier loop limits
- L3/L4 checksum updates via `bpf_l3_csum_replace` / `bpf_l4_csum_replace`
- Conntrack integration for stateful NAT

## TC NAT Egress (tc-nat-egress)

- **NPTv6 (RFC 6296)**: stateless IPv6 prefix translation (source rewrite), checked before SNAT rules
- Source NAT (SNAT) for outgoing packets, attached on TCX egress so locally originated traffic is rewritten as well as forwarded traffic
- `bpf_loop` for NAT rule scanning without hitting verifier loop limits
- Reverse mapping from conntrack entries
- L3/L4 checksum updates
- Stateful return path matching

## TC DNS (tc-dns)

- UDP port 53 traffic identification
- DNS wire-format packet forwarding to userspace

## TC QoS (tc-qos)

- Two entry points in one object: `tc_qos` on TC egress and `tc_qos_ingress` on TC ingress, each applying only the rules whose direction matches
- Three-level hierarchy: pipes (bandwidth, burst, delay, loss, direction) → queues (each names the pipe that shapes it and carries no scheduling of its own) → classifiers (5-tuple + DSCP + VLAN matching)
- **Token bucket** bandwidth limiting with `bpf_ktime_get_boot_ns` timestamps
- **Classification ladder** in `QOS_CLASSIFIERS`: nine rule shapes (both hosts and ports, hosts and destination port, hosts only, both ports, destination port, source port, DSCP, protocol, catch-all), walked in two scopes (rules naming a VLAN, then rules naming none). The six host and port shapes are probed with the packet's DSCP and with DSCP open, so a full walk is 16 lookups for an unmarked packet and 30 for a marked one
- **Empty-shape mask** (`QOS_EMPTY_SHAPES`): userspace publishes which shapes hold no rule, one bit each plus a no-DSCP bit per scope, and the ladder skips them. With no shaping rule loaded the program costs about the floor of the test loop; a stale mask can only be slower, never wrong
- **Random loss** emulation via `bpf_get_prandom_u32`
- **Delay** by EDT pacing: `bpf_skb_set_tstamp` stamps a departure time and an `fq` qdisc on the interface holds the packet until then
- **ARRAY** `QOS_PIPE_STATE` for the token bucket, one per pipe and shared across CPUs so a pipe's rate is not multiplied by the core count
- **LRU_PERCPU_HASH** (`QOS_FLOW_STATE`, 65536 entries) for each flow's last departure time
- **PerCpuArray** metrics: total_seen, shaped, dropped_loss, dropped_queue, delayed, errors, events_dropped
- RingBuf backpressure (same 75% line)

## Uprobe DLP (uprobe-dlp)

- Nine programs in three sets of three (write, read entry, read return):
  - C TLS libraries: `SSL_write` (uprobe), `SSL_read` entry (uprobe, saves the buffer pointer) and `SSL_read` return (uretprobe, reads what was decrypted), on every OpenSSL or BoringSSL library a process maps
  - Go `crypto/tls`: uprobes on `(*Conn).Write` and `(*Conn).Read` reading Go's register ABI, with the read return probed on each return instruction
  - Kernel TLS: kprobes on `tls_sw_sendmsg` and `tls_sw_recvmsg` (entry and return) through a `kprobe_multi` link, covering every software kTLS socket on the host; a kernel probe stands down when a C-library probe on the same thread already captured the bytes
- Captures plaintext before encryption / after decryption, and the cgroup identifier of the calling task so an event is attributed to its container
- Forwards to userspace DLP engine via RingBuf. The OSS agent attaches the C-library set; the Go and kernel TLS sets, statically linked BoringSSL and the other C libraries are attached by the Enterprise extended TLS scan

## Socket Attribution (cgroup-attribution)

- Seven programs, one answer: `connect4`/`connect6` fire before any packet exists, `post_bind4`/`post_bind6` name a listening socket, `sendmsg4`/`sendmsg6` cover the unconnected datagram path (most DNS never calls `connect()`), and a `sock_ops` program joins the established connection to its five-tuple
- Writes `SOCKET_IDENTITY` (socket cookie to task), `SOCKET_FLOW` (five-tuple to task, the index a conntrack row can be read through) and `DLP_TASK_SOCKET`, the map `uprobe-dlp` also declares so the loader gives both objects one kernel map: the uprobe holds a plaintext buffer and a thread, the `sock_ops` hook holds the socket, and the thread is what they have in common
- All three tables are LRU, so a node opening more sockets than the table holds loses the coldest entry rather than refusing the newest, and `ATTRIBUTION_METRICS` per-CPU counters say which hooks are firing
- Enforces nothing. Every program returns allow unconditionally, so a refused attachment or a full map costs attribution and never connectivity: flows fall back to five-tuple matching, which is what the agent reports through `/api/v1/ebpf/kernel-features`

## Workload Rules (cgroup-workload-firewall)

- Six programs on the same cgroup as the attribution object, and a different question: `connect4`/`connect6`, `sendmsg4`/`sendmsg6` and the **pre-bind** pair `bind4`/`bind6`, which is where the attribution object uses post-bind - post-bind runs once the kernel has assigned the address and cannot refuse it
- Reads a mask and never an identity. Userspace resolves what a cgroup and a task are - an executable path, a systemd unit, a cgroup path, a container - and writes one bit per selector of the loaded policy into `WORKLOAD_CGROUP_SELECTORS` (keyed by cgroup id) or `WORKLOAD_TASK_SELECTORS` (keyed by thread group id, since an executable belongs to a task and not to its cgroup). The two are ORed, and a selector naming both halves is decided in userspace and written once, so it can never be half-satisfied
- `WORKLOAD_RULES` is the policy in priority order with no holes: the walk stops at the first disabled slot, and slot zero disabled is a node with no policy, where the hooks count nothing and allow everything
- Returns `1` to let the syscall through and `0` to refuse it, which the caller sees as `EPERM`. A rule in observe mode counts what it would have refused and returns `1`, so a policy can be measured before it is turned on
- The loaded object follows the rules rather than a configuration key, with one exception: a document with no workload rule but with quarantining turned on loads it anyway. A document whose workload rules enforce stops the agent on a host where these hooks did not attach
- `QUARANTINE_CGROUPS` is read before the rule walk and before the no-policy early return, so a quarantined cgroup is refused whatever the rules say: an allow rule written for a workload's ordinary traffic must not survive the decision to cut that workload off. Entries expire on the boot clock in the kernel rather than on a userspace timer, enforcing is the zero mode so a zeroed entry refuses rather than failing open, and `QUARANTINE_EVENTS` is a ring of its own so a flood of refusals cannot push a workload rule's alerts out

## Process Lifecycle (tracepoint-process)

- Two raw tracepoints, `sched_process_exec` and `sched_process_exit`, each returning zero unconditionally
- Puts only the calling task's own numbers on the ring - pid, tgid, uid, gid, cgroup id, `comm` - because the executable path, the command line and the parent live in `task_struct` and `linux_binprm`, and reading them here would pin the object to one kernel's field offsets. The exec record is the invitation for userspace to read `/proc/<pid>`, the exit record the order to forget
- Its own RingBuf rather than a share of the packet ring: a process event is rare, must not be dropped behind a flood of packets, and an exec read a second late is an alert naming a pid instead of a binary

## Kernel Requirements

All features require Linux kernel **6.9+** with BTF. The 6.9 floor is set by BPF token delegation; the newest kfuncs the programs call (`bpf_xdp_metadata_rx_vlan_tag`, `bpf_xdp_get_xfrm_state`) arrived in 6.8. See the [Compatibility](../operations/compatibility.md) page for the full feature-to-kernel-version matrix.

## Build

```bash
cargo xtask ebpf-build    # Builds all 19 programs with nightly
```

See [eBPF Development](../development/ebpf-development.md) for the development workflow.
