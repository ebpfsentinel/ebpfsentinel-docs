# ebpfsentinel-docs

The user documentation of eBPFsentinel: the open-source agent, the enterprise
layer, the Kubernetes operator and the customer portal. It is a
[Docusaurus](https://docusaurus.io/) site published at
<https://docs.ebpfsentinel.io>. This README is for people changing the pages;
readers start at the site.

## Working on the site

```bash
pnpm install
pnpm start        # local preview with live reload
pnpm typecheck
pnpm build        # the static site, as CI builds it
```

Pages live under `docs/`, one folder per section. Every page is listed in
`sidebars.ts`; a page missing there is a page nobody finds.

## Checks

The pages describe code that lives in other repositories, so every fact that
can drift is generated from that code or checked against it. The scripts in
`scripts/` expect the sibling repositories (`ebpfsentinel`,
`ebpfsentinel-enterprise`, `ebpfsentinel-operator`, `ebpfsentinel-website`)
checked out beside this one, which is how CI runs them.

```bash
pnpm run check:feature-counts   # any single check
```

| Check | Holds |
|---|---|
| `check:feature-counts` | counts marked `<!-- feature-count: <kind> -->` |
| `check:metrics`, `check:ebpf-metric-slots` | metric names and kernel counter slots exist |
| `check:rest-routes`, `check:vendored-openapi`, `check:request-bodies` | routes, the vendored OpenAPI document and JSON bodies match the agent |
| `check:route-commands` | the enterprise command named beside each route exists and calls it |
| `check:config-keys` | every configuration key the loaders accept is documented |
| `check:feature-suites` | every feature page names the test suites behind it |
| `check:cli-reference`, `check:cli-invocations` | every subcommand and command on a page parses |
| `check:grpc-reference`, `check:crd-reference`, `check:mitre-coverage`, `check:suricata-keywords`, `check:sigma-fields`, `check:intel-objects` | generated reference tables |
| `check:above-the-floor`, `check:kernel-matrices` | kernel capability tables and the kernel floor |
| `check:lockdown-programs`, `check:cni-matrix`, `check:host-rule-limits`, `check:shipped-host-rules` | tables generated from the agent's sources |
| `check:enterprise-tiers` | the tier of every licensed page, from the website's price table |
| `check:media-copy` | the clips in `static/media/` match the website's render manifest |
| `check:no-waf-claim`, `check:no-protection-claim`, `check:no-typographic-dash` | wording rules |

A generated table is rewritten with the matching `pnpm run generate:<name>`,
never edited by hand. When a check fails, fix the page or regenerate; do not
loosen the checker.

## Licence

The documentation, code samples included, is licensed under
[Creative Commons Attribution 4.0 International](LICENSE) (CC BY 4.0); the
build scripts of the site are under Apache-2.0. The
software it describes carries its own licences: the open-source agent is
AGPL-3.0, the enterprise layer, the operator and the console are proprietary.
