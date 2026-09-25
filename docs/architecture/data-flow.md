# Data Flow

## Packet Processing Pipeline

### 1. Ingress (Kernel)

```mermaid
flowchart TD
    NIC["Network Interface"]

    subgraph XDP["XDP Hook (earliest possible)"]
        FW["xdp-firewall"]
        FW_LPM["LPM trie lookup\n(CIDR rules)"]
        FW_SCAN["Linear scan\n(port/protocol/VLAN)"]
        FW --> FW_LPM --> FW_SCAN

        FW_DENY{"Denied?"}
        FW_SCAN --> FW_DENY
        FW_DROP_1["XDP_DROP +\nemit RingBuf event"]
        FW_DENY -- Yes --> FW_DROP_1

        FW_REJECT{"ACTION_REJECT?"}
        FW_DENY -- No --> FW_REJECT
        REJECT_PROG["xdp-firewall-reject\n(tail_call slot 1)"]
        FORGE_RST["Forge TCP RST /\nICMP Unreachable"]
        XDP_TX_1["XDP_TX\n(sent back)"]
        FW_REJECT -- Yes --> REJECT_PROG --> FORGE_RST --> XDP_TX_1

        FW_PASS["XDP_PASS\n(event only for a log rule;\nARP to a VIP tail-calls\nxdp-vip-announcer, slot 3)"]
        FW_REJECT -- No --> FW_PASS

        RL_ABSENT{"ratelimit\npresent?"}
        FW_PASS --> RL_ABSENT

        subgraph RATELIMIT["xdp-ratelimit (tail_call slot 0)"]
            RL_LPM["Country LPM tier lookup\n(RL_LPM_SRC_V4/V6)"]
            RL_DDOS["DDoS protections\n(SYN/ICMP/UDP amp/conntrack)"]
            RL_LPM --> RL_DDOS

            SYN_FLOOD{"SYN flood?"}
            RL_DDOS --> SYN_FLOOD
            SYNCOOKIE["xdp-ratelimit-syncookie\n(tail_call)"]
            FORGE_SYNACK["Forge SYN+ACK cookie"]
            XDP_TX_2["XDP_TX\n(sent back)"]
            SYN_FLOOD -- Yes --> SYNCOOKIE --> FORGE_SYNACK --> XDP_TX_2

            RL_CHECK["Per-IP rate check\n(PerCPU hash)"]
            SYN_FLOOD -- No --> RL_CHECK

            RL_EXCEEDED{"Rate exceeded\nor DDoS?"}
            RL_CHECK --> RL_EXCEEDED
            RL_DROP["XDP_DROP"]
            RL_EXCEEDED -- Yes --> RL_DROP
        end

        RL_ABSENT -- Yes --> RL_LPM

        subgraph LB["xdp-loadbalancer"]
            LB_LOOKUP{"Service\nmatch?"}
            LB_DNAT["DNAT → XDP_TX /\nXDP_REDIRECT"]
            LB_PASS_2["XDP_PASS"]
            LB_LOOKUP -- Yes --> LB_DNAT
            LB_LOOKUP -- No --> LB_PASS_2
        end

        RL_EXCEEDED -- No --> LB_LOOKUP
        RL_ABSENT -- "No (slot 2)" --> LB_LOOKUP
    end

    NIC --> FW

    STACK["Kernel Network Stack\n(SKB allocation)"]
    LB_PASS_2 --> STACK

    subgraph TC["TC Hook (ingress, TCX chain in this order)"]
        IDS["tc-ids"]
        IDS_PARSE["Parse L2/L3/L4 once,\nwrite skb->cb handoff"]
        IDS_SAMPLE["Sampling check\n(map never written:\nevery event passes)"]
        IDS_EMIT["Emit PacketEvent\nto RingBuf"]
        IDS --> IDS_PARSE --> IDS_SAMPLE --> IDS_EMIT

        TI["tc-threatintel"]
        TI_BLOOM["Bloom filter pre-check"]
        TI_VLAN["LRU hash confirmation\n+ VLAN tag on event"]
        IDS_EMIT --> TI --> TI_BLOOM --> TI_VLAN

        DNS["tc-dns"]
        DNS_UDP["Port 53? (read from handoff)"]
        DNS_EMIT["Emit DNS packet\nto RingBuf"]
        TI_VLAN --> DNS --> DNS_UDP --> DNS_EMIT

        CT["tc-conntrack"]
        CT_KF["Kernel netfilter CT probe\n(bpf_skb_ct_lookup kfunc)"]
        CT_RD["nf_conn->status via bpf_probe_read_kernel"]
        DNS_EMIT --> CT --> CT_KF --> CT_RD

        NAT_IN["tc-nat-ingress"]
        NAT_NPTV6["NPTv6 prefix translation\n(stateless)"]
        NAT_DNAT["DNAT rule scan (bpf_loop)\n+ hairpin NAT"]
        NAT_CSUM["L3/L4 checksum update\n(handoff invalidated)"]
        CT_RD --> NAT_IN --> NAT_NPTV6 --> NAT_DNAT --> NAT_CSUM

        SCRUB["tc-scrub"]
        SCRUB_NORM["TTL / MSS / DF / IP ID\nnormalization"]
        SCRUB_TS["TCP timestamp stripping"]
        NAT_CSUM --> SCRUB --> SCRUB_NORM --> SCRUB_TS

        QOS_IN["tc_qos_ingress"]
        QOS_IN_CLASS["Shape ladder\n(ingress rules only)"]
        SCRUB_TS --> QOS_IN --> QOS_IN_CLASS
    end

    STACK --> IDS
```

### 1b. Egress (Kernel)

```mermaid
flowchart TD
    APP["Application"]

    subgraph TC_EGR["TC Hook (egress, TCX chain in this order)"]
        IDS_EGR["tc-ids\n(only with ids.inspect_egress\nor the container resolver)"]
        NAT_EGR["tc-nat-egress"]
        IDS_EGR --> NAT_EGR
        NAT_NPTV6["NPTv6 prefix translation\n(stateless)"]
        NAT_SNAT["SNAT / masquerade rule scan\n(bpf_loop)"]
        NAT_REWRITE["Source IP/port rewrite\n+ checksum update"]
        NAT_EGR --> NAT_NPTV6 --> NAT_SNAT --> NAT_REWRITE

        QOS["tc_qos"]
        QOS_CLASS["Shape ladder\n(skips shapes with no rule)"]
        QOS_TOKEN["Token bucket bandwidth check\n(per-pipe state)"]
        QOS_LOSS["Random loss emulation\n(bpf_get_prandom_u32)"]
        QOS_DELAY["EDT pacing\n(bpf_skb_set_tstamp)"]
        NAT_REWRITE --> QOS --> QOS_CLASS --> QOS_TOKEN --> QOS_LOSS --> QOS_DELAY

        QOS_DROP{"Token exhausted\nor loss hit?"}
        QOS_DELAY --> QOS_DROP
        QOS_SHOT["TC_ACT_SHOT\n(dropped)"]
        QOS_DROP -- Yes --> QOS_SHOT
        QOS_OK["TC_ACT_OK +\nemit QosEvent to RingBuf"]
        QOS_DROP -- No --> QOS_OK
    end

    APP --> IDS_EGR
    WIRE["Wire"]
    QOS_OK --> WIRE

    subgraph UPROBE["uprobe Hook (SSL_write / SSL_read)"]
        DLP["uprobe-dlp"]
        DLP_CAP["Capture plaintext before\nencryption / after decryption"]
        DLP_EMIT["Emit DlpEvent to RingBuf"]
        DLP --> DLP_CAP --> DLP_EMIT
    end

    APP -.->|"plaintext intercept"| DLP
```

### 2. Event Dispatch (Userspace)

```mermaid
flowchart TD
    RB["RingBuf consumers\n(async tasks)"]
    ED["EventDispatcher"]
    ROUTE["Route by program source"]
    RB --> ED --> ROUTE

    subgraph ENGINES["Domain Engines (parallel evaluation, GeoIP-aware)"]
        FW_E["Firewall Engine\nrule audit"]
        IDS_E["IDS Engine\ncountry-aware sampling\nregex evaluation\nper-country thresholds"]
        IPS_E["IPS Engine\nblacklist update\n/24 subnet LPM injection\neBPF map sync"]
        DDOS_E["DDoS Engine\nEWMA rate analysis\nper-country thresholds\ncountry CIDR auto-block"]
        DLP_E["DLP Engine\npattern matching"]
        TI_E["Threat Intel Engine\nfull IOC correlation\ncountry confidence boost"]
        L7_E["L7 Firewall Engine\nprotocol parsing\nsrc/dst country matching\nrule evaluation"]
        DNS_E["DNS Engine\ncache update\nblocklist check\nhigh-risk country reputation"]
        LB_E["LB Engine\nforward/no-backend metrics"]
        QOS_E["QoS Engine\nshaping metrics\npipe/queue stats"]
        DR_E["Domain Reputation\nscoring\nauto-block decision"]
    end

    ROUTE --> FW_E & IDS_E & IPS_E & DDOS_E & DLP_E & TI_E & L7_E & DNS_E & LB_E & QOS_E & DR_E
```

### 3. Alert Pipeline

```mermaid
flowchart TD
    ALERTS["Domain Engine alerts"]

    subgraph ENRICH["Alert Enrichment"]
        DNS_REV["DNS reverse lookup\n(src_ip / dst_ip → domain)"]
        REP["Domain reputation scoring"]
        GEO["GeoIP enrichment\n(country, city, ASN)"]
    end

    ALERTS --> DNS_REV & REP & GEO

    subgraph ROUTER["AlertRouter"]
        DEDUP["Deduplication\n(time-window suppression)"]
        THROTTLE["Throttling\n(per-source rate limit)"]
        ROUTING["Routing\n(severity x component → sender list)"]
        DEDUP --> THROTTLE --> ROUTING
    end

    DNS_REV & REP & GEO --> DEDUP

    subgraph SENDERS["Senders (email and webhook behind a circuit breaker)"]
        EMAIL["Email (SMTP)"]
        WEBHOOK["Webhook (HTTP POST)"]
        LOG["Log (file)"]
        OTLP["OTLP (logs)"]
    end

    ROUTING --> EMAIL & WEBHOOK & LOG & OTLP
```

### 4. External Interfaces

```mermaid
flowchart LR
    subgraph REST["REST API (Axum)"]
        CRUD["Rule CRUD\n(reads and writes rate\nlimited separately)"]
        HEALTH["Status / health"]
        RELOAD["Config reload"]
        OPENAPI["OpenAPI / Swagger UI"]
    end

    subgraph GRPC["gRPC (tonic)"]
        STREAM["AlertStreamService\n(server-streaming)"]
        GRPC_HEALTH["Health check + reflection"]
    end

    subgraph PROM["Prometheus"]
        METRICS["/metrics endpoint\n(counters, histograms, gauges)"]
    end

    CLIENT["External Clients"] --> REST & GRPC & PROM
```

## Hairpin NAT Data Flow

When an internal client accesses a DNAT service via the external IP, and both client and server are on the same internal subnet:

```mermaid
sequenceDiagram
    participant C as Internal Client<br/>192.168.1.100
    participant FWD as tc-nat-ingress<br/>(forward path)
    participant S as Internal Server<br/>192.168.1.50
    participant RET as tc-nat-ingress<br/>(return path)

    C->>FWD: dst = 203.0.113.1:443
    Note over FWD: DNAT lookup:<br/>203.0.113.1:443 -> 192.168.1.50:443
    Note over FWD: Hairpin detection: src (.100)<br/>and dst (.50) both in 192.168.1.0/24
    Note over FWD: Apply DNAT: dst -> 192.168.1.50:443
    Note over FWD: Apply hairpin SNAT:<br/>src -> 192.168.1.1 (hairpin_snat_ip)
    Note over FWD: Store reverse mapping<br/>in NAT_HAIRPIN_CT
    FWD->>S: src = 192.168.1.1, dst = 192.168.1.50:443

    S->>RET: src = 192.168.1.50:443, dst = 192.168.1.1
    Note over RET: NAT_HAIRPIN_CT lookup by 5-tuple
    Note over RET: Reverse hairpin SNAT:<br/>dst -> 192.168.1.100 (original client)
    Note over RET: Reverse DNAT:<br/>src -> 203.0.113.1:443 (external IP)
    RET->>C: src = 203.0.113.1:443 (reply received)
```

## TC Chain Handoff

XDP and TC do not share per-packet metadata: nothing is written with
`bpf_xdp_adjust_meta`, and every TC program works from the skb. What is shared
is the parse *inside* each TC chain. The first classifier that sees the skb
reads the Ethernet header, walks the VLAN and QinQ tags, reads the IP header
and the transport ports, and writes the result into the control-block words
the kernel carries with the skb from one TCX program to the next
(`skb->cb`):

```mermaid
classDiagram
    class PktMeta {
        magic byte
        L3 and L4 offsets
        protocol
        VLAN identifier
        source and destination port
        tenant
        check word
    }

    class FirstClassifier {
        parses the frame once
        writes skb->cb
    }

    class LaterClassifiers {
        verify the check word
        read offsets and ports back
    }

    FirstClassifier --> PktMeta : writes
    PktMeta --> LaterClassifiers : read by
```

The check word folds the other words together with the skb length and the two
interface indexes, because the kernel overwrites the control block on an IP
receive and on a locally originated skb; a mismatch is a re-parse, never a wrong
offset. A NAT rewrite invalidates the handoff before it touches the packet, and
the next program parses again. The layout is in
`crates/ebpf-helpers/src/pktmeta.rs`.

## eBPF↔Userspace Map Synchronization

Some eBPF maps are updated from userspace:

| Map | Direction | Purpose |
|-----|-----------|---------|
| Firewall LPM tries | Userspace → Kernel | Rule updates |
| Rate limit configs | Userspace → Kernel | Policy changes |
| Rate limit country LPM (×2) | Userspace → Kernel | GeoIP country tier reload |
| Rate limit tier configs | Userspace → Kernel | Country tier config reload |
| DDoS protection configs | Userspace → Kernel | SYN/ICMP/amp thresholds, conntrack settings |
| CT_NF_CONN_OFFSETS | Userspace → Kernel | Runtime BTF offsets for `nf_conn` field reads |
| XDP PROG_ARRAYs | Userspace → Kernel | Tail-call wiring: firewall → ratelimit/reject/loadbalancer/VIP announcer, ratelimit → syncookie/loadbalancer |
| Threat intel Bloom filter | Userspace → Kernel | IOC feed refresh |
| Threat intel LRU hash maps | Userspace → Kernel | IOC exact-match confirmation |
| IPS blacklist | Userspace → Kernel | Auto-block IPs |
| Threat intel or IPS maps, from the DNS blocklist | Userspace → Kernel | Addresses a blocked domain resolved to |
| LB service/backend maps | Userspace → Kernel | Load balancer service definitions |
| LB metrics (PerCpuArray) | Kernel → Userspace | Per-CPU forwarding counters |
| QoS pipe/queue/classifier configs | Userspace → Kernel | QoS policy changes |
| QoS metrics (PerCpuArray) | Kernel → Userspace | Per-CPU shaping counters |
