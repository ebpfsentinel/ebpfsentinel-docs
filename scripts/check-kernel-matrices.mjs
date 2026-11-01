#!/usr/bin/env node
// The distribution and managed node image matrices are written twice: once in
// the getting-started prerequisites, where a reader installing for the first
// time lands, and once in the operations compatibility page, where an
// operator planning a fleet lands. Two copies of a support verdict drift the
// day one is edited alone, and a reader told "yes" on one page and "no" on the
// other cannot tell which is the product. This check holds the two copies to
// the same rows, cell for cell, and to the same floor in each page's headline.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PAGES = {
  prerequisites: 'docs/getting-started/prerequisites.md',
  compatibility: 'docs/operations/compatibility.md',
};
const MATRICES = [
  { name: 'distributions', headings: { prerequisites: '### Supported Distributions', compatibility: '## Distributions' } },
  { name: 'managed node images', headings: { prerequisites: '### Managed Node Images', compatibility: '## Managed Node Images' } },
];

function tableAfter(text, heading, page) {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    throw new Error(`${page}: heading "${heading}" not found`);
  }
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) {
      rows.push(line);
    } else if (rows.length > 0) {
      break;
    }
  }
  // Drop the header and the alignment row; key the rest by the first cell.
  const body = new Map();
  for (const row of rows.slice(2)) {
    const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
    body.set(cells[0], cells);
  }
  if (body.size === 0) {
    throw new Error(`${page}: no table rows under "${heading}"`);
  }
  return body;
}

const texts = Object.fromEntries(
  Object.entries(PAGES).map(([key, path]) => [key, readFileSync(join(root, path), 'utf8')]),
);
const failures = [];

for (const matrix of MATRICES) {
  const a = tableAfter(texts.prerequisites, matrix.headings.prerequisites, PAGES.prerequisites);
  const b = tableAfter(texts.compatibility, matrix.headings.compatibility, PAGES.compatibility);
  for (const [key, cells] of a) {
    if (!b.has(key)) {
      failures.push(`${matrix.name}: "${key}" is in ${PAGES.prerequisites} and not in ${PAGES.compatibility}`);
    } else if (b.get(key).join(' | ') !== cells.join(' | ')) {
      failures.push(
        `${matrix.name}: "${key}" differs\n    ${PAGES.prerequisites}: ${cells.join(' | ')}\n    ${PAGES.compatibility}: ${b.get(key).join(' | ')}`,
      );
    }
  }
  for (const key of b.keys()) {
    if (!a.has(key)) {
      failures.push(`${matrix.name}: "${key}" is in ${PAGES.compatibility} and not in ${PAGES.prerequisites}`);
    }
  }
}

const floors = Object.entries(texts).map(([key, text]) => {
  const match = text.match(/kernel (?:\*\*)?(\d+\.\d+)\+\*\*/i);
  return [key, match ? match[1] : null];
});
if (floors.some(([, floor]) => floor === null) || new Set(floors.map(([, floor]) => floor)).size !== 1) {
  failures.push(`the headline floor differs or is missing: ${floors.map(([key, floor]) => `${key}=${floor}`).join(', ')}`);
}

if (failures.length > 0) {
  console.error('kernel matrices drifted between the two pages:');
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}
console.log(`kernel matrices agree: ${MATRICES.length} tables, floor ${floors[0][1]}`);
