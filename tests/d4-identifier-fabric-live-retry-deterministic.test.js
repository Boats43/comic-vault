// tests/d4-identifier-fabric-live-retry-deterministic.test.js
//
// D4 Phase B, B7a deterministic closure. Not a probabilistic race: an explicitly constructed PostgreSQL lock cycle against real data1_dev
// (tests/helpers/d4DeterministicDeadlock.js). A helper connection forces the exact wait-for graph a genuine deadlock needs; the REAL
// supersedeIdentifierAssertion service transaction is then the backend that receives PostgreSQL's own SQLSTATE 40P01, is retried by the real
// retry helper, and commits once the competing lock is released.
//
// FRESH FIXTURES (2026-10-20): every execution mints its OWN asset, identifier definition and assertion pair A/B through the real service (UUID-nonced
// keys, unique across processes), proves the pair is fresh (live, unreferenced, no supersession event) before the cycle, and registers it so in-process reuse
// throws. The earlier version reused one retained pair and could only ever pass once: a second run found A already superseded and aborted.
//
// No SQLSTATE injection. No fake repository. No trigger/constraint modification. No production-code change. Mints permanent, append-only Development rows
// (source marker below), like the other D4 live proofs.
//
// Invoke: node tests/d4-identifier-fabric-live-retry-deterministic.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';
import { runLockCycle, findLeaks } from './helpers/d4DeterministicDeadlock.js';
import { mintFreshPair, assertFreshPair, registerFreshPair, evaluateDeterministicConversion, collectRaceObservations, evaluateStateInvariants } from './helpers/d4RaceInvariants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);

const OPERATOR_PRINCIPAL = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const MARKER = 'd4-phase-b-proof:b7a-deterministic';
const connOpts = { connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } };

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

console.log('\n=== D4 Phase B, B7a deterministic closure (real PostgreSQL lock cycle, fresh fixture) ===\n');

// Deliberately targets real data1_dev; assertAdminDbTarget() verifies current_database()/schema/environment identity.
const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const observer = await assertAdminDbTarget({ connectionString: connOpts.connectionString, label: 'd4-identifier-fabric-live-retry-deterministic' });
await observer.query('SET search_path TO data1_dev');
const dbDefaultTimeout = (await observer.query('SHOW deadlock_timeout')).rows[0].deadlock_timeout;
console.log('  Database deadlock_timeout (service and helper both run at this default):', dbDefaultTimeout);

// ---- FRESH PAIR ----
const pair = await mintFreshPair(assets, { principalId: OPERATOR_PRINCIPAL, marker: MARKER });
registerFreshPair(pair.a, pair.b);
console.log(`FRESH_PAIR asset=${pair.assetId} A=${pair.a} B=${pair.b}`);
const fresh = await assertFreshPair(observer, pair.a, pair.b);
assertTrue(fresh.fresh, `fixture: freshly minted pair is live, unreferenced and has no supersession event${fresh.fresh ? '' : ' -- ' + fresh.reasons.join('; ')}`);
let reuseThrew = false;
try { registerFreshPair(pair.a, pair.b); } catch { reuseThrew = true; }
assertTrue(reuseThrew, 'fixture: registering the same pair a second time throws (reuse is detected)');
if (!fresh.fresh) { console.log('ABORT: fixture is not fresh.'); await observer.end(); process.exit(1); }

// ---- REAL LOCK CYCLE ----
const sAttemptLog = [];
const tS = Date.now();
const idemKey = `d4-b7a-deterministic-${pair.a}`;
const cycle = await runLockCycle({
  connOpts, observer, A: pair.a, B: pair.b, victimAttemptLog: sAttemptLog,
  startVictim: () => assets.supersedeIdentifierAssertion({
    principalId: OPERATOR_PRINCIPAL, gkAssetId: pair.assetId, oldAssertionId: pair.a, newAssertionId: pair.b, idempotencyKey: idemKey,
    __onAttemptError: (attempt, e) => sAttemptLog.push({ attempt, code: e.code, message: e.message, t: Date.now() - tS }),
  }),
});
console.log('  Lock graph (S waiting on H) before the cycle closed:', JSON.stringify(cycle.lockGraph));
console.log('  H second-lock outcome:', JSON.stringify(cycle.hOutcome));
console.log('  S retry-layer attempt errors:', JSON.stringify(sAttemptLog));
console.log('  Victim (backend that received 40P01):', cycle.victim);
assertTrue(cycle.confirmedBlocked, 'F1: observer confirms the service transaction S is blocked behind H before the cycle is closed');
assertTrue(cycle.victim === 'V', `F3a REAL: PostgreSQL itself aborted the service transaction S with SQLSTATE 40P01 (victim=${cycle.victim})`);
const real40 = sAttemptLog.find((a) => a.code === '40P01');
assertTrue(!!real40 && /deadlock detected/i.test(real40.message || ''), 'the 40P01 is PostgreSQL\'s own error ("deadlock detected"), observed at the real retry layer (not injected)');

const sFinal = cycle.victimSettled?.ok
  ? { ok: true, attemptsUsed: sAttemptLog.length + 1, value: cycle.victimSettled.value }
  : { ok: false, errorCode: cycle.victimSettled?.errorCode ?? null };
console.log('  S final:', JSON.stringify(sFinal.ok ? { ok: true, attemptsUsed: sFinal.attemptsUsed } : sFinal), ` elapsed ${Date.now() - tS}ms`);
const verdict = evaluateDeterministicConversion({ victim: cycle.victim === 'V' ? 'S' : cycle.victim, sAttemptLog, sFinal });
assertTrue(verdict.ok, `retry conversion: ${verdict.reason}`);
assertTrue(sFinal.ok === true && sFinal.attemptsUsed >= 2, 'the contractually required conversion occurred: 40P01 on attempt 1, successful commit on a later attempt, no raw 40P01 surfaced to the caller');

// ---- DURABLE STATE (fresh connection) ----
const verify = new Client(connOpts);
await verify.connect();
await verify.query('SET search_path TO data1_dev');
const obs = await collectRaceObservations(verify, [{ a: pair.a, b: pair.b }]);
const aRow = obs.rows.find((r) => r.id === pair.a), bRow = obs.rows.find((r) => r.id === pair.b);
console.log('  Final durable rows:', JSON.stringify(obs.rows));
assertTrue(aRow?.superseded_by === pair.b, 'durable state: A.superseded_by = B');
assertTrue(bRow?.superseded_by === null, 'durable state: B remains live');
// ONE service call (A->B) runs against the held cycle, so the shared evaluator is applied to the state invariants (3 no duplicate rows, 4 no cycle, 5 no duplicate evidence).
for (const i of evaluateStateInvariants({ pairs: [{ a: pair.a, b: pair.b }], ...obs })) assertTrue(i.status === 'PASS', `state invariant ${i.id}: ${i.detail}`);
const dom = obs.supersessionEvents.filter((e) => e.old_id === pair.a);
assertTrue(dom.length === 1 && dom[0].n === 1, 'exactly one durable domain_event for this supersession (not one per retry attempt)');
const outboxN = (await verify.query(`SELECT count(*)::int AS n FROM outbox o JOIN domain_event de ON de.event_id = o.domain_event_id WHERE de.event_type='identifier-assertion.superseded' AND (de.payload->>'oldAssertionId') = $1`, [pair.a])).rows[0].n;
assertTrue(outboxN === 1, 'exactly one outbox side effect (not one per retry attempt)');
const idemN = (await verify.query(`SELECT count(*)::int AS n FROM idempotency_key WHERE operation='supersedeIdentifierAssertion' AND idempotency_key = $1`, [idemKey])).rows[0].n;
assertTrue(idemN === 1, 'exactly one idempotency_key row (the aborted 40P01 attempt rolled back before claiming it)');
await verify.end();

// ---- CLEANUP ----
const leaks = await findLeaks(observer, cycle.hPid);
console.log('  Leak check:', JSON.stringify({ idle: leaks.idleInTransaction.length, waiting: leaks.waitingOnLock.length, helperPresent: leaks.helperSessionStillPresent.length }));
assertTrue(cycle.hRolledBack === true, 'cleanup: the helper transaction was rolled back');
assertTrue(leaks.idleInTransaction.length === 0, 'cleanup: no idle-in-transaction session left touching the assertion table');
assertTrue(leaks.waitingOnLock.length === 0, 'cleanup: no session left waiting on a lock');
assertTrue(leaks.helperSessionStillPresent.length === 0, 'cleanup: the helper connection\'s backend is gone');
await observer.end();

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
console.log('SUMMARY:', JSON.stringify({ victim: cycle.victim, first40P01OffsetMs: real40?.t ?? null, attempts: sAttemptLog.length + (sFinal.ok ? 1 : 0), final: sFinal.ok ? 'SUCCESS' : 'FAILED', pair: { a: pair.a, b: pair.b } }));
if (failed > 0) { console.log('\nFAILURES:'); failures.forEach((f) => console.log(f)); process.exit(1); }
process.exit(0);
