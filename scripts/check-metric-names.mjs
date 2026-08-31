#!/usr/bin/env node
// Fails when the documentation names a Prometheus series neither agent
// exposes, and when a series an agent exposes is documented nowhere.
//
// The two registries are the source of truth. Each is read out of the
// checked-in `REGISTERED_METRICS` table in its own metrics module, which that
// agent's own test suite pins to the live `registry.register(...)` calls, so a
// metric renamed in an agent breaks this check on the next docs build rather
// than on the day somebody opens a blank Grafana panel.
//
// The check runs in both directions. A name the documentation carries and no
// registry exposes is a query that returns nothing; a family a registry exposes
// and no page names is a metric nobody can find. The second half is what makes
// the metrics reference the registry rather than a subset of it.
//
// Names belonging to a third binary (the dashboard server) or quoted here only
// as a retired series cannot be derived from either table, so they are listed
// with their source in `known-metrics.json`. An entry nothing references is an
// error too: the list is meant to shrink.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const docsRoot = join(repoRoot, 'docs');
const allowListPath = join(scriptDir, 'known-metrics.json');

const DEFAULT_METRICS_RS = resolve(
  repoRoot,
  '..',
  'ebpfsentinel',
  'crates',
  'adapters',
  'src',
  'metrics.rs',
);
const DEFAULT_ENT_METRICS_RS = resolve(
  repoRoot,
  '..',
  'ebpfsentinel-enterprise',
  'crates',
  'enterprise-infrastructure',
  'src',
  'metrics.rs',
);
const metricsRs = process.env.EBPFSENTINEL_METRICS_RS
  ? resolve(process.env.EBPFSENTINEL_METRICS_RS)
  : DEFAULT_METRICS_RS;
const entMetricsRs = process.env.EBPFSENTINEL_ENT_METRICS_RS
  ? resolve(process.env.EBPFSENTINEL_ENT_METRICS_RS)
  : DEFAULT_ENT_METRICS_RS;

// The enterprise registry is built with `Registry::with_prefix("ebpfsentinel_ent")`,
// so every family it registers is exposed one prefix deeper than the OSS one.
const PREFIX = 'ebpfsentinel_';
const ENT_PREFIX = 'ebpfsentinel_ent_';
const TOKEN = /ebpfsentinel_[a-z0-9_]+/g;
const HISTOGRAM_SUFFIXES = ['_bucket', '_sum', '_count'];

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readRegistry(path, prefix, hint) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    fail([`Cannot read the registry at ${path}.`, ...hint]);
  }

  const start = source.indexOf('const REGISTERED_METRICS');
  if (start === -1) {
    fail([`No REGISTERED_METRICS table in ${path}.`]);
  }
  const end = source.indexOf('];', start);
  const table = source.slice(start, end);

  const entries = [...table.matchAll(/\(\s*"([a-z0-9_]+)"\s*,\s*"([a-z]+)"\s*\)/g)];
  if (entries.length === 0) {
    fail([`REGISTERED_METRICS in ${path} parsed to nothing.`]);
  }

  // A counter is registered bare and the OpenMetrics encoder appends `_total`.
  // A gauge is exported under its own name. A histogram is sampled as
  // `_bucket`, `_sum` and `_count`, and the family name itself is quotable.
  //
  // `exposed` is every name a query may carry; `documentable` is the one name
  // per family a page has to name, which for a histogram is the family rather
  // than its three samples.
  const exposed = new Map();
  const documentable = new Set();
  for (const [, name, kind] of entries) {
    const family = prefix + name;
    if (kind === 'counter') {
      exposed.set(`${family}_total`, kind);
      documentable.add(`${family}_total`);
    } else {
      exposed.set(family, kind);
      documentable.add(family);
      if (kind === 'histogram') {
        for (const suffix of HISTOGRAM_SUFFIXES) exposed.set(family + suffix, kind);
      }
    }
  }
  return { exposed, documentable };
}

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...markdownFiles(full));
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) found.push(full);
  }
  return found;
}

const oss = readRegistry(metricsRs, PREFIX, [
  'Check out the ebpfsentinel repository beside this one, or point',
  'EBPFSENTINEL_METRICS_RS at its crates/adapters/src/metrics.rs.',
]);
const enterprise = readRegistry(entMetricsRs, ENT_PREFIX, [
  'Check out the ebpfsentinel-enterprise repository beside this one, or point',
  'EBPFSENTINEL_ENT_METRICS_RS at its',
  'crates/enterprise-infrastructure/src/metrics.rs.',
]);

// The enterprise prefix is a longer spelling of the OSS one, so the two maps
// cannot collide: a family is registered in one registry or the other.
const exposed = new Map([...oss.exposed, ...enterprise.exposed]);
const allowList = JSON.parse(readFileSync(allowListPath, 'utf8'));
const allowed = new Set(Object.keys(allowList));

const unknown = new Map();
const usedFromAllowList = new Set();
const named = new Set();

for (const file of markdownFiles(docsRoot).sort()) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const token of line.match(TOKEN) ?? []) {
      if (exposed.has(token)) {
        named.add(token);
        continue;
      }
      if (allowed.has(token)) {
        usedFromAllowList.add(token);
        continue;
      }
      if (!unknown.has(token)) unknown.set(token, []);
      unknown.get(token).push(`${relative(repoRoot, file)}:${index + 1}`);
    }
  });
}

const problems = [];

if (unknown.size > 0) {
  problems.push(`${unknown.size} metric name(s) neither registry exposes:`, '');
  for (const [token, places] of [...unknown].sort()) {
    problems.push(`  ${token}`);
    for (const place of places) problems.push(`      ${place}`);
  }
  problems.push(
    '',
    'Either the name is wrong (a counter is exported with a `_total` suffix the',
    'registry does not carry, so check the exported spelling), or the series',
    'belongs to a third binary and needs an entry in scripts/known-metrics.json',
    'naming the registry it comes from.',
  );
}

const undocumented = [
  ['OSS', metricsRs, oss.documentable],
  ['enterprise', entMetricsRs, enterprise.documentable],
]
  .map(([label, path, families]) => [
    label,
    path,
    [...families].filter((name) => !named.has(name)).sort(),
  ])
  .filter(([, , missing]) => missing.length > 0);

for (const [label, path, missing] of undocumented) {
  if (problems.length > 0) problems.push('');
  problems.push(
    `${missing.length} series the ${label} registry exposes and no page names:`,
    '',
    ...missing.map((name) => `  ${name}`),
    '',
    `They are registered in ${relative(repoRoot, path)}. Add each one to`,
    'docs/api-reference/prometheus-metrics.md with its type, its labels and the',
    'feature that writes it. A registered metric nobody can find is a metric',
    'nobody queries.',
  );
}

const stale = [...allowed].filter((token) => !usedFromAllowList.has(token)).sort();
if (stale.length > 0) {
  if (problems.length > 0) problems.push('');
  problems.push(
    `${stale.length} entry in scripts/known-metrics.json that no page names:`,
    '',
    ...stale.map((token) => `  ${token}`),
    '',
    'Remove it. The list is an exception register, not a second catalogue.',
  );
}

if (problems.length > 0) fail(problems);

console.log(
  `Metric names OK: ${oss.documentable.size} OSS and ${enterprise.documentable.size} enterprise ` +
    `families documented, ${exposed.size} queryable series recognised, ` +
    `${allowed.size} allowed from elsewhere.`,
);
