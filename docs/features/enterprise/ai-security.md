# AI/LLM Security

> **Edition: Enterprise** | **License Feature: `ai-llm-security`**

## Overview

AI/LLM Security scores connection events against AI provider destinations: it identifies unsanctioned AI service usage (Shadow AI), scans submitted payloads for sensitive data on its way to an AI provider, judges payload size and request rate against thresholds, and applies encrypted DNS policy. Every one of those produces an alert and a verdict; none of them touches the datapath. Read [What Reaches the Engine](#what-reaches-the-engine) before deploying it.

Five sub-capabilities:

| Capability | Description |
|-----------|-------------|
| AI Provider Registry | 38+ built-in AI provider domain entries with wildcard matching |
| Shadow AI Detection | Monitor, block, or allow-list verdict for AI provider access |
| AI-aware DLP | Regex-based payload scanning for sensitive data sent to AI providers |
| Exfiltration Detection | Per-request, aggregate, and burst rate thresholds |
| Encrypted DNS Policy | Resolver allow/block lists for encrypted DNS (DoH/DoT/DoQ) |

## What Reaches the Engine

The engine is not attached to the packet path. It scores connection events
that are submitted to it: the only entry is
`POST /api/v1/enterprise/ai-security/events`, and nothing on the packet path,
the DLP path or the SIEM path feeds it. An agent with the feature licensed and
configured, and nothing posting events, records no detection of any kind.

That constraint decides what every mode below means. A mode named `block` -
in the shadow AI policy, in an AI DLP pattern or in the encrypted DNS policy -
**drops nothing**. It is the verdict the engine returns in the response body,
for the caller that submitted the event to act on. The agent writes no rule,
touches no eBPF map and closes no connection as a result. Everything the
engine does on its own is observation: it raises an alert, records a metric and
keeps the event in the lists the read endpoints serve.

To enforce against AI providers on the datapath today, use the L7 domain rules
and the DNS intelligence block lists, which are attached to the packet path,
and use this feature for the visibility and the verdict.

## AI Provider Registry

38+ built-in provider entries covering major AI services:

| Category | Providers |
|----------|-----------|
| General-purpose LLMs | OpenAI, Anthropic, Google AI/Gemini, Mistral, Cohere, Together AI, Groq, Fireworks, DeepSeek, Replicate |
| Code assistants | GitHub Copilot, Cursor, Codeium, Tabnine, Sourcegraph Cody |
| Image generation | Midjourney, Stability AI, Leonardo AI |
| Model hubs | Hugging Face, CivitAI |
| Cloud AI platforms | AWS Bedrock, Azure OpenAI, Azure AI, Google Vertex AI |
| Search AI | Perplexity, You.com, Phind |

Domain matching supports exact match and wildcard suffix (e.g. `*.openai.com` matches `api.openai.com` and `chat.openai.com`).

### Custom Providers

Add organization-specific or internal AI services:

> A mistake in this block stops the agent: an unknown key, a value of the wrong type
> or a section that fails its own consistency rules is refused by name at startup rather
> than answered with defaults, because defaults would leave the feature off in an agent
> that reports itself healthy. See
> [what happens when the section is wrong](../../configuration/enterprise.md#what-happens-when-the-section-is-wrong).

```yaml
enterprise:
  ai_security:
    custom_providers:
      - domain: internal-llm.corp.example.com
        provider_name: Internal LLM
        category: internal
        wildcard: false
      - domain: ai.partner.example.com
        provider_name: Partner AI
        category: custom
        wildcard: true
```

Categories: `general_purpose`, `code_assistant`, `image_generation`, `model_hub`, `search_ai`, `custom`, `internal`.

### API

```
GET    /api/v1/enterprise/ai-security/providers
POST   /api/v1/enterprise/ai-security/providers
DELETE /api/v1/enterprise/ai-security/providers/{id}
```

## Shadow AI Detection

Detects outbound connections to AI providers and applies policy:

| Mode | Verdict returned |
|------|------------------|
| `monitor` | Log all AI provider access (default) |
| `block` | `block` for all AI provider access |
| `allow_list` | `block` for providers not on the explicit allow list |

```yaml
enterprise:
  ai_security:
    shadow_ai:
      mode: allow_list
      allowed_providers:
        - OpenAI
        - Anthropic
      exempt_sources:
        - 10.0.0.100       # CI/CD server
        - 192.168.1.50      # admin workstation
```

When a submitted event names an AI provider, the engine:
1. Checks if the source IP is exempt
2. In `allow_list` mode, checks if the provider is in the allowed list
3. Generates an alert with MITRE ATT&CK mapping T1567.002 (Exfiltration to Cloud Storage)

### API

```
GET /api/v1/enterprise/ai-security/shadow-ai/detections
GET /api/v1/enterprise/ai-security/shadow-ai/policy
PUT /api/v1/enterprise/ai-security/shadow-ai/policy
```

## AI-aware DLP

Regex-based scanning of the payload sample on a submitted event whose destination is an AI provider. Separate from the Vectorscan-based enterprise DLP - this is a lightweight, AI-context-specific scanner.

```yaml
enterprise:
  ai_security:
    ai_dlp:
      patterns:
        - id: ssn-ai
          name: SSN in AI prompt
          regex: '\d{3}-\d{2}-\d{4}'
          severity: critical
          data_type: pii
          mode: block
          enabled: true
        - id: api-key-ai
          name: API key leak
          regex: 'sk-[a-zA-Z0-9]{32,}'
          severity: high
          data_type: credentials
          mode: block
          enabled: true
```

Patterns are compiled when they are added, so a scan matches against the
compiled form rather than recompiling the regex per payload. An invalid regex is
refused at the moment the pattern is added.

When a pattern matches payload data in a submitted event:
- An alert is generated with MITRE ATT&CK mapping T1048 (Exfiltration Over Alternative Protocol)
- Metrics are recorded (`ai_dlp_scans`, `ai_dlp_matches`, `ai_dlp_blocks`)
- In `block` mode, the connection result carries the verdict that the traffic should be blocked. The agent does not block it - see [What Reaches the Engine](#what-reaches-the-engine)

### API

```
GET    /api/v1/enterprise/ai-security/ai-dlp/patterns
POST   /api/v1/enterprise/ai-security/ai-dlp/patterns
DELETE /api/v1/enterprise/ai-security/ai-dlp/patterns/{id}
```

## Exfiltration Detection

Tracks the upload volume and request rate reported by submitted events, per source IP. Three threshold types:

| Threshold | `detection_type` | Default | Description |
|-----------|------------------|---------|-------------|
| Per-request | `per_request` | 10 MB | Single request payload size |
| Aggregate hourly | `aggregate_hourly` | 100 MB | Total bytes to AI providers per source per hour |
| Burst rate | `burst_rate` | 60/min | Requests per minute to AI providers |

Those three are the whole vocabulary: a detection exists only where a threshold
does, and the byte counts are the ones the submitted events reported.

```yaml
enterprise:
  ai_security:
    exfiltration:
      per_request_threshold_bytes: 10485760    # 10 MB
      aggregate_threshold_bytes_per_hour: 104857600  # 100 MB
      burst_requests_per_minute: 60
      provider_overrides:
        OpenAI:
          per_request_threshold_bytes: 1048576  # 1 MB for OpenAI
        Hugging Face:
          aggregate_threshold_bytes_per_hour: 524288000  # 500 MB (model downloads)
```

Threshold violations generate alerts with MITRE ATT&CK mapping T1048.001 (Exfiltration Over Symmetric Encrypted Non-C2 Protocol).

Expired trackers (inactive > 2 hours) are garbage-collected every 60 seconds by a background task.

### API

```
GET /api/v1/enterprise/ai-security/exfiltration/sources
GET /api/v1/enterprise/ai-security/exfiltration/thresholds
PUT /api/v1/enterprise/ai-security/exfiltration/thresholds
```

## Encrypted DNS Policy

Enforces policy on encrypted DNS resolvers (DoH, DoT, DoQ):

```yaml
enterprise:
  ai_security:
    encrypted_dns:
      mode: block
      allowed_resolvers:
        - dns.google
        - cloudflare-dns.com
      blocked_resolvers:
        - dns.quad9.net
      bypass_sources:
        - 10.0.0.1       # DNS server itself
```

Policy evaluation order:
1. Bypass sources checked first (always returns `monitor`)
2. Blocked resolver list checked (returns `block` if matched)
3. Allowed resolver list checked (returns `monitor`, whatever the mode says)
4. In `allow_list` mode anything left is blocked; otherwise the policy mode applies

`bypass_sources` are matched as exact addresses, not CIDR ranges.

Violations generate alerts with MITRE ATT&CK mapping T1071.004 (Application Layer Protocol: DNS).

### API

```
GET /api/v1/enterprise/ai-security/encrypted-dns/policy
PUT /api/v1/enterprise/ai-security/encrypted-dns/policy
```

## Event Ingestion

This is the only way an event enters the feature. A submitted event runs the
full pipeline (shadow AI, then exfiltration tracking, then DLP) and the verdicts
come back in the response:

```
POST /api/v1/enterprise/ai-security/events
```

Request body:
```json
{
  "domain": "api.openai.com",
  "src_addr": [167772161, 0, 0, 0],
  "dst_addr": [0, 0, 0, 0],
  "is_ipv6": false,
  "src_port": 54321,
  "dst_port": 443,
  "protocol": 6,
  "sni": "api.openai.com",
  "bytes_sent": 1048576,
  "payload_sample": "Tell me about SSN 123-45-6789",
  "timestamp_ns": 0
}
```

Response:
```json
{
  "shadow_ai_action": "block",
  "exfil_detections": [
    {
      "timestamp_ns": 0,
      "src_addr": [167772161, 0, 0, 0],
      "is_ipv6": false,
      "provider": "OpenAI",
      "detection_type": "per_request",
      "value": 1048576,
      "threshold": 1048576
    }
  ],
  "dlp_matches": [
    {
      "pattern_id": "ssn-ai",
      "pattern_name": "SSN in AI prompt",
      "severity": "critical",
      "data_type": "pii",
      "mode": "block"
    }
  ]
}
```

`shadow_ai_action` is `null` when the domain is not a known AI provider, and the
rest of the pipeline is skipped. Exfiltration tracking runs only when
`bytes_sent` is above zero, and the DLP scan runs only when `payload_sample` is
present. Both `shadow_ai_action` and a match's `mode` are verdicts for the
caller to enforce, not actions the agent took.

## Alerts & Status

```
GET /api/v1/enterprise/ai-security/alerts
GET /api/v1/enterprise/ai-security/status
```

Status returns:
```json
{
  "providers_loaded": 42,
  "shadow_ai_mode": "Monitor",
  "ai_dlp_patterns": 3,
  "ai_dlp_mode": "regex",
  "exfil_tracking_sources": 5,
  "enc_dns_mode": "Block"
}
```

## MITRE ATT&CK Coverage

| Capability | Technique | Name | Tactic |
|-------|-----------|------|--------|
| Shadow AI | T1567.002 | Exfiltration to Cloud Storage | exfiltration |
| AI DLP | T1048 | Exfiltration Over Alternative Protocol | exfiltration |
| Exfiltration | T1048.001 | Exfil Over Symmetric Encrypted Non-C2 | exfiltration |
| Encrypted DNS | T1071.004 | DNS | command-and-control |

## Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `ai_providers_loaded` | Gauge | - |
| `ai_provider_matches` | Counter | provider |
| `ai_shadow_detections` | Counter | provider, action |
| `ai_shadow_bytes` | Counter | provider |
| `ai_dlp_scans` | Counter | - |
| `ai_dlp_matches` | Counter | pattern_id |
| `ai_dlp_blocks` | Counter | - |
| `ai_exfil_detections` | Counter | detection_type |
| `ai_exfil_bytes` | Counter | provider |
| `ai_enc_dns_detections` | Counter | resolver, action |
| `ai_enc_dns_bypassed` | Counter | - |

## REST API

Every path below is served on the Enterprise port. The role is the least-privileged built-in role that satisfies the grant the middleware requires; a custom role carrying the same grant works too.

| Method | Path | Role | License feature | Description |
|--------|------|------|-----------------|-------------|
| `GET` | `/api/v1/enterprise/ai-security/status` | viewer | ai-llm-security | AI security engine state and counters. |
| `GET` | `/api/v1/enterprise/ai-security/alerts` | viewer | ai-llm-security | List AI security alerts. |
| `POST` | `/api/v1/enterprise/ai-security/events` | operator | ai-llm-security | Process a connection event. |
| `GET` | `/api/v1/enterprise/ai-security/providers` | viewer | ai-llm-security | List the known AI provider destinations. |
| `POST` | `/api/v1/enterprise/ai-security/providers` | operator | ai-llm-security | Add an AI provider destination. |
| `DELETE` | `/api/v1/enterprise/ai-security/providers/{id}` | operator | ai-llm-security | Remove an AI provider destination. |
| `GET` | `/api/v1/enterprise/ai-security/shadow-ai/detections` | viewer | ai-llm-security | Unsanctioned AI service use seen on the estate. |
| `GET` | `/api/v1/enterprise/ai-security/shadow-ai/policy` | viewer | ai-llm-security | Current shadow AI policy. |
| `PUT` | `/api/v1/enterprise/ai-security/shadow-ai/policy` | operator | ai-llm-security | Replace the shadow AI policy. |
| `GET` | `/api/v1/enterprise/ai-security/ai-dlp/patterns` | viewer | ai-llm-security | List the prompt inspection patterns. |
| `POST` | `/api/v1/enterprise/ai-security/ai-dlp/patterns` | operator | ai-llm-security | Add a prompt inspection pattern. |
| `DELETE` | `/api/v1/enterprise/ai-security/ai-dlp/patterns/{id}` | operator | ai-llm-security | Remove a prompt inspection pattern. |
| `GET` | `/api/v1/enterprise/ai-security/exfiltration/sources` | viewer | ai-llm-security | Sources ranked by outbound volume to AI providers. |
| `GET` | `/api/v1/enterprise/ai-security/exfiltration/thresholds` | viewer | ai-llm-security | Current exfiltration volume thresholds. |
| `PUT` | `/api/v1/enterprise/ai-security/exfiltration/thresholds` | operator | ai-llm-security | Replace the exfiltration volume thresholds. |
| `GET` | `/api/v1/enterprise/ai-security/encrypted-dns/policy` | viewer | ai-llm-security | Current DoH and DoT handling policy. |
| `PUT` | `/api/v1/enterprise/ai-security/encrypted-dns/policy` | operator | ai-llm-security | Replace the DoH and DoT handling policy. |

## Feature Gating

AI/LLM Security requires a valid license with the `ai-llm-security` feature. Without a license, all AI security endpoints return 404, so there is no route to submit an event to and no detection occurs.
