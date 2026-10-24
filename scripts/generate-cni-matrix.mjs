#!/usr/bin/env node

// Writes the tested CNI matrix from the operator's coexistence lanes, and
// fails when a page and the lanes disagree.
//
// "Runs beside Cilium and Calico" is the first thing a platform engineer
// checks, and a version typed on a page is a version nobody re-reads when the
// lane moves. The lanes pin their versions in `tests/coexistence/cni.env` and
// describe what each one stands up, and what none of them does, in
// `tests/coexistence/coverage.json`; the operator's own tests hold both files
// to the CI matrix. This renders them, so a page states exactly what CI runs
// and lists everything else as untested rather than leaving it to be assumed.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const operatorRoot = process.env.EBPFSENTINEL_OPERATOR_ROOT
  ? resolve(process.env.EBPFSENTINEL_OPERATOR_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel-operator');

const checkOnly = process.argv.includes('--check');

const LANES = join(operatorRoot, 'tests', 'coexistence');
const PAGES = [join('docs', 'operations', 'deployment', 'kubernetes.md')];
const BEGIN = '<!-- BEGIN GENERATED CNI MATRIX -->';
const END = '<!-- END GENERATED CNI MATRIX -->';

function pins() {
  const env = new Map();
  for (const raw of readFileSync(join(LANES, 'cni.env'), 'utf8').split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at < 0) throw new Error(`cni.env: not KEY=value: ${line}`);
    env.set(line.slice(0, at), line.slice(at + 1));
  }
  return env;
}

function render() {
  const env = pins();
  const coverage = JSON.parse(readFileSync(join(LANES, 'coverage.json'), 'utf8'));
  const image = env.get('KIND_NODE_IMAGE') ?? '';
  const kubernetes = image.split(':v')[1];
  if (!kubernetes) throw new Error(`cni.env: KIND_NODE_IMAGE=${image} carries no version tag`);
  const rows = coverage.lanes.map((lane) => {
    const version = env.get(lane.versionKey);
    if (!version) throw new Error(`cni.env: no ${lane.versionKey} for ${lane.name}`);
    return `| ${lane.name} | ${version} | ${lane.datapath} | ${kubernetes} |`;
  });
  return [
    BEGIN,
    '',
    '| CNI | Version | What the lane stands up | Kubernetes |',
    '|-----|---------|-------------------------|------------|',
    ...rows,
    '',
    `Untested, because no lane runs it, so nothing is claimed for it: ${coverage.untested.join(', ')}.`,
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
    console.error(`generate-cni-matrix: ${page} has no generated CNI matrix markers`);
    failed += 1;
    continue;
  }
  const next = text.slice(0, start) + block + text.slice(stop + END.length);
  if (next === text) continue;
  if (checkOnly) {
    console.error(`generate-cni-matrix: ${page} differs from the coexistence lanes; run npm run generate:cni-matrix`);
    failed += 1;
  } else {
    writeFileSync(path, next);
    console.log(`generate-cni-matrix: wrote ${page}`);
  }
}
if (failed > 0) process.exit(1);
if (checkOnly) console.log(`generate-cni-matrix: ${PAGES.length} page(s) match the coexistence lanes`);
