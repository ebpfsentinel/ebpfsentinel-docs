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

// The grant a request needs is decided by the enterprise RBAC middleware alone:
// the domain from the path, the permission from the method, raised on the one
// read that hands out packet content and on the routes that touch the role
// model. The OpenAPI document does not carry it, so the Grant column of the
// enterprise reference is held to those sources instead.
const DEFAULT_ENT_CRATES = resolve(repoRoot, '..', 'ebpfsentinel-enterprise', 'crates');
const entCrates = process.env.EBPFSENTINEL_ENT_CRATES
  ? resolve(process.env.EBPFSENTINEL_ENT_CRATES)
  : DEFAULT_ENT_CRATES;
const entHttpDir = join(entCrates, 'enterprise-adapters', 'src', 'http');
const entRbacEntity = join(entCrates, 'enterprise-domain', 'src', 'rbac', 'entity.rs');

const VERBS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const VERB_SET = new Set(VERBS.map((verb) => verb.toUpperCase()));

const ENTERPRISE_HEADING = '## Enterprise Endpoints';
const SECTION_RE = /^#{3,4}\s+([A-Z]+)\s+(\/\S*)\s*$/;
const SUMMARY_ROW_RE = /^\|\s*([A-Z]+)\s*\|\s*`([^`]+)`\s*\|/;
const INLINE_PAIR_RE = /`([A-Z]+)\s+(\/(?:api\/v1|metrics|healthz|readyz)\S*?)`/g;
const FENCED_PAIR_RE = /^([A-Z]+)\s+(\/(?:api\/v1|metrics|healthz|readyz)\S*)\s*$/;

// Prefix to feature page. Longest match wins, so the more specific prefixes
// come first. Every enterprise operation must fall under one of them.
const FEATURE_DOCS = [
  ['/api/v1/rbac', 'advanced-rbac.md'],
  ['/api/v1/enterprise/ai-security', 'ai-security.md'],
  ['/api/v1/airgap', 'airgap.md'],
  ['/api/v1/analytics', 'analytics.md'],
  ['/api/v1/enterprise/response', 'automated-response.md'],
  ['/api/v1/compliance', 'compliance-reports.md'],
  ['/api/v1/content', 'content-channel.md'],
  ['/api/v1/enterprise/dlp', 'dlp.md'],
  ['/api/v1/enterprise/tls-probes', 'dlp.md'],
  ['/api/v1/agent', 'fleet-management.md'],
  ['/api/v1/flows', 'fleet-management.md'],
  ['/api/v1/exposure', 'fleet-management.md'],
  ['/api/v1/firewall', 'fleet-management.md'],
  ['/api/v1/host-rules', 'fleet-management.md'],
  ['/api/v1/file-watch', 'fleet-management.md'],
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
  ['/api/v1/investigations', 'network-forensics.md'],
  ['/api/v1/intel', 'threat-intel-platforms.md'],
  ['/api/v1/siem', 'siem-integration.md'],
  ['/api/v1/enterprise/tls-intelligence', 'tls-intelligence.md'],
];

// Mounted whatever the license carries, so they belong to no feature. They are
// documented on the enterprise overview page instead. Matched as prefixes the
// same way FEATURE_DOCS is, so a route added under one of them - a second verb
// on an alert, say - is agent-wide too rather than a path nothing claims.
const AGENT_WIDE_DOC = 'overview.md';
const AGENT_WIDE = [
  '/api/v1/alerts',
  '/api/v1/ebpf/kernel-features',
  '/api/v1/ebpf/hidden-ports',
  '/api/v1/ebpf/hidden-processes',
  '/metrics',
  '/healthz',
  '/readyz',
];

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
          if (columns.grant !== -1) claim.grant = trimmed[columns.grant].replace(/`/g, '');
        }
        add(method, path, claim);
        continue;
      }

      const header = trimmed.map((cell) => cell.toLowerCase());
      if (header[0] === 'method' && header[1] === 'path') {
        columns = {
          role: header.indexOf('role'),
          feature: header.indexOf('license feature'),
          grant: header.indexOf('grant'),
        };
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
  if (AGENT_WIDE.some((p) => path === p || path.startsWith(`${p}/`))) {
    return AGENT_WIDE_DOC;
  }
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

function readSource(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    return fail([
      `Cannot read ${path}:`,
      `  ${error.message}`,
      '',
      'The enterprise repository is expected beside this one. Set',
      'EBPFSENTINEL_ENT_CRATES to its crates directory.',
    ]);
  }
}

// The text of one Rust item, from its signature to its closing line.
function itemOf(source, start) {
  const from = source.indexOf(start);
  if (from === -1) fail([`Cannot find \`${start}\` in the RBAC middleware. Update this check.`]);
  const end = start.includes(' const ') ? '];' : '\n}\n';
  return source.slice(from, source.indexOf(end, from));
}

function readGrantRules() {
  const middleware = readSource(join(entHttpDir, 'rbac_middleware.rs'));
  const methodClass = readSource(join(entHttpDir, 'method_class.rs'));
  const names = new Map(
    [...readSource(entRbacEntity).matchAll(/Self::(\w+) => write!\(f, "([a-z0-9_-]+)"\)/g)].map(
      (m) => [m[1], m[2]],
    ),
  );

  const branches = [];
  let conditions = [];
  const body = itemOf(middleware, 'pub fn path_to_domain');
  for (const m of body.matchAll(
    /path\.starts_with\("([^"]+)"\)|path == "([^"]+)"|Some\(SecurityDomain::(\w+)\)/g,
  )) {
    if (m[1]) conditions.push({ prefix: m[1] });
    else if (m[2]) conditions.push({ exact: m[2] });
    else {
      const domain = names.get(m[3]);
      if (!domain) fail([`path_to_domain names SecurityDomain::${m[3]}, which entity.rs never displays.`]);
      branches.push({ conditions, domain });
      conditions = [];
    }
  }

  const admin = [
    ...itemOf(middleware, 'pub const ROLE_MODEL_WRITES').matchAll(
      /\(\s*Method::(\w+),\s*"([^"]+)",?\s*\)/g,
    ),
  ].map((m) => ({ method: m[1], pattern: m[2] }));
  const exempt = [...itemOf(middleware, 'pub const RBAC_EXEMPT_PATHS').matchAll(/"([^"]+)"/g)].map(
    (m) => m[1],
  );
  const capturePrefix = methodClass.match(/CAPTURE_PREFIX: &str = "([^"]+)"/)?.[1];
  const captureSuffix = methodClass.match(/CAPTURE_FILE_SUFFIX: &str = "([^"]+)"/)?.[1];
  if (branches.length === 0 || admin.length === 0 || !capturePrefix || !captureSuffix) {
    fail(['The RBAC middleware no longer reads the way this check expects. Update it.']);
  }
  return { branches, admin, exempt, capturePrefix, captureSuffix };
}

// Segment by segment, a `{name}` on either side standing for one segment.
function sameRoute(path, pattern) {
  const a = path.replace(/\/$/, '').split('/');
  const b = pattern.replace(/\/$/, '').split('/');
  const wild = (segment) => /^\{[^}]+\}$/.test(segment);
  return a.length === b.length && a.every((segment, i) => wild(segment) || wild(b[i]) || segment === b[i]);
}

function grantFor(rules, method, path) {
  if (rules.exempt.includes(path)) return 'none';
  const branch = rules.branches.find(({ conditions }) =>
    conditions.some((c) => (c.exact ? path === c.exact : path.startsWith(c.prefix))),
  );
  if (!branch) return null;
  let permission = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'read' : 'write';
  if (path.startsWith(rules.capturePrefix) && path.endsWith(rules.captureSuffix)) {
    const id = path.slice(rules.capturePrefix.length, -rules.captureSuffix.length);
    if (id && !id.includes('/')) permission = 'write';
  }
  if (rules.admin.some((rule) => rule.method === method && sameRoute(path, rule.pattern))) {
    permission = 'admin';
  }
  return `${branch.domain}:${permission}`;
}

const grantRules = readGrantRules();
const wrongGrant = [];
for (const [pair, claim] of entPage) {
  if (!claim.grant) continue;
  const method = pair.slice(0, pair.indexOf(' '));
  const path = pair.slice(pair.indexOf(' ') + 1);
  const truth = grantFor(grantRules, method, path);
  if (truth === null) {
    wrongGrant.push(`${pair} says ${claim.grant}, and the middleware maps the path to no domain`);
  } else if (claim.grant !== truth) {
    wrongGrant.push(`${pair} says ${claim.grant}, the middleware asks for ${truth}`);
  }
}
report(
  problems,
  'grant in the enterprise reference the RBAC middleware does not ask for',
  wrongGrant.sort(),
  'Take the grant from path_to_domain and required_permission in rbac_middleware.rs.',
);

if (problems.length > 0) fail(problems);

console.log(
  `REST reference OK: ${spec.size} open-source operations in ` +
    `${relative(process.cwd(), openApiJson)}, each with a section and a summary row; ` +
    `${entSpec.size} enterprise operations in ${relative(process.cwd(), entOpenApiJson)}, ` +
    `each on the enterprise reference and on its own feature page.`,
);
