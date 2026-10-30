#!/usr/bin/env node

// Writes the Sigma field table from the compiler's own list, and fails when
// the page and the list disagree.
//
// The subset is the claim an imported rule set is judged by: a field the page
// calls compiled and the compiler refuses is a rule the reader believes is
// loaded and is not. So the table is not written by hand. It is read off
// `FIELDS` in the enterprise compiler, the same list the compiler consults.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'features', 'enterprise', 'sigma-rules.md');

const DEFAULT_SOURCE = resolve(
  repoRoot,
  '..',
  'ebpfsentinel-enterprise',
  'crates',
  'enterprise-domain',
  'src',
  'sigma',
  'mod.rs',
);
const sourcePath = process.env.EBPFSENTINEL_ENTERPRISE_SIGMA
  ? resolve(process.env.EBPFSENTINEL_ENTERPRISE_SIGMA)
  : DEFAULT_SOURCE;

const checkOnly = process.argv.includes('--check');

const MARKER_ID = 'SIGMA FIELDS';

// How each support level is written on the page, in the order it is listed.
const SUPPORT = new Map([
  ['Compiled', 'Compiled'],
  ['Accepted', 'Accepted, changes nothing'],
  ['Widened', 'Accepted, decided more broadly'],
  ['Refused', 'Refused'],
]);

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
      'The field table is generated from the enterprise tree, which is expected',
      'beside this one. Point EBPFSENTINEL_ENTERPRISE_SIGMA at sigma/mod.rs otherwise.',
    ]);
  }
  return '';
}

function parseRows(source) {
  const start = source.indexOf('pub const FIELDS: &[FieldSupport] = &[');
  if (start === -1) return [];
  const end = source.indexOf('\n];', start);
  const body = source.slice(start, end);
  const pattern =
    /FieldSupport\s*\{\s*field:\s*"((?:[^"\\]|\\.)*)",\s*support:\s*Support::(\w+),\s*note:\s*"((?:[^"\\]|\\.)*)",?\s*\}/g;
  const rows = [];
  for (const match of body.matchAll(pattern)) {
    rows.push({
      field: match[1],
      support: match[2],
      note: match[3].replace(/\\(.)/g, '$1'),
    });
  }
  return rows;
}

function escapeCell(text) {
  return text.replace(/\|/g, '\\|');
}

function render(rows) {
  const order = [...SUPPORT.keys()];
  const sorted = [...rows].sort(
    (a, b) => order.indexOf(a.support) - order.indexOf(b.support),
  );
  const lines = ['| Field or construct | Support | What it means here |', '|---|---|---|'];
  for (const row of sorted) {
    lines.push(
      `| \`${escapeCell(row.field)}\` | ${SUPPORT.get(row.support)} | ${escapeCell(row.note)} |`,
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
      'The markers are where the generated table goes. Put them back rather',
      'than writing the field list by hand.',
    ]);
  }
  return `${page.slice(0, from + begin.length)}\n\n${generated}\n\n${page.slice(to)}`;
}

const rows = parseRows(readSource());

if (rows.length === 0) {
  fail([
    `${relative(process.cwd(), sourcePath)} yielded no field. Refusing to empty the table.`,
    '',
    'The table is read from `FIELDS`, rows written as `FieldSupport {',
    'field, support, note }`. A rename there is a change here.',
  ]);
}

const unknown = [...new Set(rows.map((row) => row.support))].filter(
  (support) => !SUPPORT.has(support),
);
if (unknown.length > 0) {
  fail([
    `The compiler carries ${unknown.length} support level(s) this generator cannot name:`,
    ...unknown.map((support) => `  ${support}`),
    '',
    'Add each one to SUPPORT with the words the page uses for it.',
  ]);
}

const original = readFileSync(pagePath, 'utf8');
const page = splice(original, render(rows));

if (checkOnly) {
  if (page !== original) {
    fail([
      `${relative(process.cwd(), pagePath)} does not match the compiler's field list.`,
      '',
      'Run `npm run generate:sigma-fields` and commit the result.',
    ]);
  }
} else if (page !== original) {
  writeFileSync(pagePath, page);
  console.log(`Wrote the field table of ${relative(process.cwd(), pagePath)}.`);
}

const count = (support) => rows.filter((row) => row.support === support).length;
console.log(
  `Sigma fields OK: ${rows.length} rows, ${count('Compiled')} compiled, ` +
    `${count('Accepted')} accepted, ${count('Widened')} widened, ` +
    `${count('Refused')} refused by name.`,
);
