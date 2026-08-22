// tests/assets-module-boundary.test.js
//
// S3-11 (DATA-1B) — the Asset Service's module boundary is enforceable,
// not just conventional. src/modules/assets/repository.js, db.js, and
// idempotency.js are PRIVATE: nothing outside src/modules/assets/ may
// import them, and only service.js may import repository.js (db.js and
// idempotency.js are private to service.js's own orchestration too).
//
// No DB connection needed — pure static analysis over the tracked source
// tree, matching this repo's own no-test-runner convention (a standalone
// script, run via `node tests/assets-module-boundary.test.js`).
//
// Invoke: node tests/assets-module-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const MODULE_DIR = path.join(repoRoot, 'src', 'modules', 'assets');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== S3-11 — Asset Service module boundary ===\n');

// Walk the tracked source tree (api/, src/), skipping node_modules/.git/dist.
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

const PRIVATE_MODULES = ['repository.js', 'db.js', 'idempotency.js'];
const PRIVATE_ABSOLUTE_PATHS = new Set(PRIVATE_MODULES.map((f) => path.join(MODULE_DIR, f)));
const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;

let boundaryViolation = null;
let repositoryImporters = new Set();

for (const file of allFiles) {
  const isInsideAssetsModule = file.startsWith(MODULE_DIR + path.sep) || file === MODULE_DIR;
  const text = readFileSync(file, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue; // only relative imports can possibly resolve into this module
    // Resolve the specifier against the IMPORTING file's own directory —
    // a bare filename match ("db.js") is not enough, since this repo
    // already has an unrelated src/db.js; only a path that actually
    // resolves inside src/modules/assets/ counts.
    const resolved = path.normalize(path.join(path.dirname(file), spec));
    if (!PRIVATE_ABSOLUTE_PATHS.has(resolved)) continue;
    const priv = path.basename(resolved);
    if (!isInsideAssetsModule) {
      boundaryViolation = { file, spec, priv };
    } else if (priv === 'repository.js') {
      repositoryImporters.add(path.basename(file));
    }
  }
}

assertTrue(
  boundaryViolation === null,
  `no file outside src/modules/assets/ imports a private module` +
  (boundaryViolation ? ` (VIOLATION: ${path.relative(repoRoot, boundaryViolation.file)} imports "${boundaryViolation.spec}")` : '')
);

assertTrue(
  repositoryImporters.size === 1 && repositoryImporters.has('service.js'),
  `repository.js is imported by exactly one file (service.js) — actual importers: [${[...repositoryImporters].join(', ')}]`
);

// index.js is the only file expected to be imported from outside the
// module — spot-check that at least the public surface it re-exports is
// actually present (guards against index.js silently drifting out of
// sync with service.js/errors.js).
const indexSrc = readFileSync(path.join(MODULE_DIR, 'index.js'), 'utf8');
const REQUIRED_EXPORTS = [
  'createPhysicalAsset', 'getPhysicalAsset', 'assignIdentity', 'correctIdentity',
  'attachMediaMetadata', 'transferOwnership', 'recordAcquisition', 'recordValuation', 'recordDecision',
  'AssetServiceError', 'NotFoundError', 'ConflictError', 'IdempotentReplayError', 'ValidationFailedError', 'AuthorizationFailedError',
];
for (const name of REQUIRED_EXPORTS) {
  assertTrue(indexSrc.includes(name), `index.js re-exports ${name}`);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
