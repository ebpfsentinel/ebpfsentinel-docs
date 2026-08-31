# OpenAPI / Swagger

:::tip Browse the spec in these docs
The open-source agent API renders directly in this site at **[API Explorer](/api-reference/api-explorer/)** (Redoc) - no running agent required. The Enterprise surface is not rendered here; read it from a running Enterprise agent, or from the `openapi.json` committed in the Enterprise repository.
:::

There are **two** documents, not one. The open-source agent describes its own surface, and the Enterprise agent describes the surface it adds on top. Neither document contains the other, so a client that has to reach both generates from both.

| | Open source | Enterprise |
|---|---|---|
| Swagger UI | `http://localhost:8080/swagger-ui/` | `https://localhost:8444/swagger-ui/` |
| JSON document | `http://localhost:8080/api-docs/openapi.json` | `https://localhost:8444/api-docs/openapi.json` |
| Committed copy | `openapi.json` at the repository root | `openapi.json` at the repository root |
| Paths / operations | 89 / 105 | 154 / 184 |
| Schema components | 114 | 184 |
| Tags | 27 | 24 |

The open-source agent serves plain HTTP on `8080` unless TLS is configured, in which case the same paths answer over `https`. The Enterprise API is HTTPS on `8444` and the open-source API stays where it is: an Enterprise deployment serves both, so both documents are reachable at once from the same host.

## What each document covers

The open-source document covers the datapath and its control surface: health, agent, firewall, L7 firewall, IPS, IDS, rate limiting, alerts, audit, threat intelligence, ops, DNS, domains, DDoS, conntrack, DLP, NAT, aliases, routing, load balancer, QoS, zones, MITRE ATT&CK, fingerprints, captures and responses.

The Enterprise document covers what the Enterprise layer adds: licensing, enterprise DLP, ML detection, RBAC, tenants and tenant management, tenant events, SIEM, analytics, compliance, air-gap, federation, high availability, fleet, AI security, TLS intelligence, TLS probes, advanced L7, forensics, DNS entropy and automated response. It also describes the two open-source routes the Enterprise binary re-mounts on its own port: the datapath alert store and the kernel feature probe.

## Common to both

- Two security schemes, on every protected operation:
  - `bearer_auth` - JWT Bearer token (RS256, obtained via OIDC or static configuration)
  - `api_key` - static API key via the `X-API-Key` header
- 401 and 403 responses documented on every protected operation
- Try-it-out from the browser through Swagger UI

## The committed documents are checked

Each repository commits the document its agent serves, generated from the `#[utoipa::path]` annotations:

```bash
cargo run -p xtask -- emit-openapi
```

CI regenerates it and fails when the committed copy differs, so a route whose annotation changed without the file being regenerated does not reach a release. A second check enumerates the routes the binary actually mounts and fails when one of them is missing from the document, which is what keeps "every operation is described" a fact rather than an intention.

## SDK generation

```bash
# Open-source surface
curl -o openapi-oss.json http://localhost:8080/api-docs/openapi.json
openapi-generator generate -i openapi-oss.json -g go -o sdk/go/oss

# Enterprise surface
curl -k -o openapi-enterprise.json https://localhost:8444/api-docs/openapi.json
openapi-generator generate -i openapi-enterprise.json -g go -o sdk/go/enterprise
```

Generating from one document alone yields a client that reaches one of the two surfaces.
