// The manifest every surface gate keeps beside itself, and the rule that
// settles a gate's inventory against it (meta `docs/COVERAGE.md`).
//
// A surface the scan covers counts by scan. One it does not must carry exactly
// one line in the manifest: `suites` (reached indirectly, the caller checks the
// suites still touch it), `reason` (unreachable by design) or `gap`
// (acknowledged debt). A line for a covered surface, or for a surface the code
// no longer has, is stale and fails. The number of `gap` lines must equal the
// top-level `gap_ceiling`: above it is a new hole, below it a closed gap whose
// ceiling was not lowered.
//
// The manifest is TOML, restricted to what a manifest needs: comments, a
// top-level integer, `[kind."quoted key"]` or `[kind.bare]` tables, and
// single-line string, integer or string-array values. Anything else fails
// rather than being half read.

import { existsSync, readFileSync } from 'node:fs';

function parseString(text, at) {
  let out = '';
  let i = at + 1;
  while (i < text.length && text[i] !== '"') {
    if (text[i] === '\\') {
      const next = text[i + 1];
      out += next === 'n' ? '\n' : next === 't' ? '\t' : next;
      i += 2;
    } else {
      out += text[i];
      i += 1;
    }
  }
  if (text[i] !== '"') throw new Error('unterminated string');
  return [out, i + 1];
}

function parseValue(raw) {
  const text = raw.trim();
  if (/^-?\d+$/.test(text)) return Number(text);
  if (text.startsWith('"')) {
    const [value, end] = parseString(text, 0);
    if (text.slice(end).trim() !== '') throw new Error(`trailing text after ${text.slice(0, end)}`);
    return value;
  }
  if (text.startsWith('[') && text.endsWith(']')) {
    const items = [];
    let rest = text.slice(1, -1).trim();
    while (rest.length > 0) {
      if (!rest.startsWith('"')) throw new Error(`only strings in an array: ${text}`);
      const [value, end] = parseString(rest, 0);
      items.push(value);
      rest = rest.slice(end).trim().replace(/^,/, '').trim();
    }
    return items;
  }
  throw new Error(`unsupported value: ${text}`);
}

function stripComment(line) {
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === '\\' && quoted) i += 1;
    else if (line[i] === '"') quoted = !quoted;
    else if (line[i] === '#' && !quoted) return line.slice(0, i);
  }
  return line;
}

// Reads `path` into `{ top: {key: value}, tables: {kind: {surface: {key: value}}} }`.
export function readManifest(path) {
  const manifest = { top: {}, tables: {} };
  if (!existsSync(path)) throw new Error(`${path}: manifest missing`);
  let current = null;
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((raw, index) => {
      const line = stripComment(raw).trim();
      if (line === '') return;
      const where = `${path}:${index + 1}`;
      const header = line.match(/^\[([a-z_-]+)\.(?:"((?:[^"\\]|\\.)*)"|([A-Za-z0-9_-]+))\]$/);
      if (header) {
        const kind = header[1];
        const key = header[2] !== undefined ? parseString(`"${header[2]}"`, 0)[0] : header[3];
        manifest.tables[kind] ??= {};
        if (manifest.tables[kind][key]) throw new Error(`${where}: [${kind}.${key}] appears twice`);
        manifest.tables[kind][key] = {};
        current = manifest.tables[kind][key];
        return;
      }
      const pair = line.match(/^([a-z_]+)\s*=\s*(.+)$/);
      if (!pair) throw new Error(`${where}: not a manifest line: ${raw}`);
      try {
        (current ?? manifest.top)[pair[1]] = parseValue(pair[2]);
      } catch (error) {
        throw new Error(`${where}: ${error.message}`);
      }
    });
  return manifest;
}

// Settles an inventory against the manifest's `kind` table.
//
// `surfaces` is every surface the code has; `covered(surface)` says whether
// the scan sees its evidence; `checkSuites(surface, suites)` returns an error
// string or null for a `suites` line. Returns the errors and the counts.
export function settle({ surfaces, covered, manifest, kind, checkSuites }) {
  const lines = manifest.tables[kind] ?? {};
  const errors = [];
  const counts = { surfaces: 0, scan: 0, suite: 0, reason: 0, gaps: 0 };
  const gaps = [];
  const known = new Set(surfaces);
  for (const unknown of Object.keys(manifest.tables)) {
    if (unknown !== kind) errors.push(`manifest table [${unknown}] is not read by this gate`);
  }
  for (const surface of surfaces) {
    counts.surfaces += 1;
    const line = lines[surface];
    if (covered(surface)) {
      if (line) errors.push(`${surface}: covered by the scan, drop its manifest line`);
      else counts.scan += 1;
      continue;
    }
    if (!line) {
      errors.push(`${surface}: not covered and the manifest does not list it`);
      continue;
    }
    const keys = ['suites', 'reason', 'gap'].filter((k) => line[k] !== undefined);
    const extra = Object.keys(line).filter((k) => !['suites', 'reason', 'gap'].includes(k));
    if (keys.length !== 1 || extra.length > 0) {
      errors.push(`${surface}: its line carries exactly one of suites, reason, gap and nothing else`);
      continue;
    }
    if (keys[0] === 'suites') {
      const suites = line.suites;
      if (!Array.isArray(suites) || suites.length === 0) {
        errors.push(`${surface}: suites must name at least one suite`);
        continue;
      }
      if (!checkSuites) {
        errors.push(`${surface}: this gate takes no suites lines`);
        continue;
      }
      const why = checkSuites(surface, suites);
      if (why) errors.push(`${surface}: ${why}`);
      else counts.suite += 1;
    } else if (typeof line[keys[0]] !== 'string' || line[keys[0]].trim() === '') {
      errors.push(`${surface}: ${keys[0]} must be a sentence`);
    } else if (keys[0] === 'reason') {
      counts.reason += 1;
    } else {
      counts.gaps += 1;
      gaps.push(`${surface}: ${line.gap}`);
    }
  }
  for (const surface of Object.keys(lines)) {
    if (!known.has(surface)) errors.push(`${surface}: listed in the manifest, not a surface of the code`);
  }
  const ceiling = manifest.top.gap_ceiling;
  if (!Number.isInteger(ceiling)) {
    errors.push('the manifest carries no integer gap_ceiling');
  } else if (counts.gaps > ceiling) {
    errors.push(`${counts.gaps} gaps, above gap_ceiling ${ceiling}: a new hole, cover it or own it`);
  } else if (counts.gaps < ceiling) {
    errors.push(`${counts.gaps} gaps, below gap_ceiling ${ceiling}: lower the ceiling with the fix`);
  }
  return { errors, counts, gaps, ceiling };
}

export function summaryLine(gate, { counts, ceiling }) {
  return (
    `${gate}: ${counts.surfaces} surfaces, ${counts.scan} by scan, ${counts.suite} by suite, ` +
    `${counts.reason} by reason, ${counts.gaps} gaps (ceiling ${ceiling})`
  );
}
