#!/usr/bin/env node

// Every route table on the enterprise feature pages names, beside each route,
// the command of `ebpfsentinel-enterprise-agent` that calls it. This holds the
// column to the binary: a command named there is one the enterprise command
// tree has (read from the `cli.json` the enterprise repository commits and a
// test keeps equal to the parser), and a route marked `none` is one the
// enterprise exclusion file says the command line leaves alone on purpose,
// because something other than a person calls it. A route a person can reach
// only by writing curl is a route this check fails on.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagesDir = join(repoRoot, 'docs', 'features', 'enterprise');
const entRoot = process.env.EBPFSENTINEL_ENT_ROOT
  ? resolve(process.env.EBPFSENTINEL_ENT_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel-enterprise');

const HEADER = /^\|\s*Method\s*\|\s*Path\s*\|(.*)$/;
const ROW = /^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`([^`]+)`\s*\|([^|]*)\|/;

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function read(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    fail([
      `Cannot read ${what} at ${path}:`,
      `  ${error.message}`,
      '',
      'The enterprise repository is expected beside this one. Set',
      'EBPFSENTINEL_ENT_ROOT to point at it.',
    ]);
  }
  return '';
}

function shape(path) {
  return path.replace(/\{[^}]*\}/g, '{}').split('?')[0];
}

const tree = JSON.parse(read(join(entRoot, 'cli.json'), 'the enterprise command tree'));
const commands = new Set(tree.commands.map((command) => command.path));

// The exclusion file holds one `method`, `path` and `reason` per table.
const excluded = new Set();
let method = null;
for (const line of read(join(entRoot, 'cli-parity-exclusions.toml'), 'the exclusion file').split('\n')) {
  const m = /^method\s*=\s*"([A-Z]+)"/.exec(line);
  if (m) method = m[1];
  const p = /^path\s*=\s*"([^"]+)"/.exec(line);
  if (p && method) excluded.add(`${method} ${shape(p[1])}`);
}

const problems = [];
let rows = 0;
for (const name of readdirSync(pagesDir).filter((file) => file.endsWith('.md')).sort()) {
  const file = join(pagesDir, name);
  const where = relative(process.cwd(), file);
  let inTable = false;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const header = HEADER.exec(line);
      if (header) {
        inTable = true;
        if (!/^\s*Command\s*\|/.test(header[1])) {
          problems.push(`${where}:${index + 1}: a route table whose third column is not "Command".`);
        }
        return;
      }
      if (!line.startsWith('|')) {
        inTable = false;
        return;
      }
      const row = ROW.exec(line);
      if (!inTable || !row) return;
      rows += 1;
      const route = `${row[1]} ${row[2]}`;
      const cell = row[3].trim();
      if (cell === 'none') {
        if (!excluded.has(`${row[1]} ${shape(row[2])}`)) {
          problems.push(
            `${where}:${index + 1}: ${route} names no command, and the enterprise exclusion file does not leave it out.`,
          );
        }
        return;
      }
      const named = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      if (named.length === 0) {
        problems.push(`${where}:${index + 1}: ${route} has "${cell}" where a command or "none" belongs.`);
      }
      for (const command of named) {
        if (!commands.has(command)) {
          problems.push(`${where}:${index + 1}: ${route} names \`${command}\`, which ${tree.binary} does not have.`);
        }
      }
    });
}

if (problems.length > 0) {
  fail([
    `${problems.length} problem${problems.length === 1 ? '' : 's'} in the route tables of the enterprise pages:`,
    '',
    ...problems.map((problem) => `  ${problem}`),
    '',
    `Each route names the ${tree.binary} command that calls it, or "none" where the`,
    'enterprise cli-parity-exclusions.toml says no person calls it.',
  ]);
}

console.log(`Route commands OK: ${rows} routes on the enterprise pages, each beside its command or excluded on purpose.`);
