#!/usr/bin/env node

// The API explorer renders `static/openapi.json`, which is a copy of the
// agent's own document rather than a second source. A copy nobody compares is a
// copy that drifts: this one had fallen three routes and one release behind
// before anybody noticed, so the two files are held byte for byte identical
// here and the fix is a copy rather than an edit.

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const vendoredPath = join(repoRoot, 'static', 'openapi.json');

const DEFAULT_OPENAPI_JSON = resolve(repoRoot, '..', 'ebpfsentinel', 'openapi.json');
const sourcePath = process.env.EBPFSENTINEL_OPENAPI_JSON
  ? resolve(process.env.EBPFSENTINEL_OPENAPI_JSON)
  : DEFAULT_OPENAPI_JSON;

function read(path, what) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`Cannot read the ${what} at ${path}: ${error.message}`);
    if (path === DEFAULT_OPENAPI_JSON) {
      console.error(
        'The agent repository is expected beside this one. Point ' +
          'EBPFSENTINEL_OPENAPI_JSON at its openapi.json to check elsewhere.',
      );
    }
    process.exit(1);
  }
}

const source = read(sourcePath, 'agent OpenAPI document');
const vendored = read(vendoredPath, 'vendored copy');

if (source === vendored) {
  const { info, paths } = JSON.parse(vendored);
  console.log(
    `check:vendored-openapi OK - ${relative(repoRoot, vendoredPath)} matches ` +
      `${sourcePath} (${info.version}, ${Object.keys(paths).length} paths)`,
  );
  process.exit(0);
}

const sourceDoc = JSON.parse(source);
const vendoredDoc = JSON.parse(vendored);
const sourcePaths = Object.keys(sourceDoc.paths ?? {});
const vendoredPaths = Object.keys(vendoredDoc.paths ?? {});
const missing = sourcePaths.filter((p) => !vendoredPaths.includes(p));
const extra = vendoredPaths.filter((p) => !sourcePaths.includes(p));

console.error(`${relative(repoRoot, vendoredPath)} is not the agent's document.`);
console.error(`  agent    ${sourceDoc.info?.version} - ${sourcePaths.length} paths`);
console.error(`  vendored ${vendoredDoc.info?.version} - ${vendoredPaths.length} paths`);
for (const path of missing) {
  console.error(`  missing from the copy: ${path}`);
}
for (const path of extra) {
  console.error(`  only in the copy: ${path}`);
}
console.error(`Refresh it: cp ${sourcePath} ${vendoredPath}`);
process.exit(1);
