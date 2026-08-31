#!/usr/bin/env node
// Renders the message reference on the gRPC page out of the `.proto` file.
//
// The documented `AlertEvent` had drifted to eight fields with the wrong names,
// the wrong types and the wrong numbers, which is what a transcribed schema
// does: nothing fails when a field is added, so nobody adds it. The section
// between the two markers on the page is therefore generated rather than
// written, and CI runs this script with `--check` so the next field addition
// fails the docs build instead of silently reaching an integrator's generated
// client.
//
// The parser is deliberately strict. A construct it does not understand is an
// error rather than a line it skips: a generator that quietly drops an `oneof`
// or a nested message would reintroduce the exact drift it exists to stop.
// Whoever adds one teaches this script about it in the same change.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'api-reference', 'grpc-api.md');

const DEFAULT_PROTO = resolve(
  repoRoot,
  '..',
  'ebpfsentinel',
  'proto',
  'ebpfsentinel',
  'v1',
  'alerts.proto',
);
const protoPath = process.env.EBPFSENTINEL_ALERTS_PROTO
  ? resolve(process.env.EBPFSENTINEL_ALERTS_PROTO)
  : DEFAULT_PROTO;

const BEGIN = '<!-- BEGIN GENERATED MESSAGES -->';
const END = '<!-- END GENERATED MESSAGES -->';

const checkOnly = process.argv.includes('--check');

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

// ── Parsing ──────────────────────────────────────────────────────────────

const SYNTAX_RE = /^syntax\s*=\s*"proto3"\s*;$/;
const PACKAGE_RE = /^package\s+([\w.]+)\s*;$/;
const SERVICE_OPEN_RE = /^service\s+(\w+)\s*\{$/;
const MESSAGE_OPEN_RE = /^message\s+(\w+)\s*\{$/;
const RPC_RE = /^rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)\s*(?:\{\s*\}|;)$/;
const FIELD_RE = /^(repeated\s+|optional\s+)?([\w.]+)\s+(\w+)\s*=\s*(\d+)\s*;$/;

function parseProto(text) {
  const lines = text.split('\n');
  const proto = { package: null, services: [], messages: [] };
  // Comments accumulate onto the next declaration. A blank line discards them,
  // which is how a section divider inside a message stays a divider instead of
  // becoming the documentation of the field that happens to follow it.
  let doc = [];
  let open = null;

  for (const [index, raw] of lines.entries()) {
    const at = `${relative(process.cwd(), protoPath)}:${index + 1}`;
    const line = raw.trim();

    if (line === '') {
      doc = [];
      continue;
    }
    if (line.startsWith('//')) {
      doc.push(line.slice(2).trim());
      continue;
    }
    if (line === '}') {
      if (open === null) fail([`${at}: a closing brace with nothing open.`]);
      open = null;
      doc = [];
      continue;
    }

    if (open === null) {
      if (SYNTAX_RE.test(line)) {
        doc = [];
        continue;
      }
      const pkg = PACKAGE_RE.exec(line);
      if (pkg) {
        proto.package = pkg[1];
        doc = [];
        continue;
      }
      const service = SERVICE_OPEN_RE.exec(line);
      if (service) {
        open = { kind: 'service', name: service[1], doc: doc.join(' '), rpcs: [] };
        proto.services.push(open);
        doc = [];
        continue;
      }
      const message = MESSAGE_OPEN_RE.exec(line);
      if (message) {
        open = { kind: 'message', name: message[1], doc: doc.join(' '), fields: [] };
        proto.messages.push(open);
        doc = [];
        continue;
      }
      fail([
        `${at}: this script does not understand "${line}".`,
        '',
        'Teach it the construct rather than loosening the parser: a generator',
        'that skips what it cannot read is how the page drifted in the first',
        'place.',
      ]);
    }

    if (open.kind === 'service') {
      const rpc = RPC_RE.exec(line);
      if (!rpc) fail([`${at}: expected an rpc declaration, got "${line}".`]);
      open.rpcs.push({
        name: rpc[1],
        request: rpc[3],
        requestStream: Boolean(rpc[2]),
        response: rpc[5],
        responseStream: Boolean(rpc[4]),
        doc: doc.join(' '),
      });
      doc = [];
      continue;
    }

    const field = FIELD_RE.exec(line);
    if (!field) fail([`${at}: expected a field declaration, got "${line}".`]);
    open.fields.push({
      label: field[1] ? field[1].trim() : '',
      type: field[2],
      name: field[3],
      number: Number(field[4]),
      doc: doc.join(' '),
    });
    doc = [];
  }

  if (open !== null) fail([`${relative(process.cwd(), protoPath)}: "${open.name}" is never closed.`]);
  if (proto.package === null) fail([`${relative(process.cwd(), protoPath)}: no package declaration.`]);
  if (proto.services.length === 0 && proto.messages.length === 0) {
    fail([`${relative(process.cwd(), protoPath)}: neither a service nor a message. Refusing to generate an empty section.`]);
  }
  return proto;
}

// ── Rendering ────────────────────────────────────────────────────────────

// A pipe inside a comment would end the table cell it sits in.
function cell(text) {
  return text.replace(/\|/g, '\\|');
}

function anchor(name) {
  return `#${name.toLowerCase()}`;
}

function render(proto, knownMessages) {
  const out = [];

  for (const service of proto.services) {
    out.push(`### ${service.name}`, '');
    if (service.doc) out.push(service.doc, '');
    out.push('```protobuf');
    for (const rpc of service.rpcs) {
      const request = `${rpc.requestStream ? 'stream ' : ''}${rpc.request}`;
      const response = `${rpc.responseStream ? 'stream ' : ''}${rpc.response}`;
      out.push(`rpc ${rpc.name}(${request}) returns (${response});`);
    }
    out.push('```', '');
    for (const rpc of service.rpcs) {
      if (rpc.doc) out.push(`\`${rpc.name}\`: ${rpc.doc}`, '');
    }
  }

  for (const message of proto.messages) {
    out.push(`### ${message.name}`, '');
    if (message.doc) out.push(message.doc, '');
    out.push(
      `${message.fields.length} field${message.fields.length === 1 ? '' : 's'}, in declaration order. The number is the wire tag and never changes.`,
      '',
      '| # | Field | Type | Description |',
      '|---|-------|------|-------------|',
    );
    for (const field of message.fields) {
      // The label and the type are one code span rather than two, so a
      // `repeated uint32` reads as the declaration it is.
      const spelling = field.label ? `${field.label} ${field.type}` : field.type;
      const type = knownMessages.has(field.type)
        ? `[\`${spelling}\`](${anchor(field.type)})`
        : `\`${spelling}\``;
      out.push(`| ${field.number} | \`${field.name}\` | ${type} | ${cell(field.doc)} |`);
    }
    out.push('');
  }

  return out.join('\n');
}

// ── Splice ───────────────────────────────────────────────────────────────

const proto = parseProto(readFileSync(protoPath, 'utf8'));
const knownMessages = new Set(proto.messages.map((message) => message.name));
const generated = render(proto, knownMessages);

const page = readFileSync(pagePath, 'utf8');
const begin = page.indexOf(BEGIN);
const end = page.indexOf(END);
if (begin === -1 || end === -1 || end < begin) {
  fail([
    `${relative(process.cwd(), pagePath)} carries no "${BEGIN}" / "${END}" pair.`,
    '',
    'The markers are where the generated section goes. Put them back rather',
    'than writing the messages by hand.',
  ]);
}

const next = `${page.slice(0, begin + BEGIN.length)}\n\n${generated}\n${page.slice(end)}`;

if (checkOnly) {
  if (next !== page) {
    fail([
      `${relative(process.cwd(), pagePath)} does not match ${relative(process.cwd(), protoPath)}.`,
      '',
      'Run `npm run generate:grpc-reference` and commit the result.',
    ]);
  }
  const fieldCount = proto.messages.reduce((total, message) => total + message.fields.length, 0);
  console.log(
    `gRPC reference OK: ${proto.messages.length} messages, ${fieldCount} fields, ` +
      `generated from ${relative(process.cwd(), protoPath)}.`,
  );
} else {
  writeFileSync(pagePath, next);
  console.log(`Wrote the generated section of ${relative(process.cwd(), pagePath)}.`);
}
