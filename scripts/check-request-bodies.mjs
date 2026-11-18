#!/usr/bin/env node

// Every request body a page prints is one the agent accepts. A body is read
// from three places: the `-d` / `--data` / `--json` argument of a curl command,
// whose URL names the route; the `--json` argument of an `ebpfsentinel-agent`
// subcommand, which the command line sends verbatim to the route in the table
// below; and a `json` fence a page labels as the request (`Request body:` or a
// `Request` heading), whose route is the last operation the page named above
// it. Each is validated against the request schema the agent's own OpenAPI
// document publishes for that route: the open-source agent's, or the
// enterprise agent's for its pages, its port and its binary. A field the
// schema does not declare where it refuses unknown fields, a required field
// left out, a value of the wrong type or outside an enum, and a body that is
// not JSON at all are each a failure, because each is a command the reader
// copies and the agent answers with 400 or 422.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const docsRoot = join(repoRoot, 'docs');
const ossRoot = process.env.EBPFSENTINEL_OSS_ROOT
  ? resolve(process.env.EBPFSENTINEL_OSS_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel');
const entRoot = process.env.EBPFSENTINEL_ENTERPRISE_ROOT
  ? resolve(process.env.EBPFSENTINEL_ENTERPRISE_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel-enterprise');

const ossDoc = JSON.parse(readFileSync(join(ossRoot, 'openapi.json'), 'utf8'));
const entDoc = JSON.parse(readFileSync(join(entRoot, 'openapi.json'), 'utf8'));
const apiClient = readFileSync(
  join(ossRoot, 'crates', 'agent', 'src', 'cli', 'api_client.rs'),
  'utf8',
);

// The open-source subcommands that take `--json` and the route each sends it
// to. Every entry is held to the client the command line calls through, so a
// command moved to another route fails here before it fails a reader.
const CLI_ROUTES = new Map([
  ['firewall add', ['POST', '/api/v1/firewall/rules']],
  ['l7 add', ['POST', '/api/v1/firewall/l7-rules']],
  ['ratelimit add', ['POST', '/api/v1/ratelimit/rules']],
  ['ddos add', ['POST', '/api/v1/ddos/policies']],
  ['lb add', ['POST', '/api/v1/lb/services']],
  ['lb announce', ['POST', '/api/v1/lb/vips']],
  ['qos add-pipe', ['POST', '/api/v1/qos/pipes']],
  ['qos add-queue', ['POST', '/api/v1/qos/queues']],
  ['qos add-classifier', ['POST', '/api/v1/qos/classifiers']],
  ['zones add', ['POST', '/api/v1/zones']],
  ['zones add-policy', ['POST', '/api/v1/zones/policies']],
  ['routing add-gateway', ['POST', '/api/v1/routing/gateways']],
  ['aliases set-content', ['PUT', '/api/v1/aliases/{id}/content']],
]);

const errors = [];

for (const [command, [method, path]] of CLI_ROUTES) {
  const literal = path.includes('{') ? path.slice(0, path.indexOf('{')) : `${path}"`;
  const call = new RegExp(`Method::${method},\\s*&?(?:format!\\()?"${escape(literal)}`);
  if (!call.test(apiClient)) {
    errors.push(
      `scripts/check-request-bodies.mjs: \`${command}\` is listed as ${method} ${path}, which the command line's client does not call`,
    );
  }
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function markdownFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
    else if (/\.mdx?$/.test(name)) found.push(path);
  }
  return found.sort();
}

function templates(doc) {
  return Object.keys(doc.paths ?? {}).map((template) => ({
    template,
    re: new RegExp(`^${template.split(/\{[^}]+\}/).map(escape).join('[^/]+')}$`),
  }));
}
const ossTemplates = templates(ossDoc);
const entTemplates = templates(entDoc);

function operation(doc, list, method, path) {
  const match = list.find(({ re }) => re.test(path));
  if (!match) return undefined;
  return { template: match.template, op: doc.paths[match.template][method.toLowerCase()] };
}

function resolveRef(doc, ref) {
  const parts = ref.replace(/^#\//, '').split('/');
  let node = doc;
  for (const part of parts) node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
  return node;
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return typeof value;
}

// The subset of JSON Schema utoipa emits: references, the three combinators,
// types (one or a list), enums, objects with their required and declared
// properties, arrays, numeric bounds and `nullable`.
function validate(doc, schema, value, at) {
  if (!schema || schema === true) return [];
  if (schema.$ref) return validate(doc, resolveRef(doc, schema.$ref), value, at);
  const problems = [];
  if (schema.allOf) {
    for (const part of schema.allOf) problems.push(...validate(doc, part, value, at));
  }
  for (const key of ['oneOf', 'anyOf']) {
    if (!schema[key]) continue;
    const tries = schema[key].map((part) => validate(doc, part, value, at));
    if (!tries.some((found) => found.length === 0)) {
      tries.sort((a, b) => a.length - b.length);
      problems.push(...tries[0]);
    }
  }
  if (value === null && schema.nullable) return problems;
  if (schema.type !== undefined) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    const fits = allowed.includes(actual) || (actual === 'integer' && allowed.includes('number'));
    if (!fits) {
      problems.push(`${at}: ${JSON.stringify(value)} is not ${allowed.join(' or ')}`);
      return problems;
    }
  }
  if (schema.enum && !schema.enum.some((option) => JSON.stringify(option) === JSON.stringify(value))) {
    problems.push(`${at}: ${JSON.stringify(value)} is not one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    problems.push(`${at}: ${JSON.stringify(value)} is not ${JSON.stringify(schema.const)}`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${at}: ${value} is below ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${at}: ${value} is above ${schema.maximum}`);
  }
  if (typeOf(value) === 'object') {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
      if (!(name in value)) problems.push(`${at}: the required field \`${name}\` is missing`);
    }
    for (const [name, inner] of Object.entries(value)) {
      if (name in properties) problems.push(...validate(doc, properties[name], inner, `${at}.${name}`));
      else if (schema.additionalProperties === false) problems.push(`${at}: \`${name}\` is not a field this route accepts`);
      else if (typeof schema.additionalProperties === 'object') {
        problems.push(...validate(doc, schema.additionalProperties, inner, `${at}.${name}`));
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => problems.push(...validate(doc, schema.items, item, `${at}[${index}]`)));
  }
  return problems;
}

// A shell argument in single quotes, with the `'\''` idiom a body uses to
// carry an apostrophe and the `'"$(command)"'` idiom it uses to splice in a
// value the shell computes, read here as a placeholder string.
function quotedArgument(text, from) {
  let out = '';
  let i = from;
  for (;;) {
    const end = text.indexOf("'", i);
    if (end < 0) return undefined;
    out += text.slice(i, end);
    const splice = text.slice(end).match(/^'"\$[^"]*"'/);
    if (text.startsWith("'\\''", end)) {
      out += "'";
      i = end + 4;
    } else if (splice) {
      out += 'shell-value';
      i = end + splice[0].length;
    } else {
      return { value: out, end: end + 1 };
    }
  }
}

// The commands of a shell fence: a line break ends one unless it follows a
// backslash or sits inside a single-quoted argument, where a JSON body spread
// over several lines keeps it.
function commands(body) {
  const found = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'") quoted = !quoted;
    if (!quoted && c === '\\' && body[i + 1] === '\n') {
      current += ' ';
      i++;
      continue;
    }
    if (!quoted && c === '\n') {
      found.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  found.push(current);
  return found;
}

const OPERATION_LINE = [
  /^#{2,5}\s+(GET|POST|PUT|PATCH|DELETE)\s+`?(\/[^\s`]+)`?\s*$/,
  /^\*\*(GET|POST|PUT|PATCH|DELETE)\*\*\s+`(\/[^`]+)`/,
  /^(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s`]+)\s*$/,
];

function check(file, method, url, body, forEnterprise, where) {
  const path = url.replace(/^[a-z]+:\/\/[^/]+/, '').replace(/[?#].*$/, '');
  if (!path.startsWith('/api/')) return false;
  const order = forEnterprise
    ? [[entDoc, entTemplates], [ossDoc, ossTemplates]]
    : [[ossDoc, ossTemplates], [entDoc, entTemplates]];
  let found;
  for (const [doc, list] of order) {
    const hit = operation(doc, list, method, path);
    if (hit?.op) {
      found = { doc, ...hit };
      break;
    }
  }
  if (!found) {
    errors.push(`${where}: ${method} ${path} is a route neither agent serves`);
    return true;
  }
  let value;
  try {
    value = JSON.parse(body);
  } catch (error) {
    errors.push(`${where}: the body sent to ${method} ${found.template} is not JSON (${error.message})`);
    return true;
  }
  const schema = found.op.requestBody?.content?.['application/json']?.schema;
  if (!schema) {
    errors.push(`${where}: ${method} ${found.template} takes no JSON body, and the page sends one`);
    return true;
  }
  for (const problem of validate(found.doc, schema, value, 'body')) {
    errors.push(`${where}: ${method} ${found.template}: ${problem}`);
  }
  return true;
}

// A request fence names its route in one of two ways besides the heading
// above it: a first line `POST /api/...` before the body, or `// POST /api/...`
// comments splitting the fence into a request and the response it gets, the
// response being no request and left alone.
function jsonParts(body, operation) {
  const lines = body.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  const head = first >= 0 ? lines[first].trim().match(OPERATION_LINE[2]) : null;
  if (head) {
    return [{ operation: { method: head[1], path: head[2] }, body: lines.slice(first + 1).join('\n') }];
  }
  if (!lines.some((line) => line.trim().startsWith('//'))) return [{ operation, body }];
  const parts = [];
  let current = { operation, body: '', request: true };
  const flush = () => {
    if (current.request && current.body.trim() !== '') parts.push(current);
  };
  for (const line of lines) {
    const comment = line.trim().match(/^\/\/\s*(.*)$/);
    if (!comment) {
      current.body += `${line}\n`;
      continue;
    }
    flush();
    const named = comment[1].match(/^(GET|POST|PUT|PATCH|DELETE)\s+(\/api\/\S+)/);
    current = named
      ? { operation: { method: named[1], path: named[2] }, body: '', request: true }
      : { operation, body: '', request: !/response/i.test(comment[1]) };
  }
  flush();
  return parts;
}

let checked = 0;
for (const file of markdownFiles(docsRoot)) {
  const shown = relative(repoRoot, file);
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const pageIsEnterprise =
    shown.includes('features/enterprise/') || shown.endsWith('rest-api-enterprise.md') || shown.endsWith('configuration/enterprise.md');
  let lastOperation;
  let pendingRequest = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const re of OPERATION_LINE) {
      const m = line.trim().match(re);
      if (m) lastOperation = { method: m[1], path: m[2] };
    }
    if (/^(Request body:?|#{2,5}\s.*\bRequest\b.*)$/i.test(line.trim())) {
      pendingRequest = true;
      continue;
    }
    const fence = line.match(/^(\s*)```(\S*)/);
    if (!fence) {
      if (line.trim() !== '' && !/^(GET|POST|PUT|PATCH|DELETE)\s/.test(line.trim())) pendingRequest = false;
      continue;
    }
    const lang = fence[2];
    let end = i + 1;
    while (end < lines.length && !/^\s*```/.test(lines[end])) end++;
    const body = lines.slice(i + 1, end).join('\n');
    const where = `${shown}:${i + 2}`;
    if (lang === 'json' && pendingRequest) {
      for (const part of jsonParts(body, lastOperation)) {
        if (!part.operation) errors.push(`${where}: a request body with no route named above it`);
        else if (check(file, part.operation.method, part.operation.path, part.body, pageIsEnterprise, where)) checked++;
      }
    } else if (lang === '' || lang === 'http' || lang === 'text') {
      for (const inner of body.split('\n')) {
        const m = inner.trim().match(OPERATION_LINE[2]);
        if (m) lastOperation = { method: m[1], path: m[2] };
      }
    } else if (lang === 'bash' || lang === 'sh' || lang === 'shell' || lang === 'console') {
      for (const command of commands(body)) {
        const cleaned = command.replace(/^\s*\$\s+/, '');
        const curl = cleaned.match(/(?:^|[;&|]\s*)curl\s/);
        const data = cleaned.match(/\s(?:-d|--data|--data-raw|--json)\s+'/);
        if (curl && data) {
          const arg = quotedArgument(cleaned, data.index + data[0].length);
          const url = cleaned.match(/https?:\/\/[^\s'"]+/)?.[0];
          const explicit = cleaned.match(/\s-X\s+([A-Z]+)/)?.[1];
          if (!arg || !url) {
            errors.push(`${where}: a curl body this check cannot read (no closing quote or no URL)`);
            continue;
          }
          const method = explicit ?? 'POST';
          const enterprise = pageIsEnterprise || /:8444\b/.test(url);
          if (check(file, method, url, arg.value, enterprise, where)) checked++;
          continue;
        }
        const cli = cleaned.match(/\bebpfsentinel-agent\s+([a-z0-9-]+)\s+([a-z0-9-]+)\b.*?\s--json\s+'/);
        if (cli) {
          const route = CLI_ROUTES.get(`${cli[1]} ${cli[2]}`);
          const arg = quotedArgument(cleaned, cli.index + cli[0].length);
          if (!route) {
            errors.push(`${where}: \`ebpfsentinel-agent ${cli[1]} ${cli[2]} --json\` names no route in scripts/check-request-bodies.mjs`);
          } else if (arg) {
            const id = cleaned.slice(cli.index).match(/\s([a-z0-9][a-z0-9_-]*)\s+--json/)?.[1] ?? 'x';
            if (check(file, route[0], route[1].replace('{id}', id), arg.value, false, where)) checked++;
          }
        }
      }
    }
    pendingRequest = false;
    i = end;
  }
}

if (checked < 50) {
  errors.push(`only ${checked} request bodies were found: the reader no longer sees them`);
}
if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(`\n${errors.length} problem(s) in the request bodies the pages print.`);
  process.exit(1);
}
console.log(`Request bodies OK (${checked} bodies held to the agents' OpenAPI documents).`);
