// live-apply-0017.mjs — D5C live-migration gate dispatch. Applies
// db/data0/0017_d5c_market_population.sql to REAL data1_dev, one
// transaction (this migration is a single cohesive schema domain --
// unlike 0015/0016, there is no second independent rollback domain to
// split from, per M1-M4's own already-ratified boundaries).
//
// N2 fix (GK-191): recovery anchor uses clock_timestamp() directly,
// WITHOUT "AT TIME ZONE 'UTC'" -- verified in this same dispatch that
// the un-converted form round-trips through node-postgres as a genuine
// timestamptz, within normal execution latency of client
// new Date().toISOString(), no ~7-hour offset.

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
console.log('=== D5C LIVE MIGRATION -- 0017 (MarketPopulation) ===\n');
console.log('git HEAD SHA:', gitSha);
console.log('working tree status:', JSON.stringify(treeStatus));

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } });
await client.connect();

const targetCheck = await client.query(`SELECT current_database() AS db`);
console.log('database:', targetCheck.rows[0].db);
const sessionPid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
console.log('pg_backend_pid() (stable throughout):', sessionPid);

async function recoveryAnchor(label) {
  const r = await client.query(`
    SELECT clock_timestamp() AS recovery_anchor, current_database() AS db,
           current_schema() AS schema, pg_backend_pid() AS pid, pg_current_wal_lsn() AS wal_lsn`);
  const clientUtc = new Date().toISOString();
  const row = r.rows[0];
  console.log(`\n-- RECOVERY ANCHOR: ${label} --`);
  console.log('  db_recovery_anchor_utc:', row.recovery_anchor.toISOString());
  console.log('  client_utc:', clientUtc);
  console.log('  database:', row.db, ' schema:', row.schema, ' pid:', row.pid, ' wal_lsn:', row.wal_lsn);
  if (row.pid !== sessionPid) throw new Error(`SAFETY ABORT: backend PID changed mid-script (${sessionPid} -> ${row.pid})`);
  return { dbAnchorUtc: row.recovery_anchor.toISOString(), clientUtc, walLsn: row.wal_lsn };
}

async function census(label) {
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM data1_dev.gk_asset) AS ga,
      (SELECT count(*)::int FROM data1_dev.market_observation) AS mo,
      (SELECT count(*)::int FROM data1_dev.valuation_question) AS vq,
      (SELECT count(*)::int FROM data1_dev.applicability) AS ap,
      (SELECT count(*)::int FROM data1_dev.comp_snapshot) AS cs,
      (SELECT count(*)::int FROM data1_dev.valuation_event) AS ve`);
  const mpExists = await client.query(`SELECT to_regclass('data1_dev.market_population') AS t`);
  const mpmExists = await client.query(`SELECT to_regclass('data1_dev.market_population_member') AS t`);
  console.log(`\n-- CENSUS: ${label} --`);
  console.log('  ', counts.rows[0]);
  console.log('  market_population exists:', mpExists.rows[0].t !== null);
  console.log('  market_population_member exists:', mpmExists.rows[0].t !== null);
  return { ...counts.rows[0], mpExists: mpExists.rows[0].t !== null, mpmExists: mpmExists.rows[0].t !== null };
}

const pre = await census('PRE-FLIGHT');
if (pre.mpExists || pre.mpmExists) throw new Error('SAFETY ABORT: market_population/market_population_member already exist -- refusing, must be a fresh apply');

const anchor = await recoveryAnchor('D5C_RECOVERY_ANCHOR (pre-BEGIN)');
console.log('D5C_RECOVERY_ANCHOR_UTC =', anchor.dbAnchorUtc);

const fwd0017 = readFileSync('db/data0/0017_d5c_market_population.sql', 'utf8');
await client.query('BEGIN');
try {
  await client.query(fwd0017);
  await client.query('COMMIT');
  console.log('0017 transaction COMMITTED.');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('0017 transaction FAILED and was rolled back:', e.message);
  await client.end();
  throw e;
}
const commitUtc = new Date().toISOString();
const postAnchor = await recoveryAnchor('post-COMMIT');
console.log('commit_utc (client) =', commitUtc);

const post = await census('POST-APPLY (FINAL)');
let verified = true;
const checks = [
  ['gk_asset unchanged', post.ga === pre.ga],
  ['market_observation unchanged', post.mo === pre.mo],
  ['valuation_question unchanged', post.vq === pre.vq],
  ['applicability unchanged', post.ap === pre.ap],
  ['comp_snapshot unchanged', post.cs === pre.cs],
  ['valuation_event unchanged', post.ve === pre.ve],
  ['market_population now exists', post.mpExists === true],
  ['market_population_member now exists', post.mpmExists === true],
];
for (const [label, ok] of checks) { console.log(`  verify: ${label} ->`, ok); if (!ok) verified = false; }
if (!verified) { console.error('\nVERIFICATION FAILED after commit.'); await client.end(); throw new Error('0017 applied but FAILED independent verification'); }

console.log('\n**D5C MARKETPOPULATION PHYSICAL SCHEMA LIVE — VERIFIED.**');
console.log('\n=== RECOVERY RECORD SUMMARY ===');
console.log(JSON.stringify({
  gitSha,
  file: '0017_d5c_market_population.sql',
  preAnchorUtc: anchor.dbAnchorUtc, preWalLsn: anchor.walLsn,
  commitUtc, postAnchorUtc: postAnchor.dbAnchorUtc, postWalLsn: postAnchor.walLsn,
  before: pre, after: post,
}, null, 2));

await client.end();
console.log('\n=== LIVE APPLY COMPLETE, connection closed ===');
