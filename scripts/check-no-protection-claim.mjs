#!/usr/bin/env node

// Fails on a page that sells mass encryption detection as ransomware protection.
//
// The agent recognises a run encrypting files and, where told to, stops it.
// The files written before the run died are lost and nothing is rolled back,
// so the word on every page is detection and a stop, and protection is the
// one thing it cannot promise. A sentence naming that protection, speaking
// about the agent and negating nothing is a claim; fenced code is skipped.
//
// The mass encryption page must also keep stating what is lost, word for
// word, since it is the sentence the claim is bounded by.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FILES_LOST = 'the files written before the run died are lost';
const BOUND_PAGE = 'docs/features/mass-encryption.md';

const PROTECTION = /ransomware protection|anti-ransomware|protects? against ransomware/i;
const US = /\b(we|we're|us|our|ours|ebpfsentinel|the agent|this agent|the enterprise agent)\b/i;
const NEGATION = /\b(not|no|never|nor|without|isn't|aren't|don't|doesn't)\b|n't\b/i;

const sentences = (text) =>
  text
    .replace(/```[\s\S]*?```/g, '')
    .split(/(?<=[.!?:;])\s+|\n\s*\n|\n\s*[-*|]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);

export const claims = (text) =>
  sentences(text).filter((s) => PROTECTION.test(s) && US.test(s) && !NEGATION.test(s));

const tracked = execFileSync('git', ['ls-files', '*.md', '*.mdx'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const failures = [];
for (const path of tracked) {
  for (const claim of claims(readFileSync(resolve(repoRoot, path), 'utf8'))) {
    failures.push(`${path}: sells mass encryption as protection: "${claim}"`);
  }
}

const boundPage = readFileSync(resolve(repoRoot, BOUND_PAGE), 'utf8').replace(/\s+/g, ' ');
if (!boundPage.includes(FILES_LOST)) {
  failures.push(`${BOUND_PAGE}: no longer states that the first files are lost`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(
  `No protection claim in ${tracked.length} tracked pages, and the files lost are stated.`,
);
