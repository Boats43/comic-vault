// tests/d4-race-invariants-negative-controls.test.js -- NEGATIVE CONTROLS for the D4 B7a certification (test-only; no production code touched).
//
// A certification test is only worth something if it FAILS when the property it certifies is broken. This file feeds the shared evaluators
// (tests/helpers/d4RaceInvariants.js) hostile observations and proves each invariant detects its violation, with two controls driven by the REAL database:
//   R1  a consumed/reused fixture pair is rejected by assertFreshPair, and an in-process reuse throws;
//   R2  BROKEN RETRY CONVERSION against a REAL PostgreSQL 40P01: the real lock cycle is built, but the victim runs under the real withRetryOn40P01 with
//       maxAttempts:1 (retry disabled). The genuine 40P01 escapes raw, and both evaluators flag it. Nothing is mocked or injected.
//
// Positive controls are included so a checker that fails everything would also be caught.
// Invoke: node tests/d4-race-invariants-negative-controls.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';
import { evaluateRaceInvariants, evaluateStateInvariants, evaluateDeterministicConversion, assertFreshPair, registerFreshPair, mintFreshPair, VACUOUS_RAW_40P01_MESSAGE } from './helpers/d4RaceInvariants.js';
import { runLockCycle, findLeaks } from './helpers/d4DeterministicDeadlock.js';

let passed = 0, failed = 0;
const failures = [];
const ok = (cond, label) => { if (cond) { passed++; console.log(`  ✓ ${label}`); } else { failed++; failures.push(label); console.log(`  ✗ ${label}`); } };
const st = (inv, id) => inv.find((i) => i.id === id)?.status;

console.log('\n=== D4 B7a negative controls ===\n');

// ---------- pure controls ----------
const P = [{ a: 'A0', b: 'B0' }, { a: 'A1', b: 'B1' }];
const fulfilled = { status: 'fulfilled', value: {} };
const rejected = (code) => ({ status: 'rejected', reason: { code } });
const cleanRows = [{ id: 'A0', superseded_by: 'B0' }, { id: 'B0', superseded_by: null }, { id: 'A1', superseded_by: null }, { id: 'B1', superseded_by: 'A1' }];
const noLogs = [{ a: [], b: [] }, { a: [], b: [] }];
const cleanResults = [fulfilled, rejected('P0001'), rejected('P0001'), fulfilled];

console.log('-- positive controls (a checker that fails everything would be caught here) --');
let inv = evaluateRaceInvariants({ pairs: P, results: cleanResults, attemptLogs: noLogs, rows: cleanRows });
ok(['PASS', 'VACUOUS', 'PASS', 'PASS', 'PASS'].join() === [0, 1, 2, 3, 4].map((i) => inv[i].status).join(), 'clean race with no deadlock: 1 PASS, 2 VACUOUS, 3-5 PASS');
ok(inv[1].detail === VACUOUS_RAW_40P01_MESSAGE && VACUOUS_RAW_40P01_MESSAGE === '0 deadlocks observed; 0 unconverted raw 40P01 errors escaped. Invariant vacuously satisfied.', 'the vacuous message is exactly the specified text');
inv = evaluateRaceInvariants({ pairs: P, results: cleanResults, attemptLogs: [{ a: [{ attempt: 1, code: '40P01' }], b: [] }, { a: [], b: [] }], rows: cleanRows });
ok(st(inv, 'no-raw-40P01-escape') === 'PASS' && /1 deadlock\(s\) observed; all converted/.test(inv[1].detail), 'clean race WITH a converted deadlock: invariant 2 is a real PASS, not vacuous');

console.log('-- negative: broken retry conversion / escaped raw 40P01 --');
inv = evaluateRaceInvariants({ pairs: P, results: [rejected('40P01'), rejected('40P01'), rejected('P0001'), fulfilled], attemptLogs: [{ a: [{ attempt: 3, code: '40P01' }], b: [{ attempt: 3, code: '40P01' }] }, { a: [], b: [] }], rows: cleanRows });
ok(st(inv, 'one-success-per-pair') === 'FAIL' && st(inv, 'no-raw-40P01-escape') === 'FAIL', 'both calls of a pair ending in raw 40P01 (retry exhausted/unconverted): invariants 1 AND 2 FAIL');
inv = evaluateRaceInvariants({ pairs: P, results: [fulfilled, rejected('40P01'), rejected('P0001'), fulfilled], attemptLogs: [{ a: [], b: [{ attempt: 1, code: '40P01' }] }, { a: [], b: [] }], rows: cleanRows });
ok(st(inv, 'no-raw-40P01-escape') === 'FAIL' && st(inv, 'one-success-per-pair') === 'PASS', 'a raw 40P01 escaping while the pair still has one success: ONLY invariant 2 fails (isolated)');

console.log('-- negative: state violations with NO deadlock (the old code skipped these) --');
inv = evaluateRaceInvariants({ pairs: P, results: cleanResults, attemptLogs: noLogs, rows: cleanRows.map((r) => (r.id === 'B0' ? { ...r, superseded_by: 'A0' } : r)) });
ok(st(inv, 'no-cycle') === 'FAIL' && st(inv, 'no-raw-40P01-escape') === 'VACUOUS', 'a 2-cycle in the final rows with zero deadlocks: invariant 4 FAILS while invariant 2 stays vacuous');
inv = evaluateRaceInvariants({ pairs: P, results: [fulfilled, fulfilled, rejected('P0001'), fulfilled], attemptLogs: noLogs, rows: cleanRows });
ok(st(inv, 'one-success-per-pair') === 'FAIL', 'both calls of a pair succeeding (no deadlock): invariant 1 FAILS');
inv = evaluateRaceInvariants({ pairs: P, results: cleanResults, attemptLogs: noLogs, rows: [...cleanRows, { id: 'A0', superseded_by: 'B0' }] });
ok(st(inv, 'no-duplicate-rows') === 'FAIL', 'a duplicated assertion row: invariant 3 FAILS');
inv = evaluateRaceInvariants({ pairs: P, results: cleanResults, attemptLogs: noLogs, rows: cleanRows, supersessionEvents: [{ old_id: 'A0', new_id: 'B0', n: 2 }] });
ok(st(inv, 'no-duplicate-rows') === 'FAIL', 'a supersession event recorded twice (retry duplicated a durable effect): invariant 3 FAILS');
inv = evaluateRaceInvariants({ pairs: P, results: cleanResults, attemptLogs: noLogs, rows: cleanRows, evidenceDupRows: [{ assertion_id: 'A0', observation_id: 'O', n: 2 }] });
ok(st(inv, 'no-duplicate-evidence') === 'FAIL', 'a duplicated evidence link: invariant 5 FAILS');

console.log('-- negative: a race that cannot be evaluated is never a silent pass --');
inv = evaluateRaceInvariants({ pairs: P, results: cleanResults.slice(0, 3), attemptLogs: noLogs, rows: cleanRows });
ok(inv.length === 5 && inv.every((i) => i.status === 'INCOMPLETE'), 'missing results: all five invariants are INCOMPLETE');
inv = evaluateRaceInvariants({ pairs: P, results: cleanResults, attemptLogs: noLogs, rows: cleanRows.slice(0, 3) });
ok(inv.every((i) => i.status === 'INCOMPLETE'), 'missing durable rows: all five invariants are INCOMPLETE');
ok(evaluateStateInvariants({ pairs: P, rows: [] }).every((i) => i.status === 'INCOMPLETE'), 'state-only evaluator: missing rows are INCOMPLETE');

console.log('-- negative: deterministic conversion verdict --');
ok(evaluateDeterministicConversion({ victim: 'S', sAttemptLog: [{ attempt: 1, code: '40P01' }], sFinal: { ok: false, errorCode: '40P01' } }).ok === false, 'victim S ended with raw 40P01: NOT converted');
ok(evaluateDeterministicConversion({ victim: 'S', sAttemptLog: [], sFinal: { ok: true, attemptsUsed: 1 } }).ok === false, 'success with no 40P01 recorded: no deadlock happened, not a conversion proof');
ok(evaluateDeterministicConversion({ victim: 'H', sAttemptLog: [], sFinal: { ok: true, attemptsUsed: 1 } }).ok === false, 'helper was the victim: not the service path, rejected');
ok(evaluateDeterministicConversion({ victim: 'S', sAttemptLog: [{ attempt: 1, code: '40P01' }], sFinal: { ok: true, attemptsUsed: 1 } }).ok === false, 'success claiming 1 attempt after a 40P01: rejected');
ok(evaluateDeterministicConversion({ victim: 'S', sAttemptLog: [{ attempt: 1, code: '40P01' }], sFinal: { ok: true, attemptsUsed: 2 } }).ok === true, 'positive control: 40P01 then success on attempt 2 is accepted');

// ---------- real-database controls ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { withRetryOn40P01 } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'retry.js')).href);
const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const OPERATOR_PRINCIPAL = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const MARKER = 'd4-phase-b-proof:b7a-negative-controls';
const connOpts = { connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } };
const observer = await assertAdminDbTarget({ connectionString: connOpts.connectionString, label: 'd4-race-invariants-negative-controls' });
await observer.query('SET search_path TO data1_dev');

console.log('\n-- R1: reused / contaminated fixture pair (real database) --');
const used = await mintFreshPair(assets, { principalId: OPERATOR_PRINCIPAL, marker: MARKER });
const before = await assertFreshPair(observer, used.a, used.b);
ok(before.fresh === true, 'a newly minted pair is accepted as fresh');
await assets.supersedeIdentifierAssertion({ principalId: OPERATOR_PRINCIPAL, gkAssetId: used.assetId, oldAssertionId: used.a, newAssertionId: used.b, idempotencyKey: `nc-consume-${used.a}` });
const after = await assertFreshPair(observer, used.a, used.b);
ok(after.fresh === false && after.reasons.some((r) => /already superseded/.test(r)) && after.reasons.some((r) => /supersession event/.test(r)), `the same pair after one real supersession is REJECTED as reused (${after.reasons.join('; ')})`);
registerFreshPair(used.a, used.b);
let threw = false; try { registerFreshPair(used.b, used.a); } catch { threw = true; }
ok(threw, 'registering the same pair again (either order) throws');
const ghost = await assertFreshPair(observer, '01a00000-0000-7000-8000-000000000001', '01a00000-0000-7000-8000-000000000002');
ok(ghost.fresh === false, 'a pair that does not exist is not fresh');

console.log('\n-- R2: BROKEN RETRY CONVERSION against a REAL 40P01 (retry disabled via maxAttempts:1; nothing injected) --');
let r2 = null;
for (let attempt = 1; attempt <= 3 && !(r2 && r2.victimIsV); attempt++) {
  const pair = await mintFreshPair(assets, { principalId: OPERATOR_PRINCIPAL, marker: MARKER });
  const log = [];
  const t0 = Date.now();
  const rawVictim = async () => {   // locks A then B in one transaction, exactly the order the service transaction uses
    const c = new Client(connOpts); c.on('error', () => {});
    await c.connect(); await c.query('SET search_path TO data1_dev');
    try {
      await c.query('BEGIN');
      await c.query('SELECT id FROM asset_identifier_assertion WHERE id = $1 FOR UPDATE', [pair.a]);
      await c.query('SELECT id FROM asset_identifier_assertion WHERE id = $1 FOR UPDATE', [pair.b]);
      await c.query('COMMIT');
      return 'committed';
    } catch (e) { try { await c.query('ROLLBACK'); } catch { /* aborted */ } throw e; } finally { try { await c.end(); } catch { /* closed */ } }
  };
  const cycle = await runLockCycle({ connOpts, observer, A: pair.a, B: pair.b, victimAttemptLog: log,
    startVictim: () => withRetryOn40P01(rawVictim, { maxAttempts: 1, onAttemptError: (n, e) => log.push({ attempt: n, code: e.code, message: e.message, t: Date.now() - t0 }) }) });
  r2 = { cycle, log, pair, victimIsV: cycle.victim === 'V' };
  console.log(`  attempt ${attempt}: victim=${cycle.victim} retry-layer log=${JSON.stringify(log.map((x) => x.code))} victim final=${JSON.stringify(cycle.victimSettled)}`);
}
ok(r2.cycle.confirmedBlocked && r2.victimIsV, 'a real wait-for cycle was built and PostgreSQL aborted the victim with 40P01 (retry layer saw it)');
ok(r2.cycle.victimSettled?.ok === false && r2.cycle.victimSettled.errorCode === '40P01', 'with conversion broken (maxAttempts:1) the REAL 40P01 escapes to the caller raw');
const verdict = evaluateDeterministicConversion({ victim: 'S', sAttemptLog: r2.log, sFinal: { ok: r2.cycle.victimSettled?.ok === true, errorCode: r2.cycle.victimSettled?.errorCode, attemptsUsed: r2.log.length } });
ok(verdict.ok === false && /unconverted/.test(verdict.reason), `the deterministic-conversion verdict FAILS it: ${verdict.reason}`);
inv = evaluateRaceInvariants({ pairs: [{ a: r2.pair.a, b: r2.pair.b }], results: [{ status: 'rejected', reason: { code: r2.cycle.victimSettled?.errorCode } }, fulfilled], attemptLogs: [{ a: r2.log, b: [] }],
  rows: (await observer.query('SELECT id, superseded_by FROM asset_identifier_assertion WHERE id = ANY($1::uuid[])', [[r2.pair.a, r2.pair.b]])).rows });
ok(st(inv, 'no-raw-40P01-escape') === 'FAIL', 'the race invariant "no unconverted raw 40P01 escapes" FAILS on the real escaped error');
const leaks = await findLeaks(observer, r2.cycle.hPid);
ok(leaks.idleInTransaction.length === 0 && leaks.waitingOnLock.length === 0 && leaks.helperSessionStillPresent.length === 0, 'cleanup after the negative control: no idle-in-transaction session, no lock waiter, helper backend gone');
await observer.end();

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
process.exit(0);
