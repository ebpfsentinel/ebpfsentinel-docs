# ebpfsentinel-docs

User documentation for the agent, the enterprise layer, the operator and the customer portal,
built with Docusaurus. Last updated: 2026-11-06. Cross-repo rules live in `../CLAUDE.md`.

## Layout

- `docs/` - the pages: `getting-started/`, `tutorials/`, `features/` (one page per capability,
  `features/enterprise/` for the licensed ones), `configuration/`, `api-reference/`,
  `cli-reference/`, `kernel/`, `operations/`, `integrations/`, `compliance/`, `architecture/`,
  `portal/`, `development/`, `examples/`, plus `intro.md` and `faq.md`.
- `sidebars.ts` - every page is reachable from it; a page missing there is a page nobody finds.
- `scripts/` - one checker or generator per fact the pages state about another tree.
- `.github/workflows/ci.yml` - checks out `ebpfsentinel`, `ebpfsentinel-enterprise` and
  `ebpfsentinel-operator` beside this tree (through `SIBLING_READ_TOKEN`), runs every check, then
  `typecheck` and `build`.

## A number on a page is read from the tree it describes

The pages describe code that lives elsewhere, so every fact that can drift is either generated
from the sibling or checked against it, and CI fails when the sibling moved and the page did not:

| Script | Holds |
|---|---|
| `check:feature-counts` | counts marked `<!-- feature-count: <kind> -->` (programs, REST routes, CLI subcommands, algorithms, ATT&CK techniques) |
| `check:metrics`, `check:ebpf-metric-slots` | every metric name and kernel counter slot a page names exists |
| `check:rest-routes`, `check:vendored-openapi` | routes named on a page exist; the vendored OpenAPI is the agent's |
| `check:cli-reference`, `check:cli-invocations` | every subcommand and every command written in a page parses |
| `check:grpc-reference`, `check:mitre-coverage`, `check:suricata-keywords`, `check:sigma-fields`, `check:intel-objects` | generated reference tables, `generate:*` rewrites them |
| `check:above-the-floor`, `check:kernel-matrices` | the capability table from the agent's `capabilities.json`, and the kernel floor (6.12) wherever a matrix states one |
| `check:cni-matrix`, `check:host-rule-limits`, `check:shipped-host-rules` | the CNI coexistence matrix and the host rule tables, generated from the sources |
| `check:no-waf-claim`, `check:no-protection-claim` | the agent is never called a WAF, mass encryption is never sold as protection |
| `check:no-typographic-dash` | none of the four typographic dashes in any tracked file |

When a check fails, regenerate (`pnpm generate:<name>`) or fix the page; never edit a generated
table by hand and never loosen a checker to make a page pass.

## Writing rules

- A capability the kernel may refuse states its condition in the same paragraph as the claim:
  the BPF LSM needs `bpf` in `lsm=`, the page says what runs without it, and gives
  `ebpfsentinel-agent ebpf host-check` as the command that answers for the reader's host.
- A tutorial starts from the release asset (`ebpfsentinel-demo.tar.gz`, the tarballs, the chart
  from `ebpfsentinel-release`), never from a `git clone`; the clone is how a contributor builds.
- Self-serve: written contact is an exception path, never a step.
- No story or epic reference, no version other than what the release stamps.
- Licensed features name the licence feature that gates them and live under `features/enterprise/`.

## Commands

```bash
pnpm install
pnpm start                 # local preview
pnpm typecheck && pnpm build
pnpm run check:feature-counts   # any single check; CI runs them all with the siblings beside this tree
```
