#!/usr/bin/env node

// Reads the clap declarations of both agents and asserts the CLI reference
// page keeps up with them. The enterprise binary is held to a row per flag with
// its default under the enterprise heading. The open-source client, whose
// commands nest three deep and are documented in prose with examples, is held
// to naming every subcommand and every long flag inside the section of the
// top-level command it belongs to. The binary is the source: a new subcommand,
// a renamed flag or a changed default fails here rather than in a support
// ticket.

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'cli-reference', 'index.md');

const DEFAULT_ENT_AGENT_MAIN = resolve(
  repoRoot,
  '..',
  'ebpfsentinel-enterprise',
  'crates',
  'enterprise-agent',
  'src',
  'cli.rs',
);
const agentMain = process.env.EBPFSENTINEL_ENT_AGENT_MAIN
  ? resolve(process.env.EBPFSENTINEL_ENT_AGENT_MAIN)
  : DEFAULT_ENT_AGENT_MAIN;

const DEFAULT_OSS_AGENT_CLI = resolve(repoRoot, '..', 'ebpfsentinel', 'crates', 'agent', 'src', 'cli', 'args.rs');
const ossCli = process.env.EBPFSENTINEL_OSS_AGENT_CLI
  ? resolve(process.env.EBPFSENTINEL_OSS_AGENT_CLI)
  : DEFAULT_OSS_AGENT_CLI;

// The heading the enterprise binary is documented under, and the subsection its
// own options live in. Everything above the heading describes the open-source
// client, which is a different binary with different flags.
const HEADING = '## Enterprise Agent Commands';
const GLOBAL_SECTION = 'Enterprise Global Options';

// Keys a clap attribute may carry. An unknown one is a construct this parser
// was never taught, and guessing at it would document the wrong surface.
const KNOWN_ARG_KEYS = new Set([
  'long',
  'short',
  'env',
  'default_value',
  'default_value_t',
  'value_delimiter',
  'action',
  'help',
  'value_name',
  // Constrains which flags go together; the page names the pair in prose.
  'conflicts_with',
]);

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readSource() {
  try {
    return readFileSync(agentMain, 'utf8');
  } catch (error) {
    fail([
      `Cannot read the enterprise agent source at ${agentMain}:`,
      `  ${error.message}`,
      '',
      'The enterprise repository is expected beside this one. Set',
      'EBPFSENTINEL_ENT_AGENT_MAIN to point at its enterprise-agent cli.rs.',
    ]);
  }
  return '';
}

// The body of the brace block that opens at the first `{` after `from`.
function block(text, from, what) {
  const open = text.indexOf('{', from);
  if (open === -1) fail([`${what} carries no body in ${agentMain}.`]);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  fail([`${what} has an unbalanced body in ${agentMain}.`]);
  return '';
}

// Split on commas that are not inside a string or character literal, so
// `value_delimiter = ','` stays one key rather than becoming two.
function topLevelCommas(text) {
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === '\\') {
        current += text[i + 1] ?? '';
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current.trim());
  return parts;
}

function kebab(name) {
  return name.replace(/_/g, '-');
}

function variantToCommand(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

function parseArg(attrs, field, where) {
  const arg = attrs.find((line) => line.startsWith('#[arg('));
  if (!arg) {
    return { field, flag: null, positional: field.toUpperCase(), default: null, env: null };
  }
  const inner = arg.slice('#[arg('.length, arg.lastIndexOf(')]'));
  const parsed = { field, flag: null, positional: null, default: null, env: null, short: null };
  for (const key of topLevelCommas(inner)) {
    const eq = key.indexOf('=');
    const name = (eq === -1 ? key : key.slice(0, eq)).trim();
    const value = eq === -1 ? null : key.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (!KNOWN_ARG_KEYS.has(name)) {
      fail([
        `${where}: the clap attribute of \`${field}\` carries \`${name}\`, which this`,
        'check does not understand. Teach it the key in KNOWN_ARG_KEYS, and decide',
        'there what the page has to say about it, rather than leaving the flag',
        'documented by nobody.',
      ]);
    }
    if (name === 'long') parsed.flag = `--${value ?? kebab(field)}`;
    if (name === 'short') parsed.short = value ?? field[0];
    if (name === 'env') parsed.env = value;
    if (name === 'default_value' || name === 'default_value_t') parsed.default = value;
  }
  if (!parsed.flag) parsed.positional = field.toUpperCase();
  return parsed;
}

// Fields of a struct or of a struct-like enum variant, with the attributes
// written above each one.
function fields(body, where) {
  const found = [];
  let attrs = [];
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('//')) continue;
    if (line.startsWith('#[')) {
      attrs.push(line);
      continue;
    }
    // A field of the top-level struct carries its visibility; a variant's does not.
    const field = /^(?:pub(?:\([\w:]+\))?\s+)?(\w+):\s*[^,]+,$/.exec(line);
    if (!field) {
      fail([
        `${where}: cannot read \`${line}\`.`,
        '',
        'This check reads one field per line with its attributes above it. A shape',
        'it has never seen would be documented by nobody, so it refuses rather than',
        'skipping the line.',
      ]);
    }
    if (!attrs.some((attr) => attr.startsWith('#[command('))) {
      found.push(parseArg(attrs, field[1], where));
    }
    attrs = [];
  }
  return found;
}

// The variants of one command enum, as commands. A variant holding a
// `#[command(subcommand)]` field is a command with subcommands of its own, and
// each of those is documented under its own "### <parent> <child>" section: a
// flag of `content import` is not a flag of `content`, and documenting it as
// one would let a renamed flag pass this check.
function commandsIn(text, enumName, prefix) {
  const enumAt = text.indexOf(`enum ${enumName}`);
  if (enumAt === -1) fail([`${agentMain} declares no \`enum ${enumName}\`.`]);
  const body = block(text, enumAt, `enum ${enumName}`);

  const commands = [];
  const lines = body.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length === 0 || line.startsWith('///') || line.startsWith('//')) continue;
    const unit = /^(\w+),$/.exec(line);
    if (unit) {
      commands.push({ name: `${prefix}${variantToCommand(unit[1])}`, args: [] });
      continue;
    }
    const open = /^(\w+)\s*\{$/.exec(line);
    if (!open) {
      fail([
        `enum ${enumName}: cannot read \`${line}\` in ${agentMain}.`,
        '',
        'This check reads struct-like and unit variants only. A tuple variant would',
        'be a subcommand with arguments it cannot enumerate.',
      ]);
    }
    let depth = 1;
    const collected = [];
    for (i += 1; i < lines.length && depth > 0; i += 1) {
      const inner = lines[i];
      depth += (inner.match(/\{/g) ?? []).length - (inner.match(/\}/g) ?? []).length;
      if (depth > 0) collected.push(inner);
    }
    i -= 1;
    const name = `${prefix}${variantToCommand(open[1])}`;
    const collectedText = collected.join('\n');
    const nested = /#\[command\(subcommand\)\]\s*\n\s*(?:pub(?:\([\w:]+\))?\s+)?\w+:\s*(\w+)\s*,/.exec(collectedText);
    if (nested) {
      commands.push({ name, args: [] });
      commands.push(...commandsIn(text, nested[1], `${name} `));
      continue;
    }
    commands.push({ name, args: fields(collectedText, `subcommand ${name}`) });
  }
  if (commands.length === 0) fail([`${agentMain} declares \`enum ${enumName}\` with no variant.`]);
  return commands;
}

function parseSource(text) {
  const cliAt = text.indexOf('struct Cli');
  if (cliAt === -1) fail([`${agentMain} declares no \`struct Cli\`.`]);
  const nameAt = text.lastIndexOf('name = "', cliAt);
  const binary = /name = "([^"]+)"/.exec(text.slice(nameAt, cliAt))?.[1];
  if (!binary) fail([`${agentMain} names no binary in the \`#[command(...)]\` of \`Cli\`.`]);

  const globals = fields(block(text, cliAt, 'struct Cli'), 'struct Cli');
  const commands = commandsIn(text, 'Command', '');
  return { binary, globals, commands };
}

// The tables of one "### " section, read as flag rows.
function sections(text) {
  const at = text.indexOf(`\n${HEADING}`);
  if (at === -1) {
    fail([
      `${relative(process.cwd(), pagePath)} carries no "${HEADING}" heading.`,
      '',
      'The heading is where the enterprise binary is documented. Without it this',
      'check would compare its flags against the open-source client and report',
      'every one of them as undocumented.',
    ]);
  }
  const found = new Map();
  let current = null;
  for (const line of text.slice(at).split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { rows: [], text: '' };
      found.set(heading[1], current);
      continue;
    }
    if (!current) continue;
    current.text += `${line}\n`;
    if (!/^\s*\|/.test(line)) continue;
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|');
    const first = cells[0]?.trim() ?? '';
    if (/^:?-{2,}:?$/.test(first) || first.toLowerCase() === 'flag') continue;
    const tokens = [...first.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const flags = tokens.flatMap((token) => [...token.matchAll(/--[\w-]+/g)].map((m) => m[0]));
    const positional = tokens.flatMap((token) =>
      [...token.matchAll(/^<([A-Z_]+)>$/g)].map((m) => m[1]),
    );
    current.rows.push({ flags, positional, line });
  }
  return found;
}

function checkSection(problems, heading, args, page, what) {
  const section = page.get(heading);
  if (!section) {
    problems.push(`${what} has no "### ${heading}" section on the page.`);
    return;
  }
  const documented = new Set();
  for (const row of section.rows) {
    for (const flag of row.flags) documented.add(flag);
    for (const name of row.positional) documented.add(`<${name}>`);
  }
  for (const arg of args) {
    const key = arg.flag ?? `<${arg.positional}>`;
    const row = section.rows.find(
      (candidate) => candidate.flags.includes(arg.flag) || candidate.positional.includes(arg.positional),
    );
    if (!row) {
      problems.push(`${what}: \`${key}\` has no row under "### ${heading}".`);
      continue;
    }
    if (arg.default !== null && !row.line.includes(arg.default)) {
      problems.push(
        `${what}: \`${key}\` defaults to \`${arg.default}\`, which its row does not name.`,
      );
    }
    if (arg.env !== null && !row.line.includes(arg.env)) {
      problems.push(
        `${what}: \`${key}\` is also read from \`${arg.env}\`, which its row does not name.`,
      );
    }
  }
  const known = new Set(args.map((arg) => arg.flag ?? `<${arg.positional}>`));
  for (const key of documented) {
    if (!known.has(key)) {
      problems.push(`${what}: "### ${heading}" documents \`${key}\`, which the binary does not take.`);
    }
  }
}

const source = readSource();
const { binary, globals, commands } = parseSource(source);
const page = readFileSync(pagePath, 'utf8');
const parsed = sections(page);
const problems = [];

if (!page.includes(binary)) {
  problems.push(`The page never names the binary \`${binary}\`.`);
}

checkSection(problems, GLOBAL_SECTION, globals, parsed, `${binary}`);
for (const command of commands) {
  checkSection(problems, command.name, command.args, parsed, `${binary} ${command.name}`);
}

const declared = new Set([GLOBAL_SECTION, ...commands.map((command) => command.name)]);
for (const heading of parsed.keys()) {
  if (!declared.has(heading) && /^[a-z][a-z-]*( [a-z][a-z-]*)*$/.test(heading)) {
    problems.push(`The page carries a "### ${heading}" section, which is not a subcommand of ${binary}.`);
  }
}

// ── The open-source client ──────────────────────────────────────────────

// The body of the brace block opening at the first `{` after `from`, in `text`.
function braced(text, from) {
  const open = text.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  fail([`${ossCli} has an unbalanced block at offset ${from}.`]);
  return '';
}

// Variants of one `enum`: name as typed on the command line, the text of a
// struct-like body, and the subcommand enum a tuple variant wraps
// (`Alerts(DomainArgs<AlertsCommand>)`).
function ossVariants(text, enumName) {
  const at = text.search(new RegExp(`enum ${enumName}\\s*\\{`));
  if (at === -1) fail([`${ossCli} declares no \`enum ${enumName}\`.`]);
  const variants = [];
  let depth = 0;
  let current = null;
  let attrs = '';
  for (const raw of braced(text, at).split('\n')) {
    const line = raw.trim();
    if (depth === 0) {
      if (line.startsWith('#[command(')) attrs += line;
      const head = /^(\w+)\s*(\{|\(|,|$)/.exec(line);
      if (head && !line.startsWith('#') && !line.startsWith('//')) {
        current = {
          name: /name\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? variantToCommand(head[1]),
          body: '',
          wraps: /\((?:\w+<)?(\w+)>?\)/.exec(line)?.[1] ?? null,
        };
        attrs = '';
        variants.push(current);
      }
    } else if (current) {
      current.body += `${raw}\n`;
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return variants;
}

// Long flags declared in a block of fields, as typed: `--page-size`.
function ossFlags(body) {
  const flags = [];
  const field = /#\[arg\(([^\]]*)\)\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(\w+)\s*:/g;
  for (const match of body.matchAll(field)) {
    if (!/\blong\b/.test(match[1])) continue;
    flags.push(`--${/long\s*=\s*"([^"]+)"/.exec(match[1])?.[1] ?? kebab(match[2])}`);
  }
  return flags;
}

// Every subcommand path and every long flag under one variant. Fields
// flattened from another struct count as the variant's own, except the
// connection options every command shares, which the page documents once.
function ossWalk(text, variant, path, found) {
  // A tuple variant wrapping a struct of arguments rather than a subcommand
  // enum (`Surface(SurfaceArgs)`) is read as if that struct were its body.
  const wrapped = variant.wraps ? text.search(new RegExp(`struct ${variant.wraps}\\s*\\{`)) : -1;
  if (wrapped !== -1) {
    variant = { ...variant, body: braced(text, wrapped), wraps: null };
  }
  found.commands.push(path);
  found.flags.push(...ossFlags(variant.body).map((flag) => [path, flag]));
  for (const match of variant.body.matchAll(/#\[command\(flatten\)\]\s*(?:pub\s+)?\w+:\s*(\w+)/g)) {
    if (match[1] === 'ConnectionArgs') continue;
    const at = text.search(new RegExp(`struct ${match[1]}\\s*\\{`));
    if (at !== -1) found.flags.push(...ossFlags(braced(text, at)).map((flag) => [path, flag]));
  }
  const nested =
    variant.wraps ??
    /#\[command\(subcommand\)\]\s*(?:pub\s+)?\w+:\s*(?:Option<)?(\w+)/.exec(variant.body)?.[1];
  if (!nested) return;
  for (const child of ossVariants(text, nested)) ossWalk(text, child, `${path} ${child.name}`, found);
}

// The open-source part of the page, cut into one section per top-level
// command: its "### <command>" heading, the "### <command> <child>" headings
// after it, and every "####" beneath them.
function ossSections(text) {
  const at = text.indexOf(`\n${HEADING}`);
  const sectionsFound = new Map();
  let current = null;
  for (const line of text.slice(0, at).split('\n')) {
    if (/^##\s/.test(line)) {
      current = null;
      continue;
    }
    const heading = /^###\s+(\S+)/.exec(line);
    if (heading) {
      current = sectionsFound.get(heading[1]) ?? '';
      sectionsFound.set(heading[1], current);
      current = heading[1];
      continue;
    }
    if (current) sectionsFound.set(current, `${sectionsFound.get(current)}${line}\n`);
  }
  return sectionsFound;
}

function readOss() {
  try {
    return readFileSync(ossCli, 'utf8');
  } catch (error) {
    fail([
      `Cannot read the open-source agent CLI at ${ossCli}:`,
      `  ${error.message}`,
      '',
      'The open-source repository is expected beside this one. Set',
      'EBPFSENTINEL_OSS_AGENT_CLI to point at its crates/agent/src/cli/args.rs.',
    ]);
  }
  return '';
}

const ossSource = readOss();
const ossPage = ossSections(page);
const ossFound = { commands: [], flags: [] };
for (const top of ossVariants(ossSource, 'Command')) {
  const found = { commands: [], flags: [] };
  ossWalk(ossSource, top, top.name, found);
  ossFound.commands.push(...found.commands);
  ossFound.flags.push(...found.flags);
  const section = ossPage.get(top.name);
  if (section === undefined) {
    problems.push(`ebpfsentinel-agent ${top.name} has no "### ${top.name}" section on the page.`);
    continue;
  }
  for (const path of found.commands.slice(1)) {
    const leaf = path.split(' ').pop();
    if (!new RegExp(`(^|[^\\w-])${leaf}($|[^\\w-])`, 'm').test(section)) {
      problems.push(`ebpfsentinel-agent ${path} is named nowhere under "### ${top.name}".`);
    }
  }
  for (const [path, flag] of found.flags) {
    if (!new RegExp(`${flag}($|[^\\w-])`, 'm').test(section)) {
      problems.push(`ebpfsentinel-agent ${path}: \`${flag}\` is named nowhere under "### ${top.name}".`);
    }
  }
}

if (problems.length > 0) {
  fail([
    `${problems.length} problem${problems.length === 1 ? '' : 's'} between the agents' CLIs and`,
    `${relative(process.cwd(), pagePath)}:`,
    '',
    ...problems.sort().map((problem) => `  ${problem}`),
    '',
    'Every subcommand of the enterprise binary needs a "### <name>" section under',
    `"${HEADING}", with one table row per flag naming its default. Every`,
    'subcommand and long flag of ebpfsentinel-agent is named in the section of',
    'its top-level command. An operator who has to run --help to find a command',
    'was not documented.',
  ]);
}

const flagCount = globals.length + commands.reduce((sum, command) => sum + command.args.length, 0);
console.log(
  `CLI reference OK: ${binary}, ${commands.length} subcommands, ${flagCount} arguments, ` +
    `each with a row and its default; ebpfsentinel-agent, ${ossFound.commands.length} commands, ` +
    `${ossFound.flags.length} long flags, each named in its section of ${relative(process.cwd(), pagePath)}.`,
);
