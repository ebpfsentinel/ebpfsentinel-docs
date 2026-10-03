#!/usr/bin/env node

// Fails on a typographic dash anywhere in the tracked tree.
//
// The punctuation rule is a cross-repository invariant covering code,
// comments, documentation and user-facing copy: the dash is the plain hyphen
// that a keyboard produces. It held here by being read, which is why a
// hundred files had drifted into carrying nine hundred of them.
//
// Both dashes are refused, not only the em dash. They arrive the same way, by
// an editor or a paste substituting one for a hyphen somebody typed, and a
// check that catches one while admitting the other just moves the drift onto
// the character it does not look at. The en dash in this tree was only ever
// standing in a numeric range, where a hyphen reads identically.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// A file that is a copy of something authored outside this tree is exempt,
// because correcting it here would fork it from the thing it copies and be
// undone by the next refresh. The fix for such a file belongs where it is
// written. An exemption carries the reason it exists and the place the real
// fix goes, and nothing else in the tree gets one.
//
// There are none. The single exemption this map ever held was
// `static/openapi.json`, the agent's own document vendored for the reference
// page, and it was exempt because the tree it is copied from carried the
// dashes. That tree holds to the rule now and asserts it from its own suite, so
// the copy arrives clean and an exemption here would only hide the day it stops
// doing so.
const EXEMPT = new Map();

// Written as escapes rather than as the characters themselves: this file is
// tracked, so a literal here would be an offence the check reports against
// itself. An exemption would have worked and would have been the wrong shape,
// since it would exempt the whole file rather than the two declarations that
// have to name what they hunt.
// All four dashes that are not the plain hyphen, not only the two a writer
// thinks of. A word processor, a paste from a web page and a model each reach
// for a different one, and a check that names two of them is a check the other
// two walk past.
//
// Each is written as an escape rather than as the character, so this file is
// never its own first failure.
const DASHES = [
  { char: '\u2012', name: 'figure dash' },
  { char: '\u2013', name: 'en dash' },
  { char: '\u2014', name: 'em dash' },
  { char: '\u2015', name: 'horizontal bar' },
];

// Reading as UTF-8 would turn an arbitrary byte run in an image into
// replacement characters, so the search is over the bytes the dashes are
// actually encoded as.
const NEEDLES = DASHES.map((dash) => ({
  ...dash,
  bytes: Buffer.from(dash.char, 'utf8'),
}));

// Byte formats a text rule cannot speak about. A PNG of a screenshot carries
// these three bytes by chance several times over, and a check that reports
// them prints a screenful of binary and teaches a reader to widen the
// exemption list rather than to fix a dash.
const BINARY = [
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svgz', '.pdf', '.woff', '.woff2',
  '.ttf', '.otf', '.eot', '.mp4', '.webm', '.wav', '.mp3', '.zip', '.gz',
  '.xz', '.tar', '.bin', '.onnx', '.mmdb',
];

const isBinary = (file) => {
  const lower = file.toLowerCase();
  return BINARY.some((extension) => lower.endsWith(extension));
};

const tracked = execFileSync('git', ['ls-files', '-z'], {
  cwd: repoRoot,
  encoding: 'utf8',
})
  .split('\0')
  .filter(Boolean)
  .filter((file) => !isBinary(file));

const offences = [];
const exemptSeen = new Set();

for (const file of tracked) {
  let content;
  try {
    content = readFileSync(resolve(repoRoot, file));
  } catch {
    continue;
  }

  const found = NEEDLES.filter((needle) => content.includes(needle.bytes));
  if (found.length === 0) continue;

  if (EXEMPT.has(file)) {
    exemptSeen.add(file);
    continue;
  }

  const text = content.toString('utf8');
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    for (const dash of DASHES) {
      if (line.includes(dash.char)) {
        offences.push({ file, line: index + 1, name: dash.name, text: line.trim() });
      }
    }
  }
}

// An exemption that no longer covers anything is an exemption that will be
// read as permission the next time somebody adds a file with that name.
const stale = [...EXEMPT.keys()].filter((file) => !exemptSeen.has(file));

if (offences.length > 0) {
  console.error(`${offences.length} typographic dash(es) in the tracked tree:`);
  for (const offence of offences.slice(0, 40)) {
    console.error(`  ${offence.file}:${offence.line}: ${offence.name}`);
    console.error(`    ${offence.text}`);
  }
  if (offences.length > 40) {
    console.error(`  ... and ${offences.length - 40} more.`);
  }
  console.error('');
  console.error('Write a plain hyphen "-" instead. If the file is a copy of');
  console.error('something authored outside this tree, add it to EXEMPT in');
  console.error('scripts/check-no-typographic-dash.mjs with the reason and where the');
  console.error('real fix goes.');
  process.exit(1);
}

if (stale.length > 0) {
  console.error('Exemptions that no longer cover anything:');
  for (const file of stale) console.error(`  ${file}`);
  console.error('');
  console.error('Remove them. An exemption nothing needs is permission nobody asked for.');
  process.exit(1);
}

const exemptions =
  EXEMPT.size === 0
    ? 'no exemptions'
    : `${EXEMPT.size} exemption(s): ` +
      [...EXEMPT.keys()].map((file) => `${file} (${EXEMPT.get(file)})`).join('; ');
console.log(`No typographic dash in ${tracked.length} tracked files, ${exemptions}`);
