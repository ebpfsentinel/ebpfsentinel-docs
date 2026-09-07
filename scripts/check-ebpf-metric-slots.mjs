#!/usr/bin/env node
// Fails when a page names a kernel-map counter slot the agent does not
// export, when it puts a slot at the wrong index, or when it enumerates a
// map's slots and leaves one out.
//
// The source of truth is the agent's `ebpf_metrics.rs` slot table, which is
// what turns a per-CPU array index into the `action` label on
// `ebpfsentinel_packets_total`. Three of these tables had drifted by a slot
// or a name across two audits, each one silently: a table is prose, so
// nothing failed until somebody built a dashboard on it.
//
// Three shapes are checked:
//
//   1. A markdown table introduced by `<!-- ebpf-metric-slots: MAP -->`.
//      Every row is matched against the map's slots by index, in order, and
//      the row count has to equal the slot count.
//   2. A bullet of the open form `interface="MAP", action}`. Every backticked
//      token on the line has to be one of the map's slots, and every slot has
//      to appear. A token ending in `*` stands for the slots sharing its
//      prefix, so a page may still write `kfunc_*` for a family of eight.
//   3. Any `interface="MAP"` carrying `action="name"`. The name has to be one
//      of the map's slots.
//
// A map named in the documentation and absent from the agent's table is an
// error too: it is a label nothing will ever carry.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const docsRoot = join(repoRoot, 'docs');

const DEFAULT_SLOTS_RS = resolve(
  repoRoot,
  '..',
  'ebpfsentinel',
  'crates',
  'agent',
  'src',
  'ebpf_metrics.rs',
);
const slotsRs = process.env.EBPFSENTINEL_EBPF_METRICS_RS
  ? resolve(process.env.EBPFSENTINEL_EBPF_METRICS_RS)
  : DEFAULT_SLOTS_RS;

const errors = [];

function readSlotTables(path) {
  const source = readFileSync(path, 'utf8');
  const maps = new Map();
  const arm = /"([A-Z0-9_]+)"\s*=>\s*&\[([\s\S]*?)\]/g;
  for (const [, name, body] of source.matchAll(arm)) {
    const slots = [];
    for (const [, index, slot] of body.matchAll(/\(\s*(\d+)\s*,\s*"([a-z0-9_]+)"\s*\)/g)) {
      slots[Number(index)] = slot;
    }
    if (slots.length > 0) maps.set(name, slots);
  }
  if (maps.size === 0) {
    errors.push(`no slot tables found in ${path} - has the table been renamed?`);
  }
  return maps;
}

function markdownFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...markdownFiles(full));
    else if (entry.endsWith('.md') || entry.endsWith('.mdx')) found.push(full);
  }
  return found;
}

// Expand `kfunc_*` against a map's slots. A bare name expands to itself.
function expand(token, slots) {
  if (!token.endsWith('*')) return slots.includes(token) ? [token] : [];
  const prefix = token.slice(0, -1);
  return slots.filter((slot) => slot.startsWith(prefix));
}

function checkSlotTable(file, lines, start, map, slots) {
  // The table opens on the first row after the marker; its header and
  // separator are skipped and every remaining row is a slot.
  let cursor = start;
  while (cursor < lines.length && !lines[cursor].startsWith('|')) cursor += 1;
  cursor += 2;
  const rows = [];
  while (cursor < lines.length && lines[cursor].startsWith('|')) {
    rows.push([cursor + 1, lines[cursor]]);
    cursor += 1;
  }
  if (rows.length !== slots.length) {
    errors.push(
      `${file}:${start + 1} - ${map} has ${slots.length} slots, the table carries ${rows.length}`,
    );
  }
  rows.forEach(([lineNo, row], index) => {
    const cells = row.split('|').map((cell) => cell.trim());
    const declared = Number(cells[1]);
    const name = (cells[2] ?? '').replace(/`/g, '');
    if (declared !== index) {
      errors.push(`${file}:${lineNo} - row ${index} of ${map} is numbered ${cells[1]}`);
    }
    const expected = slots[index];
    if (expected !== undefined && name !== expected) {
      errors.push(`${file}:${lineNo} - slot ${index} of ${map} is \`${expected}\`, not \`${name}\``);
    }
  });
}

function checkEnumeration(file, lineNo, line, map, slots) {
  const tokens = [...line.matchAll(/`([a-z][a-z0-9_]*\*?)`/g)].map(([, token]) => token);
  const seen = new Set();
  for (const token of tokens) {
    const matched = expand(token, slots);
    if (matched.length === 0) {
      errors.push(`${file}:${lineNo} - \`${token}\` is not a slot of ${map}`);
      continue;
    }
    for (const slot of matched) seen.add(slot);
  }
  const missing = slots.filter((slot) => !seen.has(slot));
  if (missing.length > 0) {
    errors.push(`${file}:${lineNo} - ${map} slots left out: ${missing.join(', ')}`);
  }
}

const maps = readSlotTables(slotsRs);

for (const file of markdownFiles(docsRoot)) {
  const shown = relative(repoRoot, file);
  const lines = readFileSync(file, 'utf8').split('\n');

  lines.forEach((line, index) => {
    const marker = line.match(/<!--\s*ebpf-metric-slots:\s*([A-Z0-9_]+)\s*-->/);
    if (marker) {
      const map = marker[1];
      const slots = maps.get(map);
      if (!slots) {
        errors.push(`${shown}:${index + 1} - the agent exports no map called ${map}`);
      } else {
        checkSlotTable(shown, lines, index + 1, map, slots);
      }
    }

    for (const [, map] of line.matchAll(/interface="([A-Z0-9_]+_METRICS)"/g)) {
      const slots = maps.get(map);
      if (!slots) {
        errors.push(`${shown}:${index + 1} - the agent exports no map called ${map}`);
        continue;
      }
      if (new RegExp(`interface="${map}",?\\s*action}`).test(line)) {
        checkEnumeration(shown, index + 1, line, map, slots);
      }
      for (const [, name] of line.matchAll(/action="([a-z0-9_]+)"/g)) {
        if (!slots.includes(name)) {
          errors.push(`${shown}:${index + 1} - \`${name}\` is not a slot of ${map}`);
        }
      }
    }
  });
}

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  console.error(`\n${errors.length} eBPF metric slot problem(s).`);
  process.exit(1);
}

console.log(`eBPF metric slots OK (${maps.size} maps).`);
