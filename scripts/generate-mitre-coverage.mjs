#!/usr/bin/env node

// Writes the ATT&CK coverage matrix from the mapping the agent actually
// carries, and fails when the page and the mapping disagree.
//
// The matrix is one row per mapping the alert layer holds, and there are
// sixty-two of them across twelve components. A table that size maintained by
// hand is a table that is wrong by the next release: the page used to carry a
// thirteen-row extract of it and called it the coverage matrix, so a reader
// looking for the technique a rate limit raises found nothing and concluded
// there was none.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'features', 'mitre-attack.md');

const DEFAULT_MITRE = resolve(
  repoRoot,
  '..',
  'ebpfsentinel',
  'crates',
  'domain',
  'src',
  'alert',
  'mitre.rs',
);
const mitrePath = process.env.EBPFSENTINEL_OSS_MITRE
  ? resolve(process.env.EBPFSENTINEL_OSS_MITRE)
  : DEFAULT_MITRE;

const checkOnly = process.argv.includes('--check');

const MARKER_ID = 'MITRE COVERAGE';

// How a component id in the mapping is written on the page, and which edition
// ships it. A component the mapping gains and this table does not is a failure
// rather than a row with a blank edition: naming an enterprise mapping as
// open-source is the mistake this column exists to prevent.
const COMPONENTS = new Map([
  ['firewall', { label: 'Firewall', edition: 'OSS' }],
  ['ips', { label: 'IPS', edition: 'OSS' }],
  ['ratelimit', { label: 'Rate limiting', edition: 'OSS' }],
  ['l7', { label: 'L7 firewall', edition: 'OSS' }],
  ['ddos', { label: 'DDoS', edition: 'OSS' }],
  ['ids', { label: 'IDS', edition: 'OSS' }],
  ['threatintel', { label: 'Threat intelligence', edition: 'OSS' }],
  ['dlp', { label: 'DLP', edition: 'OSS' }],
  ['dns', { label: 'DNS intelligence', edition: 'OSS' }],
  ['ml-anomaly', { label: 'ML anomaly detection', edition: 'Enterprise' }],
  ['ai-security', { label: 'AI security', edition: 'Enterprise' }],
  ['tls-intelligence', { label: 'TLS intelligence', edition: 'Enterprise' }],
]);

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readSource() {
  try {
    return readFileSync(mitrePath, 'utf8');
  } catch (error) {
    fail([
      `Cannot read the ATT&CK mapping at ${mitrePath}:`,
      `  ${error.message}`,
      '',
      'The agent repository is expected beside this one. Set',
      'EBPFSENTINEL_OSS_MITRE to point at its crates/domain/src/alert/mitre.rs.',
    ]);
  }
  return '';
}

// Every mapping is built by the same five-argument constructor, so the
// mapping is read by finding its calls rather than by evaluating Rust.
function parseEntries(source) {
  const call =
    /\bentry\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,\s*"([^"]*)"\s*,?\s*\)/g;
  const entries = [];
  for (const match of source.matchAll(call)) {
    const [, component, technique, name, tactic, trigger] = match;
    entries.push({ component, technique, name, tactic, trigger });
  }
  return entries;
}

function escapeCell(text) {
  return text.replace(/\|/g, '\\|');
}

function render(entries) {
  const lines = [
    '| Component | Edition | Raised by | Technique | Technique name | Tactic |',
    '|-----------|---------|-----------|-----------|----------------|--------|',
  ];
  const order = [...COMPONENTS.keys()];
  const sorted = [...entries].sort(
    (a, b) => order.indexOf(a.component) - order.indexOf(b.component),
  );
  for (const item of sorted) {
    const known = COMPONENTS.get(item.component);
    lines.push(
      `| ${known.label} | ${known.edition} | ${escapeCell(item.trigger)} | ` +
        `${item.technique} | ${escapeCell(item.name)} | ${item.tactic} |`,
    );
  }
  return lines.join('\n');
}

function splice(page, generated) {
  const begin = `<!-- BEGIN GENERATED ${MARKER_ID} -->`;
  const end = `<!-- END GENERATED ${MARKER_ID} -->`;
  const from = page.indexOf(begin);
  const to = page.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    fail([
      `${relative(process.cwd(), pagePath)} carries no "${begin}" / "${end}" pair.`,
      '',
      'The markers are where the generated matrix goes. Put them back rather',
      'than writing sixty-two rows by hand.',
    ]);
  }
  return `${page.slice(0, from + begin.length)}\n\n${generated}\n\n${page.slice(to)}`;
}

const source = readSource();
const entries = parseEntries(source);

if (entries.length === 0) {
  fail([
    `${relative(process.cwd(), mitrePath)} yielded no mapping. Refusing to empty the matrix.`,
    '',
    'The constructor the matrix is read from is `entry(component, technique,',
    'name, tactic, trigger)`. A rename there is a change here.',
  ]);
}

const unknown = [...new Set(entries.map((item) => item.component))].filter(
  (component) => !COMPONENTS.has(component),
);
if (unknown.length > 0) {
  fail([
    `The mapping carries ${unknown.length} component(s) this generator cannot name:`,
    ...unknown.map((component) => `  ${component}`),
    '',
    'Add each one to COMPONENTS with the label it is called on the page and the',
    'edition that ships it.',
  ]);
}

const original = readFileSync(pagePath, 'utf8');
const page = splice(original, render(entries));

if (checkOnly) {
  if (page !== original) {
    fail([
      `${relative(process.cwd(), pagePath)} does not match the ATT&CK mapping.`,
      '',
      'Run `npm run generate:mitre-coverage` and commit the result.',
    ]);
  }
} else if (page !== original) {
  writeFileSync(pagePath, page);
  console.log(`Wrote the coverage matrix of ${relative(process.cwd(), pagePath)}.`);
}

const components = new Set(entries.map((item) => item.component));
const techniques = new Set(entries.map((item) => item.technique));
console.log(
  `MITRE coverage OK: ${entries.length} mappings over ${components.size} components, ` +
    `${techniques.size} distinct techniques.`,
);
