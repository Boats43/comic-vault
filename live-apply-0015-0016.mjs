// live-apply-0015-0016.mjs — D5B live-apply gate dispatch, X1/X2/X3
// amendment. Applies db/data0/0015_d1_identity_assignment_immutability
// .sql and db/data0/0016_d5b_valuation_question_applicability.sql to
// REAL data1_dev, as two fully independent transactions (X2A), each
// with its own pre-transaction recovery anchor (X2C) and its own
// verification gate before the next stage is even attempted. A failure
// verifying 0015 stops before 0016 is ever touched.
//
// No DB-side migration-ledger table exists in this repo (verified:
// grepped db/data0/*.sql and docs/ for migration_history/
// schema_migrations/migration_ledger, zero hits) -- X2B's "ledger" is
// satisfied here via direct schema-object-existence checks (this
// repo's actual, established mechanism -- docs/DATABASE-MIGRATION-
// STATUS.md already tracks "applied" status this same way), captured
// independently before/after each stage.

import { Client } from 'pg';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const envRaw = readFileSync('.env.development.local', 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

const gitSha = execSync('git rev-parse HEAD').toString().trim();
const treeStatus = execSync('git status --short').toString();
console.log('=== D5B LIVE MIGRATION -- 0015 (D1 repair) then 0016 (D5B ValuationQuestion+Applicability), independent transactions ===\n');
console.log('git HEAD SHA:', gitSha);
console.log('working tree status (should show nothing for this script once committed):', JSON.stringify(treeStatus));

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();

const targetCheck = await client.query(`SELECT current_database() AS db`);
console.log('database:', targetCheck.rows[0].db);
const sessionPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
console.log('pg_backend_pid() (this session, stable throughout):', sessionPid);

async function recoveryAnchor(label) {
  const r = await client.query(`
    SELECT clock_timestamp() AT TIME ZONE 'UTC' AS recovery_anchor_utc,
           current_database() AS db, current_schema() AS schema,
           pg_backend_pid() AS pid, pg_current_wal_lsn() AS wal_lsn`);
  const clientUtc = new Date().toISOString();
  const row = r.rows[0];
  console.log(`\n-- RECOVERY ANCHOR: ${label} --`);
  console.log('  db_recovery_anchor_utc:', row.recovery_anchor_utc.toISOString());
  console.log('  client_utc:', clientUtc);
  console.log('  database:', row.db, ' schema:', row.schema, ' pid:', row.pid, ' wal_lsn:', row.wal_lsn);
  if (row.pid !== sessionPid) throw new Error(`SAFETY ABORT: backend PID changed mid-script (${sessionPid} -> ${row.pid})`);
  if (row.db !== 'neondb' && row.schema === 'data1_dev') { /* schema explicitly confirmed below regardless of db name */ }
  return { dbAnchorUtc: row.recovery_anchor_utc.toISOString(), clientUtc, walLsn: row.wal_lsn, db: row.db, schema: row.schema, pid: row.pid };
}

async function census(label) {
  const aia = await client.query('SELECT count(*)::int AS n FROM data1_dev.asset_identity_assignment');
  const mo = await client.query('SELECT count(*)::int AS n FROM data1_dev.market_observation');
  const ga = await client.query('SELECT count(*)::int AS n FROM data1_dev.gk_asset');
  const trigs = await client.query(`
    SELECT tgname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'data1_dev' AND c.relname = 'asset_identity_assignment' AND NOT t.tgisinternal ORDER BY tgname`);
  const uk = await client.query(`SELECT 1 FROM pg_constraint WHERE conrelid='data1_dev.asset_identity_assignment'::regclass AND conname='asset_identity_assignment_id_asset_uk'`);
  const vq = await client.query(`SELECT to_regclass('data1_dev.valuation_question') AS t`);
  const app = await client.query(`SELECT to_regclass('data1_dev.applicability') AS t`);
  console.log(`\n-- CENSUS: ${label} --`);
  console.log('  asset_identity_assignment rows:', aia.rows[0].n);
  console.log('  market_observation rows:', mo.rows[0].n);
  console.log('  gk_asset rows:', ga.rows[0].n);
  console.log('  asset_identity_assignment triggers:', trigs.rows.map(r => r.tgname));
  console.log('  asset_identity_assignment_id_asset_uk exists:', uk.rows.length === 1);
  console.log('  valuation_question exists:', vq.rows[0].t !== null);
  console.log('  applicability exists:', app.rows[0].t !== null);
  return {
    aia: aia.rows[0].n, mo: mo.rows[0].n, ga: ga.rows[0].n,
    trigCount: trigs.rows.length, ukExists: uk.rows.length === 1,
    vqExists: vq.rows[0].t !== null, appExists: app.rows[0].t !== null,
  };
}

// =====================================================================
// PRE-FLIGHT (before either migration)
// =====================================================================
const preAll = await census('PRE-FLIGHT (before D1)');
if (preAll.trigCount !== 0) throw new Error('SAFETY ABORT: asset_identity_assignment already has triggers -- refusing, must be a fresh apply');
if (preAll.ukExists) throw new Error('SAFETY ABORT: asset_identity_assignment_id_asset_uk already exists -- refusing');
if (preAll.vqExists || preAll.appExists) throw new Error('SAFETY ABORT: valuation_question or applicability already exist -- refusing');
console.log(`\n  D1 "ledger" state pre-apply: NOT present (0 triggers, no UK constraint) -- confirmed above.`);
console.log(`  D5B "ledger" state pre-apply: NOT present (valuation_question/applicability absent) -- confirmed above.`);

// =====================================================================
// STAGE 1 -- D1 repair, own transaction
// =====================================================================
console.log('\n\n========== STAGE 1: D1 (0015) ==========');
const d1Anchor = await recoveryAnchor('D1_RECOVERY_ANCHOR (pre-BEGIN)');
console.log('D1_RECOVERY_ANCHOR_UTC =', d1Anchor.dbAnchorUtc);

const fwd0015 = readFileSync('db/data0/0015_d1_identity_assignment_immutability.sql', 'utf8');
await client.query('BEGIN');
try {
  await client.query(fwd0015);
  await client.query('COMMIT');
  console.log('D1 (0015) transaction COMMITTED.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('D1 (0015) transaction FAILED and was rolled back:', e.message);
  await client.end();
  throw e;
}
const d1CommitUtc = new Date().toISOString();
const d1PostAnchor = await recoveryAnchor('D1 post-COMMIT');
console.log('D1 commit_utc (client) =', d1CommitUtc);

// Independent verification -- D1 ledger state, row counts, structure.
const postD1 = await census('POST-D1 (before D5B is even attempted)');
let d1Verified = true;
const d1Checks = [
  ['row count unchanged', postD1.aia === preAll.aia],
  ['exactly 2 triggers now exist', postD1.trigCount === 2],
  ['UK constraint now exists', postD1.ukExists === true],
  ['D5B objects still absent (D1 ledger entry is independent of D5B)', postD1.vqExists === false && postD1.appExists === false],
];
for (const [label, ok] of d1Checks) { console.log(`  D1 verify: ${label} ->`, ok); if (!ok) d1Verified = false; }

if (!d1Verified) {
  console.error('\nD1 VERIFICATION FAILED. STOPPING. D5B will NOT be applied.');
  await client.end();
  throw new Error('D1 IMMUTABILITY REPAIR: applied but FAILED independent verification -- STOP, D5B not attempted');
}

// Compatibility spot-check: the one live write pattern must still work
// and prohibited mutations must still be rejected, against REAL data1_dev.
const probeAssetCheck = await client.query(`SELECT id FROM data1_dev.asset_identity_assignment WHERE superseded_by IS NULL LIMIT 1`);
if (probeAssetCheck.rows.length > 0) {
  const probeRowId = probeAssetCheck.rows[0].id;
  let updateRejected = false;
  try {
    await client.query(`UPDATE data1_dev.asset_identity_assignment SET authority = authority WHERE id = $1`, [probeRowId]);
  } catch (e) {
    updateRejected = /only superseded_by|must set superseded_by/.test(e.message);
  }
  console.log('  D1 live spot-check: a real UPDATE attempt against a real live row is rejected ->', updateRejected);
  if (!updateRejected) { await client.end(); throw new Error('D1 IMMUTABILITY REPAIR: live spot-check FAILED -- an UPDATE against a real row was not rejected'); }
}

console.log('\n**D1 IMMUTABILITY REPAIR LIVE — VERIFIED.**');

// =====================================================================
// STAGE 2 -- D5B (0016), own transaction, only after D1 independently verified
// =====================================================================
console.log('\n\n========== STAGE 2: D5B (0016) ==========');
const d5bAnchor = await recoveryAnchor('D5B_RECOVERY_ANCHOR (pre-BEGIN)');
console.log('D5B_RECOVERY_ANCHOR_UTC =', d5bAnchor.dbAnchorUtc);

const fwd0016 = readFileSync('db/data0/0016_d5b_valuation_question_applicability.sql', 'utf8');
await client.query('BEGIN');
try {
  await client.query(fwd0016);
  await client.query('COMMIT');
  console.log('D5B (0016) transaction COMMITTED.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('D5B (0016) transaction FAILED and was rolled back. D1 remains committed and untouched:', e.message);
  await client.end();
  throw e;
}
const d5bCommitUtc = new Date().toISOString();
const d5bPostAnchor = await recoveryAnchor('D5B post-COMMIT');
console.log('D5B commit_utc (client) =', d5bCommitUtc);

const postD5B = await census('POST-D5B (FINAL)');
let d5bVerified = true;
const d5bChecks = [
  ['asset_identity_assignment row count unchanged from pre-flight', postD5B.aia === preAll.aia],
  ['market_observation row count unchanged', postD5B.mo === preAll.mo],
  ['gk_asset row count unchanged', postD5B.ga === preAll.ga],
  ['D1 objects still present (D1 ledger entry remains after D5B)', postD5B.trigCount === 2 && postD5B.ukExists === true],
  ['valuation_question now exists', postD5B.vqExists === true],
  ['applicability now exists', postD5B.appExists === true],
];
for (const [label, ok] of d5bChecks) { console.log(`  D5B verify: ${label} ->`, ok); if (!ok) d5bVerified = false; }

if (!d5bVerified) {
  console.error('\nD5B VERIFICATION FAILED after commit.');
  await client.end();
  throw new Error('D5B: applied but FAILED independent verification -- see PA checks needed');
}

console.log('\n**D5B PHYSICAL SCHEMA LIVE — VERIFIED.**');

console.log('\n\n=== RECOVERY RECORD SUMMARY ===');
console.log(JSON.stringify({
  gitSha,
  D1: { file: '0015_d1_identity_assignment_immutability.sql', preAnchorUtc: d1Anchor.dbAnchorUtc, preWalLsn: d1Anchor.walLsn, commitUtc: d1CommitUtc, postAnchorUtc: d1PostAnchor.dbAnchorUtc, postWalLsn: d1PostAnchor.walLsn, beforeAia: preAll.aia, afterAia: postD1.aia },
  D5B: { file: '0016_d5b_valuation_question_applicability.sql', preAnchorUtc: d5bAnchor.dbAnchorUtc, preWalLsn: d5bAnchor.walLsn, commitUtc: d5bCommitUtc, postAnchorUtc: d5bPostAnchor.dbAnchorUtc, postWalLsn: d5bPostAnchor.walLsn, beforeMo: preAll.mo, afterMo: postD5B.mo, beforeGa: preAll.ga, afterGa: postD5B.ga },
}, null, 2));

await client.end();
console.log('\n=== LIVE APPLY COMPLETE, connection closed ===');
