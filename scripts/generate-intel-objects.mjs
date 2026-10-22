#!/usr/bin/env node

// Writes the intelligence import tables from the enterprise tree they are
// facts about, and fails when a page and the code disagree.
//
// Three tables say what an import can do with what a platform serves: the
// object types the importer reads and the matcher each one reaches, the STIX
// pattern properties it evaluates, and the MISP attribute types it maps. All
// three are mappings in Rust `match` arms, which is exactly the kind of list
// that a page keeps a stale copy of: an object type gaining a matcher is a
// claim that changes, and a reader deciding whether to buy the integration
// reads the page rather than the enum.
//
// The honesty sentence under the first table is generated with it, because a
// kind the engine cannot act on is the one thing a count must never hide.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const enterpriseRoot = process.env.EBPFSENTINEL_ENTERPRISE_ROOT
  ? resolve(process.env.EBPFSENTINEL_ENTERPRISE_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel-enterprise');

const checkOnly = process.argv.includes('--check');

const ENTITY = join(
  enterpriseRoot,
  'crates',
  'enterprise-domain',
  'src',
  'intel',
  'entity.rs',
);
const ENGINE = join(
  enterpriseRoot,
  'crates',
  'enterprise-domain',
  'src',
  'intel',
  'engine.rs',
);
const SERVICE = join(
  enterpriseRoot,
  'crates',
  'enterprise-application',
  'src',
  'intel_service.rs',
);

// Which page carries which table. A page listed here without the markers of
// every table it is given fails, so a table is never silently dropped from a
// page somebody is still reading.
const PAGES = new Map([
  [join('docs', 'features', 'enterprise', 'threat-intel-platforms.md'), ['OBJECTS']],
  [join('docs', 'integrations', 'taxii.md'), ['OBJECTS', 'STIX PROPERTIES']],
  [join('docs', 'integrations', 'misp.md'), ['MISP ATTRIBUTES']],
]);

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function read(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    fail([
      `Cannot read ${path}:`,
      `  ${error.message}`,
      '',
      'The enterprise repository is expected beside this one. Set',
      'EBPFSENTINEL_ENTERPRISE_ROOT to point at it explicitly.',
    ]);
  }
  return '';
}

// The body of one function, from its signature to the brace that closes it.
// Reading the arms of a `match` by hand beats evaluating Rust, and the arms
// are the mapping: everything these tables carry is a literal in one of them.
function functionBody(source, signature, where) {
  const at = source.indexOf(signature);
  if (at === -1) {
    fail([
      `${where} carries no "${signature}".`,
      '',
      'The tables are read off that function. A rename there is a change here.',
    ]);
  }
  let depth = 0;
  let start = -1;
  for (let i = at; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      if (depth === 0) start = i + 1;
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i);
    }
  }
  fail([`${where}: "${signature}" is not closed.`]);
  return '';
}

// One arm per line, which is what `cargo fmt` leaves behind for arms this
// short. A left side may list several patterns, and the right side is read for
// the literals or the variants it names.
function arms(body) {
  const found = [];
  for (const line of body.split('\n')) {
    const arm = /^\s*([^=>]+?)\s*=>\s*(.*?),?\s*$/.exec(line);
    if (!arm) continue;
    if (arm[1].includes('//')) continue;
    found.push({ left: arm[1], right: arm[2] });
  }
  return found;
}

const quoted = (text) => [...text.matchAll(/"([^"]*)"/g)].map((match) => match[1]);

// A pipe inside a table cell ends the cell, and a MISP composite type carries
// one in its name.
const cell = (text) => text.replaceAll('|', '\\|');
const variants = (text, enumName) =>
  [...text.matchAll(new RegExp(`(?:${enumName}|Self)::(\\w+)`, 'g'))].map((match) => match[1]);

// A `match` whose arms may span several lines, read by pattern rather than by
// line: the MISP mapping has arms with a body in braces.
function multilineArms(body) {
  const found = [];
  const re = /((?:\s*"[^"]*"\s*\|?)+)=>\s*(\{[\s\S]*?\n\s{8}\}|[^\n]*)/g;
  for (const match of body.matchAll(re)) {
    found.push({ left: match[1], right: match[2] });
  }
  return found;
}

const entity = read(ENTITY);
const engine = read(ENGINE);
const service = read(SERVICE);

// The kinds, in the order `all` lists them, which is the order every answer
// the agent gives uses.
const order = variants(
  functionBody(entity, 'pub const fn all() -> [Self; ', ENTITY),
  'IndicatorKind',
);

const names = new Map();
for (const arm of arms(functionBody(entity, 'pub const fn as_str(self) -> &\'static str', ENTITY))) {
  const [name] = quoted(arm.right);
  for (const variant of variants(arm.left, 'IndicatorKind')) names.set(variant, name);
}

const objects = new Map();
for (const arm of arms(
  functionBody(entity, 'pub const fn stix_object(self) -> &\'static str', ENTITY),
)) {
  const [object] = quoted(arm.right);
  for (const variant of variants(arm.left, 'IndicatorKind')) objects.set(variant, object);
}

const matcherNames = new Map();
const matcherBody = entity.slice(entity.indexOf('impl Matcher {'));
for (const arm of arms(
  functionBody(matcherBody, 'pub const fn as_str(self) -> &\'static str', ENTITY),
)) {
  const [name] = quoted(arm.right);
  for (const variant of variants(arm.left, 'Matcher')) matcherNames.set(variant, name);
}

// Keyed on the kind, holding the matcher's reported name rather than its
// variant, because the name is what the API answers and what the pages quote.
const matchers = new Map();
for (const arm of arms(
  functionBody(entity, 'pub const fn matcher(self) -> Option<Matcher>', ENTITY),
)) {
  const [matcher] = variants(arm.right, 'Matcher').filter((name) => matcherNames.has(name));
  for (const variant of variants(arm.left, 'IndicatorKind')) {
    matchers.set(variant, matcher ? matcherNames.get(matcher) : null);
  }
}

if (order.length === 0) {
  fail([`${ENTITY} yielded no indicator kind. Refusing to empty the tables.`]);
}
for (const kind of order) {
  if (!names.has(kind) || !objects.has(kind) || !matchers.has(kind)) {
    fail([
      `${kind} is listed by IndicatorKind::all and is missing from one of its mappings.`,
      '',
      'Every kind needs a name, a STIX object and a matcher decision, including',
      'the decision that no matcher acts on it.',
    ]);
  }
}

// Where a matcher lands, in the words the rest of the documentation uses for
// those paths. A matcher the code gains and this table does not is a failure
// rather than a blank cell.
const MATCHER_PROSE = new Map([
  ['threat-intel-map', 'Address-keyed threat intelligence map, matched in the TC path'],
  ['dns-blocklist', 'DNS blocklist, matched on every query the capture path reads'],
  ['l7-url-rules', 'L7 URL rules, matched on every request the L7 path parses'],
  ['tls-fingerprints', 'JA4 fingerprint list, matched by the TLS intelligence engine'],
]);

const unknownMatchers = [...matcherNames.values()].filter((name) => !MATCHER_PROSE.has(name));
if (unknownMatchers.length > 0) {
  fail([
    `${unknownMatchers.length} matcher(s) this generator cannot describe:`,
    ...unknownMatchers.map((name) => `  ${name}`),
    '',
    'Add each one to MATCHER_PROSE with the sentence the pages describe it by.',
  ]);
}

function objectTable() {
  const lines = [
    '| STIX object | Indicator kind | What matches it |',
    '|-------------|----------------|-----------------|',
  ];
  for (const kind of order) {
    const matcher = matchers.get(kind);
    const where = matcher
      ? `${MATCHER_PROSE.get(matcher)} (\`${matcher}\`)`
      : 'Nothing. Counted and reported, stored in no matcher';
    lines.push(`| \`${cell(objects.get(kind))}\` | \`${names.get(kind)}\` | ${where} |`);
  }

  const inert = order.filter((kind) => matchers.get(kind) === null);
  lines.push('');
  if (inert.length === 0) {
    lines.push('Every object type the importer reads reaches a matcher.');
  } else {
    const spelled = inert.map((kind) => `\`${names.get(kind)}\``).join(', ');
    lines.push(
      `An indicator type the engine cannot act on is reported as not actionable at import` +
        ` rather than stored as if it were doing something: ${spelled}` +
        ` ${inert.length === 1 ? 'is counted' : 'are counted'} per poll, named on the screen` +
        ` and in \`GET /api/v1/intel/indicators\`, and matched by nothing.`,
    );
  }
  return lines.join('\n');
}

function propertyTable() {
  const body = functionBody(engine, 'fn property_kind(property: &str) -> Option<IndicatorKind>', ENGINE);
  const rows = [];
  for (const arm of multilineArms(body)) {
    const properties = quoted(arm.left);
    const [kind] = variants(arm.right, 'IndicatorKind').filter((name) => names.has(name));
    if (properties.length === 0 || !kind) continue;
    rows.push({ properties, kind });
  }
  if (rows.length === 0) {
    fail([`${ENGINE} yielded no pattern property. Refusing to empty the table.`]);
  }
  const lines = [
    '| Pattern property | Indicator kind |',
    '|------------------|----------------|',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.properties.map((property) => `\`${cell(property)}\``).join(', ')} | \`${names.get(row.kind)}\` |`,
    );
  }
  return lines.join('\n');
}

function attributeTable() {
  const body = functionBody(
    service,
    'fn misp_terms(attribute_type: &str, value: &str) -> Option<Vec<(IndicatorKind, String)>>',
    SERVICE,
  );
  const rows = [];
  for (const arm of multilineArms(body)) {
    const types = quoted(arm.left);
    if (types.length === 0) continue;
    const kinds = variants(arm.right, 'IndicatorKind').filter((name) => names.has(name));
    // An address is read rather than declared, so the helper stands for both
    // address kinds wherever the arm calls it.
    if (arm.right.includes('address_kind(')) {
      for (const kind of ['Ipv4', 'Ipv6']) if (!kinds.includes(kind)) kinds.push(kind);
    }
    if (kinds.length === 0) continue;
    rows.push({ types, kinds });
  }
  if (rows.length === 0) {
    fail([`${SERVICE} yielded no MISP attribute type. Refusing to empty the table.`]);
  }
  const lines = [
    '| MISP attribute type | Indicator kind |',
    '|---------------------|----------------|',
  ];
  for (const row of rows) {
    const ordered = order.filter((kind) => row.kinds.includes(kind));
    lines.push(
      `| ${row.types.map((type) => `\`${cell(type)}\``).join(', ')} | ` +
        `${ordered.map((kind) => `\`${names.get(kind)}\``).join(', ')} |`,
    );
  }
  return lines.join('\n');
}

const TABLES = new Map([
  ['OBJECTS', objectTable],
  ['STIX PROPERTIES', propertyTable],
  ['MISP ATTRIBUTES', attributeTable],
]);

function splice(page, path, marker, generated) {
  const begin = `<!-- BEGIN GENERATED INTEL ${marker} -->`;
  const end = `<!-- END GENERATED INTEL ${marker} -->`;
  const from = page.indexOf(begin);
  const to = page.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    fail([
      `${path} carries no "${begin}" / "${end}" pair.`,
      '',
      'The markers are where the generated table goes. Put them back rather',
      'than writing the mapping out by hand.',
    ]);
  }
  return `${page.slice(0, from + begin.length)}\n\n${generated}\n\n${page.slice(to)}`;
}

let stale = 0;
let written = 0;
for (const [path, markers] of PAGES) {
  const full = join(repoRoot, path);
  const original = read(full);
  let page = original;
  for (const marker of markers) {
    page = splice(page, relative(repoRoot, full), marker, TABLES.get(marker)());
  }
  if (page === original) continue;
  if (checkOnly) {
    console.error(`${path} does not match the enterprise tree.`);
    stale += 1;
  } else {
    writeFileSync(full, page);
    console.log(`Wrote the intelligence tables of ${path}.`);
    written += 1;
  }
}

if (stale > 0) {
  fail(['', 'Run `npm run generate:intel-objects` and commit the result.']);
}

const inert = order.filter((kind) => matchers.get(kind) === null).length;
console.log(
  `Intelligence tables OK: ${order.length} indicator kinds, ${inert} of them actionable by ` +
    `nothing, over ${PAGES.size} pages${written > 0 ? ` (${written} rewritten)` : ''}.`,
);
