#!/usr/bin/env node

// Holds the CLI reference page to both agents' command lines. The enterprise
// binary is read from the `cli.json` its repository commits, which a test there
// keeps equal to the parser: every command it adds, beside the domains only it
// carries or under an open-source domain, is named with each of its long flags
// in the section of its domain, and the daemon's own options with their default
// and environment variable. The open-source client, whose commands nest three
// deep and are documented in prose with examples, is read from its clap
// declarations and held to naming every subcommand and every long flag inside
// the section of the top-level command it belongs to. The binaries are the
// source: a new subcommand, a renamed flag or a changed default fails here
// rather than in a support ticket.

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const pagePath = join(repoRoot, 'docs', 'cli-reference', 'index.md');

const DEFAULT_ENT_CLI_TREE = resolve(repoRoot, '..', 'ebpfsentinel-enterprise', 'cli.json');
const entTree = process.env.EBPFSENTINEL_ENT_CLI_TREE
  ? resolve(process.env.EBPFSENTINEL_ENT_CLI_TREE)
  : DEFAULT_ENT_CLI_TREE;

const DEFAULT_OSS_AGENT_CLI = resolve(repoRoot, '..', 'ebpfsentinel', 'crates', 'agent', 'src', 'cli', 'args.rs');
const ossCli = process.env.EBPFSENTINEL_OSS_AGENT_CLI
  ? resolve(process.env.EBPFSENTINEL_OSS_AGENT_CLI)
  : DEFAULT_OSS_AGENT_CLI;

// The heading the enterprise binary is documented under, and the subsection its
// own options live in. Everything above the heading describes the open-source
// client, whose commands the enterprise binary carries unchanged.
const HEADING = '## Enterprise Agent Commands';
const GLOBAL_SECTION = 'Enterprise Global Options';

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
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

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A word as typed: not inside a longer flag or command name.
function names(section, word) {
  return new RegExp(`(^|[^\\w-])${escape(word)}($|[^\\w-])`, 'm').test(section);
}

function readTree() {
  try {
    return JSON.parse(readFileSync(entTree, 'utf8'));
  } catch (error) {
    fail([
      `Cannot read the enterprise command tree at ${entTree}:`,
      `  ${error.message}`,
      '',
      'The enterprise repository is expected beside this one, with the cli.json',
      'its tests keep. Set EBPFSENTINEL_ENT_CLI_TREE to point at it.',
    ]);
  }
  return null;
}

// The enterprise part of the page, as the text under each "### " heading,
// filed under every command name the heading carries: "### dlp and dns,
// enterprise verbs" documents both domains, "### content import" its parent.
function enterpriseSections(text, topLevel) {
  const at = text.indexOf(`\n${HEADING}`);
  if (at === -1) {
    fail([
      `${relative(process.cwd(), pagePath)} carries no "${HEADING}" heading.`,
      '',
      'The heading is where the enterprise binary is documented. Without it this',
      'check would compare its commands against the open-source client and report',
      'every one of them as undocumented.',
    ]);
  }
  const found = new Map();
  const headings = [];
  let current = [];
  for (const line of text.slice(at + 1).split('\n')) {
    if (/^##\s/.test(line) && !line.startsWith(HEADING)) break;
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      headings.push(heading[1]);
      current = heading[1] === GLOBAL_SECTION ? [GLOBAL_SECTION] : heading[1].split(/[\s,]+/).filter((w) => topLevel.has(w));
      for (const key of current) if (!found.has(key)) found.set(key, '');
      continue;
    }
    for (const key of current) found.set(key, `${found.get(key)}${line}\n`);
  }
  return { found, headings };
}

const tree = readTree();
const page = readFileSync(pagePath, 'utf8');
const problems = [];
const { binary } = tree;

if (!page.includes(binary)) {
  problems.push(`The page never names the binary \`${binary}\`.`);
}

const ours = tree.commands.filter((command) => command.enterprise);
const topLevel = new Set(tree.commands.map((command) => command.path.split(' ')[0]));
const { found: entPage, headings } = enterpriseSections(page, topLevel);

const options = entPage.get(GLOBAL_SECTION);
if (options === undefined) {
  problems.push(`${binary} has no "### ${GLOBAL_SECTION}" section on the page.`);
} else {
  for (const option of tree.options) {
    if (!names(options, option.flag)) {
      problems.push(`${binary}: \`${option.flag}\` is named nowhere under "### ${GLOBAL_SECTION}".`);
    }
    if (option.default && !options.includes(option.default)) {
      problems.push(`${binary}: \`${option.flag}\` defaults to \`${option.default}\`, which "### ${GLOBAL_SECTION}" does not name.`);
    }
    if (option.env && !options.includes(option.env)) {
      problems.push(`${binary}: \`${option.flag}\` is also read from \`${option.env}\`, which "### ${GLOBAL_SECTION}" does not name.`);
    }
  }
}

let entFlags = 0;
for (const command of ours) {
  const words = command.path.split(' ');
  const section = entPage.get(words[0]);
  if (section === undefined) {
    problems.push(`${binary} ${command.path}: no "### ${words[0]}" section under "${HEADING}".`);
    continue;
  }
  if (words.length > 1 && !names(section, words[words.length - 1])) {
    problems.push(`${binary} ${command.path} is named nowhere under "### ${words[0]}".`);
  }
  for (const argument of command.arguments) {
    if (!argument.flag) continue;
    entFlags += 1;
    if (!names(section, argument.flag)) {
      problems.push(`${binary} ${command.path}: \`${argument.flag}\` is named nowhere under "### ${words[0]}".`);
    }
  }
}

for (const heading of headings) {
  if (heading === GLOBAL_SECTION) continue;
  if (!heading.split(/[\s,]+/).some((word) => topLevel.has(word))) {
    problems.push(`The page carries a "### ${heading}" section, which names no command of ${binary}.`);
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
    'Every command the enterprise binary adds is named, with each of its long',
    `flags, in the section of its domain under "${HEADING}". Every`,
    'subcommand and long flag of ebpfsentinel-agent is named in the section of',
    'its top-level command. An operator who has to run --help to find a command',
    'was not documented.',
  ]);
}

console.log(
  `CLI reference OK: ${binary}, ${ours.length} commands of its own and ${entFlags} long flags, ` +
    `each named in its section; ebpfsentinel-agent, ${ossFound.commands.length} commands, ` +
    `${ossFound.flags.length} long flags, each named in its section of ${relative(process.cwd(), pagePath)}.`,
);
