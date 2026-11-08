#!/usr/bin/env node

// The tutorials play the clips the website renders, and `static/media/` holds
// a copy of them rather than a link. The site and this one deploy to two
// buckets from two pipelines, and Docusaurus serves what `static/` holds at
// build time, so a page here cannot reach a file in the website's `public/`
// without a cross-origin request to a host whose layout is that repository's
// business. A copy nobody compares drifts, so each file is held to the hash
// the website's render recorded in `media/manifest.json`: a clip rendered
// again there fails here until it is copied again, and the fix is a copy
// rather than an edit.
//
// It also fails on a file in `static/media/` the manifest does not list, and
// on a page naming a `/media/` file that is not there, because a raw <video>
// is HTML the link checker does not follow.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const copyDir = join(repoRoot, 'static', 'media');
const docsDir = join(repoRoot, 'docs');

const DEFAULT_WEBSITE = resolve(repoRoot, '..', 'ebpfsentinel-website');
const websiteDir = process.env.EBPFSENTINEL_WEBSITE_DIR
  ? resolve(process.env.EBPFSENTINEL_WEBSITE_DIR)
  : DEFAULT_WEBSITE;
const manifestPath = join(websiteDir, 'media', 'manifest.json');

let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (error) {
  console.error(`Cannot read the website's media manifest at ${manifestPath}: ${error.message}`);
  if (websiteDir === DEFAULT_WEBSITE) {
    console.error(
      'The website repository is expected beside this one. Point ' +
        'EBPFSENTINEL_WEBSITE_DIR at its checkout to check elsewhere.',
    );
  }
  process.exit(1);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const problems = [];

const expected = new Map();
for (const [id, clip] of Object.entries(manifest.clips ?? {})) {
  for (const [file, { sha256: hash }] of Object.entries(clip.outputs ?? {})) {
    expected.set(basename(file), { id, file, hash });
  }
}
if (expected.size === 0) problems.push(`${manifestPath} lists no rendered file`);

const present = readdirSync(copyDir).filter((name) => statSync(join(copyDir, name)).isFile());

for (const [name, { file, hash }] of expected) {
  if (!present.includes(name)) {
    problems.push(`static/media/${name} is missing; copy ${file} from the website`);
    continue;
  }
  if (sha256(readFileSync(join(copyDir, name))) !== hash) {
    problems.push(`static/media/${name} is not the website's ${file}; copy it again`);
  }
}
for (const name of present) {
  if (!expected.has(name)) problems.push(`static/media/${name} is not in the website's manifest`);
}

function pages(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return pages(path);
    return /\.mdx?$/.test(entry.name) ? [path] : [];
  });
}

let embeds = 0;
for (const page of pages(docsDir)) {
  for (const [, name] of readFileSync(page, 'utf8').matchAll(/"\/media\/([^"/]+)"/g)) {
    embeds += 1;
    if (!present.includes(name)) {
      problems.push(`${relative(repoRoot, page)} names /media/${name}, which static/media lacks`);
    }
  }
}

if (problems.length > 0) {
  console.error(`check:media-copy: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(
  `check:media-copy OK - ${present.length} files match ${relative(repoRoot, manifestPath)}, ` +
    `${embeds} references resolve`,
);
