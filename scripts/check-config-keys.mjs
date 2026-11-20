#!/usr/bin/env node

// Every key the agents' configuration loaders accept is named by a page. The
// keys are read off the loaders' own sources: every field of a struct deriving
// `Deserialize` in the open-source `crates/infrastructure/src/config/` and in
// the enterprise `enterprise-infrastructure/src/config.rs`, under the name serde
// gives it (`rename` honoured, `skip` and `flatten` left out, since neither is a
// key a reader writes). A key counts as named when a page prints it as a key:
// inside backticks (a table cell, a dotted path) or at the start of a YAML line,
// commented out or not. A word in prose does not count, because `enabled` is
// in every paragraph and documents nothing.
//
// Open-source keys are looked for under `docs/configuration/`, the reference a
// reader opens to write the file; enterprise keys anywhere under `docs/`, since
// a licensed feature's page carries its own block. A key added to a loader and
// to no page fails here, which is the drift this check exists to catch: the
// loaders refuse unknown keys, so an undocumented one is a setting nobody can
// find out how to write.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, settle, summaryLine } from './lib/surface-manifest.mjs';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const docsRoot = join(repoRoot, 'docs');
const ossRoot = process.env.EBPFSENTINEL_OSS_ROOT
  ? resolve(process.env.EBPFSENTINEL_OSS_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel');
const entRoot = process.env.EBPFSENTINEL_ENTERPRISE_ROOT
  ? resolve(process.env.EBPFSENTINEL_ENTERPRISE_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel-enterprise');

function walk(dir, suffix, found = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, suffix, found);
    else if (path.endsWith(suffix)) found.push(path);
  }
  return found;
}

// The names a set of pages prints as keys.
function namedKeys(files) {
  const names = new Set();
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [, code] of text.matchAll(/`([^`\n]+)`/g)) {
      for (const [word] of code.matchAll(/[a-z_][a-z0-9_]*/g)) names.add(word);
    }
    for (const [, key] of text.matchAll(/^[\s#]*-?\s*([a-z_][a-z0-9_]*)\s*:/gm)) names.add(key);
  }
  return names;
}

// Every field serde reads off a configuration document, as `file:Struct.key`.
function loaderKeys(files) {
  const keys = [];
  const struct =
    /#\[derive\(([^)]*)\)\]((?:\s*#\[[^\]]*\]|\s*\/\/\/[^\n]*)*)\s*pub struct (\w+)\s*\{(.*?)\n\}/gs;
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [, derives, attrs, name, body] of text.matchAll(struct)) {
      if (!derives.includes('Deserialize')) continue;
      // A struct renamed wholesale to another case is a wire shape, not a
      // configuration section; none exists today and none is checked.
      if (/rename_all\s*=\s*"(?!snake_case)/.test(attrs)) continue;
      let pending = '';
      for (const raw of body.split('\n')) {
        const line = raw.trim();
        if (line.startsWith('#[')) {
          pending += line;
          continue;
        }
        const field = line.match(/^pub(?:\([^)]*\))?\s+(?:r#)?(\w+)\s*:/);
        if (field) {
          const serde = pending;
          pending = '';
          if (/\bflatten\b/.test(serde)) continue;
          if (/\bskip\b(?!_)/.test(serde) || /\bskip_deserializing\b/.test(serde)) continue;
          const renamed = serde.match(/\brename\s*=\s*"([^"]+)"/);
          keys.push({ file, struct: name, key: renamed ? renamed[1] : field[1] });
        } else if (line && !line.startsWith('//')) {
          pending = '';
        }
      }
    }
  }
  return keys;
}

const errors = [];
const lanes = [
  {
    label: 'open-source',
    sources: walk(join(ossRoot, 'crates', 'infrastructure', 'src', 'config'), '.rs'),
    pages: walk(join(docsRoot, 'configuration'), '.md'),
    floor: 700,
  },
  {
    label: 'enterprise',
    sources: [join(entRoot, 'crates', 'enterprise-infrastructure', 'src', 'config.rs')],
    pages: walk(docsRoot, '.md'),
    floor: 400,
  },
];

// A key no page should name (none today) carries a line in `config-keys.toml`
// beside this script, keyed `<lane> Struct.key`, with its reason or its gap.
const manifest = readManifest(join(scriptDir, 'config-keys.toml'));
const surfaces = new Set();
const named = new Set();

const counts = [];
for (const lane of lanes) {
  const names = namedKeys(lane.pages);
  const keys = loaderKeys(lane.sources);
  // A scanner that stopped matching the sources would pass on an empty list.
  if (keys.length < lane.floor) {
    errors.push(
      `only ${keys.length} ${lane.label} configuration keys were read: the scanner no longer matches the loader`,
    );
  }
  for (const { file, struct, key } of keys) {
    const surface = `${lane.label} ${struct}.${key}`;
    surfaces.add(surface);
    if (names.has(key)) named.add(surface);
    else if (!(manifest.tables.keys ?? {})[surface]) {
      errors.push(
        `${lane.label} key \`${key}\` (${struct}, ${relative(resolve(repoRoot, '..'), file)}) is named by no page`,
      );
    }
  }
  counts.push(`${keys.length} ${lane.label}`);
}

const settled = settle({
  surfaces: [...surfaces].sort(),
  covered: (surface) => named.has(surface),
  manifest,
  kind: 'keys',
});
errors.push(...settled.errors.filter((e) => !e.endsWith('the manifest does not list it')));

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(`\n${errors.length} configuration key(s) the documentation does not name.`);
  process.exit(1);
}
console.log(`Configuration keys OK (${counts.join(', ')} keys named by a page).`);
for (const gap of settled.gaps) console.log(`gap: ${gap}`);
console.log(summaryLine('docs/config-keys', settled));
