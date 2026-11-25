#!/usr/bin/env node
// The programs the kernel loads and refuses under `lockdown=confidentiality`,
// rendered from the agent's own list, tests/integration/lockdown-programs.toml.
// The same file is what the agent's lockdown suite holds the running kernel to,
// so the page and the test cannot state two different lists. Until that suite
// has confirmed the list on a locked-down kernel, the page says the verdicts
// are expected from the source.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const sourcePath = process.env.EBPFSENTINEL_LOCKDOWN_PROGRAMS
  ? resolve(process.env.EBPFSENTINEL_LOCKDOWN_PROGRAMS)
  : resolve(repoRoot, '..', 'ebpfsentinel', 'tests', 'integration', 'lockdown-programs.toml');

const checkOnly = process.argv.includes('--check');

const PAGES = [join('docs', 'security', 'agent-and-warden.md')];
const BEGIN = '<!-- BEGIN GENERATED LOCKDOWN PROGRAMS -->';
const END = '<!-- END GENERATED LOCKDOWN PROGRAMS -->';
const VERDICTS = new Set(['loads', 'refused']);

// The subset of TOML the list is written in: comments, top-level keys, and
// `[[program]]` tables of single-line strings and booleans. Anything else
// fails rather than being half read.
function parseValue(raw, where) {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(text);
  if (!match) throw new Error(`${where}: unsupported value ${text}`);
  return match[1].replace(/\\(.)/g, '$1');
}

function parse(text) {
  const top = {};
  const programs = [];
  let current = top;
  text.split('\n').forEach((line, index) => {
    const where = `${sourcePath}:${index + 1}`;
    const bare = line.trim();
    if (bare === '' || bare.startsWith('#')) return;
    if (bare === '[[program]]') {
      current = {};
      programs.push(current);
      return;
    }
    const eq = bare.indexOf('=');
    if (eq < 0) throw new Error(`${where}: not a key = value line`);
    const key = bare.slice(0, eq).trim();
    if (!/^[a-z_]+$/.test(key)) throw new Error(`${where}: bad key ${key}`);
    current[key] = parseValue(bare.slice(eq + 1), where);
  });
  return { top, programs };
}

function cell(text) {
  return text.replaceAll('|', '\\|');
}

// A cell starting with an identifier (bpf_probe_read_kernel) keeps its case.
function sentence(text) {
  if (/^[a-z]+[_(]/.test(text)) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function render() {
  const { top, programs } = parse(readFileSync(sourcePath, 'utf8'));
  if (top.level !== 'confidentiality') throw new Error(`${sourcePath}: level is not confidentiality`);
  if (typeof top.confirmed !== 'boolean') throw new Error(`${sourcePath}: confirmed is not a boolean`);
  if (programs.length < 20) throw new Error(`${sourcePath}: only ${programs.length} programs`);
  const seen = new Set();
  for (const p of programs) {
    if (typeof p.name !== 'string' || p.name === '') throw new Error(`${sourcePath}: a program has no name`);
    if (seen.has(p.name)) throw new Error(`${sourcePath}: ${p.name} listed twice`);
    seen.add(p.name);
    if (!VERDICTS.has(p.verdict)) throw new Error(`${sourcePath}: ${p.name} has verdict ${p.verdict}`);
    if (typeof p.because !== 'string' || p.because === '') throw new Error(`${sourcePath}: ${p.name} has no because`);
    if (p.verdict === 'refused' && !p.loses) throw new Error(`${sourcePath}: ${p.name} is refused and says nothing lost`);
  }
  const verdictCell = (p) => {
    if (p.verdict === 'refused') return 'Refused';
    if (p.reached_through) return `Loads, but never attempted while \`${p.reached_through}\` is refused`;
    return 'Loads';
  };
  const rows = [...programs]
    .sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'refused' ? -1 : 1))
    .map(
      (p) =>
        `| \`${p.name}\` | ${verdictCell(p)} | ${cell(sentence(p.because))} | ${p.loses ? cell(sentence(p.loses)) : 'Nothing'} |`,
    );
  const refused = programs.filter((p) => p.verdict === 'refused').length;
  const status = top.confirmed
    ? `Confirmed on a kernel booted with \`lockdown=confidentiality\` by the agent's lockdown suite on ${top.confirmed_on}.`
    : 'Expected from the source, to be confirmed on the VM: every verdict below is read off the programs\' source and the kernel\'s, and the agent\'s lockdown suite has not yet run them on a locked-down kernel.';
  return [
    BEGIN,
    '',
    `${status} ${refused} of the ${programs.length} programs are expected to be refused. The list is \`tests/integration/lockdown-programs.toml\` in the agent's repository; the agent's lockdown suite (\`158-lockdown-confidentiality.bats\`) reads the same file.`,
    '',
    '| Program | Under `lockdown=confidentiality` | Why | What you go without there |',
    '|---------|----------------------------------|-----|---------------------------|',
    ...rows,
    '',
    END,
  ].join('\n');
}

const block = render();
let failed = 0;
for (const page of PAGES) {
  const path = join(repoRoot, page);
  const text = readFileSync(path, 'utf8');
  const start = text.indexOf(BEGIN);
  const stop = text.indexOf(END);
  if (start < 0 || stop < start) {
    console.error(`generate-lockdown-programs: ${page} has no generated lockdown markers`);
    failed += 1;
    continue;
  }
  const next = text.slice(0, start) + block + text.slice(stop + END.length);
  if (next === text) continue;
  if (checkOnly) {
    console.error(`generate-lockdown-programs: ${page} differs from the agent's lockdown list; run npm run generate:lockdown-programs`);
    failed += 1;
  } else {
    writeFileSync(path, next);
    console.log(`generate-lockdown-programs: wrote ${page}`);
  }
}
if (failed > 0) process.exit(1);
if (checkOnly) console.log(`generate-lockdown-programs: ${PAGES.length} page(s) match the agent's lockdown list`);
