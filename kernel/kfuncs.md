# eBPF KFuncs

KFuncs (kernel functions) are a newer mechanism for exposing kernel functionality to eBPF programs. Unlike helper functions (which are stable ABI), kfuncs can change between kernel versions. eBPFsentinel documents kfuncs it plans to adopt as they become available in aya-ebpf.

## Current Status

eBPFsentinel does not currently call any kfuncs directly. All kernel interactions use stable BPF helper functions. Kfuncs are documented here as the upgrade path for features that require deeper kernel integration.

## Conntrack KFuncs (kernel 5.18+)

The most impactful kfuncs for eBPFsentinel — they enable integration with the kernel's native nf_conntrack instead of maintaining a parallel connection tracking table.

| KFunc | Kernel | Purpose |
|-------|--------|---------|
| `bpf_skb_ct_lookup` | 5.18+ | Look up an existing conntrack entry from TC classifier |
| `bpf_xdp_ct_lookup` | 5.18+ | Look up conntrack from XDP context |
| `bpf_skb_ct_alloc` | 6.0+ | Create a new conntrack entry from TC |
| `bpf_xdp_ct_alloc` | 6.0+ | Create a new conntrack entry from XDP |
| `bpf_ct_insert_entry` | 6.0+ | Insert an allocated conntrack entry |
| `bpf_ct_release` | 5.18+ | Release a conntrack reference |
| `bpf_ct_set_timeout` | 6.0+ | Set timeout on a conntrack entry |
| `bpf_ct_change_timeout` | 6.0+ | Modify timeout on an existing entry |
| `bpf_ct_set_status` | 6.0+ | Set conntrack status flags (NAT, ASSURED) |
| `bpf_ct_change_status` | 6.0+ | Modify existing status flags |
| `bpf_ct_set_nat_info` | 6.1+ | Configure NAT for a conntrack entry |

### Upgrade Path

Current: `tc-conntrack` maintains its own LRU hash map with lazy timeout eviction.

Future: Replace with `bpf_skb_ct_lookup` / `bpf_ct_insert_entry` to:
- Share state with the kernel's nf_conntrack (visible to iptables, nftables, conntrack-tools)
- Get kernel-managed timeouts instead of lazy eviction
- Enable kernel-native NAT via `bpf_ct_set_nat_info`

### Blocker

aya-ebpf 0.1.1 does not support calling kfuncs. Kfuncs require BTF-based function declaration that aya does not yet expose. Tracking: [aya issue](https://github.com/aya-rs/aya/issues).

## XFRM/IPsec KFuncs (kernel 6.2+)

For IPsec-aware packet classification.

| KFunc | Kernel | Purpose |
|-------|--------|---------|
| `bpf_skb_get_xfrm_info` | 6.2+ | Get IPsec transform info from a TC packet |
| `bpf_skb_set_xfrm_info` | 6.2+ | Set IPsec transform info |
| `bpf_xdp_get_xfrm_state` | 6.8+ | Get XFRM state in XDP context |

### Use Case

Detect IPsec-encrypted traffic and apply differentiated policies (allow VPN, block unencrypted). Currently, the IPv6 extension header parser treats ESP (protocol 50) as a terminal header — these kfuncs would provide richer metadata.

## Dynamic Pointer KFuncs (kernel 6.4+)

Safe, bounds-checked packet access replacing manual `ptr_at` patterns.

| KFunc | Kernel | Purpose |
|-------|--------|---------|
| `bpf_dynptr_from_skb` | 6.4+ | Create a dynptr from an SKB for safe access |
| `bpf_dynptr_from_xdp` | 6.4+ | Create a dynptr from an XDP buffer |
| `bpf_dynptr_slice` | 6.4+ | Get a zero-copy slice of packet data |
| `bpf_dynptr_slice_rdwr` | 6.4+ | Get a read-write slice for packet modification |

### Upgrade Path

Current: All packet access goes through `ebpf-helpers::ptr_at()` which manually checks `data + offset + size <= data_end`.

Future: Replace with `bpf_dynptr_from_skb` + `bpf_dynptr_slice` for verifier-friendly, zero-copy packet access. This would eliminate the class of verifier issues we've encountered (unbounded offsets, pointer tracking across function calls).

## XDP Metadata KFuncs (kernel 6.3+)

Hardware-offloaded packet metadata.

| KFunc | Kernel | Purpose |
|-------|--------|---------|
| `bpf_xdp_metadata_rx_timestamp` | 6.3+ | Hardware RX timestamp for precise timing |
| `bpf_xdp_metadata_rx_hash` | 6.3+ | Hardware RSS hash (avoid recalculating) |
| `bpf_xdp_metadata_rx_vlan_tag` | 6.8+ | Hardware VLAN tag extraction |

### Use Case

- Hardware timestamps for sub-microsecond rate limiting precision
- RSS hash reuse for faster flow classification in the load balancer
- VLAN tag extraction without parsing Ethernet headers

## Crypto KFuncs (kernel 6.10+)

In-kernel cryptographic operations.

| KFunc | Kernel | Purpose |
|-------|--------|---------|
| `bpf_crypto_ctx_create` | 6.10+ | Create a crypto context |
| `bpf_crypto_decrypt` | 6.10+ | Decrypt data in eBPF |
| `bpf_crypto_encrypt` | 6.10+ | Encrypt data in eBPF |

### Use Case (future)

- Decrypt TLS traffic for DLP inspection without userspace roundtrip
- Encrypt sensitive event data before ring buffer emission

**Kernel requirement (6.10+)** exceeds our 6.1 minimum — future consideration only.

## String KFuncs (kernel 6.17+)

Native string operations in eBPF.

| KFunc | Kernel | Purpose |
|-------|--------|---------|
| `bpf_strcmp` | 6.17+ | String comparison |
| `bpf_strstr` | 6.17+ | Substring search |
| `bpf_strcasestr` | 6.17+ | Case-insensitive substring search |
| `bpf_strlen` | 6.17+ | String length |

### Use Case (future)

- DNS domain matching without manual byte comparison
- DLP keyword detection in packet payloads
- HTTP header parsing

**Kernel requirement (6.17+)** exceeds our 6.1 minimum — future consideration only.

## Key Verification KFuncs (kernel 6.1+)

Signature verification in eBPF.

| KFunc | Kernel | Purpose |
|-------|--------|---------|
| `bpf_lookup_user_key` | 6.1+ | Look up a key in the user keyring |
| `bpf_verify_pkcs7_signature` | 6.1+ | Verify PKCS7 signatures |

### Use Case

- Verify update signatures before applying config changes
- Validate signed rule bundles from CTI feeds

Available on 6.1+ but requires kfunc support in aya.

## Adoption Timeline

| Phase | Kfuncs | Dependency |
|-------|--------|------------|
| **Phase 1** (when aya adds kfunc support) | CT kfuncs — replace custom conntrack with nf_conntrack integration | aya kfunc API |
| **Phase 2** (kernel 6.4+ target) | Dynptr kfuncs — replace `ptr_at` with safe dynptr access | Minimum kernel bump |
| **Phase 3** (kernel 6.8+ target) | XDP metadata, XFRM kfuncs | Minimum kernel bump |
| **Phase 4** (kernel 6.10+ target) | Crypto kfuncs for DLP, string kfuncs for DNS | Minimum kernel bump |
