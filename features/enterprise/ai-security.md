# AI/LLM Security

> **Edition: Enterprise** | **Status: Shipped** | **License Feature: `ai-llm-security`**

## Overview

AI/LLM Security detects and controls unauthorized AI service usage (Shadow AI), scans outbound traffic to AI providers for sensitive data exfiltration, enforces payload size and rate thresholds, and applies encrypted DNS policies. It builds on the existing DNS intelligence and L7 domain enforcement capabilities.

Five sub-capabilities:

| Capability | Story | Description |
|-----------|-------|-------------|
| AI Provider Registry | 38+ built-in AI provider domain entries with wildcard matching |
| Shadow AI Detection | Monitor, block, or allow-list mode for AI provider access |
| AI-aware DLP | Regex-based payload scanning for sensitive data sent to AI providers |
| Exfiltration Detection | Per-request, aggregate, and burst rate threshold enforcement |
| Encrypted DNS Policy | Resolver allow/block lists for encrypted DNS (DoH/DoT/DoQ) |

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

| Mode | Behavior |
|------|----------|
| `monitor` | Log all AI provider access (default) |
| `block` | Block all AI provider access |
| `allow_list` | Block providers not on the explicit allow list |

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

When a connection to an AI provider is detected, the engine:
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

Regex-based payload scanning applied when traffic is destined for an AI provider. Separate from the Vectorscan-based enterprise DLP — this is a lightweight, AI-context-specific scanner.

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

When a pattern matches payload data sent to an AI provider:
- An alert is generated with MITRE ATT&CK mapping T1048 (Exfiltration Over Alternative Protocol)
- Metrics are recorded (`ai_dlp_scans`, `ai_dlp_matches`, `ai_dlp_blocks`)
- In `block` mode, the connection result indicates the traffic should be blocked

### API

```
GET    /api/v1/enterprise/ai-security/ai-dlp/patterns
POST   /api/v1/enterprise/ai-security/ai-dlp/patterns
DELETE /api/v1/enterprise/ai-security/ai-dlp/patterns/{id}
```

## Exfiltration Detection

Tracks upload volume and request rates to AI providers per source IP. Three threshold types:

| Threshold | Default | Description |
|-----------|---------|-------------|
| Per-request | 10 MB | Single request payload size |
| Aggregate hourly | 100 MB | Total bytes to AI providers per source per hour |
| Burst rate | 60/min | Requests per minute to AI providers |

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
3. If an allow list is configured, anything not on it uses the policy mode

Violations generate alerts with MITRE ATT&CK mapping T1071.004 (Application Layer Protocol: DNS).

### API

```
GET /api/v1/enterprise/ai-security/encrypted-dns/policy
PUT /api/v1/enterprise/ai-security/encrypted-dns/policy
```

## Event Ingestion

Process outbound connection events through the full AI security pipeline (shadow AI + exfiltration + DLP):

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

Response includes shadow AI action, exfiltration detections, and DLP matches.

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

| Story | Technique | Name | Tactic |
|-------|-----------|------|--------|
| Shadow AI | T1567.002 | Exfiltration to Cloud Storage | exfiltration |
| AI DLP | T1048 | Exfiltration Over Alternative Protocol | exfiltration |
| Exfiltration | T1048.001 | Exfil Over Symmetric Encrypted Non-C2 | exfiltration |
| Encrypted DNS | T1071.004 | DNS | command-and-control |

## Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `ai_providers_loaded` | Gauge | — |
| `ai_provider_matches` | Counter | provider |
| `ai_shadow_detections` | Counter | provider, action |
| `ai_shadow_bytes` | Counter | provider |
| `ai_dlp_scans` | Counter | — |
| `ai_dlp_matches` | Counter | pattern_id |
| `ai_dlp_blocks` | Counter | — |
| `ai_exfil_detections` | Counter | detection_type |
| `ai_exfil_bytes` | Counter | provider |
| `ai_enc_dns_detections` | Counter | resolver, action |
| `ai_enc_dns_bypassed` | Counter | — |

## Feature Gating

AI/LLM Security requires a valid license with the `ai-llm-security` feature. Without a license, all AI security endpoints return 404 and no detection occurs.
