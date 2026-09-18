// tests/collection-module-boundary.test.js
//
// GrailKey Clean Account/Collection Cutover — the collection module's
// boundary is enforceable, not just conventional, mirroring
// tests/capture-module-boundary.test.js / assets-module-boundary.test.js:
//
//   1. db.js and repository.js (the two PRIVATE files in
//      src/modules/collection/) are never imported outside that
//      directory.
//   2. index.js re-exports the real public surface, and genuinely
//      imports repository.js from within service.js (non-vacuous).
//   3. This module never references src/modules/assets/ or
//      src/modules/capture/ at all — collection_item != gkAssetId is
//      enforced by absence, not merely by convention: there is no
//      import path from here into the physical-asset kernel.
//
// Invoke: node tests/collection-module-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const COLLECTION_DIR = path.join(repoRoot, 'src', 'modules', 'collection');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== Collection module boundary ===\n');

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

// --- 1. db.js / repository.js stay private ---
for (const privateName of ['db.js', 'repository.js']) {
  const PRIVATE_PATH = path.join(COLLECTION_DIR, privateName);
  let violation = null;
  for (const file of allFiles) {
    const isInside = file.startsWith(COLLECTION_DIR + path.sep) || file === COLLECTION_DIR;
    if (isInside) continue;
    if (findImports(file).includes(PRIVATE_PATH)) violation = file;
  }
  assertTrue(
    violation === null,
    `no file outside src/modules/collection/ imports ${privateName}` +
    (violation ? ` (VIOLATION: ${path.relative(repoRoot, violation)})` : '')
  );
}

// --- 2. service.js genuinely imports repository.js (non-vacuous) ---
const serviceSrc = readFileSync(path.join(COLLECTION_DIR, 'service.js'), 'utf8');
assertTrue(/from\s+['"]\.\/repository\.js['"]/.test(serviceSrc), 'service.js genuinely imports ./repository.js');

// --- 3. index.js re-exports the real public surface ---
const indexSrc = readFileSync(path.join(COLLECTION_DIR, 'index.js'), 'utf8');
for (const name of ['listMyCollection', 'getMyCollectionItem', 'createCollectionItem', 'updateCollectionItem', 'deleteCollectionItem', 'ValidationFailedError', 'NotFoundError', 'AuthorizationFailedError']) {
  assertTrue(indexSrc.includes(name), `index.js re-exports ${name}`);
}

// --- 4. physical-asset kernel isolation: nothing in this module reaches
// src/modules/assets/ or src/modules/capture/ at all ---
const collectionFiles = walk(COLLECTION_DIR);
let kernelReach = null;
for (const file of collectionFiles) {
  for (const resolved of findImports(file)) {
    if (resolved.includes(path.join('modules', 'assets')) || resolved.includes(path.join('modules', 'capture'))) {
      kernelReach = { file, resolved };
    }
  }
}
assertTrue(
  kernelReach === null,
  'no file in src/modules/collection/ imports anything from src/modules/assets/ or src/modules/capture/ — collection_item != gkAssetId enforced by absence' +
  (kernelReach ? ` (VIOLATION: ${path.relative(repoRoot, kernelReach.file)} imports ${path.relative(repoRoot, kernelReach.resolved)})` : '')
);

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
