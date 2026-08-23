// tests/auth-module-boundary.test.js
//
// DATA-1D, T1 — the Auth module's boundary is enforceable, not just
// conventional. Mirrors tests/assets-module-boundary.test.js exactly:
// src/modules/auth/{repository,db,token,credentials}.js are PRIVATE —
// nothing outside src/modules/auth/ may import them, and only
// service.js may import repository.js/db.js.
//
// Invoke: node tests/auth-module-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const MODULE_DIR = path.join(repoRoot, 'src', 'modules', 'auth');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== DATA-1D T1 — Auth module boundary ===\n');

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

const PRIVATE_MODULES = ['repository.js', 'db.js', 'token.js', 'credentials.js'];
const PRIVATE_ABSOLUTE_PATHS = new Set(PRIVATE_MODULES.map((f) => path.join(MODULE_DIR, f)));
const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

let boundaryViolation = null;
let repositoryImporters = new Set();

for (const file of allFiles) {
  const isInsideModule = file.startsWith(MODULE_DIR + path.sep) || file === MODULE_DIR;
  const text = readFileSync(file, 'utf8');
  for (const re of [IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const resolved = path.normalize(path.join(path.dirname(file), spec));
      if (!PRIVATE_ABSOLUTE_PATHS.has(resolved)) continue;
      const priv = path.basename(resolved);
      if (!isInsideModule) {
        boundaryViolation = { file, spec, priv };
      } else if (priv === 'repository.js') {
        repositoryImporters.add(path.basename(file));
      }
    }
  }
}

assertTrue(
  boundaryViolation === null,
  `no file outside src/modules/auth/ imports a private module` +
  (boundaryViolation ? ` (VIOLATION: ${path.relative(repoRoot, boundaryViolation.file)} imports "${boundaryViolation.spec}")` : '')
);

assertTrue(
  repositoryImporters.size === 1 && repositoryImporters.has('service.js'),
  `repository.js is imported by exactly one file (service.js) — actual importers: [${[...repositoryImporters].join(', ')}]`
);

const indexSrc = readFileSync(path.join(MODULE_DIR, 'index.js'), 'utf8');
const REQUIRED_EXPORTS = [
  'login', 'verifyToken',
  'AuthModuleError', 'InvalidCredentialError', 'InvalidTokenError', 'NotProvisionedError',
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
