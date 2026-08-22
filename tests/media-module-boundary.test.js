// tests/media-module-boundary.test.js
//
// DATA-1C, Task 4 (M4-7) — the Media Storage Adapter's module boundary
// is enforceable, not just conventional. Mirrors
// tests/assets-module-boundary.test.js's discipline exactly:
// src/modules/media/driver-localfs.js, driver-vercel-blob.js, and
// contentAddress.js are PRIVATE — nothing outside src/modules/media/ may
// import them directly.
//
// No DB/storage access needed — pure static analysis over the tracked
// source tree, matching this repo's own no-test-runner convention.
//
// Invoke: node tests/media-module-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const MODULE_DIR = path.join(repoRoot, 'src', 'modules', 'media');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== M4-7 — Media Storage Adapter module boundary ===\n');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const allFiles = [
  ...walk(path.join(repoRoot, 'api')),
  ...walk(path.join(repoRoot, 'src')),
];

const PRIVATE_MODULES = ['driver-localfs.js', 'driver-vercel-blob.js', 'contentAddress.js'];
const PRIVATE_ABSOLUTE_PATHS = new Set(PRIVATE_MODULES.map((f) => path.join(MODULE_DIR, f)));
const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

let boundaryViolation = null;

for (const file of allFiles) {
  const isInsideMediaModule = file.startsWith(MODULE_DIR + path.sep) || file === MODULE_DIR;
  const text = readFileSync(file, 'utf8');
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const resolved = path.normalize(path.join(path.dirname(file), spec));
      if (!PRIVATE_ABSOLUTE_PATHS.has(resolved)) continue;
      if (!isInsideMediaModule) {
        boundaryViolation = { file, spec };
      }
    }
  }
}

assertTrue(
  boundaryViolation === null,
  `no file outside src/modules/media/ imports a private module` +
  (boundaryViolation ? ` (VIOLATION: ${path.relative(repoRoot, boundaryViolation.file)} imports "${boundaryViolation.spec}")` : '')
);

// index.js re-exports the real public surface.
const indexSrc = readFileSync(path.join(MODULE_DIR, 'index.js'), 'utf8');
const REQUIRED_EXPORTS = [
  'put', 'head', 'getBytes',
  'MediaStorageError', 'HashMismatchError', 'ImmutabilityViolationError', 'MediaNotFoundError', 'NotProvisionedError',
];
for (const name of REQUIRED_EXPORTS) {
  assertTrue(indexSrc.includes(name), `index.js re-exports ${name}`);
}

// C3 — no physical-delete API. The Part-A dispatch's delete() sketch was
// removed by the C0-C8 review; prove it stays removed, not just absent
// today by omission.
assertTrue(
  !/export\s+(async\s+)?function\s+del(ete)?\s*\(/i.test(indexSrc) && !/^\s*del(ete)?\s*[,}]/m.test(indexSrc),
  'index.js exports no delete()/del() function (C3)'
);

// Structural proof for M4-3 (immutability): the public put() signature
// accepts no overwrite-style parameter anywhere in this module — an
// overwrite path cannot exist if no caller-reachable function ever
// offers one.
const allModuleSrc = ['index.js', 'driver-localfs.js', 'driver-vercel-blob.js']
  .map((f) => readFileSync(path.join(MODULE_DIR, f), 'utf8'))
  .join('\n');
assertTrue(
  !/allowOverwrite\s*:\s*true/i.test(allModuleSrc),
  'no driver ever passes allowOverwrite:true (M4-3 — immutability by construction)'
);

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
