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

- Full request/response schema documentation for all 23+ endpoints
- Try-it-out functionality (send real requests from the browser)
- Authentication support (enter Bearer token or API key in the Swagger UI)
- Schema validation for request bodies
