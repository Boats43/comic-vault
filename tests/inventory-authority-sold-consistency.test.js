// tests/inventory-authority-sold-consistency.test.js
//
// GRAILKEY — INVENTORY AUTHORITY SOLD CONSISTENCY CLOSEOUT. Real, live
// proof against real Development data1_dev that the split-brain
// (outcome_event = SOLD while inventory_current_state stays AVAILABLE/
// RESERVED because the reconciler's own best-effort markSold() write
// failed) can never make a truly SOLD asset listable or reservable
// again, and that the projection self-heals idempotently once repair
// succeeds.
//
// CONTROLLED REAL FAILURE INJECTION: attemptInventoryMarkSold() is
// called with a REAL, valid, but WRONG-owner principalId — a genuine
// AuthorizationFailedError thrown by the real code (assertPrincipalOwnsAsset),
// not a mock or a simulated network outage. This is exactly the shape
// of failure attemptInventoryMarkSold()'s own catch-all branch is built
// to survive: some real error prevents the projection write from ever
// reaching its CAS, leaving inventory_current_state stale while
// outcome_event's SOLD row is already durable.
//
// Invoke: node tests/inventory-authority-sold-consistency.test.js

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
const { attemptInventoryMarkSold } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'ebayOutcomeReconciler.js')).href);
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
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.constructor.name}: ${e.message.slice(0, 110)})`); }
    else { failed++; const m = `  ✗ ${label} (wrong error type: ${e.constructor.name}: ${e.message})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== Inventory Authority — SOLD consistency closeout (real live proof, real failure injection) ===\n');

const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'inventory-authority-sold-consistency' });
const principalRows = (await client.query('SELECT id FROM data1_dev.gk_principal LIMIT 2')).rows;
const principalId = principalRows[0].id;
// A real, valid, but WRONG-owner principal for the controlled real
// failure injection below — genuinely does not own ASSET_A.
const wrongPrincipalId = principalRows[1]?.id;

const ASSET_A = '01a0283b-a0f2-7bfb-bdf2-d565824fc4e9';
const ASSET_UNMANAGED_BUT_SOLD = '01a0283d-82d5-73ce-ad86-5e61a2d23ae2'; // "somehow sold without ever being enrolled" edge case

async function cleanupAsset(assetId) {
  await client.query('DELETE FROM data1_dev.outcome_economics_component WHERE outcome_event_id IN (SELECT id FROM data1_dev.outcome_event WHERE gk_asset_id = $1)', [assetId]).catch(() => {});
  await client.query('DELETE FROM data1_dev.outcome_event WHERE gk_asset_id = $1', [assetId]).catch(() => {});
  await client.query('DELETE FROM data1_dev.inventory_current_state WHERE gk_asset_id = $1', [assetId]).catch(() => {});
  await client.query('DELETE FROM data1_dev.inventory_transition_event WHERE gk_asset_id = $1', [assetId]).catch(() => {});
}

try {
  if (!wrongPrincipalId) throw new Error('Need at least 2 real gk_principal rows in Development for the failure-injection scenario — only found 1.');

  await cleanupAsset(ASSET_A);
  await cleanupAsset(ASSET_UNMANAGED_BUT_SOLD);

  // ===================================================================
  // 1. TRACE THE FAILURE PATH — reproduce the split-brain for real
  // ===================================================================
  console.log('-- Reproducing the split-brain (real writes) --\n');

  await inventory.enrollAsset({ principalId, gkAssetId: ASSET_A, idempotencyKey: `sc-enroll-${crypto.randomUUID()}` });
  const stateAfterEnroll = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  assertTrue(stateAfterEnroll.state === 'AVAILABLE', 'setup: ASSET_A enrolled and AVAILABLE');

  const orderId = `order-${crypto.randomUUID()}`;
  const externalListingId = `sc-listing-${crypto.randomUUID()}`;
  // Step 1: "authoritative eBay SOLD evidence found; SOLD outcome_event
  // succeeds" — the exact real write reconcileEbayOutcome() itself makes.
  const soldOutcome = await assets.recordOutcomeEvent({
    principalId, gkAssetId: ASSET_A, outcomeType: 'SOLD', channel: 'ebay', externalListingId,
    grossAmount: 42, idempotencyKey: `sc-sold-outcome-${crypto.randomUUID()}`,
  });
  assertTrue(!!soldOutcome.outcomeEventId, 'a real, durable SOLD outcome_event is recorded for ASSET_A');

  const soldCheckBeforeRepair = await assets.hasAuthoritativeSoldOutcome({ principalId, gkAssetId: ASSET_A });
  assertTrue(soldCheckBeforeRepair.sold === true, 'hasAuthoritativeSoldOutcome confirms the durable SOLD fact exists');

  const stateBeforeRepair = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  assertTrue(stateBeforeRepair.state === 'AVAILABLE', 'THE SPLIT-BRAIN, REPRODUCED: inventory_current_state is STILL AVAILABLE — outcome_event says SOLD, the projection has not caught up yet');

  // Step 2: "markSold() fails" — CONTROLLED REAL FAILURE INJECTION. A
  // real, valid, but wrong-owner principal makes assertPrincipalOwnsAsset
  // throw a genuine AuthorizationFailedError — a real failure, not a mock.
  const repairKey = `inventory-authority-${orderId}-SOLD`;
  const failedAttempt = await attemptInventoryMarkSold({ principalId: wrongPrincipalId, gkAssetId: ASSET_A, channel: 'ebay', orderId });
  assertTrue(failedAttempt.attempted === true && failedAttempt.applied === false, 'the injected markSold() failure is real, caught, and non-throwing — attemptInventoryMarkSold reports attempted:true, applied:false');

  const stateAfterInjectedFailure = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  assertTrue(stateAfterInjectedFailure.state === 'AVAILABLE', 'inventory_current_state remains genuinely stale (AVAILABLE) after the injected failure — nothing silently changed');
  assertTrue(stateAfterInjectedFailure.history.every((h) => h.next_state !== 'SOLD'), 'no SOLD transition_event exists yet — the failed attempt never reached the transition insert (real AuthorizationFailedError fires before it)');

  // ===================================================================
  // 2/3. THE FAIL-CLOSED INVARIANT — proven despite the stale projection
  // ===================================================================
  console.log('\n-- Fail-closed despite stale AVAILABLE projection --\n');

  await assertRejected(
    () => assertListingAuthorized({ principalId, gkAssetId: ASSET_A, channel: 'ebay' }),
    ListingPreflightFailedError,
    'LIST preflight REJECTS the split-brain asset — SOLD outcome history wins over the stale AVAILABLE projection'
  );
  await assertRejected(
    () => inventory.reserveAsset({ principalId, gkAssetId: ASSET_A, channel: 'ebay', externalReference: `late-order-${crypto.randomUUID()}`, idempotencyKey: `sc-late-reserve-${crypto.randomUUID()}` }),
    inventory.ConflictError,
    'reserveAsset() ALSO rejects the split-brain asset directly (defense in depth, not just the LIST preflight)'
  );

  // Edge case: an asset that was NEVER enrolled (UNMANAGED) but somehow
  // has a real SOLD outcome_event (e.g. a legacy/bypass path) must also
  // never become enrollable.
  await assets.recordOutcomeEvent({
    principalId, gkAssetId: ASSET_UNMANAGED_BUT_SOLD, outcomeType: 'SOLD', channel: 'ebay',
    externalListingId: `sc-legacy-sold-${crypto.randomUUID()}`, idempotencyKey: `sc-legacy-sold-outcome-${crypto.randomUUID()}`,
  });
  await assertRejected(
    () => inventory.enrollAsset({ principalId, gkAssetId: ASSET_UNMANAGED_BUT_SOLD, idempotencyKey: `sc-legacy-enroll-${crypto.randomUUID()}` }),
    inventory.ConflictError,
    'enrollAsset() rejects an UNMANAGED asset that already has a real SOLD outcome_event — never becomes enrollable'
  );

  // ===================================================================
  // 4. REPAIR — repeated reconciler execution self-heals idempotently
  // ===================================================================
  console.log('\n-- Repair (repeated reconciler execution) --\n');

  const repairAttempt1 = await attemptInventoryMarkSold({ principalId, gkAssetId: ASSET_A, channel: 'ebay', orderId });
  assertTrue(repairAttempt1.applied === true && repairAttempt1.state === 'SOLD', 'a repeat reconciler run, now with the CORRECT principal, repairs the projection to SOLD');

  const stateAfterRepair = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  assertTrue(stateAfterRepair.state === 'SOLD', 'inventory_current_state now correctly reads SOLD');
  const soldTransitions = stateAfterRepair.history.filter((h) => h.next_state === 'SOLD');
  assertTrue(soldTransitions.length === 1, `exactly one SOLD inventory transition exists after repair (found ${soldTransitions.length})`);

  // A THIRD reconciler pass (e.g. the very next scheduled poll) — proves
  // the repair itself is idempotent, never a second SOLD transition.
  const repairAttempt2 = await attemptInventoryMarkSold({ principalId, gkAssetId: ASSET_A, channel: 'ebay', orderId });
  assertTrue(repairAttempt2.applied === true && repairAttempt2.state === 'SOLD', 'a further repeated repair run also reports applied:true (idempotent replay)');
  const stateAfterSecondRepair = await inventory.getInventoryState({ principalId, gkAssetId: ASSET_A });
  const soldTransitionsAfterSecondRepair = stateAfterSecondRepair.history.filter((h) => h.next_state === 'SOLD');
  assertTrue(soldTransitionsAfterSecondRepair.length === 1, `still exactly one SOLD inventory transition after a second repair run — no duplicate created (found ${soldTransitionsAfterSecondRepair.length})`);

  const outcomeEventCount = (await client.query('SELECT count(*)::int AS n FROM data1_dev.outcome_event WHERE gk_asset_id = $1 AND outcome_type = $2', [ASSET_A, 'SOLD'])).rows[0].n;
  assertTrue(outcomeEventCount === 1, `exactly one durable SOLD outcome_event exists throughout — never duplicated by any repair attempt (found ${outcomeEventCount})`);

  // ===================================================================
  // Further LIST/reserve attempts still fail after repair (now for the
  // ordinary, already-established SOLD-state reasons too).
  // ===================================================================
  console.log('\n-- Further LIST/reserve attempts still fail post-repair --\n');
  await assertRejected(
    () => assertListingAuthorized({ principalId, gkAssetId: ASSET_A, channel: 'ebay' }),
    ListingPreflightFailedError,
    'LIST preflight still rejects after repair'
  );
  await assertRejected(
    () => inventory.reserveAsset({ principalId, gkAssetId: ASSET_A, channel: 'ebay', externalReference: `post-repair-${crypto.randomUUID()}`, idempotencyKey: `sc-post-repair-reserve-${crypto.randomUUID()}` }),
    inventory.ConflictError,
    'reserveAsset() still rejects after repair'
  );

} finally {
  await cleanupAsset(ASSET_A);
  await cleanupAsset(ASSET_UNMANAGED_BUT_SOLD);
  await client.end();
  await inventory.closePool();
  await assets.closePool();
  console.log('\n  cleaned up all transient outcome_event/inventory rows for both test assets');
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log(f));
  process.exit(1);
}
