#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'api-reference', 'rest-api.md');
const enterprisePagePath = join(repoRoot, 'docs', 'api-reference', 'rest-api-enterprise.md');
const featureDir = join(repoRoot, 'docs', 'features', 'enterprise');

const DEFAULT_OPENAPI_JSON = resolve(repoRoot, '..', 'ebpfsentinel', 'openapi.json');
const openApiJson = process.env.EBPFSENTINEL_OPENAPI_JSON
  ? resolve(process.env.EBPFSENTINEL_OPENAPI_JSON)
  : DEFAULT_OPENAPI_JSON;

const DEFAULT_ENT_OPENAPI_JSON = resolve(
  repoRoot,
  '..',
  'ebpfsentinel-enterprise',
  'openapi.json',
);
const entOpenApiJson = process.env.EBPFSENTINEL_ENT_OPENAPI_JSON
  ? resolve(process.env.EBPFSENTINEL_ENT_OPENAPI_JSON)
  : DEFAULT_ENT_OPENAPI_JSON;

const VERBS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const VERB_SET = new Set(VERBS.map((verb) => verb.toUpperCase()));

const ENTERPRISE_HEADING = '## Enterprise Endpoints';
const SECTION_RE = /^#{3,4}\s+([A-Z]+)\s+(\/\S*)\s*$/;
const SUMMARY_ROW_RE = /^\|\s*([A-Z]+)\s*\|\s*`([^`]+)`\s*\|/;
const INLINE_PAIR_RE = /`([A-Z]+)\s+(\/(?:api\/v1|metrics)\S*?)`/g;
const FENCED_PAIR_RE = /^([A-Z]+)\s+(\/(?:api\/v1|metrics)\S*)\s*$/;

// Prefix to feature page. Longest match wins, so the more specific prefixes
// come first. Every enterprise operation must fall under one of them.
const FEATURE_DOCS = [
  ['/api/v1/rbac', 'advanced-rbac.md'],
  ['/api/v1/enterprise/ai-security', 'ai-security.md'],
  ['/api/v1/airgap', 'airgap.md'],
  ['/api/v1/analytics', 'analytics.md'],
  ['/api/v1/enterprise/response', 'automated-response.md'],
  ['/api/v1/compliance', 'compliance-reports.md'],
  ['/api/v1/enterprise/dlp', 'dlp.md'],
  ['/api/v1/enterprise/tls-probes', 'dlp.md'],
  ['/api/v1/agent', 'fleet-management.md'],
  ['/api/v1/flows', 'fleet-management.md'],
  ['/api/v1/ha', 'high-availability.md'],
  ['/api/v1/enterprise/l7/enriched-alerts', 'l7-alert-enrichment.md'],
  ['/api/v1/enterprise/l7/policy', 'l7-per-protocol-policies.md'],
  ['/api/v1/enterprise/l7', 'l7-deep-inspection.md'],
  ['/api/v1/license', 'license.md'],
  ['/api/v1/enterprise/ml', 'ml-detection.md'],
  ['/api/v1/enterprise/dns', 'ml-detection.md'],
  ['/api/v1/federation', 'multicluster.md'],
  ['/api/v1/tenants', 'multitenancy.md'],
  ['/api/v1/enterprise/tenants', 'multitenancy.md'],
  ['/api/v1/enterprise/alerts', 'multitenancy.md'],
  ['/api/v1/enterprise/audit', 'multitenancy.md'],
  ['/api/v1/enterprise/forensics', 'network-forensics.md'],
  ['/api/v1/forensics', 'network-forensics.md'],
  ['/api/v1/siem', 'siem-integration.md'],
  ['/api/v1/enterprise/tls-intelligence', 'tls-intelligence.md'],
];

// Mounted whatever the license carries, so they belong to no feature. They are
// documented on the enterprise overview page instead.
const AGENT_WIDE_DOC = 'overview.md';
const AGENT_WIDE = ['/api/v1/alerts', '/api/v1/ebpf/kernel-features', '/metrics'];

// Operations deliberately left out of the enterprise reference page. Add a pair
// here only when the route is internal by design, with the reason beside it.
const INTERNAL = new Set([]);

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readOpenApi(path, what) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail([
      `Cannot read the ${what} OpenAPI document at ${path}:`,
      `  ${error.message}`,
      '',
      'The agent repository is expected beside this one. Set',
      'EBPFSENTINEL_OPENAPI_JSON or EBPFSENTINEL_ENT_OPENAPI_JSON to point at',
      'it explicitly.',
    ]);
  }

  const operations = new Map();
  for (const [path_, item] of Object.entries(doc.paths ?? {})) {
    for (const verb of VERBS) {
      const operation = item[verb];
      if (!operation) continue;
      const access = operation['x-access'] ?? {};
      operations.set(`${verb.toUpperCase()} ${path_}`, {
        role: access.role,
        feature: access['license-feature'],
      });
    }
  }
  if (operations.size === 0) {
    fail([`${path} describes no operation at all. Refusing to compare against it.`]);
  }
  return operations;
}

function readPage() {
  const text = readFileSync(pagePath, 'utf8');
  const enterpriseAt = text.indexOf(`\n${ENTERPRISE_HEADING}`);
  if (enterpriseAt === -1) {
    fail([
      `${relative(process.cwd(), pagePath)} carries no "${ENTERPRISE_HEADING}" heading.`,
      '',
      'The heading is where the open-source surface ends. Without it this check',
      'would compare the enterprise routes against the open-source document and',
      'report every one of them as undocumented.',
    ]);
  }

  const sections = new Set();
  const rows = new Set();
  for (const line of text.slice(0, enterpriseAt).split('\n')) {
    const section = SECTION_RE.exec(line);
    if (section) {
      sections.add(`${section[1]} ${section[2]}`);
      continue;
    }
    const row = SUMMARY_ROW_RE.exec(line);
    if (row) rows.add(`${row[1]} ${row[2]}`);
  }
  return { sections, rows };
}

// A documented path may name a concrete resource where the document carries a
// template segment, so `/api/v1/rbac/roles/soc-analyst` satisfies
// `/api/v1/rbac/roles/{id}`. Segment counts still have to agree.
function matchesTemplate(documented, served) {
  if (documented === served) return true;
  const a = documented.split('/');
  const b = served.split('/');
  if (a.length !== b.length) return false;
  return b.every((segment, index) =>
    segment.startsWith('{') && segment.endsWith('}') ? a[index].length > 0 : segment === a[index],
  );
}

function servedPair(pair, served) {
  if (served.has(pair)) return pair;
  const space = pair.indexOf(' ');
  const method = pair.slice(0, space);
  const path = pair.slice(space + 1);
  for (const candidate of served.keys()) {
    const at = candidate.indexOf(' ');
    if (candidate.slice(0, at) !== method) continue;
    if (matchesTemplate(path, candidate.slice(at + 1))) return candidate;
  }
  return null;
}

// Every method and path pair a page states, wherever it states it: a row in a
// table, a line inside a fenced block, or a backticked mention in a sentence.
// Table rows carrying Role and License feature columns are returned with the
// values they claim, so they can be held to the served access rules.
function documentedPairs(text) {
  const found = new Map();
  const lines = text.split('\n');
  let fenced = false;
  let columns = null;

  const add = (method, path, claim) => {
    if (!VERB_SET.has(method)) return;
    const key = `${method} ${path.split('?')[0].replace(/[.,;:]$/, '')}`;
    const prior = found.get(key);
    if (!prior || (claim && !prior.role)) found.set(key, claim ?? {});
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) {
      const pair = FENCED_PAIR_RE.exec(line.trim());
      if (pair) add(pair[1], pair[2]);
      continue;
    }

    if (/^\s*\|/.test(line)) {
      const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
      const trimmed = cells.map((cell) => cell.trim());
      if (trimmed.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;

      const method = trimmed[0]?.replace(/`/g, '');
      const path = trimmed[1]?.replace(/`/g, '');
      if (VERB_SET.has(method) && path?.startsWith('/')) {
        const claim = {};
        if (columns) {
          if (columns.role !== -1) claim.role = trimmed[columns.role];
          if (columns.feature !== -1) claim.feature = trimmed[columns.feature];
        }
        add(method, path, claim);
        continue;
      }

      const header = trimmed.map((cell) => cell.toLowerCase());
      if (header[0] === 'method' && header[1] === 'path') {
        columns = { role: header.indexOf('role'), feature: header.indexOf('license feature') };
        continue;
      }
      columns = null;
      continue;
    }

    columns = null;
    for (const pair of line.matchAll(INLINE_PAIR_RE)) add(pair[1], pair[2]);
  }
  return found;
}

function docFor(path) {
  if (AGENT_WIDE.includes(path)) return AGENT_WIDE_DOC;
  let best = null;
  for (const [prefix, doc] of FEATURE_DOCS) {
    if (path !== prefix && !path.startsWith(`${prefix}/`)) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, doc };
  }
  return best?.doc ?? null;
}

function report(problems, heading, pairs, remedy) {
  if (pairs.length === 0) return;
  if (problems.length > 0) problems.push('');
  problems.push(`${pairs.length} ${heading}:`, '', ...pairs.map((pair) => `  ${pair}`), '', remedy);
}

const spec = readOpenApi(openApiJson, 'open-source');
const entSpec = readOpenApi(entOpenApiJson, 'enterprise');
const served = new Map([...spec, ...entSpec]);

const { sections, rows } = readPage();
const problems = [];

const missingFrom = (expected, actual) =>
  [...expected].filter((pair) => !actual.has(pair)).sort();

report(
  problems,
  'route in the OpenAPI document with no section on the page',
  missingFrom(spec.keys(), sections),
  'Add a "#### METHOD /path" section, taking the request and response shapes from the document.',
);
report(
  problems,
  'section on the page describing a route the agent does not serve',
  missingFrom(sections, new Set(spec.keys())),
  'Remove the section, or move it to rest-api-enterprise.md if the enterprise agent serves it.',
);
report(
  problems,
  'route in the OpenAPI document with no row in the endpoint summary',
  missingFrom(spec.keys(), rows),
  'Add a row to the "## Endpoint Summary" table.',
);
report(
  problems,
  'row in the endpoint summary describing a route the agent does not serve',
  missingFrom(rows, new Set(spec.keys())),
  'Remove the row, or move it to rest-api-enterprise.md if the enterprise agent serves it.',
);

// The enterprise reference is the one place the whole enterprise surface is
// listed, so it is held to the document exactly.
const entPage = documentedPairs(readFileSync(enterprisePagePath, 'utf8'));
report(
  problems,
  'enterprise route with no row in the enterprise reference',
  [...entSpec.keys()].filter((pair) => !entPage.has(pair) && !INTERNAL.has(pair)).sort(),
  `Add a row to ${relative(repoRoot, enterprisePagePath)}, or list the pair in INTERNAL with the reason it is not public.`,
);
report(
  problems,
  'row in the enterprise reference describing a route the agent does not serve',
  [...entPage.keys()].filter((pair) => !servedPair(pair, served)).sort(),
  `Remove the row from ${relative(repoRoot, enterprisePagePath)}. A documented path the binary does not mount answers 404.`,
);

// Every feature page carries the endpoints of its own feature, and no page
// names a path nothing serves.
const pages = new Map();
for (const name of readdirSync(featureDir).sort()) {
  if (!name.endsWith('.md')) continue;
  pages.set(name, documentedPairs(readFileSync(join(featureDir, name), 'utf8')));
}

const uncovered = [];
for (const pair of entSpec.keys()) {
  if (INTERNAL.has(pair)) continue;
  const path = pair.slice(pair.indexOf(' ') + 1);
  const doc = docFor(path);
  if (doc === null) {
    uncovered.push(`${pair} (no feature page claims this prefix)`);
    continue;
  }
  const page = pages.get(doc);
  if (!page) {
    uncovered.push(`${pair} (${doc} does not exist)`);
    continue;
  }
  if (!page.has(pair)) uncovered.push(`${pair} (expected in ${doc})`);
}
report(
  problems,
  'enterprise route missing from the feature page that owns it',
  uncovered.sort(),
  'Document the endpoint on its own feature page. A feature page that lists none of its endpoints sends integrators to the reference for everything.',
);

const ghosts = [];
for (const [name, page] of pages) {
  for (const pair of page.keys()) {
    if (!servedPair(pair, served)) ghosts.push(`${pair} (${name})`);
  }
}
report(
  problems,
  'documented endpoint no agent serves',
  ghosts.sort(),
  'Rename it to the path the binary mounts, or remove it. A documented endpoint that answers 404 costs an integrator an afternoon.',
);

// The role and the license feature both decide whether a call succeeds, so a
// page stating either has to state what the binary enforces.
const wrongAccess = [];
for (const [name, page] of [['rest-api-enterprise.md', entPage], ...pages]) {
  for (const [pair, claim] of page) {
    const match = servedPair(pair, entSpec);
    if (!match) continue;
    const truth = entSpec.get(match);
    if (claim.role && truth.role && claim.role !== truth.role) {
      wrongAccess.push(`${pair} (${name}) says role ${claim.role}, served as ${truth.role}`);
    }
    if (claim.feature && truth.feature && claim.feature !== truth.feature) {
      wrongAccess.push(
        `${pair} (${name}) says feature ${claim.feature}, served as ${truth.feature}`,
      );
    }
  }
}
report(
  problems,
  'documented role or license feature the agent does not enforce',
  wrongAccess.sort(),
  'Take both values from the x-access block of the operation in the enterprise OpenAPI document.',
);

if (problems.length > 0) fail(problems);

console.log(
  `REST reference OK: ${spec.size} open-source operations in ` +
    `${relative(process.cwd(), openApiJson)}, each with a section and a summary row; ` +
    `${entSpec.size} enterprise operations in ${relative(process.cwd(), entOpenApiJson)}, ` +
    `each on the enterprise reference and on its own feature page.`,
);
