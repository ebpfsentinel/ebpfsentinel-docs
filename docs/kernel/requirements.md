# Kernel Compatibility

## Minimum Requirements

| Requirement | Value |
|-------------|-------|
| Linux kernel | **6.9+** |
| BTF | `CONFIG_DEBUG_INFO_BTF=y` (`/sys/kernel/btf/vmlinux` must exist) |
| Privileges | The privileged warden (a container, a sidecar or a systemd unit) delegates a BPF filesystem; the agent unshares a user namespace, creates the BPF token itself and holds no capability. Unprivileged user namespaces must be enabled. No `CAP_BPF`/`setcap` path. |

The 6.9 floor is enforced at agent startup before any BPF program is loaded - there is no fallback path. The minimum is set by BPF token delegation (`BPF_TOKEN_CREATE` + `BPF_F_TOKEN_FD`, 6.9); the newest kfuncs the programs call (see [KFuncs](kfuncs.md)) arrived in 6.8 and do not move it.

Verify on your system:

```bash
uname -r                       # Must be >= 6.9
ls /sys/kernel/btf/vmlinux     # Must exist
```

## Ask the running kernel

A version number is a proxy for capability, not capability itself: vendors backport helpers into older trees and distributions compile features out. At startup the agent therefore asks the kernel directly, per program type, about every helper its programs call, logs a one-line summary, and serves the detail:

```bash
curl -H "Authorization: Bearer $EBPFSENTINEL_TOKEN" -s http://127.0.0.1:8080/api/v1/ebpf/kernel-features
```

```json
{
  "probed": true,
  "load_mode": "bpf-token",
  "program_types": [{"program_type": "xdp", "supported": true}],
  "helpers": [{"program_type": "xdp", "helper": "bpf_fib_lookup", "supported": true}],
  "missing_required": []
}
```

Read it as follows.

- `missing_required` is the actionable field. Each entry names the program object, the program type and the helper. A program whose helper is missing is refused before it is loaded, with that same sentence as the error, instead of an opaque verifier rejection. `/readyz` stays `not_ready` while any entry remains, and repeats the list in `kernel_helpers_missing`.
- `probed: false` means the probe could not run, **not** that the kernel is missing anything. `helpers` and `missing_required` are then empty because nothing was measured, and `reason` says why. Nothing is refused on this basis and the agent starts normally.
- **`probed: false` is the expected answer on the standard deployment.** The probe issues a plain program load, which needs `CAP_BPF`; the agent loads through a BPF token and holds no capabilities, so it cannot probe. `load_mode` is printed alongside precisely so this asymmetry is visible rather than inferred. To get a full reading, run the agent once with `CAP_BPF` on a representative host.
- Helpers only. KFuncs, map types and program types have no equivalent probe; for those the matrix below and the BTF check remain the source of truth.

The probe does not move the floor, and cannot: the newest helper in the matrix below arrived in 6.0, well under 6.9. What sets the floor is BPF token delegation, which the probe does not cover. Measured on a 7.0 kernel with `CAP_BPF`, every helper/program-type pair the agent needs is supported and `missing_required` is empty.

## Feature-to-Kernel-Version Matrix

Every eBPF feature used by eBPFsentinel, the minimum kernel version, and which program relies on it.

### Helper Functions

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| [`bpf_map_lookup_elem`](https://docs.ebpf.io/linux/helper-function/bpf_map_lookup_elem/) | 3.19+ | All programs | Map read on every packet path |
| [`bpf_l3_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l3_csum_replace/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-scrub | IP header checksum update |
| [`bpf_l4_csum_replace`](https://docs.ebpf.io/linux/helper-function/bpf_l4_csum_replace/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-scrub | TCP/UDP checksum update |
| [`bpf_skb_store_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_store_bytes/) | 4.1+ | tc-nat-ingress, tc-nat-egress, tc-scrub | Packet byte rewriting |
| [`bpf_skb_load_bytes`](https://docs.ebpf.io/linux/helper-function/bpf_skb_load_bytes/) | 4.5+ | tc-ids, tc-dns, tc-scrub | Payload copy into the event record, TCP option reads |
| [`bpf_get_smp_processor_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_smp_processor_id/) | 4.1+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer, tc-ids, tc-threatintel, tc-qos | CPU number carried in the event record |
| [`bpf_tail_call`](https://docs.ebpf.io/linux/helper-function/bpf_tail_call/) | 4.2+ | xdp-firewall, xdp-ratelimit | Chaining to reject, VIP announce, rate limit and load balancer |
| [`bpf_clone_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_clone_redirect/) | 4.2+ | tc-ids | Mirror a matched packet to the capture interface |
| [`bpf_csum_diff`](https://docs.ebpf.io/linux/helper-function/bpf_csum_diff/) | 4.6+ | tc-scrub | Checksum delta for the rewritten IP fields and TCP options |
| [`bpf_get_current_pid_tgid`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_pid_tgid/) | 4.2+ | uprobe-dlp | Attribute a TLS write to its process |
| [`bpf_probe_read_user`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_user/) | 5.5+ | uprobe-dlp | Read the plaintext buffer from the traced process |
| [`bpf_probe_read_kernel`](https://docs.ebpf.io/linux/helper-function/bpf_probe_read_kernel/) | 5.5+ | xdp-firewall, tc-conntrack, uprobe-dlp | Read `nf_conn` fields and the kernel TLS message iterator at BTF-resolved offsets |
| [`bpf_get_current_cgroup_id`](https://docs.ebpf.io/linux/helper-function/bpf_get_current_cgroup_id/) | 4.18+ | tc-ids, tc-threatintel, tc-dns, tc-qos, uprobe-dlp | Container attribution for locally-originated events |
| [`bpf_skb_cgroup_id`](https://docs.ebpf.io/linux/helper-function/bpf_skb_cgroup_id/) | 4.18+ | tc-ids | Container attribution on the egress hook |
| [`bpf_fib_lookup`](https://docs.ebpf.io/linux/helper-function/bpf_fib_lookup/) | 4.18+ | xdp-firewall, xdp-loadbalancer | FIB routing enrichment, DNAT next hop |
| [`bpf_get_prandom_u32`](https://docs.ebpf.io/linux/helper-function/bpf_get_prandom_u32/) | 4.1+ | tc-ids, tc-qos, tc-scrub | Kernel-side sampling, loss emulation, IP ID randomization |
| [`bpf_get_socket_cookie`](https://docs.ebpf.io/linux/helper-function/bpf_get_socket_cookie/) | 4.12+ | tc-ids, tc-threatintel, tc-qos | Per-connection flow identity |
| [`bpf_redirect_map`](https://docs.ebpf.io/linux/helper-function/bpf_redirect_map/) | 4.14+ | xdp-loadbalancer (DEVMAP) | Wire-speed backend forwarding |
| [`bpf_redirect`](https://docs.ebpf.io/linux/helper-function/bpf_redirect/) | 4.4+ | xdp-loadbalancer | Backend forwarding without a DevMap entry |
| [`bpf_xdp_adjust_tail`](https://docs.ebpf.io/linux/helper-function/bpf_xdp_adjust_tail/) | 4.15+ | xdp-firewall-reject, xdp-ratelimit-syncookie | Resize the forged reply |
| [`bpf_ktime_get_boot_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_boot_ns/) | 5.8+ | Most programs | Suspend-aware timestamps |
| [`bpf_ktime_get_coarse_ns`](https://docs.ebpf.io/linux/helper-function/bpf_ktime_get_coarse_ns/) | 5.11+ | xdp-ratelimit | Cheap clock for token-bucket refill |
| [`bpf_ringbuf_reserve`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_reserve/) | 5.8+ | Every event-emitting program | Ring buffer record reservation |
| [`bpf_ringbuf_submit`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_submit/) | 5.8+ | Every event-emitting program | Ring buffer record submission |
| [`bpf_ringbuf_discard`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_discard/) | 5.8+ | Every event-emitting program | Drop a reservation whose payload read failed |
| [`bpf_ringbuf_query`](https://docs.ebpf.io/linux/helper-function/bpf_ringbuf_query/) | 5.8+ | Every event-emitting program | Backpressure at 3/4 full and batched reader wakeups |
| [`bpf_check_mtu`](https://docs.ebpf.io/linux/helper-function/bpf_check_mtu/) | 5.12+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer | MTU validation before pass or forward |
| [`bpf_skb_ecn_set_ce`](https://docs.ebpf.io/linux/helper-function/bpf_skb_ecn_set_ce/) | 5.1+ | tc-qos | ECN congestion marking instead of dropping |
| [`bpf_skb_set_tstamp`](https://docs.ebpf.io/linux/helper-function/bpf_skb_set_tstamp/) | 5.18+ | tc-qos | Earliest-departure-time pacing |
| [`bpf_loop`](https://docs.ebpf.io/linux/helper-function/bpf_loop/) | 5.17+ | xdp-firewall, tc-nat-ingress, tc-nat-egress, tc-scrub | Rule set iteration |
| [`bpf_tcp_raw_gen_syncookie_ipv4`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_raw_gen_syncookie_ipv4/) / `_ipv6` | 6.0+ | xdp-ratelimit-syncookie | Forge a SYN cookie without a socket |
| [`bpf_tcp_raw_check_syncookie_ipv4`](https://docs.ebpf.io/linux/helper-function/bpf_tcp_raw_check_syncookie_ipv4/) / `_ipv6` | 6.0+ | xdp-ratelimit | Validate the returning ACK |

This table is generated from the same requirement table the agent probes with (`crates/adapters/src/ebpf/helper_probe.rs`), which a unit test keeps in step with the program sources: a helper call added without a matching entry fails the build rather than surfacing as a verifier rejection on an operator's kernel.

### Map Types

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| [`BPF_MAP_TYPE_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_HASH/) | 3.19+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer, xdp-vip-announcer, tc-ids, tc-nat-ingress, tc-nat-egress, tc-qos | Exact-match rules and configuration |
| [`BPF_MAP_TYPE_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_ARRAY/) | 3.19+ | Most programs | Configuration slots and indexed rule tables |
| [`BPF_MAP_TYPE_PROG_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PROG_ARRAY/) | 4.2+ | xdp-firewall, xdp-ratelimit | Tail-call chaining |
| [`BPF_MAP_TYPE_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_HASH/) | 4.6+ | xdp-vip-announcer | Per-CPU announce state |
| [`BPF_MAP_TYPE_PERCPU_ARRAY`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_PERCPU_ARRAY/) | 4.6+ | Every program but xdp-pass | Per-CPU metrics counters and scratch space |
| [`BPF_MAP_TYPE_LRU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_HASH/) | 4.10+ | tc-threatintel, tc-nat-ingress, uprobe-dlp, xdp-firewall-reject | Auto-evicting state (IOC hits, hairpin mappings, pending TLS reads) |
| [`BPF_MAP_TYPE_LRU_PERCPU_HASH`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LRU_PERCPU_HASH/) | 4.10+ | xdp-ratelimit, tc-qos | Rate-limit buckets and per-flow departure times |
| [`BPF_MAP_TYPE_LPM_TRIE`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_LPM_TRIE/) | 4.11+ | xdp-firewall, xdp-ratelimit, tc-ids, tc-nat-ingress, tc-nat-egress, tc-qos | CIDR matching |
| [`BPF_MAP_TYPE_DEVMAP`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_DEVMAP/) | 4.14+ | xdp-loadbalancer | Redirect to a backend interface |
| [`BPF_MAP_TYPE_RINGBUF`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_RINGBUF/) | 5.8+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer, tc-ids, tc-threatintel, tc-dns, tc-qos, uprobe-dlp | Kernel to userspace events |
| [`BPF_MAP_TYPE_BLOOM_FILTER`](https://docs.ebpf.io/linux/map-type/BPF_MAP_TYPE_BLOOM_FILTER/) | 5.16+ | tc-threatintel | IOC pre-filtering |

### KFuncs

KFuncs are bound manually through `crates/ebpf-helpers/src/kfuncs.rs`: aya still has no kfunc infrastructure as of 0.14. See [KFuncs](kfuncs.md) for full per-kfunc semantics and safe-wrapper coverage.

| Feature | Min Kernel | Used By | Reference |
|---------|-----------|---------|-----------|
| `bpf_skb_ct_lookup` / `bpf_ct_release` | 5.18+ | tc-conntrack, tc-ids | Read kernel netfilter conntrack from TC |
| `bpf_xdp_ct_lookup` / `bpf_ct_release` | 5.18+ | xdp-firewall | Read kernel netfilter conntrack from XDP |
| `bpf_ct_change_timeout` | 6.0+ | tc-ids, xdp-firewall | Kill a flow by expiring its conntrack entry |
| `bpf_skb_get_xfrm_info` / `bpf_skb_set_xfrm_info` | 6.2+ | tc-nat-ingress (get), tc-nat-egress (set) | IPsec interface steering via `xfrmi` devices |
| `bpf_xdp_metadata_rx_hash` / `bpf_xdp_metadata_rx_timestamp` | 6.3+ | xdp-firewall, xdp-ratelimit, xdp-loadbalancer | NIC RSS hash and hardware RX timestamp |
| `bpf_dynptr_from_skb` / `bpf_dynptr_from_xdp` / `bpf_dynptr_size` | 6.4+ | tc-ids (skb), xdp-firewall (xdp) | Full packet length, fragments included |
| `bpf_skb_get_fou_encap` / `bpf_skb_set_fou_encap` | 6.4+ | tc-ids (get), tc-nat-egress (set) | FOU/GUE encapsulation metadata |
| `bpf_xdp_metadata_rx_vlan_tag` | 6.8+ | xdp-firewall | Hardware-offloaded VLAN tag |
| `bpf_xdp_get_xfrm_state` / `bpf_xdp_xfrm_state_release` | 6.8+ | xdp-firewall | XDP-side `xfrm_state` lookup |

No cgroup, RCU, iterator or cast kfunc is called: container attribution uses the `bpf_get_current_cgroup_id` and `bpf_skb_cgroup_id` helpers above.

### Other Kernel Features

| Feature | Min Kernel | Description |
|---------|-----------|-------------|
| CO-RE / BTF | 5.8+ | Compile Once, Run Everywhere - portable eBPF binaries |
| `CONFIG_DEBUG_INFO_BTF` | 5.2+ | Type information embedded in vmlinux |
| BPF filesystem pinning | 5.8+ | `/sys/fs/bpf/` map sharing across programs |
| `kprobe_multi` link (`BPF_TRACE_KPROBE_MULTI`) | 5.18+ | Kernel TLS probes of `uprobe-dlp` on `tls_sw_sendmsg`/`tls_sw_recvmsg` |
| BPF token delegation | 6.9+ | Sandboxed BPF object loading from unprivileged user namespaces |
| Netkit device + `BPF_NETKIT_PRIMARY` attach | 6.7+ | Native TC-program attach to netkit interfaces via `BPF_LINK_CREATE` (Cilium 1.16+ pod networking); standard interfaces fall back to TC clsact |

## How the Programs Use the Kernel

### Firewall: Layered Rule Lookup

**Program:** `xdp-firewall`

After the overload set and the kernel conntrack lookup, a packet is matched in this order, the first hit deciding:

| Step | Map | Match Type |
|------|-----|------------|
| 1 | `FW_LPM_*` (LPM trie) | Source CIDR, then destination CIDR |
| 2 | `FW_HASH_5TUPLE` (hash) | Exact 5-tuple |
| 3 | `FW_HASH_PORT` (hash) | Protocol + port |
| 4 | `FIREWALL_RULES` / `FIREWALL_RULES_V6` + `bpf_loop` | Every other rule shape, up to 4096 per family |

NAT has no hash or LPM level: `tc-nat-ingress` and `tc-nat-egress` scan `NAT_DNAT_RULES` / `NAT_SNAT_RULES` (256 entries) with `bpf_loop`.

### Rate Limiter: One Bucket Map

**Program:** `xdp-ratelimit`

Every algorithm keeps its state in one `RL_BUCKETS` map (`LruPerCpuHashMap`) holding a discriminated union (`RateLimitBucketUnion`, 64 bytes). Its size comes from `ratelimit.max_buckets`, 65,536 by default.

### Load Balancer: Two-Level HashMap

**Program:** `xdp-loadbalancer`

- `LB_SERVICES` (HashMap, 4096 entries) → `LbServiceConfigV2` (8 bytes: algorithm, mode, backend count, first backend id)
- `LB_BACKENDS` (HashMap, 65536 entries) → `LbBackendEntry`

Up to 4096 services, each with up to 256 backends.

### Conntrack: Kernel Netfilter Kfuncs

**Programs:** `tc-conntrack`, `xdp-firewall`

Connection tracking uses kernel netfilter directly via `bpf_skb_ct_lookup` / `bpf_xdp_ct_lookup` kfuncs (kernel 5.18+). No BPF-side shadow tables - kernel manages all CT state. `nf_conn` field offsets are resolved at startup from vmlinux BTF and pushed to the `CT_NF_CONN_OFFSETS` Array map. The `INTERFACE_GROUPS` map (6 programs) is pinned to `/sys/fs/bpf/`.

### Attribution: Four Hooks Off the Datapath

**Programs:** `cgroup-attribution`, `tracepoint-process`

Naming the process behind a flow is done by four program types that sit outside the packet path. None of them enforces: every one returns the allow verdict and writes a single record, so a kernel refusing the attach costs a name and never a packet.

| Program type | Hooks | Min Kernel | What its absence costs |
|---|---|---|---|
| `cgroup_sock_addr` | `connect4`, `connect6`, `sendmsg4`, `sendmsg6` | 4.17+ (`sendmsg*` 4.18+) | No socket is recorded as a task opens or sends on it, so an outbound flow carries no workload at all |
| `cgroup_sock` | `post_bind4`, `post_bind6` | 4.17+ | A listening socket is unnamed, so an inbound flow reaching it carries no workload |
| `sock_ops` | `BPF_CGROUP_SOCK_OPS` | 4.13+ | The socket cookie is never joined to the established connection, so conntrack entries and tc alerts fall back to a five-tuple correlation and the workload is reported as `flow` rather than `socket` |
| `raw_tracepoint` | `sched_process_exec`, `sched_process_exit` | 4.17+ | No process table is kept, so a pid resolves to no executable, container, image or unit and the block carries the pid alone |

Every hook is well under the agent's 6.9 floor, so a refusal is a host decision rather than a kernel version: a cgroup v1 hierarchy, a container with no access to the host's cgroup root, a locked-down `bpf()` or a tracepoint the kernel was built without. The attach is all-or-nothing per object, with one exception stated below - a partial set of socket hooks is reported as not attached, because half the hooks would make an absent workload mean two different things.

The exception is the `sock_ops` join, which is the one hook of the object that may be absent on its own. It is also the only program here calling `bpf_get_socket_cookie` from a `sock_ops` context, and a kernel is allowed to take every other hook and refuse that one helper to that one program type. Rather than lose every hook to that, the agent loads the join as optional: the six socket hooks attach, `Socket attribution` reports `attached` with six hooks and a reason carrying the kernel's own error, and an established flow is matched to its socket by five-tuple, so the workload arrives with `flow` as its source rather than `socket`. Every socket is still named. The reason is in the `ebpf kernel-features` output and in `/api/v1/ebpf/kernel-features`, so a host that pays this fallback says so rather than looking identical to one that does not.

What the host actually did is answered per node rather than inferred from this table:

```bash
ebpfsentinel-agent ebpf kernel-features
```

The `Socket attribution` and `Process tracing` sections of that output name the hooks that took, the cgroup they sit on, and the reason where nothing attached. The configuration for both, and the counters they export, are in [attribution](../configuration/attribution.md) and [the process table](../configuration/process-table.md).

### Tiered Ring Buffer Records

**Programs:** `tc-ids`, `tc-dns`, `uprobe-dlp`

Events are fixed-size records; a program that carries a payload reserves a small record when the payload fits and a large one otherwise (for `tc-dns`, 128 or 512 bytes of DNS message), so a short payload does not occupy a full-size slot. No `bpf_dynptr` ring buffer reservation is used.

## Distribution Compatibility

What matters is the running kernel, not the release: any distribution booting 6.9 or later with BTF works. Older LTS distributions need a backport, HWE or mainline kernel channel.

| Distribution | Stock Kernel | Supported |
|-------------|--------------|-----------|
| Debian 13 (Trixie) | 6.12 | Yes |
| Debian 12 (Bookworm) | 6.1 | No - use a backports kernel 6.9+ or upgrade |
| Ubuntu 24.04.2+ | HWE 6.11+ | Yes, with `linux-generic-hwe-24.04` |
| Ubuntu 24.04 (GA kernel) | 6.8 | No - move to the HWE kernel |
| Ubuntu 22.04 LTS | 5.15 (HWE 6.8) | No |
| RHEL 10 / Rocky 10 | 6.12 | Yes |
| RHEL / Rocky 9.x | 5.14 | No - requires ELRepo `kernel-ml` 6.9+ |
| Fedora 41+ | Current stable | Yes |
| Arch Linux | Rolling | Yes |
| Alpine 3.21+ | `linux-lts` 6.12 | Yes |
| Alpine 3.20 and earlier | `linux-lts` 6.6 | No - use `linux-stable` |
| NixOS | Default LTS | Yes, with `boot.kernelPackages = pkgs.linuxPackages_latest` |
| Talos Linux 1.9+ | 6.12 | Yes |

**Not supported:** macOS, Windows, FreeBSD (no Linux eBPF subsystem).

**Architectures:** x86_64 (primary, every integration lane runs here); aarch64/ARM64 binaries and images are built natively by the release pipeline but not exercised by the integration lanes.

## Verifying Kernel Support

```bash
# Check kernel version (must be >= 6.9)
uname -r

# Check BTF support
ls /sys/kernel/btf/vmlinux

# Check available eBPF helpers (requires bpftool)
sudo bpftool feature probe kernel

# Check specific map type support
sudo bpftool feature probe kernel | grep -i bloom
sudo bpftool feature probe kernel | grep -i lpm

# Check loaded eBPF programs
sudo bpftool prog list

# Check loaded eBPF maps
sudo bpftool map list
```
