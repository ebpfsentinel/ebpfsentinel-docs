#!/usr/bin/env node

// Writes the "above the floor" table into both kernel pages from the agent's
// own catalogue, and fails when either page and the catalogue disagree.
//
// The floor guarantees the base programs load; every capability above it
// switches on host by host. The agent publishes the list it reports from in
// `capabilities.json` at the root of its repository, held to the source by a
// test there. Rendering both pages from that one file is what keeps the two
// copies from drifting apart, and keeps a condition from going missing beside
// the capability it qualifies.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const sourcePath = process.env.EBPFSENTINEL_CAPABILITIES
  ? resolve(process.env.EBPFSENTINEL_CAPABILITIES)
  : resolve(repoRoot, '..', 'ebpfsentinel', 'capabilities.json');

const checkOnly = process.argv.includes('--check');

const PAGES = [join('docs', 'operations', 'compatibility.md'), join('docs', 'kernel', 'requirements.md')];
const BEGIN = '<!-- BEGIN GENERATED ABOVE THE FLOOR -->';
const END = '<!-- END GENERATED ABOVE THE FLOOR -->';

function cell(text) {
  return text.replaceAll('|', '\\|');
}

function sentence(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function render() {
  const catalogue = JSON.parse(readFileSync(sourcePath, 'utf8'));
  if (!Array.isArray(catalogue.capabilities) || catalogue.capabilities.length === 0) {
    throw new Error(`${sourcePath}: no capabilities`);
  }
  const rows = catalogue.capabilities.map((c) => {
    for (const field of ['id', 'unlocks', 'condition', 'fallback']) {
      if (typeof c[field] !== 'string' || c[field].trim() === '') {
        throw new Error(`${sourcePath}: ${c.id ?? '?'} has no ${field}`);
      }
    }
    return `| \`${c.id}\` | ${cell(sentence(c.unlocks))} | ${cell(sentence(c.condition))} | ${cell(sentence(c.fallback))} |`;
  });
  return [
    BEGIN,
    '',
    `Everything below is above the ${catalogue.floor} floor: each entry is active only where its condition holds on the host, and its fallback runs everywhere else. The agent decides each one from a probe or an attach, never from the kernel version, and reports it in the \`capabilities\` block of \`GET /api/v1/ebpf/kernel-features\` and in \`ebpfsentinel-agent ebpf kernel-features\`, with the reason and the way to switch it on where it is off.`,
    '',
    '| Capability | What it unlocks | Condition | Where it is absent |',
    '|------------|-----------------|-----------|--------------------|',
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
    console.error(`generate-above-the-floor: ${page} has no generated above-the-floor markers`);
    failed += 1;
    continue;
  }
  const next = text.slice(0, start) + block + text.slice(stop + END.length);
  if (next === text) continue;
  if (checkOnly) {
    console.error(`generate-above-the-floor: ${page} differs from the agent's catalogue; run npm run generate:above-the-floor`);
    failed += 1;
  } else {
    writeFileSync(path, next);
    console.log(`generate-above-the-floor: wrote ${page}`);
  }
}
if (failed > 0) process.exit(1);
if (checkOnly) console.log(`generate-above-the-floor: ${PAGES.length} page(s) match the agent's catalogue`);
