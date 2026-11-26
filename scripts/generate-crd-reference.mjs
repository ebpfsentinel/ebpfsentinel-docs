#!/usr/bin/env node

// The operator's custom resources, one section per kind, read off the CRDs
// the operator generates from its own types. A field the operator accepts is
// a field this page names, with the type, the default and the text the API
// server itself serves under `kubectl explain`.
//
// `--check` fails when the page and the CRDs disagree. The CRDs are read from
// `../ebpfsentinel-operator/config/crd/crds.yaml`, or from the file named by
// `EBPFSENTINEL_OPERATOR_CRDS`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'api-reference', 'operator-crds.md');
const crdsPath = process.env.EBPFSENTINEL_OPERATOR_CRDS
  ? resolve(process.env.EBPFSENTINEL_OPERATOR_CRDS)
  : resolve(repoRoot, '..', 'ebpfsentinel-operator', 'config', 'crd', 'crds.yaml');
const operatorRoot = process.env.EBPFSENTINEL_OPERATOR_DIR
  ? resolve(process.env.EBPFSENTINEL_OPERATOR_DIR)
  : resolve(repoRoot, '..', 'ebpfsentinel-operator');
const licensePath = join(operatorRoot, 'crates', 'operator', 'src', 'license.rs');
const websiteRoot = process.env.EBPFSENTINEL_WEBSITE_DIR
  ? resolve(process.env.EBPFSENTINEL_WEBSITE_DIR)
  : resolve(repoRoot, '..', 'ebpfsentinel-website');
const tiersPath = join(websiteRoot, 'src', 'app', 'core', 'licence', 'licence.generated.ts');
const checkOnly = process.argv.includes('--check');

const BEGIN = '<!-- BEGIN GENERATED KINDS -->';
const END = '<!-- END GENERATED KINDS -->';

// Below these the reader no longer understands the file it was given.
const MIN_KINDS = 30;
const MIN_FIELDS = 250;
const MIN_GATED_KINDS = 10;

// The licence feature the operator itself needs, which is also what the one
// ungated enterprise kind is served under.
const OPERATOR_FEATURE = 'kubernetes-operator';
const TIER_NAME = { professional: 'Professional', enterprise: 'Enterprise', critical: 'Critical' };

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

// A reader for the block YAML serde_yaml writes: mappings, sequences whose
// dash sits at the key's indent, plain, quoted and literal scalars, and the
// empty flow collections. Anything else stops the run rather than being
// half read.

function indentOf(line) {
  return line.length - line.trimStart().length;
}

const KEY_RE = /^((?:'(?:[^']|'')*')|(?:"(?:[^"\\]|\\.)*")|(?:[^'"\s#][^:]*?)):(?: (.*)|)$/;

function scalar(text, where) {
  const value = text.trim();
  if (value === '' || value === '~' || value === 'null') return null;
  if (value === '[]') return [];
  if (value === '{}') return {};
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) fail([`${where}: an unterminated single-quoted scalar.`]);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      fail([`${where}: a double-quoted scalar this reader cannot decode.`]);
    }
  }
  if (value.startsWith('[') || value.startsWith('{') || value.startsWith('&') || value.startsWith('*')) {
    fail([`${where}: flow collections and anchors are not expected in generated CRDs.`]);
  }
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)) return Number(value);
  return value;
}

function keyName(raw, where) {
  if (raw.startsWith("'") || raw.startsWith('"')) return scalar(raw, where);
  return raw;
}

class Reader {
  constructor(lines, origin) {
    this.lines = lines;
    this.origin = origin;
  }

  where(index) {
    return `${this.origin}:${index + 1}`;
  }

  skipBlank(index) {
    let i = index;
    while (i < this.lines.length && this.lines[i].trim() === '') i += 1;
    return i;
  }

  // The value of a node starting at `index`, every line of it at `indent`.
  node(index, indent) {
    const i = this.skipBlank(index);
    if (i >= this.lines.length) return [null, i];
    const content = this.lines[i].slice(indent);
    if (content === '-' || content.startsWith('- ')) return this.sequence(i, indent);
    return this.mapping(i, indent);
  }

  blockScalar(index, indent, header) {
    const style = header[0];
    const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';
    const explicit = header.match(/\d/);
    let i = index;
    const body = [];
    let contentIndent = explicit ? indent + Number(explicit[0]) : null;
    while (i < this.lines.length) {
      const line = this.lines[i];
      if (line.trim() !== '' && indentOf(line) <= indent) break;
      if (line.trim() !== '' && contentIndent === null) contentIndent = indentOf(line);
      body.push(line);
      i += 1;
    }
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
    const text = body.map((line) => line.slice(contentIndent ?? 0)).join('\n');
    let value = style === '>' ? text.replace(/([^\n])\n(?=[^\n])/g, '$1 ') : text;
    if (chomp !== 'strip' && value !== '') value += '\n';
    return [value, i];
  }

  // A scalar after a key or a dash, with any deeper continuation lines.
  inline(rest, index, indent) {
    const trimmed = rest.trim();
    if (/^[|>][-+0-9]*$/.test(trimmed)) return this.blockScalar(index + 1, indent, trimmed);
    let text = trimmed;
    let i = index + 1;
    while (i < this.lines.length && this.lines[i].trim() !== '' && indentOf(this.lines[i]) > indent) {
      text += ` ${this.lines[i].trim()}`;
      i += 1;
    }
    return [scalar(text, this.where(index)), i];
  }

  mapping(index, indent) {
    const out = {};
    let i = index;
    while (true) {
      i = this.skipBlank(i);
      if (i >= this.lines.length) break;
      const line = this.lines[i];
      const at = indentOf(line);
      if (at < indent) break;
      if (at > indent) fail([`${this.where(i)}: a line deeper than the mapping it sits in.`]);
      const content = line.slice(indent);
      if (content.startsWith('- ') || content === '-') break;
      const match = content.match(KEY_RE);
      if (!match) fail([`${this.where(i)}: expected a key.`]);
      const key = keyName(match[1], this.where(i));
      const rest = match[2] ?? '';
      if (rest.trim() !== '') {
        [out[key], i] = this.inline(rest, i, indent);
        continue;
      }
      const next = this.skipBlank(i + 1);
      if (next >= this.lines.length) {
        out[key] = null;
        i = next;
        continue;
      }
      const nextIndent = indentOf(this.lines[next]);
      const nextContent = this.lines[next].slice(nextIndent);
      if (nextIndent > indent) {
        [out[key], i] = this.node(next, nextIndent);
      } else if (nextIndent === indent && (nextContent.startsWith('- ') || nextContent === '-')) {
        [out[key], i] = this.sequence(next, indent);
      } else {
        out[key] = null;
        i = next;
      }
    }
    return [out, i];
  }

  sequence(index, indent) {
    const out = [];
    let i = index;
    while (true) {
      i = this.skipBlank(i);
      if (i >= this.lines.length) break;
      const line = this.lines[i];
      if (indentOf(line) !== indent) break;
      const content = line.slice(indent);
      if (!(content.startsWith('- ') || content === '-')) break;
      const item = content === '-' ? '' : content.slice(2);
      if (item.trim() === '') {
        const next = this.skipBlank(i + 1);
        let value;
        [value, i] = this.node(next, indentOf(this.lines[next]));
        out.push(value);
      } else if (KEY_RE.test(item) && !item.startsWith("'") && !item.startsWith('"')) {
        this.lines[i] = ' '.repeat(indent + 2) + item;
        let value;
        [value, i] = this.mapping(i, indent + 2);
        out.push(value);
      } else {
        let value;
        [value, i] = this.inline(item, i, indent);
        out.push(value);
      }
    }
    return [out, i];
  }
}

function parseDocuments(text, origin) {
  const documents = [];
  let chunk = [];
  let start = 0;
  const lines = text.split('\n');
  const flush = () => {
    if (chunk.some((line) => line.trim() !== '')) {
      const reader = new Reader(chunk, origin);
      const [value, end] = reader.node(0, 0);
      if (reader.skipBlank(end) < chunk.length) {
        fail([`${origin}:${start + end + 1}: the reader stopped before the end of the document.`]);
      }
      documents.push(value);
    }
  };
  for (const [index, line] of lines.entries()) {
    if (line === '---') {
      flush();
      chunk = [];
      start = index + 1;
    } else {
      chunk.push(line);
    }
  }
  flush();
  return documents;
}

// Licensing: which feature each enterprise kind is reconciled under, read
// off the operator's own table, and the tier the website's price table first
// sells that feature on. A tier typed here would be one nobody re-reads when
// the price table moves.

function readText(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    fail([`Cannot read ${what} at ${path}: ${error.message}`]);
  }
}

function readGates() {
  const source = readText(licensePath, "the operator's licence table");
  const block = source.match(/const FEATURE_BY_KIND: &\[\(&str, &str\)\] = &\[([\s\S]*?)\];/);
  if (!block) fail([`${licensePath}: no FEATURE_BY_KIND table.`]);
  const gates = new Map();
  for (const [, kind, feature] of block[1].matchAll(/\("([A-Za-z0-9]+)",\s*"([a-z0-9-]+)"\)/g)) {
    gates.set(kind, feature);
  }
  if (gates.size < MIN_GATED_KINDS) {
    fail([`${licensePath}: read ${gates.size} gated kinds, below the floor of ${MIN_GATED_KINDS}.`]);
  }
  const ungated = source.match(/const UNGATED_KIND: &str = "([A-Za-z0-9]+)";/);
  if (!ungated) fail([`${licensePath}: no UNGATED_KIND.`]);
  return { gates, ungated: ungated[1] };
}

function readTiers() {
  const source = readText(tiersPath, "the website's licence tiers");
  const block = source.match(/LICENCE_FEATURE_TIERS\s*=\s*\{([\s\S]*?)\}\s*as const/);
  if (!block) fail([`${tiersPath}: no LICENCE_FEATURE_TIERS object.`]);
  const tiers = new Map();
  for (const [, feature, tier] of block[1].matchAll(/'([a-z0-9-]+)':\s*'([a-z]+)'/g)) {
    if (!(tier in TIER_NAME)) fail([`${tiersPath}: ${feature} on unknown tier ${tier}.`]);
    tiers.set(feature, TIER_NAME[tier]);
  }
  return tiers;
}

function licensing(kinds) {
  const { gates, ungated } = readGates();
  const tiers = readTiers();
  const problems = [];
  const tierOf = (feature) => {
    const tier = tiers.get(feature);
    if (!tier) problems.push(`Licence feature ${feature} is not in the website's price table.`);
    return tier;
  };
  const names = new Set(kinds.map((kind) => kind.kind));
  for (const kind of [...gates.keys(), ungated]) {
    if (!names.has(kind)) problems.push(`${kind} is licensed by the operator but has no CRD.`);
  }
  const notes = new Map();
  for (const [kind, feature] of gates) {
    notes.set(kind, { feature, tier: tierOf(feature) });
  }
  notes.set(ungated, { feature: null, tier: tierOf(OPERATOR_FEATURE) });
  if (problems.length > 0) fail(problems);
  return notes;
}

function licenceCell(note) {
  if (!note) return '';
  return note.feature ? `${code(note.feature)}, ${note.tier}` : `none, ${note.tier}`;
}

function licenceLine(kind, note) {
  if (note.feature) {
    return `Enterprise kind, reconciled only when the licence carries ${code(note.feature)}, which is sold from the ${note.tier} tier.`;
  }
  return `Enterprise kind gated on no licence feature, since it is where the licence is named: it is reconciled wherever the operator runs, from the ${note.tier} tier.`;
}

// Rendering.

function escapeText(text) {
  // Code spans stay as written; the prose around them cannot open a tag.
  return text
    .split(/(`[^`]*`)/)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    )
    .join('')
    .replaceAll('|', '\\|');
}

function prose(description) {
  if (!description) return '';
  return description
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph !== '')
    .join(' ');
}

function typeOf(schema) {
  if (!schema || typeof schema !== 'object') return 'any';
  if (schema['x-kubernetes-int-or-string']) return 'integer or string';
  if (schema['x-kubernetes-preserve-unknown-fields'] && !schema.type) return 'any';
  if (schema.type === 'array') return `array of ${typeOf(schema.items)}`;
  if (schema.type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    return `map of ${typeOf(schema.additionalProperties)}`;
  }
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) return 'object';
  return schema.type ?? 'object';
}

function code(text) {
  const value = String(text);
  const fence = value.includes('`') ? '``' : '`';
  const pad = value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

function defaultOf(schema) {
  if (!schema || !('default' in schema)) return '';
  return code(JSON.stringify(schema.default)).replaceAll('|', '\\|');
}

function constraints(schema) {
  const notes = [];
  if (Array.isArray(schema.enum)) {
    notes.push(`One of ${schema.enum.filter((v) => v !== null).map((v) => code(v)).join(', ')}.`);
  }
  if (typeof schema.minimum === 'number' && schema.minimum !== 0) notes.push(`Minimum ${code(schema.minimum)}.`);
  if (typeof schema.maximum === 'number') notes.push(`Maximum ${code(schema.maximum)}.`);
  if (typeof schema.maxItems === 'number') notes.push(`At most ${schema.maxItems} items.`);
  if (typeof schema.maxLength === 'number') notes.push(`At most ${schema.maxLength} characters.`);
  return notes.join(' ').replaceAll('|', '\\|');
}

function crdKinds(documents) {
  const kinds = [];
  for (const document of documents) {
    if (document?.kind !== 'CustomResourceDefinition') continue;
    const spec = document.spec;
    const version = (spec.versions ?? []).find((v) => v.served && v.storage) ?? spec.versions?.[0];
    const schema = version?.schema?.openAPIV3Schema?.properties?.spec;
    if (!schema) fail([`${document.metadata?.name}: no spec schema in the served version.`]);
    kinds.push({
      kind: spec.names.kind,
      plural: spec.names.plural,
      shortNames: spec.names.shortNames ?? [],
      scope: spec.scope,
      apiVersion: `${spec.group}/${version.name}`,
      schema,
    });
  }
  return kinds.sort((left, right) => left.kind.localeCompare(right.kind));
}

function render(kinds, notes) {
  const out = [];
  out.push('| Kind | apiVersion | Short names | Scope | Licence feature, tier |');
  out.push('|------|------------|-------------|-------|-----------------------|');
  for (const kind of kinds) {
    const anchor = kind.kind.toLowerCase();
    const shorts = kind.shortNames.map((name) => code(name)).join(', ');
    const licence = licenceCell(notes.get(kind.kind));
    out.push(`| [${kind.kind}](#${anchor}) | ${code(kind.apiVersion)} | ${shorts} | ${kind.scope} | ${licence} |`);
  }
  for (const kind of kinds) {
    out.push('');
    out.push(`### ${kind.kind}`);
    out.push('');
    out.push(`${code(kind.apiVersion)}, plural ${code(kind.plural)}, ${kind.scope.toLowerCase()}.`);
    const note = notes.get(kind.kind);
    if (note) {
      out.push('');
      out.push(licenceLine(kind.kind, note));
    }
    const summary = prose(kind.schema.description);
    if (summary) {
      out.push('');
      out.push(escapeText(summary).replaceAll('\\|', '|'));
    }
    const properties = Object.entries(kind.schema.properties ?? {});
    const required = new Set(kind.schema.required ?? []);
    out.push('');
    if (properties.length === 0) {
      out.push(`${code(`${kind.kind}.spec`)} has no fields.`);
      continue;
    }
    out.push('| Field | Type | Default | Description |');
    out.push('|-------|------|---------|-------------|');
    for (const [name, schema] of properties) {
      const type = `${typeOf(schema)}${required.has(name) ? ', required' : ''}`;
      const text = [escapeText(prose(schema.description)), constraints(schema)].filter(Boolean).join(' ');
      out.push(`| ${code(name)} | ${type} | ${defaultOf(schema)} | ${text} |`);
    }
  }
  return out.join('\n');
}

let source;
try {
  source = readFileSync(crdsPath, 'utf8');
} catch (error) {
  fail([
    `Cannot read the operator CRDs at ${crdsPath}: ${error.message}`,
    '',
    'Check out ebpfsentinel-operator beside this repository, or name the file',
    'with EBPFSENTINEL_OPERATOR_CRDS.',
  ]);
}

const kinds = crdKinds(parseDocuments(source, relative(process.cwd(), crdsPath)));
const fields = kinds.reduce((total, kind) => total + Object.keys(kind.schema.properties ?? {}).length, 0);
if (kinds.length < MIN_KINDS || fields < MIN_FIELDS) {
  fail([`Read ${kinds.length} kinds and ${fields} fields: below the floor of ${MIN_KINDS} and ${MIN_FIELDS}.`]);
}

const original = readFileSync(pagePath, 'utf8');
const begin = original.indexOf(BEGIN);
const end = original.indexOf(END);
if (begin < 0 || end < begin) {
  fail([`${relative(process.cwd(), pagePath)} lacks the ${BEGIN} and ${END} markers.`]);
}
const page = `${original.slice(0, begin + BEGIN.length)}\n\n${render(kinds, licensing(kinds))}\n\n${original.slice(end)}`;

if (checkOnly) {
  if (page !== original) {
    fail([
      `${relative(process.cwd(), pagePath)} does not match the operator CRDs.`,
      '',
      'Run `npm run generate:crd-reference` and commit the result.',
    ]);
  }
} else if (page !== original) {
  writeFileSync(pagePath, page);
  console.log(`Wrote the generated section of ${relative(process.cwd(), pagePath)}.`);
}

console.log(`Operator CRD reference OK: ${kinds.length} kinds, ${fields} fields.`);
