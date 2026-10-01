// tests/marketplace-module-boundary.test.js
//
// GK-263 — src/modules/marketplace/'s module boundary is enforceable,
// not just conventional, mirroring tests/assets-module-boundary.test.js
// exactly. repository.js, db.js, and crypto.js are PRIVATE: nothing
// outside src/modules/marketplace/ may import them, and only service.js
// may import repository.js/crypto.js.
//
// No DB connection needed — pure static analysis over the tracked
// source tree.
//
// Invoke: node tests/marketplace-module-boundary.test.js

import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const MODULE_DIR = path.join(repoRoot, 'src', 'modules', 'marketplace');

let passed = 0;
let failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-263 — Marketplace module boundary ===\n');

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

const PRIVATE_MODULES = ['repository.js', 'db.js', 'crypto.js'];
const PRIVATE_ABSOLUTE_PATHS = new Set(PRIVATE_MODULES.map((f) => path.join(MODULE_DIR, f)));
const IMPORT_RE = /from\s+['"]([^'"]+)['"]/g;

let boundaryViolation = null;
const repositoryImporters = new Set();
const cryptoImporters = new Set();

for (const file of allFiles) {
  const isInsideModule = file.startsWith(MODULE_DIR + path.sep) || file === MODULE_DIR;
  const text = readFileSync(file, 'utf8');
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(text))) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const resolved = path.normalize(path.join(path.dirname(file), spec));
    if (!PRIVATE_ABSOLUTE_PATHS.has(resolved)) continue;
    const priv = path.basename(resolved);
    if (!isInsideModule) {
      boundaryViolation = { file, spec, priv };
    } else if (priv === 'repository.js') {
      repositoryImporters.add(path.basename(file));
    } else if (priv === 'crypto.js') {
      cryptoImporters.add(path.basename(file));
    }
  }
}

assertTrue(
  boundaryViolation === null,
  'no file outside src/modules/marketplace/ imports a private module' +
  (boundaryViolation ? ` (VIOLATION: ${path.relative(repoRoot, boundaryViolation.file)} imports "${boundaryViolation.spec}")` : '')
);

assertTrue(
  repositoryImporters.size === 1 && repositoryImporters.has('service.js'),
  `repository.js is imported by exactly one file (service.js) — actual importers: [${[...repositoryImporters].join(', ')}]`
);

assertTrue(
  cryptoImporters.size === 1 && cryptoImporters.has('service.js'),
  `crypto.js is imported by exactly one file (service.js) — actual importers: [${[...cryptoImporters].join(', ')}]`
);

// No HTTP handler (api/) imports this module at all in Phase 1 — the
// governing dispatch's own "NO HTTP SURFACE YET" requirement, checked
// mechanically rather than just by review.
// GK-264 Phase 2 wired exactly four authenticated endpoints to this
// module's public surface (index.js only, never repository.js/db.js/
// crypto.js directly — the same private-module check above already
// covers that). GK-269 Lane B adds a fifth, deliberate, eBay-authenticated
// (never GrailKey-session-authenticated) one: ebay-account-deletion.js,
// which calls ONLY findPrincipalByProviderIdentity and
// disconnectMarketplaceConnection — never resolveMarketplaceRefreshCredential,
// never reads credential material. Every OTHER api/ file — critically
// list-ebay.js, delist-ebay.js, and ebay-outcome-reconciler.js, whose
// seller-credential behavior this dispatch is explicitly forbidden from
// touching — must import NOTHING from this module. Checked mechanically,
// not just by review.
const EXPECTED_MARKETPLACE_API_IMPORTERS = new Set([
  'ebay-connect.js', 'ebay-callback.js', 'ebay-connection.js', 'ebay-disconnect.js',
  'ebay-account-deletion.js',
]);
const apiFiles = walk(path.join(repoRoot, 'api'));
const unexpectedApiImporters = [];
const actualApiImporters = new Set();
for (const file of apiFiles) {
  const text = readFileSync(file, 'utf8');
  if (/from\s+['"][^'"]*modules\/marketplace/.test(text)) {
    const base = path.basename(file);
    actualApiImporters.add(base);
    if (!EXPECTED_MARKETPLACE_API_IMPORTERS.has(base)) unexpectedApiImporters.push(file);
  }
}
assertTrue(
  unexpectedApiImporters.length === 0,
  'no api/ file OUTSIDE the four authorized eBay-connect endpoints imports src/modules/marketplace/ (list-ebay.js/delist-ebay.js/ebay-outcome-reconciler.js seller-credential behavior stays untouched)' +
  (unexpectedApiImporters.length ? ` (VIOLATION: ${unexpectedApiImporters.map((f) => path.relative(repoRoot, f)).join(', ')})` : '')
);
for (const expected of EXPECTED_MARKETPLACE_API_IMPORTERS) {
  assertTrue(actualApiImporters.has(expected), `api/${expected} imports src/modules/marketplace/ (expected wiring present)`);
}

const indexSrc = readFileSync(path.join(MODULE_DIR, 'index.js'), 'utf8');
const REQUIRED_EXPORTS = [
  'upsertMarketplaceConnection', 'getMarketplaceConnection', 'resolveMarketplaceRefreshCredential',
  'markMarketplaceReconnectRequired', 'disconnectMarketplaceConnection',
  'MarketplaceModuleError', 'NotFoundError', 'ConflictError', 'ValidationFailedError',
  'AuthorizationFailedError', 'ProviderIdentityConflictError',
];
for (const name of REQUIRED_EXPORTS) {
  assertTrue(indexSrc.includes(name), `index.js re-exports ${name}`);
}

// getMarketplaceConnection must never reference the raw credential
// columns directly in its own source text — a cheap, static guard
// against accidentally serializing secret material into its return
// value in a future edit.
const serviceSrc = readFileSync(path.join(MODULE_DIR, 'service.js'), 'utf8');
const getConnFnMatch = serviceSrc.match(/export async function getMarketplaceConnection[\s\S]*?\n}\n/);
assertTrue(!!getConnFnMatch, 'getMarketplaceConnection function body found in service.js for static inspection');
if (getConnFnMatch) {
  assertTrue(
    !/encrypted_refresh_credential|credential_key_version/.test(getConnFnMatch[0]),
    'getMarketplaceConnection never references raw credential columns in its own source'
  );
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
