#!/usr/bin/env node

// Writes the lowest tier of every licensed page into the enterprise overview,
// and fails when a page's edition header or the overview disagrees with the
// price table.
//
// The tier a licence feature is first issued on is decided by the portal and
// published by the website in `src/app/core/licence/licence.generated.ts`. A
// tier typed on a page is a tier nobody re-reads when the price table moves:
// four headers here had drifted from it, two selling Critical features as
// Enterprise and two asking Enterprise for Professional ones, and the overview
// had lost six of its pages. This reads the website's table, maps each page to
// the licence feature that gates it, and holds three things to it:
//
// - the tier named first in each page's `> **Edition: ...**` header,
// - the `Lowest tier` column of the overview table, which it writes,
// - that every page under `docs/features/enterprise/` has a row there.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const websiteRoot = process.env.EBPFSENTINEL_WEBSITE_DIR
  ? resolve(process.env.EBPFSENTINEL_WEBSITE_DIR)
  : resolve(repoRoot, '..', 'ebpfsentinel-website');

const checkOnly = process.argv.includes('--check');
const NAME = 'generate-enterprise-tiers';

const LICENCE_TABLE = join(websiteRoot, 'src', 'app', 'core', 'licence', 'licence.generated.ts');
const PAGES_DIR = join(repoRoot, 'docs', 'features', 'enterprise');
const OVERVIEW = 'overview.md';
const TIER_ORDER = ['professional', 'enterprise', 'critical'];
const TIER_NAME = { professional: 'Professional', enterprise: 'Enterprise', critical: 'Critical' };

// The licence feature(s) gating each page, keyed by the link target the
// overview uses (relative to `docs/features/enterprise/`). A page naming
// several features is sold from the lowest tier carrying any of them.
const FEATURES = {
  'advanced-rbac.md': ['advanced-rbac'],
  'airgap.md': ['air-gap'],
  'ai-security.md': ['ai-llm-security'],
  'analytics.md': ['advanced-analytics'],
  'automated-response.md': ['automated-response'],
  'bare-metal-load-balancer.md': ['kubernetes-operator'],
  'base-model.md': ['ml-detection'],
  'compliance-reports.md': ['compliance-reports'],
  'content-channel.md': ['content-channel'],
  'dlp.md': ['advanced-dlp'],
  'fleet-management.md': ['fleet-management'],
  'high-availability.md': ['high-availability'],
  'kubernetes-operator.md': ['kubernetes-operator'],
  'l7-alert-enrichment.md': ['advanced-dlp'],
  'l7-deep-inspection.md': ['advanced-dlp'],
  'l7-per-protocol-policies.md': ['advanced-dlp'],
  'ml-detection.md': ['ml-detection'],
  'multicluster.md': ['multi-cluster'],
  'multitenancy.md': ['multi-tenancy'],
  'network-forensics.md': ['network-forensics'],
  'reachable-vulnerabilities.md': ['fleet-management'],
  'regulated-estates.md': [
    'regulatory-notification',
    'control-assurance',
    'runtime-attestation',
    'sealed-audit',
  ],
  'siem-integration.md': ['siem-integration'],
  'sigma-rules.md': ['sigma-rules'],
  'tamper-protection.md': ['tamper-protection'],
  'threat-intel-platforms.md': ['threat-intel-platforms'],
  'tls-intelligence.md': ['tls-intelligence'],
  '../l7-firewall.md#supported-protocols---enterprise-extension-port': ['extended-l7-protocols'],
};

// Pages and rows no single licence feature gates, each with the tier it is
// sold from and why that tier rather than a feature's.
const STATED = {
  // The licence system is what every paid key goes through.
  'license.md': 'professional',
  // The console and its screens carry no licence feature; the price table
  // sells cases and hunting, and the console that serves them, from Enterprise.
  'dashboard.md': 'enterprise',
  'cases.md': 'enterprise',
  'hunting.md': 'enterprise',
  // The DLP page states this coverage from Enterprise in its own header.
  'dlp.md#extended-tls-library-coverage': 'enterprise',
};

function readTiers() {
  let source;
  try {
    source = readFileSync(LICENCE_TABLE, 'utf8');
  } catch (error) {
    console.error(`${NAME}: cannot read ${LICENCE_TABLE}: ${error.message}`);
    console.error(`${NAME}: the website repository is expected beside this one, or at EBPFSENTINEL_WEBSITE_DIR`);
    process.exit(1);
  }
  const block = source.match(/LICENCE_FEATURE_TIERS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  if (!block) throw new Error(`${LICENCE_TABLE}: no LICENCE_FEATURE_TIERS object`);
  const tiers = new Map();
  for (const [, feature, tier] of block[1].matchAll(/'([a-z0-9-]+)':\s*'([a-z]+)'/g)) {
    if (!TIER_ORDER.includes(tier)) throw new Error(`${LICENCE_TABLE}: ${feature} on unknown tier ${tier}`);
    tiers.set(feature, tier);
  }
  if (tiers.size === 0) throw new Error(`${LICENCE_TABLE}: LICENCE_FEATURE_TIERS is empty`);
  return tiers;
}

const featureTiers = readTiers();
const problems = [];

function lowestTier(target) {
  if (target in STATED) return STATED[target];
  const features = FEATURES[target];
  if (!features) return null;
  let best = null;
  for (const feature of features) {
    const tier = featureTiers.get(feature);
    if (!tier) {
      problems.push(`${target}: licence feature \`${feature}\` is not in the website's price table`);
      continue;
    }
    if (best === null || TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(best)) best = tier;
  }
  return best;
}

// Every page names its lowest tier first in its edition header.
const pages = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.md'));
for (const page of pages) {
  if (page === OVERVIEW) continue;
  const expected = lowestTier(page);
  if (expected === null) {
    problems.push(`${page}: no licence feature or stated tier in ${NAME}.mjs; add it to FEATURES or STATED`);
    continue;
  }
  const header = readFileSync(join(PAGES_DIR, page), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('> **Edition:'));
  const named = header?.match(/^> \*\*Edition: (Professional|Enterprise|Critical)\b/);
  if (!named) {
    problems.push(`${page}: no \`> **Edition: <tier>\` header (expected ${TIER_NAME[expected]})`);
  } else if (named[1] !== TIER_NAME[expected]) {
    problems.push(`${page}: header says ${named[1]}, the price table sells it from ${TIER_NAME[expected]}`);
  }
}

// The overview's table: one row per page, its tier column written from the table.
const overviewPath = join(PAGES_DIR, OVERVIEW);
const text = readFileSync(overviewPath, 'utf8');
const lines = text.split('\n');
const headerAt = lines.findIndex((line) => /^\| Feature \| Lowest tier \| Description \|/.test(line));
if (headerAt < 0) {
  problems.push(`${OVERVIEW}: no \`| Feature | Lowest tier | Description |\` table`);
} else {
  const linked = new Set();
  for (let i = headerAt + 2; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('<!--')) continue;
    if (!line.startsWith('|')) break;
    const cells = line.split(' | ');
    const link = cells[0].match(/\]\(([^)]+)\)/);
    if (!link) {
      problems.push(`${OVERVIEW}:${i + 1}: row links no page`);
      continue;
    }
    const target = link[1];
    linked.add(target.split('#')[0]);
    const tier = lowestTier(target);
    if (tier === null) {
      problems.push(`${OVERVIEW}:${i + 1}: ${target} has no licence feature or stated tier in ${NAME}.mjs`);
      continue;
    }
    cells[1] = TIER_NAME[tier];
    lines[i] = cells.join(' | ');
  }
  for (const page of pages) {
    if (page !== OVERVIEW && !linked.has(page)) problems.push(`${OVERVIEW}: no row for ${page}`);
  }
}

const next = lines.join('\n');
if (next !== text) {
  if (checkOnly) {
    problems.push(`${OVERVIEW}: the Lowest tier column differs from the price table; run npm run generate:enterprise-tiers`);
  } else {
    writeFileSync(overviewPath, next);
    console.log(`${NAME}: wrote ${OVERVIEW}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`${NAME}: ${problem}`);
  process.exit(1);
}
console.log(`${NAME}: ${pages.length} pages and the overview match the price table (${featureTiers.size} licence features)`);
