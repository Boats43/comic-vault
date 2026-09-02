// tests/d4-identifier-fabric-concurrency.test.js
//
// D4 Phase A -- real two-connection concurrency proof against the ACTUAL
// proposed db/data0/0013_d4_identifier_fabric.sql trigger (read from
// disk, not a hand-built approximation). data1_dev is never touched. No
// migration is applied to any live database by this file.
//
// Required invariant: both committed=false, cycleFormed=false, under a
// real T1:A->B / T2:B->A race at READ COMMITTED. Also proves convergent
// supersession (A,B,C->D) remains legal against the real trigger.
//
// Invoke: node tests/d4-identifier-fabric-concurrency.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

// Session-scoped multi-statement work -- unpooled connection required
// (docs/DATABASE-MIGRATION-STATUS.md, pooled-connection operational note).
const connOpts = { connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } };

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertSucceeds = async (fn, label) => {
  try { await fn(); passed++; console.log(`  ✓ ${label}`); }
  catch (e) { failed++; const m = `  ✗ ${label} (unexpectedly rejected: ${e.message})`; failures.push(m); console.log(m); }
};

console.log('\n=== D4 Phase A -- Identifier Fabric concurrency proof (real 0013 trigger, two real connections) ===\n');

const setup = new Client(connOpts);
await setup.connect();

const isoRow = await setup.query('SHOW transaction_isolation');
console.log('  Session default transaction_isolation:', isoRow.rows[0].transaction_isolation);

async function dataOneDevUntouched() {
  await setup.query('SET search_path TO data1_dev');
  const r = await setup.query(`SELECT to_regclass('data1_dev.asset_identifier_assertion') AS exists`);
  return r.rows[0].exists;
}
console.log('  data1_dev.asset_identifier_assertion exists before (must be null):', await dataOneDevUntouched());

const SCHEMA = `d4_0013_concur_${Date.now()}`;
const fwdRaw = readFileSync(path.join(repoRoot, 'db', 'data0', '0013_d4_identifier_fabric.sql'), 'utf8');

try {
  await setup.query(`CREATE SCHEMA ${SCHEMA}`);
  await setup.query(`SET search_path TO ${SCHEMA}`);
  await setup.query(`CREATE TABLE gk_asset (id UUID PRIMARY KEY); CREATE TABLE gk_principal (id UUID PRIMARY KEY);`);
  const fwd = fwdRaw.replace('SET search_path TO data1_dev;', `SET search_path TO ${SCHEMA};`);
  await assertSucceeds(() => setup.query(fwd), 'real 0013 migration text applied to the concurrency scratch schema');

  const assetId = crypto.randomUUID(), principalId = crypto.randomUUID();
  await setup.query('INSERT INTO gk_asset (id) VALUES ($1)', [assetId]);
  await setup.query('INSERT INTO gk_principal (id) VALUES ($1)', [principalId]);
  const idfId = crypto.randomUUID();
  await setup.query(`INSERT INTO asset_identifier (id, scheme, issuing_authority, normalized_value, scope) VALUES ($1,'isbn','ISBN-agency','9780306406157','PRODUCT_CLASS')`, [idfId]);

  async function insertPair() {
    const a = crypto.randomUUID(), b = crypto.randomUUID();
    await setup.query(
      `INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority)
       VALUES ($1,$3,$5,'t1',$6,'CORROBORATED'),($2,$4,$5,'t2',$6,'CORROBORATED')`,
      [a, b, idfId, idfId, assetId, principalId]
    );
    return { a, b };
  }

  async function runRace(label, { a, b }, timeoutMs = 8000) {
    const c1 = new Client(connOpts), c2 = new Client(connOpts);
    await c1.connect(); await c2.connect();
    await c1.query(`SET search_path TO ${SCHEMA}`);
    await c2.query(`SET search_path TO ${SCHEMA}`);
    await c1.query('BEGIN'); await c2.query('BEGIN');

    console.log(`\n-- ${label} --\n`);
    console.log(`  T1 = UPDATE id=${a.slice(0, 8)} SET superseded_by=${b.slice(0, 8)}`);
    console.log(`  T2 = UPDATE id=${b.slice(0, 8)} SET superseded_by=${a.slice(0, 8)}`);
    console.log('  Firing both concurrently, both before either commits...');

    const withTimeout = (p, ms, tag) => Promise.race([
      p.then(() => ({ ok: true, tag })).catch(e => ({ ok: false, tag, error: e.message, code: e.code })),
      new Promise(res => setTimeout(() => res({ ok: false, tag, error: 'TIMEOUT (blocked)', code: 'TIMEOUT' }), ms)),
    ]);
    const p1 = withTimeout(c1.query('UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2', [b, a]), timeoutMs, 'T1');
    const p2 = withTimeout(c2.query('UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2', [a, b]), timeoutMs, 'T2');
    const [r1, r2] = await Promise.all([p1, p2]);
    console.log('  T1 result:', r1.ok ? 'statement succeeded' : `${r1.error} (code=${r1.code})`);
    console.log('  T2 result:', r2.ok ? 'statement succeeded' : `${r2.error} (code=${r2.code})`);

    const finish = async (client, ok) => {
      if (!ok) { try { await client.query('ROLLBACK'); } catch { } return false; }
      try { await client.query('COMMIT'); return true; } catch { return false; }
    };
    const c1Committed = await finish(c1, r1.ok);
    const c2Committed = await finish(c2, r2.ok);
    console.log('  T1 committed:', c1Committed, '  T2 committed:', c2Committed);
    await c1.end(); await c2.end();

    const finalRows = await setup.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id IN ($1,$2)', [a, b]);
    console.log('  Final rows:', JSON.stringify(finalRows.rows));
    const bothCommitted = c1Committed && c2Committed;
    const cycleFormed = finalRows.rows.every(r => r.superseded_by !== null);
    return { bothCommitted, cycleFormed, r1, r2 };
  }

  const pair = await insertPair();
  const result = await runRace('T1: A->B concurrent with T2: B->A, against the REAL 0013 trigger', pair);

  console.log('\n  RESULT (FACT): bothCommitted =', result.bothCommitted, ' cycleFormed =', result.cycleFormed);
  assertTrue(result.bothCommitted === false, 'required invariant: both transactions committed = false');
  assertTrue(result.cycleFormed === false, 'required invariant: cycle formed = false');
  const outcome = result.r1.code === '40P01' || result.r2.code === '40P01' ? 'PostgreSQL deadlock (40P01)'
    : (result.r1.error === 'TIMEOUT (blocked)' || result.r2.error === 'TIMEOUT (blocked)') ? 'plain block (one side timed out waiting for the row lock)'
    : 'one side rejected for another reason';
  console.log('  Actual mechanism observed this run:', outcome);

  // Convergent supersession must remain legal against the real trigger.
  console.log('\n-- convergent supersession (A,B,C -> D) against the real 0013 trigger --\n');
  const cA = crypto.randomUUID(), cB = crypto.randomUUID(), cC = crypto.randomUUID(), cD = crypto.randomUUID();
  for (const [id, src] of [[cA, 'conv-A'], [cB, 'conv-B'], [cC, 'conv-C'], [cD, 'conv-D']]) {
    await setup.query(
      `INSERT INTO asset_identifier_assertion (id, identifier_id, asset_id, source, recorded_by_principal_id, resolution_authority) VALUES ($1,$2,$3,$4,$5,'CORROBORATED')`,
      [id, idfId, assetId, src, principalId]
    );
  }
  await assertSucceeds(() => setup.query('UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2', [cD, cA]), 'A -> D succeeds');
  await assertSucceeds(() => setup.query('UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2', [cD, cB]), 'B -> D succeeds (convergence)');
  await assertSucceeds(() => setup.query('UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2', [cD, cC]), 'C -> D succeeds (convergence)');
  const dRow = await setup.query('SELECT superseded_by FROM asset_identifier_assertion WHERE id=$1', [cD]);
  assertTrue(dRow.rows[0].superseded_by === null, 'D remains live after 3 rows converge onto it, against the real trigger');

} finally {
  await setup.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  console.log('\n  data1_dev.asset_identifier_assertion exists after (must still be null):', await dataOneDevUntouched());
  await setup.end();
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) { console.log('FAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
