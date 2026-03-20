# OpenAPI / Swagger

eBPFsentinel serves an interactive OpenAPI 3.0 specification when the agent is running.

## Swagger UI

Browse and test the REST API interactively:

```
http://localhost:8080/swagger-ui/
```

With TLS:

```
https://localhost:8080/swagger-ui/
```

## OpenAPI JSON Spec

Machine-readable OpenAPI 3.0 specification:

```
http://localhost:8080/api-docs/openapi.json
```

Use this to generate client libraries, import into Postman, or integrate with API gateways.

## Features

- Full request/response schema documentation for all 82 endpoints (97 paths including health/metrics)
- SecurityScheme definitions for both authentication methods:
  - `bearer_auth` — JWT Bearer token (RS256, obtained via OIDC or static configuration)
  - `api_key` — Static API key via `X-API-Key` header
- 401/403 error responses documented on all protected endpoints
- 25 domain tags (Health, Firewall, L7, IPS, IDS, Rate Limiting, Alerts, Audit, Threat Intel, Ops, DNS, Domains, DDoS, ConnTrack, DLP, NAT, Aliases, Routing, Load Balancer, QoS, Zones, MITRE ATT&CK, Fingerprints, Captures, Responses)
- 80+ schema components with full type definitions
- Try-it-out functionality (send real requests from the browser)

## SDK Generation

The OpenAPI spec can be used to generate typed client libraries:

```bash
# Download the spec
curl -o openapi.json http://localhost:8080/api-docs/openapi.json

# Generate Go client
openapi-generator generate -i openapi.json -g go -o sdk/go

# Generate Python client
openapi-generator generate -i openapi.json -g python -o sdk/python
```
