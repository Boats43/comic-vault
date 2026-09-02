// tests/d4-identifier-fabric-live-retry-deterministic.test.js
//
// D4 Phase B, B7a FINAL deterministic closure (F1-F5). Not a
// probabilistic race -- an explicitly constructed PostgreSQL lock cycle
// against real data1_dev, using a helper connection to force the exact
// wait-for graph a genuine deadlock requires, then observing that the
// REAL supersedeIdentifierAssertion service transaction is the one that
// receives PostgreSQL's own SQLSTATE 40P01, is retried through the real
// retry helper, and succeeds once the competing lock is released.
//
// No SQLSTATE injection. No fake repository. No trigger/constraint
// modification. 0013 unedited. Reuses two EXISTING live D4 proof
// assertions (no new large population).
//
// Invoke: node tests/d4-identifier-fabric-live-retry-deterministic.test.js

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
const connOpts = { connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } };

// F1: reuse two EXISTING live D4 proof assertions, same asset. Chosen
// from the already-retained b7a-closure-3cycle population.
const ASSET_ID = '01a063ec-9679-789b-89b7-de362f23cbdf';
const A = '01a063ec-ee90-7bd0-a3b2-92f4c1ad8884';
const B = '01a063ec-f089-713b-a50e-70f35b062005';

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D4 Phase B, B7a FINAL deterministic closure (real PostgreSQL lock cycle) ===\n');
console.log('  Asset:', ASSET_ID, '  A(source)=', A, '  B(target)=', B);

const observer = new Client(connOpts);
await observer.connect();
await observer.query('SET search_path TO data1_dev');

// Pre-flight: confirm A and B are actually live right now, and reachable.
const pre = await observer.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = ANY($1::uuid[])', [[A, B]]);
console.log('  Pre-flight state:', JSON.stringify(pre.rows));
const preLive = pre.rows.every(r => r.superseded_by === null);
assertTrue(preLive, 'F1 pre-flight: both A and B are currently live (superseded_by IS NULL)');
if (!preLive) { console.log('ABORT: chosen rows are not both live.'); process.exit(1); }

const dbDefaultTimeout = await observer.query('SHOW deadlock_timeout');
console.log('  Database default deadlock_timeout:', dbDefaultTimeout.rows[0].deadlock_timeout);

// --- Helper connection H ---
const h = new Client(connOpts);
await h.connect();
await h.query('SET search_path TO data1_dev');
const hPidRow = await h.query('SELECT pg_backend_pid() AS pid');
const hPid = hPidRow.rows[0].pid;
console.log('  Helper H backend pid:', hPid);

await h.query('BEGIN');
// FACT, discovered live: Neon (managed Postgres) does not permit
// SET LOCAL deadlock_timeout -- it is a superuser-only GUC on this
// platform ("permission denied to set parameter"). Both connections
// therefore run at the real database default (1s, confirmed above).
// Falling back to the other legitimate coordination technique already
// planned: S is made to start WAITING on B well before H's second
// request closes the cycle (confirmed via the observer poll below) --
// since each backend's deadlock-detection timer is armed independently
// from the moment IT starts waiting, not from a shared clock, S's
// timer still fires first because its wait began first, achieving the
// same intended outcome without a GUC override.
let hTimeoutRow;
try {
  await h.query("SET LOCAL deadlock_timeout = '10s'");
  hTimeoutRow = await h.query('SHOW deadlock_timeout');
} catch (e) {
  console.log('  SET LOCAL deadlock_timeout REJECTED (real Neon constraint):', e.message, ' code=', e.code);
  hTimeoutRow = { rows: [{ deadlock_timeout: '1s (default, override rejected -- see above)' }] };
  // A failed statement aborts the transaction block on Postgres -- must
  // ROLLBACK and re-BEGIN to get a clean, usable transaction before the
  // real FOR UPDATE work below.
  await h.query('ROLLBACK');
  await h.query('BEGIN');
}
console.log('  Helper H effective deadlock_timeout:', hTimeoutRow.rows[0].deadlock_timeout);

const tHLockBStart = Date.now();
await h.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = $1 FOR UPDATE', [B]);
console.log(`  H acquired FOR UPDATE on B at +${Date.now() - tHLockBStart}ms -- H now owns B.`);

// --- Real service transaction S ---
const sAttemptLog = [];
const tSStart = Date.now();
const idemKey = `d4-b7a-deterministic-${Date.now()}`;
const sPromise = assets.supersedeIdentifierAssertion({
  principalId: OPERATOR_PRINCIPAL, gkAssetId: ASSET_ID, oldAssertionId: A, newAssertionId: B,
  idempotencyKey: idemKey,
  __onAttemptError: (attempt, e) => sAttemptLog.push({ attempt, code: e.code, message: e.message, t: Date.now() - tSStart }),
});
console.log('  S (real supersedeIdentifierAssertion(A->B)) fired, not yet awaited.');

// --- Observer: confirm S is blocked behind H before proceeding ---
const blockingQuery = `
  SELECT blocked_locks.pid AS blocked_pid, blocked_activity.query AS blocked_query,
         blocking_locks.pid AS blocking_pid, blocking_activity.query AS blocking_query
  FROM pg_catalog.pg_locks blocked_locks
  JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
  JOIN pg_catalog.pg_locks blocking_locks ON blocking_locks.locktype = blocked_locks.locktype
    AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
    AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
    AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
    AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
    AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
    AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
    AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
    AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
    AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
    AND blocking_locks.pid != blocked_locks.pid
  JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
  WHERE NOT blocked_locks.granted AND blocking_locks.pid = $1
`;
let sConfirmedWaiting = false;
let observedLockGraphBeforeCycle = null;
const tWaitForConfirm = Date.now();
for (let i = 0; i < 100 && !sConfirmedWaiting; i++) {
  const r = await observer.query(blockingQuery, [hPid]);
  if (r.rows.length > 0) {
    sConfirmedWaiting = true;
    observedLockGraphBeforeCycle = r.rows;
  } else {
    await new Promise(res => setTimeout(res, 30));
  }
}
console.log(`  Observer confirmed S blocked behind H after ${Date.now() - tWaitForConfirm}ms:`, sConfirmedWaiting);
if (observedLockGraphBeforeCycle) console.log('  Lock graph (S waiting on H):', JSON.stringify(observedLockGraphBeforeCycle));
assertTrue(sConfirmedWaiting, 'F1: observer confirms S is blocked, waiting on a lock held by H, before closing the cycle');

if (!sConfirmedWaiting) {
  console.log('S never entered a waiting state behind H -- aborting this attempt, rolling back H.');
  await h.query('ROLLBACK');
  await sPromise.catch(() => {});
  await observer.end(); await h.end();
  process.exit(1);
}

// --- F2: close the wait-for cycle ---
const tHLockAStart = Date.now();
const hSecondLockPromise = h.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = $1 FOR UPDATE', [A]);
console.log('  H fired FOR UPDATE on A -- wait-for cycle now closed: S holds A waits B; H holds B waits A.');

// Snapshot the closed-cycle lock graph briefly after issuing H's request.
await new Promise(res => setTimeout(res, 100));
const cycleSnapshot = await observer.query(`
  SELECT pid, locktype, relation::regclass AS rel, granted, mode
  FROM pg_locks WHERE pid IN (
    SELECT pid FROM pg_stat_activity WHERE query LIKE '%asset_identifier_assertion%' AND pid != pg_backend_pid()
  ) ORDER BY pid
`);
console.log('  Lock snapshot after cycle closed:', JSON.stringify(cycleSnapshot.rows));

// --- F3/F3a: wait for S's first-attempt outcome ---
// IMPORTANT: S's error notification (over S's own pooled connection)
// and H's success/error notification (over H's own connection) are two
// INDEPENDENT network round-trips with no guaranteed client-side
// delivery ordering, even though one is the causal RESULT of the other
// at the database level (whichever backend Postgres aborts releases its
// lock, letting the other proceed -- but Node's event loop can process
// the "winner" notification before the "loser" notification finishes
// being handled). A naive Promise.race on the very first settled
// promise can therefore observe the correct database-level outcome
// (e.g. H's lock request succeeding) before sAttemptLog has actually
// been populated by S's own catch handler, even though S's abort is
// what caused it. Waiting for a short grace period after the first
// signal resolves the ambiguity honestly rather than mis-reporting it.
const hOutcome = await hSecondLockPromise.then(() => ({ kind: 'H_GOT_A' })).catch(e => ({ kind: 'H_ERROR', code: e.code, message: e.message }));
console.log('  H second-lock-request outcome:', JSON.stringify(hOutcome));

// Give S's own async error-handling chain (network round-trip + catch +
// onAttemptError callback) a real chance to complete, since it is a
// causally-related but independently-delivered notification.
for (let i = 0; i < 50 && sAttemptLog.length === 0; i++) {
  await new Promise(res => setTimeout(res, 50));
}
console.log(`  Grace-period check complete -- sAttemptLog length: ${sAttemptLog.length}`);

let victim = null;
if (sAttemptLog.some(a => a.code === '40P01')) victim = 'S';
if (hOutcome.kind === 'H_ERROR' && hOutcome.code === '40P01') victim = 'H';

console.log('  S internal attempt-error log:', JSON.stringify(sAttemptLog));
console.log('  Victim (backend that received 40P01):', victim);

assertTrue(victim === 'S', `F3a REQUIRED: the real service transaction S received PostgreSQL SQLSTATE 40P01 (observed victim: ${victim})`);

if (victim !== 'S') {
  console.log('\n  H was selected as victim instead (or neither yet) -- reporting evidence, not rerunning random batches per instruction.');
  console.log('  Full sAttemptLog:', JSON.stringify(sAttemptLog));
  try { await h.query('ROLLBACK'); } catch {}
  await sPromise.catch(() => {});
  await hSecondLockPromise.catch(() => {});
  await observer.end(); await h.end();
  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  process.exit(1);
}

const first40P01 = sAttemptLog.find(a => a.code === '40P01');
console.log(`  S attempt-1 40P01 at +${first40P01.t}ms from S start.`);

// --- F4/F4a: H's pending FOR UPDATE A should now complete (S released A on rollback) ---
const tWaitHGetA = Date.now();
await hSecondLockPromise;
const tHGotA = Date.now();
console.log(`  H acquired FOR UPDATE on A at +${tHGotA - tWaitHGetA}ms after S's abort -- confirms S's ROLLBACK released A.`);

// Immediately release H -- do not leave it open while S's retry runs.
await h.query('ROLLBACK');
const tHReleased = Date.now();
console.log(`  H released (ROLLBACK) at ${new Date(tHReleased).toISOString()} -- both A and B now free.`);

// --- F5: await S's eventual outcome ---
const tSRetryWaitStart = Date.now();
let sFinal;
try {
  sFinal = await sPromise;
  console.log(`  S retry SUCCEEDED at +${Date.now() - tSRetryWaitStart}ms after H released:`, JSON.stringify(sFinal));
} catch (e) {
  console.log(`  S retry FAILED at +${Date.now() - tSRetryWaitStart}ms after H released: code=${e.code} msg=${e.message}`);
  sFinal = null;
}

assertTrue(sFinal !== null, 'F4: the retried transaction (attempt >= 2) eventually SUCCEEDED');
assertTrue(sAttemptLog.filter(a => a.code === '40P01').length >= 1, 'retry helper was invoked by the real service path (at least 1 recorded 40P01 attempt-error)');
console.log(`  Total elapsed 40P01 -> successful retry commit: ${Date.now() - tSStart}ms`);

await observer.end();

// --- Durable state proof (fresh connection) ---
const verify = new Client(connOpts);
await verify.connect();
await verify.query('SET search_path TO data1_dev');

const finalRows = await verify.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = ANY($1::uuid[])', [[A, B]]);
console.log('\n  Final durable rows:', JSON.stringify(finalRows.rows));
const aRow = finalRows.rows.find(r => r.id === A);
const bRow = finalRows.rows.find(r => r.id === B);
assertTrue(aRow?.superseded_by === B, 'durable state: A.superseded_by = B');
assertTrue(bRow?.superseded_by === null, 'durable state: B remains live');

function formsCycle(byId, startId, ids) {
  const seen = new Set(); let cur = startId;
  while (byId[cur] !== null && byId[cur] !== undefined) {
    if (seen.has(cur)) return true;
    seen.add(cur); cur = byId[cur];
    if (!ids.includes(cur)) break;
  }
  return false;
}
const byId = { [A]: aRow?.superseded_by ?? null, [B]: bRow?.superseded_by ?? null };
assertTrue(!formsCycle(byId, A, [A, B]), 'cycle = false');

const dupRows = await verify.query('SELECT id, count(*)::int AS n FROM asset_identifier_assertion WHERE id = ANY($1::uuid[]) GROUP BY id HAVING count(*) > 1', [[A, B]]);
assertTrue(dupRows.rows.length === 0, 'exactly one supersession outcome -- no duplicate rows for A or B');

const domainDup = await verify.query(
  `SELECT payload->>'oldAssertionId' AS old_id, payload->>'newAssertionId' AS new_id, count(*)::int AS n
   FROM domain_event WHERE event_type='identifier-assertion.superseded' AND (payload->>'oldAssertionId') = $1
   GROUP BY old_id, new_id`,
  [A]
);
console.log('  domain_event rows for this supersession:', JSON.stringify(domainDup.rows));
assertTrue(domainDup.rows.every(r => r.n === 1), 'no duplicate domain_event (exactly one row for this (old,new) pair, not one per retry attempt)');

const outboxDup = await verify.query(
  `SELECT count(*)::int AS n FROM outbox o JOIN domain_event de ON de.event_id = o.domain_event_id
   WHERE de.event_type='identifier-assertion.superseded' AND (de.payload->>'oldAssertionId') = $1`,
  [A]
);
console.log('  outbox rows for this supersession:', JSON.stringify(outboxDup.rows));
assertTrue(outboxDup.rows[0].n === 1, 'no duplicate outbox side effect (exactly 1, not 1 per retry attempt)');

const idemRows = await verify.query(
  `SELECT count(*)::int AS n FROM idempotency_key WHERE operation='supersedeIdentifierAssertion' AND idempotency_key = $1`,
  [idemKey]
);
console.log('  idempotency_key rows for this exact key:', JSON.stringify(idemRows.rows));
assertTrue(idemRows.rows[0].n === 1, 'no duplicate idempotency consequence -- exactly one idempotency_key row for this key (the aborted 40P01 attempt never reached claimIdempotencyKey, since it rolled back before that statement)');

const evidenceDup = await verify.query(
  `SELECT assertion_id, observation_id, count(*)::int AS n FROM asset_identifier_assertion_evidence WHERE assertion_id = ANY($1::uuid[]) GROUP BY assertion_id, observation_id HAVING count(*) > 1`,
  [[A, B]]
);
assertTrue(evidenceDup.rows.length === 0, 'no duplicate evidence relationship (none created by this op, but verified clean)');

await verify.end();

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
console.log('SUMMARY:');
console.log('  helper deadlock_timeout:', hTimeoutRow.rows[0].deadlock_timeout);
console.log('  service/database default deadlock_timeout:', dbDefaultTimeout.rows[0].deadlock_timeout);
console.log('  victim (received 40P01):', victim);
console.log('  S attempt-1 40P01 offset:', first40P01?.t, 'ms');
console.log('  H acquired A (released by S rollback) offset:', tHGotA - tWaitHGetA, 'ms after H\'s A-request');
console.log('  final result:', sFinal ? 'SUCCESS' : 'FAILED');

if (failed > 0) { console.log('\nFAILURES:'); failures.forEach(f => console.log(f)); process.exit(1); }
process.exit(0);
