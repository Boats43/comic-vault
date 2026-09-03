// tests/valuation-module-boundary.test.js
//
// D5D isolated-writer-design dispatch. Two invariants:
//   1. Standard module-boundary discipline, mirroring
//      tests/assets-module-boundary.test.js exactly: repository.js,
//      db.js, idempotency.js are PRIVATE to src/modules/valuation/;
//      only service.js may import repository.js.
//   2. THE D5D-SPECIFIC INVARIANT: zero production call sites. No file
//      under api/ may import ANYTHING from src/modules/valuation/ --
//      not even the public index.js. This is stronger than assets/'s
//      own boundary (which permits, and expects, api/ to eventually
//      call its public surface) -- for src/modules/valuation/, even the
//      PUBLIC surface must currently have zero importers under api/,
//      because runtime wiring is explicitly HOLD until Milestone Ten's
//      phone proof closes (CLAUDE.md, "WHAT MUST NOT BE DONE").
//
// No DB connection needed — pure static analysis over the tracked
// source tree.
//
// Invoke: node tests/valuation-module-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const MODULE_DIR = path.join(repoRoot, 'src', 'modules', 'valuation');
const API_DIR = path.join(repoRoot, 'api');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D5D — valuation module boundary (incl. zero production call sites) ===\n');

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
const INDEX_ABSOLUTE_PATH = path.join(MODULE_DIR, 'index.js');
const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;

let boundaryViolation = null;
let repositoryImporters = new Set();
let productionCallSites = [];

for (const file of allFiles) {
  const isInsideValuationModule = file.startsWith(MODULE_DIR + path.sep) || file === MODULE_DIR;
  const isUnderApi = file.startsWith(API_DIR + path.sep) || file === API_DIR;
  const text = readFileSync(file, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.normalize(path.join(path.dirname(file), spec));

    if (PRIVATE_ABSOLUTE_PATHS.has(resolved) && !isInsideValuationModule) {
      boundaryViolation = { file, spec, priv: path.basename(resolved) };
    }
    if (PRIVATE_ABSOLUTE_PATHS.has(resolved) && path.basename(resolved) === 'repository.js' && isInsideValuationModule) {
      repositoryImporters.add(path.basename(file));
    }
    // Zero production call sites: ANY import resolving into this
    // module's directory (index.js included) from a file under api/ is
    // a violation, regardless of whether that import targets the
    // public or a private file.
    if (isUnderApi && (resolved === INDEX_ABSOLUTE_PATH || resolved.startsWith(MODULE_DIR + path.sep) || resolved === MODULE_DIR)) {
      productionCallSites.push({ file, spec });
    }
  }
}

assertTrue(
  boundaryViolation === null,
  `no file outside src/modules/valuation/ imports a private module` +
  (boundaryViolation ? ` (VIOLATION: ${path.relative(repoRoot, boundaryViolation.file)} imports "${boundaryViolation.spec}")` : '')
);

assertTrue(
  repositoryImporters.size === 1 && repositoryImporters.has('service.js'),
  `repository.js is imported by exactly one file (service.js) — actual importers: [${[...repositoryImporters].join(', ')}]`
);

assertTrue(
  productionCallSites.length === 0,
  `ZERO production call sites -- no file under api/ imports anything from src/modules/valuation/ (GK-180 unaffected)` +
  (productionCallSites.length > 0 ? ` (VIOLATIONS: ${productionCallSites.map((v) => `${path.relative(repoRoot, v.file)} -> "${v.spec}"`).join('; ')})` : '')
);

const indexSrc = readFileSync(INDEX_ABSOLUTE_PATH, 'utf8');
const REQUIRED_EXPORTS = [
  'resolveEligibleSubject', 'evaluateMarketPopulation', 'getEvaluatedPopulation', 'attemptDurablePersistence',
  'ValuationServiceError', 'NotFoundError', 'ValidationFailedError', 'AuthorizationFailedError',
  'IdempotencyConflictError', 'SKIP_REASONS',
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
