// tests/gk178-pooled-session-state.test.js
//
// GK-178 — pooled-connection session-state hazard, CLOSED. `db.js`'s
// connection string (both src/modules/assets/ and src/modules/auth/)
// resolves to a Neon PgBouncer transaction-pooling endpoint, which does
// not guarantee that a `SET search_path` issued as its own statement at
// connection-acquire time survives to any later statement on the "same"
// pg.Pool client — proven with real pg_backend_pid() drift mid-operation
// and real 42P01 "relation does not exist" errors, reproducible at 3
// concurrent operations (docs/DATABASE-MIGRATION-STATUS.md, "GK-178").
//
// Fix: eliminate the session-state dependence entirely (not pin it to a
// transaction boundary) — every table reference in repository.js/
// idempotency.js/service.js (both modules) is now schema-qualified
// (data1_dev.<table>), and acquireConnection() no longer issues SET
// search_path at all. `uuidv7()`/`now()` are native pg_catalog functions,
// always resolvable regardless of search_path — correctly left bare.
//
// This test proves BOTH halves:
//   Part 1 — static source-text checks (deterministic, no DB) that no
//            bare table reference or SET search_path has crept back in,
//            so a future edit that reintroduces either is caught here
//            mechanically, not just documented as a rule to remember.
//   Part 2 — real live concurrency proof, through the REAL public
//            surface of both modules (never a reimplementation), at the
//            exact N=3 concurrency that reproduced the defect pre-fix.
//            Read-only calls only (listMyAssets, and login with a
//            deliberately WRONG passphrase) — no permanent rows written,
//            safe to rerun indefinitely.
//
// Invoke: node tests/gk178-pooled-session-state.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== GK-178 — pooled-connection session-state hazard, closed ===\n');

// ── Part 1 — static source-text checks ──────────────────────────────
console.log('-- Part 1: static source-text checks --\n');

const readSrc = (rel) => readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

const CHECKED_FILES = [
  'src/modules/assets/repository.js',
  'src/modules/assets/idempotency.js',
  'src/modules/assets/service.js',
  'src/modules/auth/repository.js',
];

for (const rel of CHECKED_FILES) {
  const src = readSrc(rel);
  // Strip line comments before scanning, so prose like "gk_asset ${id}
  // does not exist" or "an UPDATE lock" in a comment never produces a
  // false failure here — only real SQL statement text is checked.
  const codeOnly = src
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  const bareRefs = [...codeOnly.matchAll(/\b(FROM|INTO|UPDATE|JOIN)\s+([a-z_][a-z0-9_]*)/g)]
    .filter(([, , table]) => !['data1_dev'].includes(table))
    .map(([whole]) => whole);
  assertTrue(bareRefs.length === 0, `${rel} — zero bare (unqualified) table references (found: ${JSON.stringify(bareRefs)})`);
}

for (const rel of ['src/modules/assets/db.js', 'src/modules/auth/db.js']) {
  const src = readSrc(rel);
  const codeOnly = src.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  assertTrue(!codeOnly.includes('SET search_path'), `${rel} — acquireConnection() no longer issues SET search_path`);
}

// ── Part 2 — real live concurrency proof, real public surface ───────
console.log('\n-- Part 2: real live concurrency, N=3, through the real public surface --\n');

const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const auth = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'index.js')).href);

const OPERATOR_PRINCIPAL = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const N = 3;
const ROUNDS = 8;

// assets.listMyAssets — the exact pre-fix-vulnerable pattern
// (assertPrincipalActive, then repo.listAssetsByOwner, both bare SELECTs
// outside any transaction). A relation-does-not-exist error here would
// surface as an unexpected thrown error, not the normal array result.
let assetsFail = 0, assetsOps = 0;
for (let r = 0; r < ROUNDS; r++) {
  const results = await Promise.allSettled(
    Array.from({ length: N }, () => assets.listMyAssets({ principalId: OPERATOR_PRINCIPAL }))
  );
  assetsOps += N;
  for (const res of results) {
    if (res.status === 'rejected') {
      assetsFail++;
      console.log(`    round ${r} listMyAssets REJECTED:`, res.reason?.code, res.reason?.message);
    } else if (!Array.isArray(res.value)) {
      assetsFail++;
      console.log(`    round ${r} listMyAssets returned non-array:`, res.value);
    }
  }
}
assertTrue(assetsFail === 0, `assets.listMyAssets — ${assetsOps} real concurrent calls (N=${N} x ${ROUNDS} rounds), 0 session-state failures`);

// auth.login — deliberately WRONG passphrase. Exercises the exact
// pre-fix-vulnerable pattern (getOperatorPrincipal, then getCredential,
// both bare SELECTs outside any transaction) WITHOUT needing the real
// credential: a session-state failure surfaces as a raw pg error
// (wrong .name / a 42P01 .code), never the expected, well-formed
// InvalidCredentialError -- so this proves the fix without ever
// touching the real passphrase (Secret Hygiene, CLAUDE.md).
let authFail = 0, authOps = 0;
for (let r = 0; r < ROUNDS; r++) {
  const results = await Promise.allSettled(
    Array.from({ length: N }, () => auth.login({ passphrase: 'gk178-deliberately-wrong-probe' }))
  );
  authOps += N;
  for (const res of results) {
    const isExpectedRejection = res.status === 'rejected' && res.reason instanceof auth.InvalidCredentialError;
    if (!isExpectedRejection) {
      authFail++;
      console.log(`    round ${r} login unexpected outcome:`, res.status, res.reason?.code || res.reason?.name, res.reason?.message);
    }
  }
}
assertTrue(authFail === 0, `auth.login (deliberately wrong passphrase) — ${authOps} real concurrent calls (N=${N} x ${ROUNDS} rounds), every rejection is a well-formed InvalidCredentialError, never a raw pg session-state error`);

await assets.closePool();
await auth.closePool();

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
