#!/usr/bin/env node

// Fails on a page that calls the agent a web application firewall.
//
// The agent detects an application attack and blocks its author in the
// kernel. Nothing sits in the request path, so the first request is seen and
// may reach the application before the source is blocked. A page calling it a
// WAF would promise the one thing it cannot do, to a reader deciding whether
// to keep the WAF they already run.
//
// A sentence is a claim when it names a WAF, speaks about the agent, and
// negates nothing. A WAF the customer runs in front, or a competitor's, is not
// a claim; saying what the agent is not is the one place a sentence about it
// may use the word. Fenced code is skipped: a configuration comment naming the
// customer's proxy is not copy.
//
// The deep inspection page must also keep stating the first-request limit,
// word for word, since it is the sentence every surface uses.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FIRST_REQUEST_LIMIT =
  'The first request is seen and may reach the application, the source is then blocked in the kernel';
const LIMIT_PAGE = 'docs/features/enterprise/l7-deep-inspection.md';

const WAF = /\bWAFs?\b|web application firewall/i;
const US = /\b(we|we're|us|our|ours|ebpfsentinel|the agent|this agent|the enterprise agent)\b/i;
const NEGATION = /\b(not|no|never|nor|without|isn't|aren't|don't|doesn't)\b|n't\b/i;

const sentences = (text) =>
  text
    .replace(/```[\s\S]*?```/g, '')
    .split(/(?<=[.!?:;])\s+|\n\s*\n|\n\s*[-*|]/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 0);

export const claims = (text) =>
  sentences(text).filter((s) => WAF.test(s) && US.test(s) && !NEGATION.test(s));

const tracked = execFileSync('git', ['ls-files', '*.md', '*.mdx'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\n')
  .filter(Boolean);

const failures = [];
for (const path of tracked) {
  for (const claim of claims(readFileSync(resolve(repoRoot, path), 'utf8'))) {
    failures.push(`${path}: calls the agent a WAF: "${claim}"`);
  }
}

const limitPage = readFileSync(resolve(repoRoot, LIMIT_PAGE), 'utf8').replace(/\s+/g, ' ');
if (!limitPage.includes(FIRST_REQUEST_LIMIT)) {
  failures.push(`${LIMIT_PAGE}: no longer states the first-request limit`);
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}
console.log(
  `No WAF claim in ${tracked.length} tracked pages, and the first-request limit is stated.`,
);
