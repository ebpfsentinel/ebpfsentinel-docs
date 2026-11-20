# Dashboard on Kubernetes

The dashboard is the web console in front of a fleet of agents: it signs
operators in through the organisation's own identity provider, maps their
groups to tenants, and fans each request out to the agents of the tenant.
It ships as the image `ghcr.io/ebpfsentinel/ebpfsentinel-dashboard` and the
Helm chart `oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-dashboard`, both
published with every release on the
[releases page](https://github.com/ebpfsentinel/ebpfsentinel-release/releases).
The chart's version is the release version and names the image of the same
version.

Every key of the configuration the chart renders is described in
[Dashboard configuration](../../configuration/dashboard.md).

## What to prepare

- An OpenID Connect provider (Keycloak, Dex, Entra ID, Okta or any other)
  where the dashboard can be registered as a confidential client.
- The address operators open the console at, for instance
  `https://dashboard.example.com`, and an Ingress controller or load
  balancer serving it over TLS.
- `openssl`, `kubectl` and Helm 3.12 or later, against Kubernetes 1.27 or
  later.

## 1. Register the dashboard with the identity provider

Create a confidential client using the authorization code flow with PKCE:

| Setting | Value |
|---------|-------|
| Client ID | `ebpfsentinel-dashboard`, or any name, given to the chart as `oidc.clientId` |
| Redirect URI | `<publicUrl>/auth/callback`, for instance `https://dashboard.example.com/auth/callback` |
| Post-logout redirect URI | optional, given to the chart as `oidc.postLogoutRedirectUri` |
| Scopes | `openid profile email groups` |

The dashboard builds the redirect URI from `publicUrl` alone, so the value
registered at the provider and `publicUrl` must name the same scheme, host
and port. The groups the provider puts in the `groups` claim are what
`tenants[].oidc_groups` and `tenants[].admin_groups` match: a person in none
of them is refused with a page saying no tenant is assigned.

Keep the client secret the provider issues for the next step.

## 2. Create the Secrets

```bash
kubectl create namespace ebpfsentinel-dashboard

kubectl -n ebpfsentinel-dashboard create secret generic dashboard-oidc \
    --from-literal=oidc_client_secret='<client secret from the provider>' \
    --from-literal=cookie_signing_key="$(openssl rand -base64 32)"

openssl genpkey -algorithm ed25519 -out dash-1.ed25519.pem
kubectl -n ebpfsentinel-dashboard create secret generic dashboard-jwt \
    --from-file=dash-1.ed25519.pem
```

| Secret | Keys | Chart value |
|--------|------|-------------|
| `dashboard-oidc` | `oidc_client_secret`, `cookie_signing_key` | `oidc.existingSecret` |
| `dashboard-jwt` | one `<id>.ed25519.pem` per signing key | `jwt.existingSecret` |

The chart mounts each key as a file. The `<id>` part of a key name is the
`id` of an entry under `jwt.signingKeys`, so `dash-1.ed25519.pem` above is
read for the key `dash-1`. Without `existingSecret` the chart renders the
Secret itself from inline values, which puts the secret in the values file:
use the Secrets above instead.

## 3. Write the values

```yaml title="dashboard-values.yaml"
publicUrl: https://dashboard.example.com

oidc:
  issuerUrl: https://login.example.com/realms/ebpfsentinel
  clientId: ebpfsentinel-dashboard
  existingSecret: dashboard-oidc

jwt:
  existingSecret: dashboard-jwt
  signingKeys:
    - id: dash-1
      notAfter: "2027-12-31T00:00:00Z"

tenants:
  - id: default
    display_name: Default
    agent_pool: default
    oidc_groups: [dashboard-users]
    admin_groups: [dashboard-admins]
    # The organisation your licences are issued to; an agent whose licence
    # names another stays out of the pool.
    license_org: Example Corp

ingress:
  enabled: true
  className: nginx
  hosts:
    - host: dashboard.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: dashboard-tls
      hosts:
        - dashboard.example.com
```

`issuerUrl` must be `https://`. `notAfter` is when the key stops signing;
[Key rotation runbook](../../configuration/dashboard.md#key-rotation-runbook)
covers adding the next one before it.

## 4. Install

```bash
helm install dashboard oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-dashboard \
    --namespace ebpfsentinel-dashboard --version <version> \
    -f dashboard-values.yaml --wait
helm test dashboard -n ebpfsentinel-dashboard
```

`helm test` runs a pod that asks the service for `/healthz` and `/readyz`.
Opening `publicUrl` then sends the browser to the identity provider and back
to `/auth/callback`.

`helm show values oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-dashboard --version <version>`
prints every value with its comment. The chart also carries two overlays,
read with `helm pull oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-dashboard --version <version> --untar`:
`values-airgap.yaml` (a local registry, no ServiceMonitor, no ClickHouse)
and `values-mssp.yaml` (several tenants, the state store, ClickHouse,
autoscaling). Both name example hosts to replace before use.

## 5. Connect agents

The dashboard reaches each agent's REST API over HTTPS with an API key the
agent lists under `auth.api_keys` (`config.auth.apiKeys` on an
`EbpfSentinelAgent`), sent as `X-API-Key`. An agent URL that is not
`https://` is refused at startup, so the agent serves its API with TLS
([TLS](../../configuration/tls.md), `config.serverTls` on an
`EbpfSentinelAgent`). Put the key in a Secret, hand it to the pod as an
environment variable, and name the variable on the agent entry:

```bash
kubectl -n ebpfsentinel-dashboard create secret generic dashboard-agent-keys \
    --from-literal=edge='<API key the agents list>'
```

```yaml
# added to dashboard-values.yaml
extraEnv:
  - name: AGENT_KEY_EDGE
    valueFrom:
      secretKeyRef:
        name: dashboard-agent-keys
        key: edge

fleetDiscovery:
  mode: static
  staticAgents:
    - tenant: default
      name: node-a
      base_url: https://10.0.0.11:8444
      api_token_env: AGENT_KEY_EDGE
```

`8444` is the enterprise agent's port; an open source agent answers on its
`httpPort`, `8080` unless set. The chart's NetworkPolicy lets the pod reach
agents on `networkPolicy.agentPort` (`8444`) only, so set it to the port
the agents answer on, or add a rule under `networkPolicy.extraEgress`.
`tls_pin_sha256` on an entry pins the agent's public key, described in
[TLS pinning](../../configuration/dashboard.md#tls-pinning).

Apply a change with:

```bash
helm upgrade dashboard oci://ghcr.io/ebpfsentinel/charts/ebpfsentinel-dashboard \
    --namespace ebpfsentinel-dashboard --version <version> \
    -f dashboard-values.yaml
```

## More than one replica

Sessions, revocations and everything operators did live in the pod's memory
unless `stateStore` names a PostgreSQL database, and the chart refuses
`replicaCount` above 1 or autoscaling without it. See
[State store](../../configuration/dashboard.md#state-store).
