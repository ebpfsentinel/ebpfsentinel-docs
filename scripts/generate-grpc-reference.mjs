#!/usr/bin/env node

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'api-reference', 'grpc-api.md');

// Both agents speak gRPC, and each keeps its protos in a `proto/` tree of its
// own. The directory is walked rather than listed file by file, so a service
// added in a new file is picked up here instead of being documented nowhere.
const SOURCES = [
  {
    id: 'MESSAGES',
    label: 'the agent',
    env: 'EBPFSENTINEL_PROTO_DIR',
    dir: resolve(repoRoot, '..', 'ebpfsentinel', 'proto'),
  },
  {
    id: 'ENTERPRISE MESSAGES',
    label: 'the enterprise agent',
    env: 'EBPFSENTINEL_ENT_PROTO_DIR',
    dir: resolve(repoRoot, '..', 'ebpfsentinel-enterprise', 'proto'),
  },
];

const checkOnly = process.argv.includes('--check');

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

const SYNTAX_RE = /^syntax\s*=\s*"proto3"\s*;$/;
const PACKAGE_RE = /^package\s+([\w.]+)\s*;$/;
const SERVICE_OPEN_RE = /^service\s+(\w+)\s*\{$/;
const MESSAGE_OPEN_RE = /^message\s+(\w+)\s*\{$/;
const ENUM_OPEN_RE = /^enum\s+(\w+)\s*\{$/;
const RPC_RE = /^rpc\s+(\w+)\s*\(\s*(stream\s+)?(\w+)\s*\)\s*returns\s*\(\s*(stream\s+)?(\w+)\s*\)\s*(?:\{\s*\}|;)$/;
const FIELD_RE = /^(repeated\s+|optional\s+)?([\w.]+)\s+(\w+)\s*=\s*(\d+)\s*;$/;
const ENUM_VALUE_RE = /^(\w+)\s*=\s*(\d+)\s*;$/;

function protoFiles(dir) {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current).sort()) {
      const path = join(current, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.proto')) out.push(path);
    }
  };
  walk(dir);
  return out;
}

function parseProto(protoPath, text) {
  const lines = text.split('\n');
  const proto = { path: protoPath, package: null, services: [], messages: [], enums: [] };
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
      const enumeration = ENUM_OPEN_RE.exec(line);
      if (enumeration) {
        open = { kind: 'enum', name: enumeration[1], doc: doc.join(' '), values: [] };
        proto.enums.push(open);
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

    if (open.kind === 'enum') {
      const value = ENUM_VALUE_RE.exec(line);
      if (!value) fail([`${at}: expected an enum value, got "${line}".`]);
      open.values.push({ name: value[1], number: Number(value[2]), doc: doc.join(' ') });
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

  const where = relative(process.cwd(), protoPath);
  if (open !== null) fail([`${where}: "${open.name}" is never closed.`]);
  if (proto.package === null) fail([`${where}: no package declaration.`]);
  if (proto.services.length === 0 && proto.messages.length === 0) {
    fail([`${where}: neither a service nor a message. Refusing to generate an empty section.`]);
  }
  return proto;
}

function cell(text) {
  return text.replace(/\|/g, '\\|');
}

function anchor(name) {
  return `#${name.toLowerCase()}`;
}

function render(protos, knownTypes) {
  const out = [];

  for (const proto of protos) {
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
        const spelling = field.label ? `${field.label} ${field.type}` : field.type;
        const type = knownTypes.has(field.type)
          ? `[\`${spelling}\`](${anchor(field.type)})`
          : `\`${spelling}\``;
        out.push(`| ${field.number} | \`${field.name}\` | ${type} | ${cell(field.doc)} |`);
      }
      out.push('');
    }

    for (const enumeration of proto.enums) {
      out.push(`### ${enumeration.name}`, '');
      if (enumeration.doc) out.push(enumeration.doc, '');
      out.push(
        `${enumeration.values.length} value${enumeration.values.length === 1 ? '' : 's'}. The number is the wire value and never changes.`,
        '',
        '| # | Value | Description |',
        '|---|-------|-------------|',
      );
      for (const value of enumeration.values) {
        out.push(`| ${value.number} | \`${value.name}\` | ${cell(value.doc)} |`);
      }
      out.push('');
    }
  }

  return out.join('\n').replace(/\n+$/, '\n');
}

function readSource(source) {
  const dir = process.env[source.env] ? resolve(process.env[source.env]) : source.dir;
  let files;
  try {
    files = protoFiles(dir);
  } catch (error) {
    fail([
      `Cannot read the proto tree of ${source.label} at ${dir}: ${error.message}`,
      '',
      `Check the repository out beside this one, or point ${source.env} at its`,
      '`proto` directory.',
    ]);
  }
  if (files.length === 0) {
    fail([`${relative(process.cwd(), dir)} carries no .proto file. Refusing to empty the page.`]);
  }
  return files.map((file) => parseProto(file, readFileSync(file, 'utf8')));
}

function splice(page, source, generated) {
  const begin = `<!-- BEGIN GENERATED ${source.id} -->`;
  const end = `<!-- END GENERATED ${source.id} -->`;
  const from = page.indexOf(begin);
  const to = page.indexOf(end);
  if (from === -1 || to === -1 || to < from) {
    fail([
      `${relative(process.cwd(), pagePath)} carries no "${begin}" / "${end}" pair.`,
      '',
      'The markers are where the generated section goes. Put them back rather',
      'than writing the messages by hand.',
    ]);
  }
  return `${page.slice(0, from + begin.length)}\n\n${generated}\n${page.slice(to)}`;
}

// Every service and every rpc has to be named by the prose as well as by the
// generated block: the signature says what the call looks like and only a
// person can say what it does to the node that receives it. Regenerating the
// page is therefore not enough to make a new rpc pass.
function handWritten(page) {
  let rest = page;
  for (const source of SOURCES) {
    const begin = `<!-- BEGIN GENERATED ${source.id} -->`;
    const end = `<!-- END GENERATED ${source.id} -->`;
    const from = rest.indexOf(begin);
    const to = rest.indexOf(end);
    if (from === -1 || to === -1 || to < from) continue;
    rest = rest.slice(0, from) + rest.slice(to + end.length);
  }
  return rest;
}

const parsed = SOURCES.map((source) => ({ source, protos: readSource(source) }));

let page = readFileSync(pagePath, 'utf8');
let services = 0;
let rpcs = 0;
let messages = 0;
let fields = 0;

for (const { source, protos } of parsed) {
  const knownTypes = new Set([
    ...protos.flatMap((proto) => proto.messages.map((message) => message.name)),
    ...protos.flatMap((proto) => proto.enums.map((enumeration) => enumeration.name)),
  ]);
  page = splice(page, source, render(protos, knownTypes));
  for (const proto of protos) {
    services += proto.services.length;
    rpcs += proto.services.reduce((total, service) => total + service.rpcs.length, 0);
    messages += proto.messages.length;
    fields += proto.messages.reduce((total, message) => total + message.fields.length, 0);
  }
}

const original = readFileSync(pagePath, 'utf8');

if (checkOnly) {
  if (page !== original) {
    fail([
      `${relative(process.cwd(), pagePath)} does not match the proto trees.`,
      '',
      'Run `npm run generate:grpc-reference` and commit the result.',
    ]);
  }
} else if (page !== original) {
  writeFileSync(pagePath, page);
  console.log(`Wrote the generated sections of ${relative(process.cwd(), pagePath)}.`);
}

// The generated block is written before this runs, so a new rpc leaves the
// signatures in place and fails on the one thing a generator cannot supply.
const unnamed = [];
const prose = handWritten(page);
for (const { protos } of parsed) {
  for (const proto of protos) {
    const where = relative(process.cwd(), proto.path);
    for (const service of proto.services) {
      if (!prose.includes(service.name)) {
        unnamed.push(`  service ${service.name} (${where}) is named nowhere outside the generated block.`);
      }
      for (const rpc of service.rpcs) {
        if (!prose.includes(rpc.name)) {
          unnamed.push(`  rpc ${service.name}/${rpc.name} (${where}) is named nowhere outside the generated block.`);
        }
      }
    }
  }
}

if (unnamed.length > 0) {
  fail([
    `${relative(process.cwd(), pagePath)} does not say what every rpc is for.`,
    '',
    ...unnamed,
    '',
    'Write what the call does to the node that receives it. A signature on its',
    'own does not tell an operator what crosses the port.',
  ]);
}

console.log(
  `gRPC reference OK: ${services} services, ${rpcs} rpcs, ${messages} messages, ${fields} fields.`,
);
