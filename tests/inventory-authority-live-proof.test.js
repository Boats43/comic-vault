// tests/inventory-authority-live-proof.test.js
//
// GRAILKEY — INVENTORY AUTHORITY V1. Real, live proof against real
// Development data1_dev, through the real src/modules/inventory/index.js,
// src/lib/inventoryListingPreflight.js, and a real concurrent-DB race
// (two genuinely simultaneous reserveAsset() calls via Promise.allSettled
// — Postgres's own row-level locking on the UPDATE...WHERE CAS is what
// guarantees correctness, not JS-side coordination). Real transient rows
// are created and deleted in a finally block.
//
// Invoke: node tests/inventory-authority-live-proof.test.js

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["'](.*)["']$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);
const inventory = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'inventory', 'index.js')).href);
const assets = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { assertListingAuthorized, ListingPreflightFailedError } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'inventoryListingPreflight.js')).href);

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, ErrClass, label) => {
  try { await fn(); failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m); }
  catch (e) {
    const ok = e instanceof ErrClass;
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.constructor.name}: ${e.message.slice(0, 100)})`); }
    else { failed++; const m = `  ✗ ${label} (wrong error type: ${e.constructor.name}: ${e.message})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== Inventory Authority — real live proof against real Development data1_dev ===\n');

const preflightClient = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'inventory-authority-live-proof' });
const principalRow = (await preflightClient.query('SELECT id FROM data1_dev.gk_principal LIMIT 1')).rows[0];
const principalId = principalRow.id;

// Two real, existing, distinct Development assets (confirmed owned by
// this principal via current_owner before this dispatch).
const ASSET_A = '01a0283b-a0f2-7bfb-bdf2-d565824fc4e9';
const ASSET_B = '01a0283d-82d5-73ce-ad86-5e61a2d23ae2';

async function cleanupAsset(assetId) {
  await preflightClient.query('DELETE FROM data1_dev.inventory_current_state WHERE gk_asset_id = $1', [assetId]).catch(() => {});
  await preflightClient.query('DELETE FROM data1_dev.inventory_transition_event WHERE gk_asset_id = $1', [assetId]).catch(() => {});
}
async function cleanupOutcomeEvent(externalListingId) {
  await preflightClient.query('DELETE FROM data1_dev.outcome_event WHERE external_listing_id = $1', [externalListingId]).catch(() => {});
}

try {
  // Start clean regardless of any prior leftover state from an aborted run.
  await cleanupAsset(ASSET_A);
  await cleanupAsset(ASSET_B);

  // -------------------------------------------------------------------
  // 1. UNMANAGED cannot list
  // -------------------------------------------------------------------
  console.log('-- UNMANAGED cannot list --\n');
  await assertRejected(
    () => inventory.assertListable({ principalId, gkAssetId: ASSET_A }),
    inventory.ConflictError,
    'UNMANAGED asset fails the listability check'
  );
  await assertRejected(
    () => assertListingAuthorized({ principalId, gkAssetId: ASSET_A, channel: 'ebay' }),
    ListingPreflightFailedError,
    'UNMANAGED asset fails the full listing preflight'
  );

  // -------------------------------------------------------------------
  // 2. Explicit enrollment -> AVAILABLE
  // -------------------------------------------------------------------
  console.log('\n-- Explicit enrollment --\n');
  const enrollKey = `inv-test-enroll-${crypto.randomUUID()}`;
  const enrollResult = await inventory.enrollAsset({ principalId, gkAssetId: ASSET_A, idempotencyKey: enrollKey });
  assertTrue(enrollResult.state === 'AVAILABLE', 'enrollAsset returns state AVAILABLE');
  const stateAfterEnroll = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  assertTrue(stateAfterEnroll.state === 'AVAILABLE', 'getInventoryState confirms AVAILABLE after enrollment');
  assertTrue(stateAfterEnroll.history.length === 1 && stateAfterEnroll.history[0].prior_state === 'UNMANAGED' && stateAfterEnroll.history[0].next_state === 'AVAILABLE', 'exactly one durable transition (UNMANAGED->AVAILABLE) recorded');

  // Enrolling again (already enrolled) is a real conflict, not a silent no-op.
  await assertRejected(
    () => inventory.enrollAsset({ principalId, gkAssetId: ASSET_A, idempotencyKey: `inv-test-enroll-again-${crypto.randomUUID()}` }),
    inventory.ConflictError,
    'a second, distinct enrollment attempt on an already-enrolled asset is rejected'
  );

  // -------------------------------------------------------------------
  // 3. AVAILABLE passes listing preflight
  // -------------------------------------------------------------------
  console.log('\n-- AVAILABLE passes listing preflight --\n');
  const preflightOk = await assertListingAuthorized({ principalId, gkAssetId: ASSET_A, channel: 'ebay' });
  assertTrue(preflightOk.inventoryState === 'AVAILABLE', 'assertListingAuthorized succeeds for a real AVAILABLE, unlisted asset');

  // -------------------------------------------------------------------
  // 4/5. AVAILABLE -> RESERVED, plus the REAL concurrency race (on a
  // FRESH asset so the race is against a clean AVAILABLE start).
  // -------------------------------------------------------------------
  console.log('\n-- Real concurrent reservation race --\n');
  const enrollBKey = `inv-test-enroll-b-${crypto.randomUUID()}`;
  await inventory.enrollAsset({ principalId, gkAssetId: ASSET_B, idempotencyKey: enrollBKey });

  const [raceA, raceB] = await Promise.allSettled([
    inventory.reserveAsset({ principalId, gkAssetId: ASSET_B, channel: 'ebay', externalReference: 'race-order-A', idempotencyKey: `inv-test-race-a-${crypto.randomUUID()}` }),
    inventory.reserveAsset({ principalId, gkAssetId: ASSET_B, channel: 'ebay', externalReference: 'race-order-B', idempotencyKey: `inv-test-race-b-${crypto.randomUUID()}` }),
  ]);
  const succeededCount = [raceA, raceB].filter((r) => r.status === 'fulfilled').length;
  const failedCount = [raceA, raceB].filter((r) => r.status === 'rejected').length;
  assertTrue(succeededCount === 1, `exactly one of two genuinely concurrent, DIFFERENT reservation attempts succeeds (got ${succeededCount} succeeded)`);
  assertTrue(failedCount === 1, `exactly one of two genuinely concurrent, DIFFERENT reservation attempts fails atomically (got ${failedCount} failed)`);
  if (raceA.status === 'rejected') assertTrue(raceA.reason instanceof inventory.ConflictError, 'the losing race attempt fails with a real ConflictError, not a crash');
  if (raceB.status === 'rejected') assertTrue(raceB.reason instanceof inventory.ConflictError, 'the losing race attempt fails with a real ConflictError, not a crash');
  const stateAfterRace = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_B });
  assertTrue(stateAfterRace.state === 'RESERVED', 'asset B ends the race RESERVED (not double-reserved, not left AVAILABLE)');
  const raceTransitions = stateAfterRace.history.filter((h) => h.next_state === 'RESERVED');
  assertTrue(raceTransitions.length === 1, `exactly one RESERVED transition is durably recorded from the race, not two (found ${raceTransitions.length})`);

  // -------------------------------------------------------------------
  // 6. Same reservation replay idempotent (on asset A)
  // -------------------------------------------------------------------
  console.log('\n-- Reservation replay idempotency --\n');
  const reserveKeyA = `inv-test-reserve-a-${crypto.randomUUID()}`;
  const reserve1 = await inventory.reserveAsset({ principalId, gkAssetId: ASSET_A, channel: 'ebay', externalReference: 'order-A1', idempotencyKey: reserveKeyA });
  const reserve2 = await inventory.reserveAsset({ principalId, gkAssetId: ASSET_A, channel: 'ebay', externalReference: 'order-A1', idempotencyKey: reserveKeyA });
  assertTrue(reserve1.transitionEventId === reserve2.transitionEventId, 'a replayed reservation with the SAME idempotencyKey returns the SAME transitionEventId — no duplicate transition');

  // -------------------------------------------------------------------
  // 7. RESERVED cannot newly list
  // -------------------------------------------------------------------
  console.log('\n-- RESERVED cannot list --\n');
  await assertRejected(
    () => assertListingAuthorized({ principalId, gkAssetId: ASSET_A, channel: 'ebay' }),
    ListingPreflightFailedError,
    'a RESERVED asset fails the listing preflight'
  );

  // -------------------------------------------------------------------
  // 8. Legitimate cancellation: RESERVED -> AVAILABLE
  // -------------------------------------------------------------------
  console.log('\n-- Legitimate cancellation --\n');
  const releaseResult = await inventory.releaseReservation({ principalId, gkAssetId: ASSET_A, idempotencyKey: `inv-test-release-${crypto.randomUUID()}` });
  assertTrue(releaseResult.state === 'AVAILABLE', 'releaseReservation returns to AVAILABLE');
  const stateAfterRelease = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  assertTrue(stateAfterRelease.state === 'AVAILABLE', 'getInventoryState confirms AVAILABLE after release');
  const preflightAfterRelease = await assertListingAuthorized({ principalId, gkAssetId: ASSET_A, channel: 'ebay' });
  assertTrue(preflightAfterRelease.inventoryState === 'AVAILABLE', 'the released asset passes the listing preflight again');

  // -------------------------------------------------------------------
  // 9-13. Authoritative sale -> SOLD, terminal, and repeated-reconciliation idempotency
  // -------------------------------------------------------------------
  console.log('\n-- Authoritative sale -> SOLD, terminal --\n');
  const soldKey = `inventory-authority-order-XYZ-SOLD`; // mirrors the reconciler's own real derivation shape
  const sold1 = await inventory.markSold({ principalId, gkAssetId: ASSET_A, channel: 'ebay', externalReference: 'order-XYZ', idempotencyKey: soldKey });
  assertTrue(sold1.state === 'SOLD', 'markSold transitions the real AVAILABLE asset to SOLD');

  // "Repeated reconciliation creates no duplicate transitions" — the
  // SAME idempotencyKey a real reconciler poll would reuse (derived from
  // the same real order id) replays instead of duplicating.
  const sold2 = await inventory.markSold({ principalId, gkAssetId: ASSET_A, channel: 'ebay', externalReference: 'order-XYZ', idempotencyKey: soldKey });
  assertTrue(sold1.transitionEventId === sold2.transitionEventId, 'repeated reconciliation (same order, same derived idempotencyKey) replays the SAME transition, never a duplicate');
  const soldHistory = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  const soldTransitions = soldHistory.history.filter((h) => h.next_state === 'SOLD');
  assertTrue(soldTransitions.length === 1, `exactly one SOLD transition exists durably, even after two calls (found ${soldTransitions.length})`);

  console.log('\n-- SOLD is terminal --\n');
  await assertRejected(
    () => inventory.reserveAsset({ principalId, gkAssetId: ASSET_A, channel: 'ebay', externalReference: 'order-late', idempotencyKey: `inv-test-late-reserve-${crypto.randomUUID()}` }),
    inventory.ConflictError,
    'SOLD cannot be reserved'
  );
  await assertRejected(
    () => assertListingAuthorized({ principalId, gkAssetId: ASSET_A, channel: 'ebay' }),
    ListingPreflightFailedError,
    'SOLD cannot list'
  );
  await assertRejected(
    () => inventory.releaseReservation({ principalId, gkAssetId: ASSET_A, idempotencyKey: `inv-test-late-release-${crypto.randomUUID()}` }),
    inventory.ConflictError,
    'SOLD cannot silently become AVAILABLE via release'
  );
  const finalState = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  assertTrue(finalState.state === 'SOLD', 'asset A remains SOLD after every illegal-transition attempt above — none of them mutated it');

  // -------------------------------------------------------------------
  // 14. Duplicate same-channel listing rejected (uses ASSET_B, real
  // outcome_event LISTED row required for the check to have something
  // to find).
  // -------------------------------------------------------------------
  console.log('\n-- Duplicate same-channel listing rejected --\n');
  // Release B back to AVAILABLE first (it's RESERVED from the race above).
  await inventory.releaseReservation({ principalId, gkAssetId: ASSET_B, idempotencyKey: `inv-test-release-b-${crypto.randomUUID()}` });
  const dupListingId = `inv-test-dup-listing-${crypto.randomUUID()}`;
  const dupListedKey = `inv-test-dup-listed-${crypto.randomUUID()}`;
  await assets.recordOutcomeEvent({
    principalId, gkAssetId: ASSET_B, outcomeType: 'LISTED', channel: 'ebay', externalListingId: dupListingId,
    askAmount: 50, idempotencyKey: dupListedKey,
  });
  await assertRejected(
    () => assertListingAuthorized({ principalId, gkAssetId: ASSET_B, channel: 'ebay' }),
    ListingPreflightFailedError,
    'a second NEW listing attempt while one is already active on the same channel is rejected'
  );
  // But a REPLAY of the SAME request (same idempotencyKey already claimed) is not blocked by the duplicate check.
  const sameKeyReplay = `inv-test-dup-listed-replay-${crypto.randomUUID()}`;
  await assets.recordOutcomeEvent({
    principalId, gkAssetId: ASSET_B, outcomeType: 'LISTED', channel: 'ebay', externalListingId: `${dupListingId}-b`,
    askAmount: 50, idempotencyKey: sameKeyReplay,
  });
  const replayPreflight = await assertListingAuthorized({ principalId, gkAssetId: ASSET_B, channel: 'ebay', outcomeIdempotencyKey: sameKeyReplay });
  assertTrue(replayPreflight.inventoryState === 'AVAILABLE', 'a legitimate replay of an already-claimed idempotencyKey is NOT blocked by the duplicate-listing check');
  await cleanupOutcomeEvent(dupListingId);
  await cleanupOutcomeEvent(`${dupListingId}-b`);
  await preflightClient.query(`DELETE FROM data1_dev.idempotency_key WHERE idempotency_key IN ($1, $2)`, [sameKeyReplay, dupListedKey]).catch(() => {});

  // -------------------------------------------------------------------
  // 15. Unknown/ambiguous state fails closed
  // -------------------------------------------------------------------
  console.log('\n-- Unknown state fails closed --\n');
  await assertRejected(
    () => inventory.assertListable({ principalId, gkAssetId: crypto.randomUUID() /* not a real asset at all */ }),
    inventory.NotFoundError,
    'a completely nonexistent gk_asset fails closed, never treated as listable'
  );

  // -------------------------------------------------------------------
  // 16. No automatic eBay reservation signal exists — structural proof
  // -------------------------------------------------------------------
  console.log('\n-- No automatic eBay-driven reservation exists (structural proof) --\n');
  const reconcilerSrc = readFileSync(path.join(repoRoot, 'src', 'lib', 'ebayOutcomeReconciler.js'), 'utf8');
  assertTrue(!/reserveAsset|markInventoryReserve/.test(reconcilerSrc), 'ebayOutcomeReconciler.js contains zero calls to reserveAsset — no automatic AVAILABLE->RESERVED transition is ever driven by eBay order/payment data (V1: reservation is manual/API-driven only)');
  assertTrue(/markInventorySold/.test(reconcilerSrc), 'the reconciler DOES call markSold — only the terminal, already-authoritative SOLD evidence rule drives an automatic inventory transition');

} finally {
  await cleanupAsset(ASSET_A);
  await cleanupAsset(ASSET_B);
  await preflightClient.end();
  await inventory.closePool();
  await assets.closePool();
  console.log('\n  cleaned up all transient inventory rows for both test assets');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
