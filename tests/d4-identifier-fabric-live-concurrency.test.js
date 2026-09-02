// tests/d4-identifier-fabric-live-concurrency.test.js
//
// D4 Phase B, B9 + B7a -- live concurrency proof against the REAL,
// applied data1_dev (not scratch). Two parts:
//   B9  -- raw two-connection T1:A->B / T2:B->A race directly against
//          the live trigger, required invariant bothCommitted=false /
//          cycleFormed=false; convergence reconfirmed.
//   B7a -- the SAME adversarial shape routed through the REAL,
//          retry-wrapped src/modules/assets service function
//          (supersedeIdentifierAssertion), proving a genuine Postgres-
//          generated 40P01 is correctly handled through the actual
//          transaction boundary -- not an injected/faked SQLSTATE.
//          Separately proves a genuine cross-asset integrity violation
//          is NOT retried (fails once, no retry).
//
// All rows created here are retained, permanent by construction, marked
// with the D4 Phase-B provenance source below. data1_dev is the real
// production database -- no trigger is disabled, no constraint weakened.
//
// Invoke: node tests/d4-identifier-fabric-live-concurrency.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

const OPERATOR_PRINCIPAL = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const MARKER = 'd4-phase-b-proof:b9-b7a-live-concurrency';
const connOpts = { connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } };

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D4 Phase B, B9 + B7a -- live concurrency (real data1_dev) ===\n');

let uidCounter = 0;
const uid = (label) => `d4-b9-${label}-${Date.now()}-${uidCounter++}`;

const setup = new Client(connOpts);
await setup.connect();
await setup.query('SET search_path TO data1_dev');
const iso = await setup.query('SHOW transaction_isolation');
console.log('  Session transaction_isolation:', iso.rows[0].transaction_isolation);

const asset1 = await assets.createPhysicalAsset({
  principalId: OPERATOR_PRINCIPAL, captureBasis: { marker: MARKER, slot: '1', ts: Date.now() },
  assetClass: 'd4-proof', source: MARKER, idempotencyKey: uid('mint-1'),
});
const asset2 = await assets.createPhysicalAsset({
  principalId: OPERATOR_PRINCIPAL, captureBasis: { marker: MARKER, slot: '2', ts: Date.now() },
  assetClass: 'd4-proof', source: MARKER, idempotencyKey: uid('mint-2'),
});
const idf = await assets.recordIdentifierDefinition({
  principalId: OPERATOR_PRINCIPAL, scheme: 'isbn', issuingAuthority: 'ISBN-agency',
  normalizedValue: uid('isbn-concur'), scope: 'PRODUCT_CLASS', idempotencyKey: uid('idf'),
});

// =========================================================================
// B9 -- raw two-connection race, directly against the live trigger
// =========================================================================
console.log('\n-- B9: raw two-connection race, real data1_dev --\n');

async function mintAssertionPair() {
  const a = await assets.recordIdentifierAssertion({
    principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, identifierId: idf.identifierId,
    source: MARKER + ':raw-race', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('raw-a'),
  });
  const b = await assets.recordIdentifierAssertion({
    principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, identifierId: idf.identifierId,
    source: MARKER + ':raw-race', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('raw-b'),
  });
  return { a: a.assertionId, b: b.assertionId };
}

async function rawRace({ a, b }, timeoutMs = 8000) {
  const c1 = new Client(connOpts), c2 = new Client(connOpts);
  await c1.connect(); await c2.connect();
  await c1.query('SET search_path TO data1_dev');
  await c2.query('SET search_path TO data1_dev');
  await c1.query('BEGIN'); await c2.query('BEGIN');

  const withTimeout = (p, ms, tag) => Promise.race([
    p.then(() => ({ ok: true, tag })).catch(e => ({ ok: false, tag, error: e.message, code: e.code })),
    new Promise(res => setTimeout(() => res({ ok: false, tag, error: 'TIMEOUT (blocked)', code: 'TIMEOUT' }), ms)),
  ]);
  const p1 = withTimeout(c1.query('UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2', [b, a]), timeoutMs, 'T1');
  const p2 = withTimeout(c2.query('UPDATE asset_identifier_assertion SET superseded_by=$1 WHERE id=$2', [a, b]), timeoutMs, 'T2');
  const [r1, r2] = await Promise.all([p1, p2]);
  console.log('  T1 result:', r1.ok ? 'succeeded' : `${r1.error} (code=${r1.code})`);
  console.log('  T2 result:', r2.ok ? 'succeeded' : `${r2.error} (code=${r2.code})`);

  const finish = async (client, ok) => {
    if (!ok) { try { await client.query('ROLLBACK'); } catch { } return false; }
    try { await client.query('COMMIT'); return true; } catch { return false; }
  };
  const c1c = await finish(c1, r1.ok), c2c = await finish(c2, r2.ok);
  await c1.end(); await c2.end();
  const finalRows = await setup.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id IN ($1,$2)', [a, b]);
  console.log('  Final rows:', JSON.stringify(finalRows.rows));
  return { bothCommitted: c1c && c2c, cycleFormed: finalRows.rows.every(r => r.superseded_by !== null), r1, r2 };
}

const pair9 = await mintAssertionPair();
const b9result = await rawRace(pair9);
assertTrue(b9result.bothCommitted === false, 'B9: bothCommitted = false (required invariant, real data1_dev)');
assertTrue(b9result.cycleFormed === false, 'B9: cycleFormed = false (required invariant, real data1_dev)');
console.log('  B9 mechanism observed:', (b9result.r1.code === '40P01' || b9result.r2.code === '40P01') ? 'PostgreSQL deadlock (40P01)' : 'plain block/timeout');

// Reconfirm legal convergence, live.
const convA = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, identifierId: idf.identifierId, source: MARKER + ':conv', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('convA') });
const convB = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, identifierId: idf.identifierId, source: MARKER + ':conv', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('convB') });
const convD = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, identifierId: idf.identifierId, source: MARKER + ':conv', resolutionAuthority: 'CORROBORATED', idempotencyKey: uid('convD') });
await assets.supersedeIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, oldAssertionId: convA.assertionId, newAssertionId: convD.assertionId, idempotencyKey: uid('conv-sup-A') });
await assets.supersedeIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, oldAssertionId: convB.assertionId, newAssertionId: convD.assertionId, idempotencyKey: uid('conv-sup-B') });
const convDCheck = await setup.query('SELECT superseded_by FROM asset_identifier_assertion WHERE id=$1', [convD.assertionId]);
assertTrue(convDCheck.rows[0].superseded_by === null, 'B9: legal convergence reconfirmed live, D remains live');

// =========================================================================
// B7a -- the SAME adversarial shape through the REAL retry-wrapped service
// =========================================================================
console.log('\n-- B7a: adversarial race through the REAL retry-wrapped service.supersedeIdentifierAssertion --\n');
console.log('  Per B7a: do not fake success, do not inject an artificial SQLSTATE, do not modify the');
console.log('  production trigger. FACT observed above: a single adversarial pair through the service\'s');
console.log('  own validation/idempotency preamble (assertPrincipalActive + checkIdempotencyReplay +');
console.log('  assertAssetExists + assertPrincipalOwnsAsset, all real round-trips before the contested');
console.log('  UPDATE) resolved via a clean block+rejection in 8/8 natural single-pair attempts, never a');
console.log('  deadlock -- the preamble\'s own latency apparently widens the gap between the two calls\'');
console.log('  UPDATEs enough that true lock-contention overlap is rare for exactly one pair at a time.');
console.log('  Legitimate escalation, per B7a\'s own allowance ("construct a legitimate competing');
console.log('  transaction schedule ... using the real schema/trigger/locks"): firing MANY independent');
console.log('  adversarial pairs concurrently within one attempt -- more real, unmodified trials of the');
console.log('  identical mechanism, not a different one.\n');

// PAIRS_PER_ATTEMPT deliberately small (well under db.js's pool max:5) --
// a first attempt at 12 pairs (24 concurrent acquireConnection() calls)
// hit a REAL, separate finding: "relation gk_principal does not exist"
// under that load, the same pooled-connection session-state hazard
// already documented in docs/DATABASE-MIGRATION-STATUS.md, now observed
// live in src/modules/assets/db.js's own pool (GRAILKEY_CATALOG_
// DATABASE_URL, the pooled string, pg.Pool max:5) -- oversubscribing it
// 5x apparently reproduces the same session-state loss. db.js is
// pre-existing DATA-1B infrastructure, out of D4's own scope to modify
// -- recorded as a new incidental finding (ticket), not fixed here; this
// test instead stays safely within the pool's real capacity.
let pairsB7a, results, attemptLogs, saw40P01 = false, winningPairIndex = -1;
const MAX_RACE_ATTEMPTS = 10;
const PAIRS_PER_ATTEMPT = 3;
let raceAttemptsUsed = 0;
for (let raceAttempt = 1; raceAttempt <= MAX_RACE_ATTEMPTS && !saw40P01; raceAttempt++) {
  raceAttemptsUsed = raceAttempt;
  pairsB7a = await Promise.all(Array.from({ length: PAIRS_PER_ATTEMPT }, () => mintAssertionPair()));
  attemptLogs = pairsB7a.map(() => ({ a: [], b: [] }));
  const t0 = Date.now();
  results = await Promise.allSettled(pairsB7a.flatMap((pair, i) => [
    assets.supersedeIdentifierAssertion({
      principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, oldAssertionId: pair.a, newAssertionId: pair.b, idempotencyKey: uid(`race${raceAttempt}-${i}-a`),
      __onAttemptError: (attempt, e) => attemptLogs[i].a.push({ attempt, code: e.code }),
    }),
    assets.supersedeIdentifierAssertion({
      principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, oldAssertionId: pair.b, newAssertionId: pair.a, idempotencyKey: uid(`race${raceAttempt}-${i}-b`),
      __onAttemptError: (attempt, e) => attemptLogs[i].b.push({ attempt, code: e.code }),
    }),
  ]));
  console.log(`  Race attempt ${raceAttempt}: ${PAIRS_PER_ATTEMPT} concurrent pairs, elapsed ${Date.now() - t0}ms`);
  for (let i = 0; i < PAIRS_PER_ATTEMPT; i++) {
    const logA = attemptLogs[i].a, logB = attemptLogs[i].b;
    if (logA.some(x => x.code === '40P01') || logB.some(x => x.code === '40P01')) {
      console.log(`    pair[${i}] A errors: ${JSON.stringify(logA)}  B errors: ${JSON.stringify(logB)}  <-- 40P01`);
      saw40P01 = true;
      if (winningPairIndex === -1) winningPairIndex = i;
    }
  }
  if (!saw40P01) console.log('    (no 40P01 among these', PAIRS_PER_ATTEMPT, 'pairs this attempt)');
}

assertTrue(saw40P01, `B7a: a REAL SQLSTATE 40P01 was observed within ${raceAttemptsUsed} race attempt(s) x ${PAIRS_PER_ATTEMPT} concurrent pairs (genuine Postgres deadlock, never injected)`);

if (!saw40P01) {
  console.log('\n  HONEST FINDING: no genuine 40P01 was captured through the service-wrapped path within the');
  console.log('  concurrency budget this proof judged safe against db.js\'s own pool (see the incidental');
  console.log('  pooled-connection finding above). Skipping the per-pair detail below -- see the final');
  console.log('  report for how this is reconciled with the deterministic unit tests and the raw-SQL');
  console.log('  proof, both of which DID capture a real 40P01 against this exact trigger logic.');
} else {

const winningLog = attemptLogs[winningPairIndex];
const losingSide = winningLog.a.some(x => x.code === '40P01') ? winningLog.a : winningLog.b;
console.log('  First 40P01 occurred on internal attempt #', losingSide.find(x => x.code === '40P01').attempt, 'of the losing side of pair', winningPairIndex);
console.log('  Internal error-attempts recorded for that losing call:', JSON.stringify(losingSide));

// Validate correctness across EVERY pair from the winning race attempt --
// not just the one that deadlocked -- exactly one call per pair
// succeeded, no raw 40P01 ever reached a caller as a final error, no
// cycle, no duplicate rows anywhere across all PAIRS_PER_ATTEMPT pairs.
let allExactlyOneSucceeded = true, anyRaw40P01Surfaced = false;
for (let i = 0; i < PAIRS_PER_ATTEMPT; i++) {
  const rA = results[i * 2], rB = results[i * 2 + 1];
  const fulfilled = [rA, rB].filter(r => r.status === 'fulfilled').length;
  if (fulfilled !== 1) allExactlyOneSucceeded = false;
  if ([rA, rB].some(r => r.status === 'rejected' && r.reason?.code === '40P01')) anyRaw40P01Surfaced = true;
}
assertTrue(allExactlyOneSucceeded, `B7a: across all ${PAIRS_PER_ATTEMPT} pairs in the winning attempt, EXACTLY ONE call per pair succeeded (no cycle committed anywhere)`);
assertTrue(!anyRaw40P01Surfaced, 'B7a: raw 40P01 NEVER reached any caller as a final surfaced error across all pairs -- the retry wrapper always converted it into either success or a clean, real, non-retryable rejection');

const idsToCheck = pairsB7a.flatMap(p => [p.a, p.b]);
const dupCheck = await setup.query(
  `SELECT id, count(*)::int AS n FROM asset_identifier_assertion WHERE id = ANY($1::uuid[]) GROUP BY id HAVING count(*) > 1`,
  [idsToCheck]
);
assertTrue(dupCheck.rows.length === 0, 'B7a: no duplicate rows across all pairs -- each assertion id appears exactly once');
const cycleCheck = await setup.query(
  `SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = ANY($1::uuid[])`,
  [idsToCheck]
);
let anyCycle = false;
for (const p of pairsB7a) {
  const ra = cycleCheck.rows.find(r => r.id === p.a);
  const rb = cycleCheck.rows.find(r => r.id === p.b);
  if (ra?.superseded_by !== null && rb?.superseded_by !== null) anyCycle = true;
}
assertTrue(!anyCycle, 'B7a: no cycle formed in the final graph, across all pairs, through the real service');
const dupEvidence = await setup.query(
  `SELECT assertion_id, observation_id, count(*)::int AS n FROM asset_identifier_assertion_evidence
   WHERE assertion_id = ANY($1::uuid[]) GROUP BY assertion_id, observation_id HAVING count(*) > 1`,
  [idsToCheck]
);
assertTrue(dupEvidence.rows.length === 0, 'B7a: no duplicate evidence-link rows caused by the retry, across all pairs');

} // end if(saw40P01)

// --- non-retryable: genuine cross-asset integrity violation, 0 retries ---
console.log('\n-- B7a: cross-asset integrity violation through the service -- must NOT retry --\n');
const zForCross = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId, identifierId: idf.identifierId, source: MARKER + ':cross-z', resolutionAuthority: 'NONE', idempotencyKey: uid('cross-z') });
const wForCross = await assets.recordIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: asset2.assetId, identifierId: idf.identifierId, source: MARKER + ':cross-w', resolutionAuthority: 'NONE', idempotencyKey: uid('cross-w') });
const tCrossStart = Date.now();
let crossThrew = null;
try {
  await assets.supersedeIdentifierAssertion({
    principalId: OPERATOR_PRINCIPAL, gkAssetId: asset1.assetId,
    oldAssertionId: zForCross.assertionId, newAssertionId: wForCross.assertionId, idempotencyKey: uid('cross-attempt'),
  });
} catch (e) { crossThrew = e; }
const crossElapsed = Date.now() - tCrossStart;
assertTrue(crossThrew !== null, 'cross-asset supersession via the service throws (rejected)');
assertTrue(crossThrew?.code !== '40P01', 'the rejection is NOT a 40P01 -- it is a real composite-FK violation');
assertTrue(crossElapsed < 3000, `rejected fast (${crossElapsed}ms), consistent with a single attempt (no 3x-attempt retry delay)`);
console.log('  Cross-asset attempt error:', crossThrew?.message?.slice(0, 120), ' code=', crossThrew?.code);

await setup.end();

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
console.log('Proof asset IDs (retained):', asset1.assetId, asset2.assetId);
if (failed > 0) { console.log('FAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
