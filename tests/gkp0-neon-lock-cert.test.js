// tests/gkp0-neon-lock-cert.test.js
//
// GK-P0 CHECK 1 -- certify the publication mutex against the REAL driver/pooler configuration:
// src/modules/assets/db.js uses pg.Pool({max:5}) on GRAILKEY_CATALOG_DATABASE_URL, the Neon PgBouncer
// (transaction-pooling) endpoint. Development uses the same Neon pooler. Nothing is published; no eBay call exists here.
//
//   node tests/gkp0-neon-lock-cert.test.js            (holds a lock 130s by default: longer than the pinned 120s function limit)
//   GKP0_CERT_HOLD_SECONDS=20 node tests/gkp0-neon-lock-cert.test.js   (quick run)

import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { bootstrap, repoRoot } from './helpers/gkp0Harness.mjs';
import os from 'node:os';

let passed = 0, failed = 0;
const failures = [];
const ok = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; failures.push(l); console.log(`  ✗ ${l}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOLD_S = Number(process.env.GKP0_CERT_HOLD_SECONDS) || 130;

const h = await bootstrap({ registryFile: path.join(os.tmpdir(), `gkp0-cert-${process.pid}.json`) });
const { A } = h;
const url = process.env.GRAILKEY_CATALOG_DATABASE_URL;
const host = new URL(url).hostname;
const mk = () => new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

console.log('\n=== GK-P0 Neon publication-mutex certification ===\n');
ok(/-pooler\./.test(host), `driver target is the Neon PgBouncer pooled endpoint (host class: ${/-pooler\./.test(host) ? '-pooler' : 'DIRECT'})`);

const PA = await h.newPrincipal('gkp0-cert');
const asset = await h.mint(PA, 'cert', h.READY_AUTHORITY);
const KEY = `${asset.gkAssetId}|ebay`;
const observer = mk(); await observer.connect();

try {
  console.log('-- lock type and key --');
  const m = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: asset.gkAssetId });
  ok(m.acquired === true, 'mutex acquired through the pooled pg.Pool path');
  const hk = (await observer.query('SELECT hashtextextended($1::text, 40295) AS k', [KEY])).rows[0].k;
  const classid = (BigInt(hk) >> 32n) & 0xffffffffn; const objid = BigInt(hk) & 0xffffffffn;
  const row = (await observer.query(`SELECT mode, granted, objsubid FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid AND granted`, [classid.toString(), objid.toString()])).rows[0];
  ok(row && row.mode === 'ExclusiveLock' && row.objsubid === 1, `PostgreSQL advisory lock, ExclusiveLock, single bigint key (objsubid=1), namespace 40295 (${row ? row.mode : 'absent'})`);
  const second = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: asset.gkAssetId });
  ok(second.acquired === false, 'a second pooled connection sees the lock (cross-connection visibility through PgBouncer)');
  await m.release();
  const gone = (await observer.query(`SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid`, [classid.toString(), objid.toString()])).rowCount;
  ok(gone === 0, 'after release() the lock is gone although the pooled connection lives on => TRANSACTION-level (not session-level)');

  console.log('\n-- no leak across many acquire/release cycles under pooler churn --');
  let stuck = 0;
  for (let i = 0; i < 25; i++) {
    const a = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: asset.gkAssetId });
    await Promise.all([observer.query('SELECT 1'), h.db.query('SELECT 1')]);
    if (!a.acquired) stuck++;
    await a.release();
  }
  ok(stuck === 0, `25 sequential cycles: every acquire succeeded after the previous release (stuck=${stuck})`);
  const leaked = (await observer.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid`, [classid.toString(), objid.toString()])).rows[0].n;
  ok(leaked === 0, 'zero advisory locks remain for the key afterwards');

  console.log('\n-- the server connection stays PINNED for the whole transaction (PgBouncer transaction mode) --');
  {
    const c = mk(); await c.connect();
    await c.query('BEGIN');
    const pids = new Set();
    for (let i = 0; i < 6; i++) { pids.add((await c.query('SELECT pg_backend_pid() AS p')).rows[0].p); await observer.query('SELECT 1'); await sleep(1500); }
    ok(pids.size === 1, `one backend pid across the whole transaction (${[...pids].join(',')})`);
    await c.query('ROLLBACK'); await c.end();
  }

  console.log(`\n-- hold the mutex ${HOLD_S}s idle (> the pinned 120s function limit): the pooler must not drop or leak it --`);
  {
    const held = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: asset.gkAssetId });
    ok(held.acquired === true, 'acquired for the long hold');
    let refusedAll = true; const t0 = Date.now(); let samples = 0;
    while (Date.now() - t0 < HOLD_S * 1000) {
      await sleep(10000); samples++;
      const probe = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: asset.gkAssetId });
      if (probe.acquired) { refusedAll = false; await probe.release(); }
    }
    ok(refusedAll, `the lock stayed held and visible for the entire ${HOLD_S}s idle hold (${samples} probes, all refused)`);
    const stillThere = (await observer.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND classid = $1::oid AND objid = $2::oid AND granted`, [classid.toString(), objid.toString()])).rows[0].n;
    ok(stillThere === 1, 'pg_locks still shows exactly one granted lock at the end of the hold');
    await held.release();
    const freed = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: asset.gkAssetId });
    ok(freed.acquired === true, 'after the long hold, release() frees the lock');
    await freed.release();
  }

  console.log('\n-- server-side backstop: Postgres frees the lock of an idle-in-transaction holder even if the process never does --');
  {
    const c = mk(); c.on('error', () => {}); await c.connect();
    await c.query('BEGIN'); await c.query('SET LOCAL idle_in_transaction_session_timeout = 2000');
    const got = (await c.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1::text, 40295)) AS g', [KEY])).rows[0].g;
    ok(got === true, 'holder took the lock with the backstop set');
    await sleep(4500);
    const after = await A.acquirePublicationMutex({ principalId: PA, gkAssetId: asset.gkAssetId });
    ok(after.acquired === true, 'after the backstop fired another request can publish (a frozen/leaked holder cannot wedge the asset)');
    await after.release(); try { await c.end(); } catch { /* connection already terminated by the server */ }
  }

  console.log('\n-- timer comparison and static guarantees --');
  const vercel = JSON.parse(readFileSync(path.join(repoRoot, 'vercel.json'), 'utf8'));
  const maxDuration = vercel.functions?.['api/list-ebay.js']?.maxDuration;
  const svc = await import('../src/modules/assets/service.js');
  ok(maxDuration === 120, `vercel.json pins api/list-ebay.js maxDuration (${maxDuration}s)`);
  ok(svc.PUBLICATION_MUTEX_MAX_HOLD_MS > maxDuration * 1000, `self-release timer (${svc.PUBLICATION_MUTEX_MAX_HOLD_MS}ms) is longer than the function limit (${maxDuration * 1000}ms): it cannot release a still-running publication`);
  ok(svc.PUBLICATION_MUTEX_MAX_HOLD_MS + svc.PUBLICATION_MUTEX_SERVER_BACKSTOP_MARGIN_MS > svc.PUBLICATION_MUTEX_MAX_HOLD_MS, 'server-side backstop is later than the JS timer');
  const srcs = ['src/modules/assets/repository.js', 'src/modules/assets/service.js', 'api/list-ebay.js'].map((f) => readFileSync(path.join(repoRoot, f), 'utf8')).join('\n');
  ok(!/pg_advisory_lock\(|pg_try_advisory_lock\(|pg_advisory_unlock/.test(srcs), 'no session-level advisory lock or unlock call exists in the publication path');
  ok(/pg_try_advisory_xact_lock/.test(srcs) && /idle_in_transaction_session_timeout/.test(srcs), 'only transaction-level try-locks are used, with the server-side backstop');
} finally {
  await observer.end().catch(() => {});
  await h.db.end();
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) { console.log('Failures:'); failures.forEach((f) => console.log(`  ✗ ${f}`)); process.exit(1); }
process.exit(0);
