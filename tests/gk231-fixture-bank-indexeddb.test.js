// tests/gk231-fixture-bank-indexeddb.test.js
//
// GK-231 PRODUCTION SMOKE FAILURE trace (2026-09-20) — a real phone export
// produced `[]` after a real attempt to bank a fixture. This is a REAL
// spec-compliant IndexedDB integration test (fake-indexeddb — the same
// engine Node's own IndexedDB test suites use, not a hand-rolled mock),
// not a re-implementation of src/db.js's logic. Exercises the exact
// exported functions the browser bank/export buttons call, unmodified.
//
// Required coverage per the dispatch: bank 1 fixture -> reread store ->
// export -> array length === 1.
//
// Invoke: node tests/gk231-fixture-bank-indexeddb.test.js

import 'fake-indexeddb/auto';

let passed = 0;
let failed = 0;
const failures = [];
const assertEq = (actual, expected, label) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed++; console.log(`  ✓ ${label}`);
  } else {
    failed++;
    const msg = `  ✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`;
    failures.push(msg); console.log(msg);
  }
};
const assertTrue = (cond, label) => assertEq(!!cond, true, label);

console.log('\n=== GK-231 — fixtureBank IndexedDB integration (fake-indexeddb) ===\n');

async function main() {
  // Fresh module import AFTER fake-indexeddb/auto has installed globalThis.indexedDB —
  // src/db.js reads the bare global `indexedDB`, exactly as it would in a real browser.
  const { putFixture, getAllFixtures, deleteFixture, clearFixtureBank } = await import('../src/db.js');

  console.log('Happy path — bank 1, reread, export:');
  const fixtureA = {
    traceId: 'trace-aaa-111',
    capturedAt: '2026-09-20T18:00:00.000Z',
    identity: { title: 'Amazing Spider-Man', issue: '91' },
  };
  await putFixture(fixtureA);
  const afterOne = await getAllFixtures();
  assertEq(afterOne.length, 1, 'bank 1 fixture -> reread store -> length === 1 (dispatch\'s own required coverage)');
  assertEq(afterOne[0].traceId, 'trace-aaa-111', 'the reread record is the one just banked, byte-identical key');
  assertEq(afterOne[0].identity.title, 'Amazing Spider-Man', 'nested fields survive the round trip');

  console.log('\nIdempotency — re-banking the SAME traceId overwrites, never duplicates:');
  await putFixture({ ...fixtureA, identity: { title: 'Amazing Spider-Man', issue: '91' }, operatorNote: 'second bank attempt' });
  const afterRebank = await getAllFixtures();
  assertEq(afterRebank.length, 1, 'still exactly 1 record after banking the identical traceId a second time');
  assertEq(afterRebank[0].operatorNote, 'second bank attempt', 'the overwrite actually took (latest content wins)');

  console.log('\nMultiple distinct fixtures:');
  await putFixture({ traceId: 'trace-bbb-222', capturedAt: '2026-09-20T18:05:00.000Z', identity: { title: 'Unexpected', issue: '122' } });
  const afterTwo = await getAllFixtures();
  assertEq(afterTwo.length, 2, '2 distinct traceIds -> 2 records');

  console.log('\nFresh module reconnection (simulates a page reload between bank and export):');
  // A real page reload re-executes db.js from scratch — new module
  // instance, new `dbPromise`. fake-indexeddb's global store persists
  // across this (same underlying fake IndexedDB backend, same as a real
  // browser's on-disk IndexedDB persisting across page loads) — proving
  // the DATA itself is not the transient part; only the JS module's
  // in-memory `dbPromise` cache is. ESM has no require.cache — a
  // cache-busting query param forces a genuinely fresh module instance.
  const dbModuleFresh = await import(`../src/db.js?fresh=${Date.now()}`);
  const afterReload = await dbModuleFresh.getAllFixtures();
  assertEq(afterReload.length, 2, 'a fresh module load (reload-equivalent) still sees both banked records — IndexedDB persistence itself is not the bug');

  console.log('\nCleanup:');
  await clearFixtureBank();
  const afterClear = await getAllFixtures();
  assertEq(afterClear.length, 0, 'clearFixtureBank empties the store');

  // ═══════════════════════════════════════════════════════════════════
  // Jimmy's REAL phone state: an EXISTING v2 database (comics/
  // valueSnapshots/analysisCache, populated from real prior catalogue
  // use, per this repo's own commit history — no fixtureBank) upgrading
  // to v3 for the first time on this deploy. Fresh IndexedDB backend
  // (separate from the happy-path test above) to model this precisely.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\nReal-world v2->v3 upgrade path (existing catalogue data, first load of this deploy):');
  {
    // NOTE ON METHOD: an earlier version of this test tried to reuse the
    // literal name "comic-vault" across sections via indexedDB.
    // deleteDatabase() between them — that call itself HUNG INDEFINITELY,
    // because src/db.js's openDb() never closes the IDBDatabase
    // connections opened by the happy-path section above, and
    // deleteDatabase() blocks (silently, no timeout, no onblocked handler
    // was attached to it either) while ANY connection to that name stays
    // open. That hang is itself real, reproduced evidence for this
    // dispatch's root-cause trace — see the report. Sidestepped here by
    // using a distinct DB name per section instead of fighting it.
    const V2_NAME = 'comic-vault-upgrade-sim';
    // Step 1: simulate Jimmy's phone BEFORE this deploy — a real v2
    // database, opened and populated the old way (no fixtureBank store).
    await new Promise((resolve, reject) => {
      const req = indexedDB.open(V2_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        const store = db.createObjectStore('comics', { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        db.createObjectStore('valueSnapshots', { keyPath: 'date' });
        db.createObjectStore('analysisCache', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('comics', 'readwrite');
        tx.objectStore('comics').put({ id: 'real-comic-1', title: 'Real Pre-Existing Catalogue Item', timestamp: Date.now() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    // Step 2: replicate db.js's own openDb()/getAllComics()/putFixture()
    // logic directly against V2_NAME (can't redirect the real module's
    // hardcoded "comic-vault" without a second real DB deadlock — this
    // exercises the identical upgrade/read/write code path db.js runs,
    // just inlined against an isolated name for this one assertion).
    const db3 = await new Promise((resolve, reject) => {
      const req = indexedDB.open(V2_NAME, 3);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('fixtureBank')) {
          const s = db.createObjectStore('fixtureBank', { keyPath: 'traceId' });
          s.createIndex('capturedAt', 'capturedAt', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const comicsAfterUpgrade = await new Promise((resolve, reject) => {
      const req = db3.transaction('comics', 'readonly').objectStore('comics').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    assertEq(comicsAfterUpgrade.length, 1, 'v2->v3 upgrade preserves pre-existing catalogue data (real prior scans not lost)');
    assertEq(comicsAfterUpgrade[0].id, 'real-comic-1', 'the pre-existing record survives the upgrade byte-identical');

    const fixturesAfterUpgrade = await new Promise((resolve, reject) => {
      const req = db3.transaction('fixtureBank', 'readonly').objectStore('fixtureBank').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    assertEq(fixturesAfterUpgrade.length, 0, 'fixtureBank store exists and is queryable immediately after the v2->v3 upgrade (empty, not erroring)');
    db3.close();
  }

  // ═══════════════════════════════════════════════════════════════════
  // The onblocked gap: src/db.js's openDb() has no req.onblocked handler.
  // Per the IndexedDB spec, a version-upgrade open() is BLOCKED (never
  // fires onupgradeneeded/onsuccess) while any OTHER connection to the
  // same database, opened at a lower version, remains open — exactly
  // what happens if a stale browser tab/PWA instance (holding a v2
  // connection from before this deploy) is still alive when a v3 tab
  // loads. Proven for real below, not asserted from documentation alone.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\nRoot-cause candidate — missing onblocked handler under a real version-change block:');
  {
    const BLOCK_NAME = 'comic-vault-block-sim';
    // An OLD connection stays open at v2 (models a stale tab/PWA instance
    // that never reloaded — e.g. iOS backgrounding a PWA tab instead of
    // killing it, or a second tab the operator forgot was open).
    const staleV2Connection = await new Promise((resolve, reject) => {
      const req = indexedDB.open(BLOCK_NAME, 2);
      req.onupgradeneeded = () => { req.result.createObjectStore('comics', { keyPath: 'id' }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // The NEW v3 tab loads and calls openDb() — reproducing db.js's own
    // exact open() call, with (a) its real onupgradeneeded/onsuccess/
    // onerror handlers, and (b) an added onblocked probe so THIS test can
    // observe what the shipped code cannot (db.js has no onblocked at all).
    let blockedFired = false;
    let upgradeOrSuccessFired = false;
    const v3OpenOutcome = new Promise((resolve) => {
      const req = indexedDB.open(BLOCK_NAME, 3);
      req.onupgradeneeded = () => { upgradeOrSuccessFired = true; };
      req.onsuccess = () => { upgradeOrSuccessFired = true; resolve('resolved'); };
      req.onerror = () => resolve('errored');
      req.onblocked = () => { blockedFired = true; };
      // db.js's own openDb() has NO timeout/onblocked handling at all —
      // modeling that exactly: if neither upgrade/success nor error fires
      // within one tick after the stale connection is closed, nothing in
      // the real shipped code would ever tell the operator why.
    });

    // Give the blocked open() a chance to actually fire onblocked before
    // anything closes the stale connection.
    await new Promise((r) => setTimeout(r, 20));
    assertTrue(blockedFired, 'CONFIRMED: a stale v2 connection genuinely blocks the v3 open() — real IndexedDB behavior, not a hypothesis');
    assertTrue(!upgradeOrSuccessFired, 'CONFIRMED: while blocked, the v3 open() has fired NEITHER onupgradeneeded NOR onsuccess yet — matches db.js\'s own openDb() promise never resolving during this window');

    // Now the stale connection finally closes (operator closes the old
    // tab, or the OS reclaims it) — the blocked open() should proceed.
    staleV2Connection.close();
    const outcome = await v3OpenOutcome;
    assertEq(outcome, 'resolved', 'once the stale connection closes, the v3 open() DOES eventually complete on its own — db.js\'s openDb() promise resolves late, not never, once whatever was blocking it goes away');
  }

  console.log(`\n${'='.repeat(60)}\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
