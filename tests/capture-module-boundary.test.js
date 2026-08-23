// tests/capture-module-boundary.test.js
//
// CAPTURE-INT, P6 — the capture module's boundary is enforceable, not
// just conventional. Two things proved, both by static analysis over the
// tracked source tree (no DB needed):
//
//   1. mapping.js (the one private file in src/modules/capture/) is
//      never imported outside that directory — mirrors
//      tests/assets-module-boundary.test.js / media-module-boundary.test.js.
//   2. THE PLANTED-VIOLATOR PROOF the dispatch specifically asks for:
//      NOTHING in src/modules/capture/ imports a PRIVATE file from
//      EITHER of the modules it depends on — src/modules/assets/
//      {repository,db,idempotency}.js or src/modules/media/
//      {driver-localfs,driver-vercel-blob,contentAddress}.js. Capture
//      can only reach the Asset Service (and, transitively, media)
//      through their PUBLIC index.js surfaces.
//
// Invoke: node tests/capture-module-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const CAPTURE_DIR = path.join(repoRoot, 'src', 'modules', 'capture');
const ASSETS_DIR = path.join(repoRoot, 'src', 'modules', 'assets');
const MEDIA_DIR = path.join(repoRoot, 'src', 'modules', 'media');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== P6 — Capture module boundary ===\n');

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

const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function findImports(file) {
  const text = readFileSync(file, 'utf8');
  const specs = [];
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) specs.push(m[1]);
  }
  return specs.filter((s) => s.startsWith('.')).map((s) => path.normalize(path.join(path.dirname(file), s)));
}

// --- 1. mapping.js stays private to src/modules/capture/ ---
const MAPPING_PATH = path.join(CAPTURE_DIR, 'mapping.js');
let mappingViolation = null;
for (const file of allFiles) {
  const isInsideCapture = file.startsWith(CAPTURE_DIR + path.sep) || file === CAPTURE_DIR;
  if (isInsideCapture) continue;
  if (findImports(file).includes(MAPPING_PATH)) mappingViolation = file;
}
assertTrue(
  mappingViolation === null,
  `no file outside src/modules/capture/ imports mapping.js` +
  (mappingViolation ? ` (VIOLATION: ${path.relative(repoRoot, mappingViolation)})` : '')
);

// --- 2. THE PLANTED-VIOLATOR PROOF: capture never reaches a PRIVATE
// file of assets/ or media/ — only their public index.js. ---
const FOREIGN_PRIVATE_PATHS = new Set([
  path.join(ASSETS_DIR, 'repository.js'),
  path.join(ASSETS_DIR, 'db.js'),
  path.join(ASSETS_DIR, 'idempotency.js'),
  path.join(MEDIA_DIR, 'driver-localfs.js'),
  path.join(MEDIA_DIR, 'driver-vercel-blob.js'),
  path.join(MEDIA_DIR, 'contentAddress.js'),
]);

const captureFiles = walk(CAPTURE_DIR);
let foreignPrivateViolation = null;
for (const file of captureFiles) {
  for (const resolved of findImports(file)) {
    if (FOREIGN_PRIVATE_PATHS.has(resolved)) {
      foreignPrivateViolation = { file, resolved };
    }
  }
}
assertTrue(
  foreignPrivateViolation === null,
  `no file in src/modules/capture/ imports a private file of assets/ or media/` +
  (foreignPrivateViolation
    ? ` (VIOLATION: ${path.relative(repoRoot, foreignPrivateViolation.file)} imports ${path.relative(repoRoot, foreignPrivateViolation.resolved)})`
    : '')
);

// Non-vacuous check: confirm the capture module genuinely imports the
// Asset Service's PUBLIC surface (proves the boundary test isn't just
// trivially passing because capture imports nothing at all).
const serviceSrc = readFileSync(path.join(CAPTURE_DIR, 'service.js'), 'utf8');
assertTrue(
  /from\s+['"]\.\.\/assets\/index\.js['"]/.test(serviceSrc),
  'capture/service.js genuinely imports ../assets/index.js (the public surface) — not a vacuous pass'
);

// index.js re-exports the real public surface.
const indexSrc = readFileSync(path.join(CAPTURE_DIR, 'index.js'), 'utf8');
for (const name of ['captureFromScan', 'ValidationFailedError', 'ConflictError', 'NotFoundError']) {
  assertTrue(indexSrc.includes(name), `index.js re-exports ${name}`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
