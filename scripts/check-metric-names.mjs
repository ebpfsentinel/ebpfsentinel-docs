#!/usr/bin/env node
// Fails when the documentation names a Prometheus series the agent does not
// expose.
//
// The agent's registry is the source of truth. It is read out of the checked-in
// `REGISTERED_METRICS` table in the agent's metrics adapter, which the agent's
// own test suite pins to the live `registry.register(...)` calls, so a metric
// renamed in the agent breaks this check on the next docs build rather than on
// the day somebody opens a blank Grafana panel.
//
// Names belonging to another binary (the enterprise agent, the dashboard
// server) or quoted here only as a retired series cannot be derived from that
// table, so they are listed with their source in `known-metrics.json`. An entry
// nothing references is an error too: the list is meant to shrink.

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
const metricsRs = process.env.EBPFSENTINEL_METRICS_RS
  ? resolve(process.env.EBPFSENTINEL_METRICS_RS)
  : DEFAULT_METRICS_RS;

const PREFIX = 'ebpfsentinel_';
const TOKEN = /ebpfsentinel_[a-z0-9_]+/g;
const HISTOGRAM_SUFFIXES = ['_bucket', '_sum', '_count'];

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readRegistry(path) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    fail([
      `Cannot read the agent registry at ${path}.`,
      'Check out the ebpfsentinel repository beside this one, or point',
      'EBPFSENTINEL_METRICS_RS at its crates/adapters/src/metrics.rs.',
    ]);
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
  const exposed = new Map();
  for (const [, name, kind] of entries) {
    const family = PREFIX + name;
    if (kind === 'counter') {
      exposed.set(`${family}_total`, kind);
    } else {
      exposed.set(family, kind);
      if (kind === 'histogram') {
        for (const suffix of HISTOGRAM_SUFFIXES) exposed.set(family + suffix, kind);
      }
    }
  }
  return exposed;
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

const exposed = readRegistry(metricsRs);
const allowList = JSON.parse(readFileSync(allowListPath, 'utf8'));
const allowed = new Set(Object.keys(allowList));

const unknown = new Map();
const usedFromAllowList = new Set();

for (const file of markdownFiles(docsRoot).sort()) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const token of line.match(TOKEN) ?? []) {
      if (exposed.has(token)) continue;
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
  problems.push(
    `${unknown.size} metric name(s) the agent registry does not expose:`,
    '',
  );
  for (const [token, places] of [...unknown].sort()) {
    problems.push(`  ${token}`);
    for (const place of places) problems.push(`      ${place}`);
  }
  problems.push(
    '',
    'Either the name is wrong (a counter is exported with a `_total` suffix the',
    'registry does not carry, so check the exported spelling), or the series',
    'belongs to another binary and needs an entry in scripts/known-metrics.json',
    'naming the registry it comes from.',
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
  `Metric names OK: ${exposed.size} series exposed by ${relative(process.cwd(), metricsRs)}, ` +
    `${allowed.size} allowed from elsewhere.`,
);
