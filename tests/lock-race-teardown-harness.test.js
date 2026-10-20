// LOCK-RACE TEARDOWN HARNESS -- proves tests/helpers/lockRaceTeardown.js terminates safely in BOTH lock-holder directions, keeps cleanup/safety guarantees, handles a REAL
// SQLSTATE 40P01, and demonstrates (negative control) the circular wait the previous sequential teardown suffered from.
// Real Development Postgres, private scratch schema created and dropped here (no application table is touched).
// Invoke: node tests/lock-race-teardown-harness.test.js
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { Client } from 'pg';
import { finishRace, closeRaceClients } from './helpers/lockRaceTeardown.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
let passed = 0, failed = 0;
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const connOpts = { connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL_UNPOOLED, ssl: { rejectUnauthorized: false } };
const { assertScratchSchemaTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const { client: admin } = await assertScratchSchemaTarget({ connectionString: connOpts.connectionString, label: 'lock-race-teardown-harness' });
const SCH = `scratch_lockrace_${Date.now()}`;
const APP = `lockrace-${SCH}`;
const mk = async () => { const c = new Client({ ...connOpts, application_name: APP }); await c.connect(); await c.query(`SET search_path TO ${SCH}`); await c.query('BEGIN'); return c; };
const withTimeout = (p, ms, tag) => Promise.race([
  p.then(() => ({ ok: true, tag })).catch((e) => ({ ok: false, tag, error: e.message, code: e.code })),
  sleep(ms).then(() => ({ ok: false, tag, error: 'TIMEOUT (blocked)', code: 'TIMEOUT' })),
]);
const settles = async (p, ms) => Promise.race([p.then(() => true), sleep(ms).then(() => false)]);
const leaks = async () => {
  const idle = (await admin.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name = $1 AND state = 'idle in transaction'`, [APP])).rows[0].n;
  const waiting = (await admin.query(`SELECT count(*)::int n FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'`, [APP])).rows[0].n;
  return { idle, waiting };
};
const value = async (id) => (await admin.query(`SELECT v FROM ${SCH}.t WHERE id = $1`, [id])).rows[0].v;

// The legacy sequential tail, reproduced ONLY for the negative control.
const legacyFinish = async (client, ok) => { if (!ok) { try { await client.query('ROLLBACK'); } catch {} return false; } try { await client.query('COMMIT'); return true; } catch { return false; } };

try {
  await admin.query(`CREATE SCHEMA ${SCH}`);
  await admin.query(`CREATE TABLE ${SCH}.t (id int primary key, v int)`);
  await admin.query(`INSERT INTO ${SCH}.t VALUES (1, 0), (2, 0), (3, 0), (4, 0)`);
  console.log('\n=== lock-race teardown harness (real Development Postgres, scratch schema) ===\n');

  // plain block: the HOLDER updates and completes; the BLOCKED side waits on the holder's uncommitted row lock (no Postgres cycle)
  async function plainBlock(id, holderIsT2) {
    const c1 = await mk(), c2 = await mk();
    const holder = holderIsT2 ? c2 : c1, blocked = holderIsT2 ? c1 : c2;
    await holder.query(`UPDATE t SET v = 100 WHERE id = ${id}`);
    const rBlocked = await withTimeout(blocked.query(`UPDATE t SET v = 200 WHERE id = ${id}`), 1200, 'blocked');
    return { c1, c2, holder, blocked, rBlocked };
  }

  console.log('-- direction A: T1 is BLOCKED, T2 holds the lock (the direction that hung the sweep) --');
  {
    const { c1, c2, rBlocked } = await plainBlock(1, true);
    ok(rBlocked.code === 'TIMEOUT', 'setup: T1 really is blocked behind T2 (statement timed out waiting)');
    const t0 = Date.now();
    const fin = finishRace(c1, false, c2, true);
    const done = await settles(fin, 5000);
    const res = done ? await fin : null;
    ok(done && res.watchdogFired === false && Date.now() - t0 < 3000, `teardown settles on its own in ${Date.now() - t0} ms (no watchdog)`);
    ok(res && res.committed[0] === false && res.committed[1] === true, 'holder (T2) committed, blocked side (T1) rolled back');
    await closeRaceClients(c1, c2);
    ok((await value(1)) === 100, 'durable state = the holder\'s committed value; the blocked side\'s write left nothing behind');
    const l = await leaks(); ok(l.idle === 0 && l.waiting === 0, `no leaked transaction and no ungranted lock afterwards (idle-in-tx ${l.idle}, waiting ${l.waiting})`);
  }
  console.log('\n-- direction B: T2 is BLOCKED, T1 holds the lock --');
  {
    const { c1, c2, rBlocked } = await plainBlock(2, false);
    ok(rBlocked.code === 'TIMEOUT', 'setup: T2 really is blocked behind T1');
    const t0 = Date.now();
    const fin = finishRace(c1, true, c2, false);
    const done = await settles(fin, 5000);
    const res = done ? await fin : null;
    ok(done && res.watchdogFired === false && Date.now() - t0 < 3000, `teardown settles on its own in ${Date.now() - t0} ms (no watchdog)`);
    ok(res && res.committed[0] === true && res.committed[1] === false, 'holder (T1) committed, blocked side (T2) rolled back');
    await closeRaceClients(c1, c2);
    ok((await value(2)) === 100, 'durable state = the holder\'s committed value');
    const l = await leaks(); ok(l.idle === 0 && l.waiting === 0, `no leaked transaction and no ungranted lock afterwards (idle-in-tx ${l.idle}, waiting ${l.waiting})`);
  }

  console.log('\n-- SQLSTATE 40P01 handling preserved: a REAL crossed-update deadlock --');
  {
    const c1 = await mk(), c2 = await mk();
    await c1.query('UPDATE t SET v = 11 WHERE id = 3'); await c2.query('UPDATE t SET v = 22 WHERE id = 4');
    const p1 = withTimeout(c1.query('UPDATE t SET v = 12 WHERE id = 4'), 8000, 'T1');
    const p2 = withTimeout(c2.query('UPDATE t SET v = 21 WHERE id = 3'), 8000, 'T2');
    const [r1, r2] = await Promise.all([p1, p2]);
    const dead = [r1, r2].filter((r) => r.code === '40P01').length;
    ok(dead === 1, `Postgres detected the cycle and aborted exactly one side with 40P01 (T1 ${r1.code || 'ok'}, T2 ${r2.code || 'ok'})`);
    const t0 = Date.now();
    const res = await finishRace(c1, r1.ok, c2, r2.ok);
    ok(res.watchdogFired === false && Date.now() - t0 < 3000, 'teardown settles after a real deadlock too');
    ok(res.committed.filter(Boolean).length === 1, 'exactly one transaction committed (the survivor); the 40P01 victim rolled back (an aborted transaction answers ROLLBACK cleanly)');
    await closeRaceClients(c1, c2);
    const vals = [await value(3), await value(4)];
    ok(!(vals[0] === 11 && vals[1] === 22 && res.committed[0] && res.committed[1]), 'no state where both crossed transactions committed');
    const l = await leaks(); ok(l.idle === 0 && l.waiting === 0, 'no leaked transaction after the deadlock teardown');
  }

  console.log('\n-- watchdog: teardown that cannot settle is terminated, never hung --');
  {
    const { c1, c2 } = await plainBlock(1, true);
    // sabotage: the holder is told to ROLLBACK-less: pass ok=false to BOTH while the holder still holds the lock -> holder rolls back, blocked proceeds; to force a stuck state we hold with a THIRD client
    const c3 = await mk();
    await c3.query('UPDATE t SET v = 7 WHERE id = 2');                     // c3 holds id=2
    const blockedOnC3 = withTimeout(c1.query('UPDATE t SET v = 8 WHERE id = 2'), 800, 'c1-blocked'); // c1 (new statement queue) blocks behind c3, which finishRace does not control
    await blockedOnC3;
    const t0 = Date.now();
    const res = await finishRace(c1, false, c2, false, { watchdogMs: 1500 });   // c1's ROLLBACK queues behind the statement blocked on c3
    ok(res.watchdogFired === true && Date.now() - t0 < 6000, `an unsettleable teardown is cut off by the watchdog (${Date.now() - t0} ms), not hung`);
    await closeRaceClients(c1, c2);
    try { await c3.query('ROLLBACK'); } catch {}
    await closeRaceClients(c3);
    const l = await leaks(); ok(l.idle === 0, `the destroyed sessions leave no idle-in-transaction backend (${l.idle})`);
  }

  console.log('\n-- NEGATIVE CONTROL: the previous sequential teardown really did circular-wait --');
  {
    const { c1, c2, rBlocked } = await plainBlock(1, true);
    const legacy = (async () => { const a = await legacyFinish(c1, false); const b = await legacyFinish(c2, true); return [a, b]; })();
    const done = await settles(legacy, 4000);
    ok(rBlocked.code === 'TIMEOUT' && done === false, 'direction A with the OLD order does NOT settle within 4 s (c1 ROLLBACK queued behind its blocked UPDATE; the holder COMMIT is stuck behind it)');
    const l = await leaks();
    ok(l.waiting >= 1, `the blocked UPDATE is still waiting on the row lock (wait_event_type=Lock) while the old teardown is "finishing" (${l.waiting} waiting backend)`);
    // break the circle from outside, exactly what no database timeout does on its own
    await c2.query('COMMIT').catch(() => {});
    ok(await settles(legacy, 4000), 'it only completes once the holder is released out-of-band');
    await closeRaceClients(c1, c2);
  }
  {
    const c1 = await mk(), c2 = await mk();
    await c1.query('UPDATE t SET v = 100 WHERE id = 1');
    await withTimeout(c2.query('UPDATE t SET v = 200 WHERE id = 1'), 1000, 'blocked');
    const legacy = (async () => { const a = await legacyFinish(c1, true); const b = await legacyFinish(c2, false); return [a, b]; })();
    ok(await settles(legacy, 4000), 'direction B with the OLD order settled (T1 COMMIT came first) -- the old defect was direction-dependent, which is why it only hung sometimes');
    await closeRaceClients(c1, c2);
  }
} finally {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCH} CASCADE`).catch(() => {});
  await admin.end().catch(() => {});
}
console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
process.exit(failed ? 1 : 0);
