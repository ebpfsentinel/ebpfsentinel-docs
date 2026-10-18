#!/usr/bin/env node
// Fails when a count written on a feature page no longer matches the tree it
// was counted from.
//
// Six numbers on `features/overview.md` are facts about the agent source:
// how many eBPF programs there are, how wide the REST surface is, how many
// CLI subcommands exist, how many rate-limit and load-balancer algorithms are
// implemented, and how many ATT&CK techniques the mapping covers. Five of
// them went stale together, which is what a number remembered rather than
// read always does. The page said the sixth stale one would be the trigger
// for this checker; this is that checker.
//
// Each count carries `<!-- feature-count: <kind> -->` on the line above it,
// and the kind names both the source file and the shape the sentence has to
// have. A marker naming a kind this file does not know, and a kind no page
// marks, both fail: the register of counted numbers stays the same size as
// the set of numbers actually checked.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const docsRoot = join(repoRoot, 'docs');

const ossRoot = process.env.EBPFSENTINEL_OSS_ROOT
  ? resolve(process.env.EBPFSENTINEL_OSS_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel');

// The shipped JA4 list is a starter sample, and how small it is is the whole
// point of saying so: a page that keeps the old number while the list grows
// or shrinks sells something else.
const enterpriseRoot = process.env.EBPFSENTINEL_ENTERPRISE_ROOT
  ? resolve(process.env.EBPFSENTINEL_ENTERPRISE_ROOT)
  : resolve(repoRoot, '..', 'ebpfsentinel-enterprise');

const errors = [];

function read(...parts) {
  return readFileSync(join(ossRoot, ...parts), 'utf8');
}

function readEnterprise(...parts) {
  return readFileSync(join(enterpriseRoot, ...parts), 'utf8');
}

// Numbers on this page are written as digits in a table cell and as words in
// a sentence, so both spellings are read.
const WORDS = new Map(
  [
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight',
    'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen',
    'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty',
  ].map((word, value) => [word, value]),
);

function numberFrom(token) {
  if (/^\d+$/.test(token)) return Number(token);
  return WORDS.get(token.toLowerCase());
}

function countProgramDirectories() {
  const dir = join(ossRoot, 'crates', 'ebpf-programs');
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory()).length;
}

function countRestSurface() {
  const { paths } = JSON.parse(read('openapi.json'));
  const methods = new Set(['get', 'put', 'post', 'delete', 'patch', 'head', 'options', 'trace']);
  let operations = 0;
  for (const item of Object.values(paths)) {
    for (const key of Object.keys(item)) {
      if (methods.has(key.toLowerCase())) operations += 1;
    }
  }
  return { paths: Object.keys(paths).length, operations };
}

// A variant is the first token of a line indented exactly one level inside
// the enum body, which is what rustfmt guarantees and what the doc-comment
// and attribute lines above it are not.
function countVariants(source, name, file) {
  const body = source.match(new RegExp(`pub enum ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!body) {
    errors.push(`cannot find \`enum ${name}\` in ${file}`);
    return 0;
  }
  return (body[1].match(/^ {4}([A-Z][A-Za-z0-9]*)/gm) ?? []).length;
}

function countCommands() {
  const source = read('crates', 'agent', 'src', 'cli.rs');
  return countVariants(source, 'Command', 'crates/agent/src/cli.rs');
}

function countBuiltinThreats() {
  const file = join('crates', 'enterprise-domain', 'src', 'tls_intelligence', 'engine.rs');
  const source = readEnterprise(file);
  const body = source.match(/const BUILTIN_THREATS: &\[BuiltinThreat\] = &\[([\s\S]*?)\n\];/);
  if (!body) {
    errors.push(`cannot find \`BUILTIN_THREATS\` in ${file}`);
    return 0;
  }
  return (body[1].match(/^ {4}BuiltinThreat \{/gm) ?? []).length;
}

function countTechniques() {
  const source = read('crates', 'domain', 'src', 'alert', 'mitre.rs');
  const call = /\bentry\(\s*"[^"]*"\s*,\s*"([^"]*)"\s*,/g;
  return new Set([...source.matchAll(call)].map(([, technique]) => technique)).size;
}

// Each kind reads its own line and says what is wrong with it, because the
// sentence a count sits in differs from cell to cell.
const KINDS = new Map([
  [
    'ebpf-programs',
    (line) => {
      const total = countProgramDirectories();
      const match = line.match(
        /holds ([a-z]+) program directories: ([a-z]+) attached[^,]*, ([a-z]+) reached only by tail call/,
      );
      if (!match) return ['the sentence no longer names a total, an attached count and a tail-call count'];
      const [, totalWord, attachedWord, tailWord] = match;
      const written = numberFrom(totalWord);
      const attached = numberFrom(attachedWord);
      const tail = numberFrom(tailWord);
      const problems = [];
      if (written !== total) {
        problems.push(`crates/ebpf-programs/ holds ${total} directories, the page says ${totalWord}`);
      }
      // The remainder is the test scaffolding program, which is named rather
      // than counted, so the three parts have to account for every directory.
      if (attached + tail + 1 !== written) {
        problems.push(
          `${attachedWord} attached plus ${tailWord} tail-called plus the test program is not ${totalWord}`,
        );
      }
      return problems;
    },
  ],
  [
    'rest-surface',
    (line) => {
      const { paths, operations } = countRestSurface();
      const match = line.match(/\((\d+) paths, (\d+) operations\)/);
      if (!match) return ['the cell no longer reads `(N paths, N operations)`'];
      const problems = [];
      if (Number(match[1]) !== paths) {
        problems.push(`openapi.json declares ${paths} paths, the page says ${match[1]}`);
      }
      if (Number(match[2]) !== operations) {
        problems.push(`openapi.json declares ${operations} operations, the page says ${match[2]}`);
      }
      return problems;
    },
  ],
  [
    'cli-subcommands',
    (line) => {
      const total = countCommands();
      const match = line.match(/\((\d+) subcommands\)/);
      if (!match) return ['the cell no longer reads `(N subcommands)`'];
      return Number(match[1]) === total
        ? []
        : [`\`enum Command\` has ${total} variants, the page says ${match[1]}`];
    },
  ],
  [
    'ratelimit-algorithms',
    (line) => {
      const source = read('crates', 'domain', 'src', 'ratelimit', 'entity.rs');
      const total = countVariants(source, 'RateLimitAlgorithm', 'crates/domain/src/ratelimit/entity.rs');
      const match = line.match(/(\d+) algorithms/);
      if (!match) return ['the cell no longer reads `N algorithms`'];
      return Number(match[1]) === total
        ? []
        : [`\`enum RateLimitAlgorithm\` has ${total} variants, the page says ${match[1]}`];
    },
  ],
  [
    'lb-algorithms',
    (line) => {
      const source = read('crates', 'domain', 'src', 'loadbalancer', 'entity.rs');
      const total = countVariants(source, 'LbAlgorithm', 'crates/domain/src/loadbalancer/entity.rs');
      const match = line.match(/(\d+) algorithms/);
      if (!match) return ['the cell no longer reads `N algorithms`'];
      return Number(match[1]) === total
        ? []
        : [`\`enum LbAlgorithm\` has ${total} variants, the page says ${match[1]}`];
    },
  ],
  [
    'ja4-builtin-threats',
    (line) => {
      const total = countBuiltinThreats();
      const match = line.match(/\b([A-Za-z]+|\d+) sourced\b/);
      if (!match) return ['the sentence no longer reads `N sourced ...`'];
      const written = numberFrom(match[1]);
      return written === total
        ? []
        : [`\`BUILTIN_THREATS\` holds ${total} entries, the page says ${match[1]}`];
    },
  ],
  [
    'mitre-techniques',
    (line) => {
      const total = countTechniques();
      const match = line.match(/(\d+) techniques mapped/);
      if (!match) return ['the cell no longer reads `N techniques mapped`'];
      return Number(match[1]) === total
        ? []
        : [`the ATT&CK mapping covers ${total} distinct techniques, the page says ${match[1]}`];
    },
  ],
]);

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...markdownFiles(full));
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) found.push(full);
  }
  return found;
}

const marked = new Set();

for (const file of markdownFiles(docsRoot)) {
  const shown = relative(repoRoot, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    const marker = line.match(/<!--\s*feature-count:\s*([a-z0-9-]+)\s*-->/);
    if (!marker) return;
    const kind = marker[1];
    const check = KINDS.get(kind);
    if (!check) {
      errors.push(`${shown}:${index + 1} - no count called \`${kind}\` is checked`);
      return;
    }
    marked.add(kind);
    let cursor = index + 1;
    while (cursor < lines.length && lines[cursor].trim() === '') cursor += 1;
    if (cursor >= lines.length) {
      errors.push(`${shown}:${index + 1} - \`${kind}\` marks nothing`);
      return;
    }
    // A count can sit in a table cell or in a sentence that wraps, so the
    // whole paragraph is read rather than the first line of it.
    const block = [];
    for (let line = cursor; line < lines.length && lines[line].trim() !== ''; line += 1) {
      block.push(lines[line]);
    }
    for (const problem of check(block.join(' '))) {
      errors.push(`${shown}:${cursor + 1} - ${problem}`);
    }
  });
}

for (const kind of KINDS.keys()) {
  if (!marked.has(kind)) {
    errors.push(`\`${kind}\` is checked here and marked on no page`);
  }
}

// The program total is written on one marked page and restated on half a dozen
// others, which is how it went stale in the first place: two programs were
// added to the tree and every unmarked sentence kept saying sixteen. A marker
// per restatement would mean marking a mermaid label and a workflow table, so
// the phrase itself is the marker. Only a claim about the whole tree is read:
// a sentence counting the programs that do one thing ("all 6 eBPF programs
// that enforce rules") is a subset and says so, which is what the trailing
// `that` excludes.
const programTotal = countProgramDirectories();
// `xdp-pass` is peer-side test scaffolding, so a page counting what a customer
// host runs is right to say one less. Both numbers are read off the same tree,
// and a page saying neither is the one that went stale.
const programsRun = programTotal - 1;
const TOTAL_CLAIMS = [
  /(?:ships|includes|holds|each of the|Linux Kernel \(|\*\*|\ball\b)\s*(\d+|[A-Za-z]+) eBPF (?:kernel )?programs(?! that)/gi,
  /\b(\d+|[A-Za-z]+) eBPF (?:kernel )?programs attached at\b/gi,
];

for (const file of [...markdownFiles(docsRoot), join(repoRoot, 'README.md')]) {
  const shown = relative(repoRoot, file);
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const seen = new Set();
      for (const claim of TOTAL_CLAIMS) {
        for (const [, token] of line.matchAll(claim)) {
          const written = numberFrom(token);
          if (written === undefined || written === programTotal || written === programsRun) continue;
          if (seen.has(token)) continue;
          seen.add(token);
          errors.push(
            `${shown}:${index + 1} - crates/ebpf-programs/ holds ${programTotal} directories (${programsRun} a host runs), the line says ${token}`,
          );
        }
      }
    });
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(`\n${errors.length} feature count problem(s).`);
  process.exit(1);
}

console.log(`Feature counts OK (${marked.size} counts read out of the agent tree).`);
