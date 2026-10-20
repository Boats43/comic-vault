// tests/helpers/d4DeterministicDeadlock.js -- builds a REAL PostgreSQL wait-for cycle against data1_dev (test-only; no production code touched, nothing mocked).
//
//   H (helper connection)  locks B                    -> H owns B
//   V (victim operation)   locks A, then waits on B   -> V owns A, blocked behind H   (observer confirms the block before proceeding)
//   H                      requests A                 -> cycle: V holds A waits B, H holds B waits A
// PostgreSQL's own deadlock detector then aborts one backend with SQLSTATE 40P01. V began waiting first, so V's detector timer fires first and V is normally the victim.
// `startVictim()` supplies V: the real service call (supersedeIdentifierAssertion A->B) in the certification test, or a raw transaction under a one-attempt
// withRetryOn40P01 in the negative control. Whatever V is, nothing here injects an error code.
import { Client } from 'pg';
import { closeRaceClients } from './lockRaceTeardown.js';

const BLOCKING_QUERY = `
  SELECT blocked_locks.pid AS blocked_pid, blocking_locks.pid AS blocking_pid
  FROM pg_catalog.pg_locks blocked_locks
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
  WHERE NOT blocked_locks.granted AND blocking_locks.pid = $1`;

export const settle = (p) => p.then((value) => ({ ok: true, value })).catch((e) => ({ ok: false, errorCode: e?.code ?? null, message: e?.message ?? String(e) }));

/** startVictim(): () => Promise; victimAttemptLog: array the victim's onAttemptError pushes {attempt, code} into. */
export async function runLockCycle({ connOpts, observer, A, B, startVictim, victimAttemptLog }) {
  const h = new Client(connOpts);
  h.on('error', () => {});
  let hPid = null, hRolledBack = false;
  const result = { confirmedBlocked: false, victim: null, hOutcome: null, victimSettled: null, hPid: null, lockGraph: null };
  let victimP = null, hSecond = null;
  try {
    await h.connect();
    await h.query('SET search_path TO data1_dev');
    hPid = (await h.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    result.hPid = hPid;
    await h.query('BEGIN');
    await h.query('SELECT id FROM asset_identifier_assertion WHERE id = $1 FOR UPDATE', [B]);
    victimP = settle(startVictim());
    for (let i = 0; i < 100 && !result.confirmedBlocked; i++) {
      const r = await observer.query(BLOCKING_QUERY, [hPid]);
      if (r.rows.length > 0) { result.confirmedBlocked = true; result.lockGraph = r.rows; } else await new Promise((res) => setTimeout(res, 30));
    }
    if (!result.confirmedBlocked) return result;
    hSecond = h.query('SELECT id FROM asset_identifier_assertion WHERE id = $1 FOR UPDATE', [A]);   // closes the cycle
    result.hOutcome = await hSecond.then(() => ({ kind: 'H_GOT_A' })).catch((e) => ({ kind: 'H_ERROR', code: e.code, message: e.message }));
    for (let i = 0; i < 50 && victimAttemptLog.length === 0; i++) await new Promise((res) => setTimeout(res, 50));   // victim's error notification is an independent round trip
    if (victimAttemptLog.some((a) => a.code === '40P01')) result.victim = 'V';
    else if (result.hOutcome.kind === 'H_ERROR' && result.hOutcome.code === '40P01') result.victim = 'H';
    return result;
  } finally {
    try { await h.query('ROLLBACK'); hRolledBack = true; } catch { /* the deadlock victim's transaction is already aborted */ }
    if (victimP) result.victimSettled = await victimP;   // H has released its locks; a retrying victim can now finish
    await closeRaceClients(h);
    result.hRolledBack = hRolledBack;
  }
}

/** Leak check after a cycle: no idle-in-transaction session touching the assertion table, and no session still waiting on a lock. Read-only. */
export async function findLeaks(observer, hPid) {
  const idle = await observer.query(
    `SELECT pid, state, left(query, 80) AS q FROM pg_stat_activity
     WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%' AND (pid = $1 OR query ILIKE '%asset_identifier_assertion%')`, [hPid]);
  const waiting = await observer.query(`SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid WHERE NOT l.granted AND a.datname = current_database() AND a.pid <> pg_backend_pid()`);
  const hStill = await observer.query('SELECT pid, state FROM pg_stat_activity WHERE pid = $1', [hPid]);
  return { idleInTransaction: idle.rows, waitingOnLock: waiting.rows, helperSessionStillPresent: hStill.rows };
}
