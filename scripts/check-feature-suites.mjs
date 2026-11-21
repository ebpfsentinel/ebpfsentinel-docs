#!/usr/bin/env node
// Every page under `docs/features/` names the suites that stand behind it, and
// so does every page outside it that the website's feature matrix links as the
// page of a capability it sells (`SELLING_PAGES` below).
//
// A feature page sells a capability. What makes the sentence true is a suite
// that drives the product and reads its answer, and that suite lives in
// another tree, where a page cannot point at it. So the pairing is written
// here, in `feature-suites.toml` beside this script: one line per page,
// exactly one of
//
//   suites = ["oss/11-ebpf-firewall-scenarios", ...]  the suites behind it
//   reason = "..."                                    a page that sells nothing
//   gap    = "..."                                    sells something no suite runs
//
// A suite is named by its tree and its file, without the extension:
//
//   oss/<name>                ebpfsentinel/tests/integration/suites/<name>.bats
//   enterprise/<name>         ebpfsentinel-enterprise/tests/integration/suites/<name>.bats
//   operator/<lane>/<name>    ebpfsentinel-operator/tests/<lane>/suites/<name>.bats
//   dashboard/<path>          ebpfsentinel-dashboard/crates/dashboard-server/<path>.rs
//
// and it must exist and hold at least one test. A page added without a line,
// a line naming a page that is gone, or a suite renamed away from its line
// fails here. Prints the surface summary line `scripts/audit-surfaces.sh`
// collects (meta `docs/COVERAGE.md`).

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, settle, summaryLine } from './lib/surface-manifest.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const parent = resolve(repoRoot, '..');
const featuresRoot = join(repoRoot, 'docs', 'features');

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.mdx?$/.test(entry) ? [path] : [];
  });
}

function suiteFile(id) {
  const parts = id.split('/');
  if (parts[0] === 'oss' && parts.length === 2) {
    return join(parent, 'ebpfsentinel', 'tests', 'integration', 'suites', `${parts[1]}.bats`);
  }
  if (parts[0] === 'enterprise' && parts.length === 2) {
    return join(parent, 'ebpfsentinel-enterprise', 'tests', 'integration', 'suites', `${parts[1]}.bats`);
  }
  if (parts[0] === 'operator' && parts.length === 3) {
    return join(parent, 'ebpfsentinel-operator', 'tests', parts[1], 'suites', `${parts[2]}.bats`);
  }
  if (parts[0] === 'dashboard' && parts.length >= 2) {
    return join(parent, 'ebpfsentinel-dashboard', 'crates', 'dashboard-server', `${parts.slice(1).join('/')}.rs`);
  }
  return null;
}

function holdsATest(path) {
  const text = readFileSync(path, 'utf8');
  return path.endsWith('.bats') ? /^@test /m.test(text) : /#\[(tokio::)?test\]/.test(text);
}

// Pages outside `features/` that the website's matrix links as the page of a
// row it sells: the capability is described there, so its suites are named
// here. The website's `check-matrix-suites.mjs` reads this manifest.
const SELLING_PAGES = [
  'configuration/flow-export',
  'configuration/workload-firewall',
  'operations/enforcement-after-exit',
];

const errors = [];
const present = (page) => existsSync(join(repoRoot, 'docs', `${page}.md`));
for (const page of SELLING_PAGES.filter((page) => !present(page))) {
  errors.push(`${page}.md is gone: drop it from SELLING_PAGES`);
}
const pages = walk(featuresRoot)
  .map((path) => relative(join(repoRoot, 'docs'), path).replace(/\.mdx?$/, ''))
  .concat(SELLING_PAGES.filter(present))
  .sort();
// A scanner that stopped finding the pages would pass on an empty list.
if (pages.length < 80) errors.push(`only ${pages.length} feature pages were read: the walk no longer finds them`);

const manifest = readManifest(join(scriptDir, 'feature-suites.toml'));
const settled = settle({
  surfaces: pages,
  covered: () => false,
  manifest,
  kind: 'pages',
  checkSuites: (_page, suites) => {
    for (const id of suites) {
      const file = suiteFile(id);
      if (!file) return `${id} is not a suite name (oss/, enterprise/, operator/<lane>/, dashboard/)`;
      if (!existsSync(file)) return `${id}: ${relative(parent, file)} does not exist`;
      if (!holdsATest(file)) return `${id}: ${relative(parent, file)} holds no test`;
    }
    return null;
  },
});
errors.push(...settled.errors);

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(`\n${errors.length} feature page(s) not tied to a suite.`);
  process.exit(1);
}
console.log(`Feature pages OK (${pages.length} pages, each named with its suites or its reason).`);
for (const gap of settled.gaps) console.log(`gap: ${gap}`);
console.log(summaryLine('docs/feature-suites', settled));
