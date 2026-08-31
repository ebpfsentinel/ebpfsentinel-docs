#!/usr/bin/env node
// Fails when the REST reference and the agent's OpenAPI document disagree on
// which method and path pairs exist.
//
// `openapi.json` is generated from the `#[utoipa::path]` annotations and the
// agent's own suite pins it to the mounted router in both directions, so it is
// the surface. This check carries that guarantee one repository further: a
// route added to the agent and not written up here fails the docs build rather
// than being discovered by a reader who cannot find it.
//
// Only the open-source surface is compared. The enterprise agent listens on a
// separate port behind a licence feature and its routes are documented under
// `## Enterprise Endpoints`, which is where the comparison stops.
//
// Both renderings of a route are checked, because the page carries each one
// twice: a `#### METHOD /path` section and a row of the endpoint summary table.
// A section with no row is a route nobody scanning the table will find, and a
// row with no section is a promise the page does not keep.

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'api-reference', 'rest-api.md');

const DEFAULT_OPENAPI_JSON = resolve(repoRoot, '..', 'ebpfsentinel', 'openapi.json');
const openApiJson = process.env.EBPFSENTINEL_OPENAPI_JSON
  ? resolve(process.env.EBPFSENTINEL_OPENAPI_JSON)
  : DEFAULT_OPENAPI_JSON;

// The verbs OpenAPI 3.1 allows on a path item. A pair is keyed on the
// upper-cased verb so the page's headings and the document's keys compare
// directly.
const VERBS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

const ENTERPRISE_HEADING = '## Enterprise Endpoints';
// The two unauthenticated probes are documented as `###` under "Public
// Endpoints" and every other route as `####` under its domain group, so both
// depths count. Requiring the path to start with `/` is what keeps a domain
// heading such as `### MITRE ATT&CK` out of the set.
const SECTION_RE = /^#{3,4}\s+([A-Z]+)\s+(\/\S*)\s*$/;
const SUMMARY_ROW_RE = /^\|\s*([A-Z]+)\s*\|\s*`([^`]+)`\s*\|/;

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readOpenApi() {
  let doc;
  try {
    doc = JSON.parse(readFileSync(openApiJson, 'utf8'));
  } catch (error) {
    fail([
      `Cannot read the OpenAPI document at ${openApiJson}:`,
      `  ${error.message}`,
      '',
      'The agent repository is expected beside this one. Set',
      'EBPFSENTINEL_OPENAPI_JSON to point at it explicitly.',
    ]);
  }

  const pairs = new Set();
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const verb of VERBS) {
      if (item[verb]) pairs.add(`${verb.toUpperCase()} ${path}`);
    }
  }
  if (pairs.size === 0) {
    fail([`${openApiJson} describes no operation at all. Refusing to compare against it.`]);
  }
  return pairs;
}

function readPage() {
  const text = readFileSync(pagePath, 'utf8');
  const enterpriseAt = text.indexOf(`\n${ENTERPRISE_HEADING}`);
  if (enterpriseAt === -1) {
    fail([
      `${relative(process.cwd(), pagePath)} carries no "${ENTERPRISE_HEADING}" heading.`,
      '',
      'The heading is where the open-source surface ends. Without it this check',
      'would compare the enterprise routes against the open-source document and',
      'report every one of them as undocumented.',
    ]);
  }

  const sections = new Set();
  const rows = new Set();
  for (const line of text.slice(0, enterpriseAt).split('\n')) {
    const section = SECTION_RE.exec(line);
    if (section) {
      sections.add(`${section[1]} ${section[2]}`);
      continue;
    }
    const row = SUMMARY_ROW_RE.exec(line);
    if (row) rows.add(`${row[1]} ${row[2]}`);
  }
  return { sections, rows };
}

function missingFrom(expected, actual) {
  return [...expected].filter((pair) => !actual.has(pair)).sort();
}

function report(problems, heading, pairs, remedy) {
  if (pairs.length === 0) return;
  if (problems.length > 0) problems.push('');
  problems.push(`${pairs.length} ${heading}:`, '', ...pairs.map((pair) => `  ${pair}`), '', remedy);
}

const spec = readOpenApi();
const { sections, rows } = readPage();
const problems = [];

report(
  problems,
  'route in the OpenAPI document with no section on the page',
  missingFrom(spec, sections),
  'Add a "#### METHOD /path" section, taking the request and response shapes from the document.',
);
report(
  problems,
  'section on the page describing a route the agent does not serve',
  missingFrom(sections, spec),
  'Remove the section, or move it under "## Enterprise Endpoints" if the enterprise agent serves it.',
);
report(
  problems,
  'route in the OpenAPI document with no row in the endpoint summary',
  missingFrom(spec, rows),
  'Add a row to the "## Endpoint Summary" table.',
);
report(
  problems,
  'row in the endpoint summary describing a route the agent does not serve',
  missingFrom(rows, spec),
  'Remove the row, or move it under "## Enterprise Endpoints" if the enterprise agent serves it.',
);

if (problems.length > 0) fail(problems);

console.log(
  `REST reference OK: ${spec.size} operations in ${relative(process.cwd(), openApiJson)}, ` +
    `each with a section and a summary row.`,
);
