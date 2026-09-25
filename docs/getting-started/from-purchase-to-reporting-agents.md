# From Purchase to Reporting Agents

> **Edition: Enterprise**

This page walks the whole path once, in the order the customer portal asks for
it: choose a tier, arm a second factor, issue the licence key, register a
deployment, mint its join secret, install the agents, and read the screen that
proves they are running. Every step is done alone, in the portal at
`https://portal.ebpfsentinel.io` and on your own machines; none of it waits on
anybody at our end.

Each screen named below sits under your organisation, at
`https://portal.ebpfsentinel.io/o/<your-organisation>/`, and is reached from the
navigation beside it.

## Before you start

- An account on the portal. Signing up creates your organisation and makes you
  its **owner**, which is the role that can do every step below.
- Somebody else can do parts of it. An **administrator** can issue keys and run
  deployments but not buy; a **billing** member can buy and nothing else. Roles
  are set under **People**.
- If you were invited, follow the link in the invitation mail. Signed out, it
  names the organisation, who invited you and the role you will hold. **Create
  an account** from there asks for no organisation name and creates none: once
  you confirm your address, the confirmation mail brings you back to the
  invitation and you land inside the organisation that invited you. If you
  already have an account, sign in from the same screen instead.
- The organisation's name can be changed under **Settings** by an owner or an
  administrator. The address `/o/<your-organisation>/` stays as it was, because
  it is the one your colleagues already hold.
- An owner can close an organisation that holds no contract and no deployment,
  also under **Settings**: type its name back, re-type your password when asked, and it is
  gone for every member. This is how an organisation created by mistake, for
  instance by signing up before accepting an invitation, is removed.
- The enterprise [prerequisites](prerequisites.md): a kernel of 6.9 or later with
  BTF, on every node you mean to protect.

## 1. Choose a tier

Open **Billing** and choose **Choose a plan**. Pick the tier, the number of
agents (one per machine you protect), the machine size band and the term, and
declare whether this is a business or a consumer purchase. **Price this** shows
the figure, which is the price published on the website. Prices exclude VAT.

**Go to the checkout** takes you to the seller of record's own page, where the
card is taken and the tax added; we never see the card. You come straight back,
and the subscription reads as active once the seller has reported the payment.

Every paid tier can be bought here. Above a tier's self-serve fleet size the
same tier at the same price is agreed in writing instead, and the screen says
which side of that line your estate is on.

## 2. Arm a second factor

A licence key is not issued to an account held by a password alone. Open your
account, then **Second factors and sign-in devices**, and arm one of:

- **Authenticator**: an app on a device you hold. Add it, type back the code it
  shows, and keep the recovery codes it prints: they are shown once.
- **Devices**: a passkey on this computer or a hardware key. It signs you in on
  its own.

Either one is enough.

## 3. Issue and verify the licence key

Open **Licences** and choose **Issue a key**. The portal asks for your password
again, then signs a key from your contract. Choose **Download the key**; the file
is named after your organisation, for example `ebpfsentinel-acme.lic`.

The key is a **fleet key**: one file for every node, bound to no machine, so a
node that is rebuilt or replaced keeps working with it. What it admits is shown
beside it, and explained in [License](../features/enterprise/license.md#keys-bought-from-the-portal).

Verify it before installing it. Under **Check this file yourself** the page
prints two commands: `sha256sum` against the fingerprint shown beside the key,
and `ebpfsentinel-license inspect` against the two published public keys. The
public keys are deliberately not served by the portal: take them from a
measurements release or from the enterprise release tarball, as described in
[Where the public keys come from](../features/enterprise/license.md#where-the-public-keys-come-from).

## 4. Register a deployment

Open **Deployments** and use **Register a deployment**. A deployment is the unit
your estate is counted in: one per cluster, site or environment you want to see
separately, for example `production` and `staging`. The name is yours and unique
within the organisation.

## 5. Mint a join secret

Open the deployment and, under **Join secrets**, choose **Mint a join secret**.
The portal asks for your password again and shows the secret **once**: only a
digest of it is kept, so copy it before choosing **I have it**.

The installation steps for your deployment shape are printed beside it, with
the portal's address filled in. The secret itself is left out of them on
purpose: every command reads it from a prompt that does not echo, so it ends up
in neither your shell history nor the process list.

A join secret only lets a machine join. Each agent that joins receives a
credential of its own, so withdrawing a join secret later stops new machines and
silences none of the ones already reporting. Several can be live at once, which
is how a rotation costs no downtime, and none of them expires.

## 6. Install the agents

The key and the join secret go to the agents one of three ways. In each, the
key is installed unchanged on every node and the join secret is read from a
Secret or a file, never from a value that is templated or committed.

| Shape | What to do | Reference |
|---|---|---|
| Helm | Create a Secret for the key and one for the join secret, then set `license.secretName`, `portal.enabled`, `portal.baseUrl` and `portal.joinSecret.secretName` | [Enterprise Deployment - Kubernetes (Helm)](../operations/deployment/enterprise.md#kubernetes-helm) |
| Operator | Create the same Secrets, then name them in `EnterpriseSettings` under `licenseSecretRef` and `spec.portal.joinSecretRef` | [Kubernetes Operator - Reporting to the vendor portal](../features/enterprise/kubernetes-operator.md#reporting-to-the-vendor-portal) |
| Host | Install the key at the configured `license_path`, write the join secret to a `0600` file, and point `enterprise.portal.join_secret_file` at it | [Enterprise Deployment - Bare metal](../operations/deployment/enterprise.md#bare-metal-systemd) and [Vendor portal reporting](../configuration/enterprise.md#vendor-portal-reporting) |

On a host, the `enterprise` block of `/etc/ebpfsentinel/config.yaml` then reads:

```yaml
enterprise:
  license_path: /etc/ebpfsentinel/license.key
  portal:
    enabled: true
    base_url: https://portal.ebpfsentinel.io
    join_secret_file: /etc/ebpfsentinel/portal-join-secret
```

Restart the agent after installing a key: which enterprise features run is
decided when the agent starts. Each agent joins under its host name unless
`agent_name` says otherwise, and joining again under the same name is the same
agent rather than a new one, so a node that loses its state is not counted
twice.

## 7. Optionally, send counters

Reporting in and sending counters are two decisions. Up to here an agent only
says it exists, which is what your subscription is measured against. To see
traffic, losses and whether the programs are loaded as graphs in the portal:

1. On the deployment, open **Telemetry for this deployment**, read what is sent
   and what never is, and choose **Turn telemetry on**.
2. Under **Ingest secrets**, choose **Mint an ingest secret** and copy it. It is
   a third credential, neither the key nor the join secret.
3. Give it to the agents beside the join secret: `portal.telemetry.enabled` and
   `portal.ingestSecret.secretName` with Helm, `telemetryEnabled` and
   `ingestSecretRef` with the operator, or `telemetry_enabled` and
   `ingest_secret_file` on a host. See
   [Optional analytics](../configuration/enterprise.md#optional-analytics).

Turning telemetry off withdraws the ingest secrets and leaves the estate counted.

## 8. Check the Entitlement screen

Open **Entitlement**: what you bought, what your key admits, and what is
actually running. It is the proof the steps above worked.

- **Your estate** counts the machines that reported in the last five minutes.
  Every node you installed should be there within one heartbeat.
- **Within your contract** means the machines reporting fit what you bought.
  **Over your contract** means they do not; buy more agents under **Billing**.
- Machines that joined and have not reported lately are listed as **gone quiet**
  beside the count, not in it, so a rolling upgrade does not read as a breach.
- **What your licence key admits** is kept apart from the contract. If the key
  admits fewer machines than you now pay for, replace it from **Licences** and
  install the new file.
- **Where they are** lists the machines per deployment. Open a deployment to see
  each machine under **Machines**, with its version and when it last reported.

If a node is missing, the agent says why in its own log: a refused join secret
is an HTTP 401, a portal it cannot reach is retried with a backoff that grows to
fifteen minutes, and `GET /api/v1/license` on the agent shows whether the key
was accepted.
