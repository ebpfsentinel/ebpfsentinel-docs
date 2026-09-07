#!/usr/bin/env node

// Reads the clap subcommand tree of the open-source agent and asserts that
// every shell line in the documentation that invokes the product names the
// binary that exists and a subcommand path that parses. A page telling a
// reader to run `ebpfsentinel firewall rules --show-schedule` fails here
// rather than at their prompt.
//
// The CLI reference page has its own check, which covers the enterprise
// binary's flags and defaults. This one covers every other page and only the
// binary and the subcommand path, because a flag is documented where the
// command is documented and a command is quoted everywhere.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const docsRoot = join(repoRoot, 'docs');

const DEFAULT_OSS_AGENT_CLI = resolve(
  repoRoot,
  '..',
  'ebpfsentinel',
  'crates',
  'agent',
  'src',
  'cli.rs',
);
const agentCli = process.env.EBPFSENTINEL_OSS_AGENT_CLI
  ? resolve(process.env.EBPFSENTINEL_OSS_AGENT_CLI)
  : DEFAULT_OSS_AGENT_CLI;

// The binary the open-source agent installs. `ebpfsentinel` is the product,
// the repository and the image; it is not a command anybody can run.
const BINARY = 'ebpfsentinel-agent';

// Other binaries the documentation quotes. They are shipped by other repositories
// or built from other crates, so their surface is not in the file read here and a
// line naming one is left alone rather than guessed at.
const OTHER_BINARIES = new Set([
  'ebpfsentinel-enterprise-agent',
  'ebpfsentinel-enterprise-warden',
  'ebpfsentinel-license',
  'ebpfsentinel-warden',
  'ebpfsentinel-token-launch',
  'ebpfsentinel-pod-reader',
  'ebpfsentinel-config',
]);

// Flags that end an invocation rather than selecting a subcommand.
const TERMINATING_FLAGS = new Set(['--help', '-h', '--version', '-V']);

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

function readSource() {
  try {
    return readFileSync(agentCli, 'utf8');
  } catch (error) {
    fail([
      `Cannot read the open-source agent CLI at ${agentCli}:`,
      `  ${error.message}`,
      '',
      'The agent repository is expected beside this one. Set',
      'EBPFSENTINEL_OSS_AGENT_CLI to point at its crates/agent/src/cli.rs.',
    ]);
  }
  return '';
}

// The body of the brace block that opens at the first `{` after `from`.
function block(text, from, what) {
  const open = text.indexOf('{', from);
  if (open === -1) fail([`${what} carries no body in ${agentCli}.`]);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  fail([`${what} has an unbalanced body in ${agentCli}.`]);
  return '';
}

function kebab(name) {
  return name.replace(/_/g, '-');
}

// clap renames a variant to kebab-case unless told otherwise, and nothing in
// this tree tells it otherwise.
function variantToCommand(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

// Every long and short flag the tree declares, mapped to whether it takes a
// value. A flag that takes one swallows the token after it, which is how
// `--output json firewall list` stays a firewall invocation rather than a
// `json` subcommand that does not exist.
function parseFlags(source) {
  const flags = new Map([
    ['--help', false],
    ['-h', false],
    ['--version', false],
    ['-V', false],
  ]);
  const pattern = /#\[arg\(([^\]]*)\)\]\s*(?:\/\/[^\n]*\n\s*)*pub\s+([a-z0-9_]+)\s*:\s*([^,\n]+)/g;
  let match = pattern.exec(source);
  while (match !== null) {
    const [, inner, field, type] = match;
    const takesValue = !/^\s*bool\s*$/.test(type);
    const longExplicit = /\blong\s*=\s*"([^"]+)"/.exec(inner);
    if (longExplicit) flags.set(`--${longExplicit[1]}`, takesValue);
    else if (/\blong\b/.test(inner)) flags.set(`--${kebab(field)}`, takesValue);
    const shortExplicit = /\bshort\s*=\s*'(.)'/.exec(inner);
    if (shortExplicit) flags.set(`-${shortExplicit[1]}`, takesValue);
    else if (/\bshort\b(?!\s*=)/.test(inner)) flags.set(`-${field[0]}`, takesValue);
    match = pattern.exec(source);
  }
  return flags;
}

// One node per subcommand: its children keyed by the word a reader types.
// A leaf has an empty map, and everything after a leaf is a positional
// argument this check does not judge.
function parseTree(source) {
  const enums = new Map();
  const pattern = /pub enum ([A-Za-z0-9]+)\s*\{/g;
  let match = pattern.exec(source);
  while (match !== null) {
    enums.set(match[1], block(source, match.index, `enum ${match[1]}`));
    match = pattern.exec(source);
  }
  if (!enums.has('Command')) {
    fail([`No \`pub enum Command\` in ${agentCli}. The subcommand tree cannot be read.`]);
  }

  const built = new Map();
  const build = (enumName) => {
    if (built.has(enumName)) return built.get(enumName);
    const body = enums.get(enumName);
    if (body === undefined) {
      fail([`\`${enumName}\` is referenced as a subcommand in ${agentCli} but declared nowhere.`]);
    }
    const children = new Map();
    built.set(enumName, children);

    // A variant starts at the outermost indentation of the enum body. Its own
    // body, where it has one, is skipped so a nested brace cannot be read as a
    // variant of its own.
    let depth = 0;
    let angle = 0;
    let atLineStart = true;
    let word = '';
    for (let i = 0; i < body.length; i += 1) {
      const ch = body[i];
      if (ch === '{' || ch === '(') depth += 1;
      else if (ch === '}' || ch === ')') depth -= 1;
      if (depth > 0) {
        atLineStart = false;
        continue;
      }
      if (ch === '\n') {
        atLineStart = true;
        word = '';
        continue;
      }
      if (/\s/.test(ch)) continue;
      if (atLineStart && /[A-Z]/.test(ch)) {
        // Collect the variant name and whatever follows it up to the comma
        // that ends the variant.
        let j = i;
        let name = '';
        while (j < body.length && /[A-Za-z0-9_]/.test(body[j])) {
          name += body[j];
          j += 1;
        }
        let rest = '';
        let restDepth = 0;
        for (let k = j; k < body.length; k += 1) {
          const c = body[k];
          if (c === '{' || c === '(') restDepth += 1;
          else if (c === '}' || c === ')') restDepth -= 1;
          else if (c === ',' && restDepth === 0) break;
          rest += c;
        }
        // Three ways this tree nests a subcommand under a variant:
        //   Firewall(DomainArgs<FirewallCommand>)
        //   Nptv6(NptV6Command)                      after #[command(subcommand)]
        //   Blacklist { #[command(subcommand)] action: BlacklistAction, .. }
        const shape = rest.trim();
        let nested = null;
        if (shape.startsWith('(')) {
          const generic = /^\(\s*[A-Za-z0-9]+\s*<\s*([A-Za-z0-9]+)\s*>\s*\)$/.exec(shape);
          const tupled = /^\(\s*([A-Za-z0-9]+)\s*\)$/.exec(shape);
          if (generic) nested = generic[1];
          else if (tupled && enums.has(tupled[1])) nested = tupled[1];
        } else if (shape.startsWith('{')) {
          const fielded =
            /#\[command\(subcommand\)\]\s*(?:pub\s+)?[a-z0-9_]+\s*:\s*(?:Option\s*<\s*)?([A-Za-z0-9]+)/.exec(
              shape,
            );
          if (fielded) nested = fielded[1];
        }
        children.set(variantToCommand(name), nested === null ? new Map() : build(nested));
        i = j - 1;
        atLineStart = false;
        angle = 0;
        word = '';
        continue;
      }
      atLineStart = false;
    }
    return children;
  };
  return build('Command');
}

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...markdownFiles(path));
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) found.push(path);
  }
  return found.sort();
}

// Every line of every fenced block, with a line joined onto the one before it
// where the shell would join them.
function fencedLines(text) {
  const lines = text.split('\n');
  const out = [];
  let inFence = false;
  let fence = '';
  let pending = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const opener = /^\s*(```+|~~~+)(.*)$/.exec(line);
    if (opener && !inFence) {
      inFence = true;
      fence = opener[1][0].repeat(3);
      continue;
    }
    if (inFence && new RegExp(`^\\s*${fence === '`' ? '```' : fence}`).test(line)) {
      const closer = /^\s*(```+|~~~+)\s*$/.exec(line);
      if (closer) {
        inFence = false;
        pending = null;
        continue;
      }
    }
    if (!inFence) continue;
    const trimmed = line.trim();
    if (pending !== null) {
      pending.text += ` ${trimmed.replace(/\\$/, '').trim()}`;
      if (!trimmed.endsWith('\\')) {
        out.push(pending);
        pending = null;
      }
      continue;
    }
    if (trimmed.endsWith('\\')) {
      pending = { line: i + 1, text: trimmed.replace(/\\$/, '').trim() };
      continue;
    }
    out.push({ line: i + 1, text: trimmed });
  }
  if (pending !== null) out.push(pending);
  return out;
}

// The tokens of one command, with the prompt, `sudo`, leading environment
// assignments and everything from the first pipe or redirection dropped.
function tokenise(text) {
  let rest = text.replace(/^\$\s+/, '').trim();
  if (rest.startsWith('#')) return [];
  const cut = rest.search(/[|><&;]/);
  if (cut !== -1) rest = rest.slice(0, cut);
  const tokens = rest.split(/\s+/).filter((token) => token.length > 0);
  while (tokens.length > 0 && (tokens[0] === 'sudo' || /^[A-Z0-9_]+=/.test(tokens[0]))) {
    tokens.shift();
  }
  return tokens;
}

function pathOf(tokens, tree, flags) {
  const taken = [];
  let node = tree;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('-')) {
      if (TERMINATING_FLAGS.has(token)) return { taken, unknown: null };
      if (token.includes('=')) continue;
      if (flags.get(token) === true) i += 1;
      continue;
    }
    // A synopsis writes its subcommand as a placeholder. There is no command
    // to check past one, so reading the path stops here.
    if (/^[[<].*[\]>]$/.test(token)) return { taken, unknown: null };
    if (node.size === 0) return { taken, unknown: null };
    const child = node.get(token);
    if (child === undefined) return { taken, unknown: token };
    taken.push(token);
    node = child;
  }
  return { taken, unknown: null };
}

const source = readSource();
const tree = parseTree(source);
const flags = parseFlags(source);
const problems = [];

for (const file of markdownFiles(docsRoot)) {
  const where = relative(repoRoot, file);
  for (const { line, text } of fencedLines(readFileSync(file, 'utf8'))) {
    const tokens = tokenise(text);
    if (tokens.length === 0) continue;
    const binary = tokens[0].replace(/^\.\//, '');
    if (OTHER_BINARIES.has(binary)) continue;
    if (binary !== BINARY && binary !== 'ebpfsentinel') continue;
    if (binary === 'ebpfsentinel') {
      problems.push(
        `${where}:${line}: invokes \`ebpfsentinel\`; the binary is \`${BINARY}\`` +
          `\n    ${text}`,
      );
      continue;
    }
    const { taken, unknown } = pathOf(tokens, tree, flags);
    if (unknown === null) continue;
    const parent = taken.length === 0 ? BINARY : `${BINARY} ${taken.join(' ')}`;
    let node = tree;
    for (const step of taken) node = node.get(step);
    const known = [...node.keys()].sort().join(', ');
    problems.push(
      `${where}:${line}: \`${parent}\` has no \`${unknown}\` subcommand` +
        `\n    ${text}` +
        `\n    known: ${known}`,
    );
  }
}

if (problems.length > 0) {
  fail([
    `${problems.length} documented invocation${problems.length === 1 ? '' : 's'} the agent cannot run:`,
    '',
    ...problems.map((problem, index) => `${index + 1}. ${problem}`),
    '',
    `The subcommand tree was read from ${relative(repoRoot, agentCli)}.`,
  ]);
}

console.log(
  `check-cli-invocations: every documented invocation of ${BINARY} names a command that runs.`,
);
