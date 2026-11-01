#!/usr/bin/env node

// Writes the table of the host rules the agent ships from the file the agent
// embeds, and fails when the page and the file disagree.
//
// The rules are content in the operator's own syntax, so the page lists what
// each one is about and leaves the matchers to the file, which is linked. A
// rule added, removed or renamed there and not here is a page promising a
// detection the agent does not carry.

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
  'infrastructure',
  'src',
  'config',
  'host_rules_shipped.yaml',
);
const sourcePath = process.env.EBPFSENTINEL_SHIPPED_HOST_RULES
  ? resolve(process.env.EBPFSENTINEL_SHIPPED_HOST_RULES)
  : DEFAULT_SOURCE;

const checkOnly = process.argv.includes('--check');

const MARKER_ID = 'SHIPPED HOST RULES';

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
      'The shipped rules table is generated from the agent tree, which is expected',
      'beside this one. Point EBPFSENTINEL_SHIPPED_HOST_RULES at the file otherwise.',
    ]);
  }
  return '';
}

// One rule is the text from its `- id:` line to the next one. The file is
// written by hand in one shape, which this reads: `id`, then `description`,
// then `severity`, then `when` and an optional `followed_by`.
function parseRules(source) {
  const blocks = source.split(/\n(?=  - id: )/).slice(1);
  return blocks.map((block) => {
    const id = block.match(/^  - id: (\S+)/)?.[1];
    const description = block.match(/\n    description: (.+)/)?.[1];
    const severity = block.match(/\n    severity: (\w+)/)?.[1];
    const [when, followedBy] = block.split(/\n    followed_by:/);
    const intents = (text) => [
      ...new Set([...text.matchAll(/\n\s+(?:- )?([a-z_]+\.[a-z_]+):/g)].map((m) => m[1])),
    ];
    if (!id || !description || !severity) {
      fail([`A shipped rule does not read as id, description, severity:`, block.split('\n')[0]]);
    }
    return {
      id,
      description,
      severity,
      when: intents(when),
      followedBy: followedBy ? intents(followedBy) : [],
      counted: /\n\s+count:/.test(block),
    };
  });
}

function code(list) {
  return list.map((name) => `\`${name}\``).join(', ');
}

function render(rules) {
  const lines = ['| Rule | Intentions | Severity | What it catches |', '|---|---|---|---|'];
  for (const rule of rules) {
    let intents = code(rule.when);
    if (rule.followedBy.length > 0) intents += `, then ${code(rule.followedBy)}`;
    if (rule.counted) intents += ', counted';
    const what = rule.description.charAt(0).toUpperCase() + rule.description.slice(1);
    lines.push(`| \`${rule.id}\` | ${intents} | ${rule.severity} | ${what} |`);
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
      'than listing the rules by hand.',
    ]);
  }
  return `${page.slice(0, from + begin.length)}\n\n${generated}\n\n${page.slice(to)}`;
}

const rules = parseRules(readSource());
if (rules.length === 0) {
  fail([`${relative(process.cwd(), sourcePath)} yielded no rule. Refusing to empty the table.`]);
}

const original = readFileSync(pagePath, 'utf8');
const page = splice(original, render(rules));

if (checkOnly) {
  if (page !== original) {
    fail([
      `${relative(process.cwd(), pagePath)} does not match the rules the agent ships.`,
      '',
      'Run `pnpm generate:shipped-host-rules` and commit the result.',
    ]);
  }
} else if (page !== original) {
  writeFileSync(pagePath, page);
  console.log(`Wrote the shipped rules table of ${relative(process.cwd(), pagePath)}.`);
}

console.log(`Shipped host rules OK: ${rules.length} rules.`);
