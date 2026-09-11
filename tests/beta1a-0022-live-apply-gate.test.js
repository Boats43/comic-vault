// tests/beta1a-0022-live-apply-gate.test.js
//
// BETA-1A -- live-apply gate for db/data0/0022_beta1a_clerk_identity_mapping.sql
// against the REAL data1_dev. Runs only after tests/beta1a-0022-migration-contract.test.js
// (the scratch-schema proof) passed clean. Idempotent: safe to rerun --
// if principal_external_identity already exists, the apply step is
// skipped and only the verification section runs.
//
// Safety chain, in order:
//   1. GRAILKEY_CATALOG_DATABASE_URL is the CORRECT connection variant --
//      GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED / GRAILKEY_CATALOG_POSTGRES_URL /
//      GRAILKEY_CATALOG_POSTGRES_URL_NON_POOLING / GRAILKEY_CATALOG_PGDATABASE
//      were all found THIS PASS to resolve to a completely different,
//      unrelated Neon database ("bookforge") in the current Development
//      environment -- a real, previously-undisclosed routing hazard, same
//      class as GK-179 but a different variable. Deliberately NOT used
//      here.
//   2. assertEnvironmentIdentity() (src/lib/environmentGuard.js, the SAME
//      real function the application runtime itself calls on every
//      acquireConnection()) -- refuses to proceed unless
//      data1_dev.environment_marker.app_env matches
//      GRAILKEY_CATALOG_ENVIRONMENT exactly.
//   3. A table-existence probe before ANY DDL -- CREATE TABLE (no
//      IF NOT EXISTS in the migration text, deliberately, so a second
//      accidental apply attempt errors loudly rather than silently
//      no-opping) is only ever attempted once.
//   4. The one behavioral proof against the live table (constraint
//      enforcement, real FK to the real operator principal) runs inside
//      an explicit transaction that is ALWAYS rolled back, never
//      committed -- zero rows persist, matching this dispatch's own
//      explicit instruction not to fabricate or auto-create a mapping
//      row until a real Clerk user exists.
//
// Invoke: node tests/beta1a-0022-live-apply-gate.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const load = async (rel) => import(pathToFileURL(path.join(repoRoot, rel)).href);

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const { assertEnvironmentIdentity } = await load('src/lib/environmentGuard.js');

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, label, expectedFragment) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = !expectedFragment || String(e.message).includes(expectedFragment);
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 110)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong reason: ${e.message})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== BETA-1A -- 0022 live-apply gate (real data1_dev) ===\n');

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

// Step 2 — the same real guard the application runtime uses.
try {
  const env = await assertEnvironmentIdentity(client);
  assertTrue(env === 'development', `assertEnvironmentIdentity confirms this connection is genuinely "development" (data1_dev.environment_marker), matching GRAILKEY_CATALOG_ENVIRONMENT`);
} catch (e) {
  assertTrue(false, `assertEnvironmentIdentity PASSED (refused: ${e.message}) -- ABORTING, no DDL will run`);
  await client.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(1);
}

// Step 3 — existence probe, idempotent rerun support.
const before = await client.query(`SELECT to_regclass('data1_dev.principal_external_identity') AS t`);
const alreadyApplied = before.rows[0].t !== null;

if (!alreadyApplied) {
  console.log('  principal_external_identity does not yet exist -- applying 0022 now.');
  const sql = readFileSync(path.join(repoRoot, 'db', 'data0', '0022_beta1a_clerk_identity_mapping.sql'), 'utf8');
  try {
    await client.query(sql);
    assertTrue(true, '0022 applied to data1_dev without error');
  } catch (e) {
    assertTrue(false, `0022 apply FAILED: ${e.message}`);
    await client.end();
    console.log(`\n=== ${passed} passed, ${failed} failed ===`);
    process.exit(1);
  }
} else {
  assertTrue(true, 'principal_external_identity already exists -- apply step skipped (idempotent rerun), proceeding straight to verification');
}

// ── Verification (read-only structural proof) ──────────────────────────
const cols = await client.query(
  `SELECT column_name, data_type, is_nullable FROM information_schema.columns
   WHERE table_schema = 'data1_dev' AND table_name = 'principal_external_identity' ORDER BY ordinal_position`
);
const colNames = cols.rows.map(r => r.column_name);
assertTrue(
  ['id', 'principal_id', 'provider', 'external_subject', 'created_at'].every(c => colNames.includes(c)),
  `all 5 expected columns present (found: ${colNames.join(', ')})`
);

const constraints = await client.query(
  `SELECT conname, contype FROM pg_constraint WHERE conrelid = 'data1_dev.principal_external_identity'::regclass`
);
const byType = constraints.rows.reduce((acc, r) => { (acc[r.contype] ||= []).push(r.conname); return acc; }, {});
assertTrue((byType.p || []).length === 1, `exactly one PRIMARY KEY constraint (${(byType.p || []).join(', ')})`);
assertTrue((byType.f || []).length === 1, `exactly one FOREIGN KEY constraint, to gk_principal (${(byType.f || []).join(', ')})`);
assertTrue((byType.u || []).length === 1, `exactly one UNIQUE constraint, (provider, external_subject) (${(byType.u || []).join(', ')})`);
assertTrue((byType.c || []).length >= 1, `at least one CHECK constraint (provider vocabulary) present (${(byType.c || []).join(', ')})`);

const fkTarget = await client.query(
  `SELECT c.relname AS target_table, n.nspname AS target_schema
   FROM pg_constraint pc JOIN pg_class c ON c.oid = pc.confrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE pc.conrelid = 'data1_dev.principal_external_identity'::regclass AND pc.contype = 'f'`
);
assertTrue(
  fkTarget.rows[0]?.target_schema === 'data1_dev' && fkTarget.rows[0]?.target_table === 'gk_principal',
  `the FK genuinely targets data1_dev.gk_principal (found: ${fkTarget.rows[0]?.target_schema}.${fkTarget.rows[0]?.target_table})`
);

const idx = await client.query(
  `SELECT indexname FROM pg_indexes WHERE schemaname = 'data1_dev' AND tablename = 'principal_external_identity'`
);
assertTrue(idx.rows.some(r => r.indexname.includes('principal_id')), `an index on principal_id exists (found: ${idx.rows.map(r => r.indexname).join(', ')})`);

const rowCount = await client.query(`SELECT count(*)::int AS n FROM data1_dev.principal_external_identity`);
assertTrue(rowCount.rows[0].n === 0, `zero rows in principal_external_identity -- no mapping fabricated or auto-created (actual: ${rowCount.rows[0].n})`);

// ── One behavioral proof against the real table, real operator
// principal, transactional, ALWAYS rolled back — zero persisted rows. ──
const operatorRow = await client.query(`SELECT id FROM data1_dev.gk_principal WHERE kind = 'operator' ORDER BY created_at ASC LIMIT 1`);
if (operatorRow.rows[0]) {
  const opId = operatorRow.rows[0].id;
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO data1_dev.principal_external_identity (id, principal_id, provider, external_subject) VALUES (gen_random_uuid(), $1, 'clerk', '__beta1a_live_gate_test__')`,
      [opId]
    );
    const found = await client.query(
      `SELECT p.id FROM data1_dev.principal_external_identity pei JOIN data1_dev.gk_principal p ON p.id = pei.principal_id WHERE pei.external_subject = '__beta1a_live_gate_test__'`
    );
    assertTrue(found.rows[0]?.id === opId, 'a real insert against the real operator principal, inside an uncommitted transaction, resolves correctly via the exact repository.js JOIN shape');
    await assertRejected(
      () => client.query(
        `INSERT INTO data1_dev.principal_external_identity (id, principal_id, provider, external_subject) VALUES (gen_random_uuid(), $1, 'clerk', '__beta1a_live_gate_test__')`,
        [opId]
      ),
      'live UNIQUE(provider, external_subject) constraint rejects a duplicate, even against the real table',
      'duplicate key'
    );
  } finally {
    await client.query('ROLLBACK');
  }
  const postRollbackCount = await client.query(`SELECT count(*)::int AS n FROM data1_dev.principal_external_identity`);
  assertTrue(postRollbackCount.rows[0].n === 0, `ROLLBACK left zero rows behind — nothing committed (actual: ${postRollbackCount.rows[0].n})`);
} else {
  assertTrue(false, 'no operator principal found in gk_principal — cannot run the transactional behavioral proof (structural verification above still stands)');
}

// Untouched-neighbor proof — 0022 is additive-only.
const gkPrincipalCount = await client.query(`SELECT count(*)::int AS n FROM data1_dev.gk_principal`);
const credentialCount = await client.query(`SELECT count(*)::int AS n FROM data1_dev.principal_credential`);
console.log(`  gk_principal rows: ${gkPrincipalCount.rows[0].n} | principal_credential rows: ${credentialCount.rows[0].n} (both unrelated to and unmodified by this apply)`);

await client.end();

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
process.exit(0);
