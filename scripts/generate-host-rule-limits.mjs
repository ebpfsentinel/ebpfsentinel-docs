#!/usr/bin/env node

// Writes the table of what a host rule cannot say from the agent's own list,
// and fails when the page and the list disagree.
//
// The refusal a rule gets when it runs into a limit is built from the same
// rows, so a limit relieved in code and still stated here, or one added in
// code and missing here, is a page telling the reader something the agent no
// longer does. The table is read off `HOST_RULE_LIMITS` in the domain.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'configuration', 'host-rules.md');

const DEFAULT_SOURCE = resolve(
  repoRoot,
  '..',
  'ebpfsentinel',
  'crates',
  'domain',
  'src',
  'hostrule',
  'limits.rs',
);
const sourcePath = process.env.EBPFSENTINEL_HOST_RULE_LIMITS
  ? resolve(process.env.EBPFSENTINEL_HOST_RULE_LIMITS)
  : DEFAULT_SOURCE;

const checkOnly = process.argv.includes('--check');

const MARKER_ID = 'HOST RULE LIMITS';

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readSource() {
  try {
    return readFileSync(sourcePath, 'utf8');
  } catch (err) {
    fail([
      `Cannot read ${sourcePath}: ${err.message}`,
      '',
      'The limits table is generated from the agent tree, which is expected',
      'beside this one. Point EBPFSENTINEL_HOST_RULE_LIMITS at limits.rs otherwise.',
    ]);
  }
  return '';
}

const STRING = '"((?:[^"\\\\]|\\\\.)*)"';

function unescape(text) {
  return text.replace(/\\(.)/g, '$1');
}

function parseRows(source) {
  const constPattern = new RegExp(
    `pub const (\\w+): HostRuleLimit = HostRuleLimit \\{\\s*limit:\\s*${STRING},\\s*written:\\s*${STRING},\\s*instead:\\s*${STRING},?\\s*\\};`,
    'g',
  );
  const byName = new Map();
  for (const match of source.matchAll(constPattern)) {
    byName.set(match[1], {
      limit: unescape(match[2]),
      written: unescape(match[3]),
      instead: unescape(match[4]),
    });
  }
  const list = source.match(/pub const HOST_RULE_LIMITS: \[HostRuleLimit; \d+\] = \[([^\]]*)\];/);
  if (!list) return { rows: [], missing: [] };
  const names = list[1]
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const missing = names.filter((name) => !byName.has(name));
  return { rows: names.filter((name) => byName.has(name)).map((name) => byName.get(name)), missing };
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function render(rows) {
  const lines = ['| Limit | Written as | Instead |', '|---|---|---|'];
  for (const row of rows) {
    lines.push(`| ${capitalise(row.limit)} | ${capitalise(row.written)} | ${capitalise(row.instead)} |`);
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
      'The markers are where the generated table goes. Put them back rather',
      'than writing the limits by hand.',
    ]);
  }
  return `${page.slice(0, from + begin.length)}\n\n${generated}\n\n${page.slice(to)}`;
}

const { rows, missing } = parseRows(readSource());

if (missing.length > 0) {
  fail([
    `HOST_RULE_LIMITS lists ${missing.length} limit(s) this generator could not read:`,
    ...missing.map((name) => `  ${name}`),
    '',
    'Each is read as `pub const NAME: HostRuleLimit = HostRuleLimit { limit, written,',
    'instead };`, every string on one line. A change of shape there is a change here.',
  ]);
}

if (rows.length === 0) {
  fail([
    `${relative(process.cwd(), sourcePath)} yielded no limit. Refusing to empty the table.`,
  ]);
}

const original = readFileSync(pagePath, 'utf8');
const page = splice(original, render(rows));

if (checkOnly) {
  if (page !== original) {
    fail([
      `${relative(process.cwd(), pagePath)} does not match the agent's limits.`,
      '',
      'Run `pnpm generate:host-rule-limits` and commit the result.',
    ]);
  }
} else if (page !== original) {
  writeFileSync(pagePath, page);
  console.log(`Wrote the limits table of ${relative(process.cwd(), pagePath)}.`);
}

console.log(`Host rule limits OK: ${rows.length} limits.`);
