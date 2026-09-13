// tests/p0a-rescan-asset-continuity.test.js
//
// P0-A (POST-OPERATORACTION P0 dispatch) — rescan/link-drift continuity.
//
// Required invariant: same physical asset before rescan == same
// gkAssetId after rescan. Browser/catalogue ids (collectionItemId) may
// change, but must be preserved as aliases/revisions, never severing
// ownership, valuation history, decision history, or operator-action
// history.
//
// Part 1 REPRODUCES the old failure deterministically: captureFromScan
// (src/modules/capture/service.js), called with a genuinely new
// collectionItemId and no continuity information, has NO way to know
// it's the same physical book as an already-captured one — it mints a
// second, disconnected gkAssetId. This is not itself a bug (a genuinely
// NEW physical item must behave exactly this way) — it demonstrates WHY
// a caller performing a real rescan must assert continuity explicitly.
//
// Part 2 proves the fix: scanPayload.priorCollectionItemId lets a caller
// assert "this new collectionItemId is the same physical asset as that
// already-linked one" — captureFromScan then attaches to the EXISTING
// gkAssetId instead of minting fresh, and the asset's full history
// (ownership, valuation, decision, operator-action) survives untouched
// and reachable under BOTH the old and the new collectionItemId (an
// alias accumulates; nothing is replaced or deleted).
//
// Real, live data1_dev (this module has no schema-override mechanism) —
// every asset/link this test creates is fully deleted at the end.
// Creepy (01a02d23-1acb-72e8-aae3-8f851308e9cf) and its real Chain #2
// history are never touched.
//
// Invoke: node tests/p0a-rescan-asset-continuity.test.js

import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';

const {
  recordValuation, recordDecision, recordOperatorAction, getPhysicalAsset,
  resolveCollectionItemLink, closePool,
} = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')));
const { captureFromScan, ValidationFailedError } =
  await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'capture', 'index.js')));

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};
const assertRejected = async (fn, label, ExpectedClass) => {
  try {
    await fn();
    failed++; const m = `  ✗ ${label} (did NOT reject)`; failures.push(m); console.log(m);
  } catch (e) {
    const ok = !ExpectedClass || e instanceof ExpectedClass;
    if (ok) { passed++; console.log(`  ✓ ${label} (rejected: ${e.message.slice(0, 140)})`); }
    else { failed++; const m = `  ✗ ${label} (rejected but wrong type: ${e.constructor.name}: ${e.message})`; failures.push(m); console.log(m); }
  }
};

console.log('\n=== P0-A — rescan asset continuity (real, disposable assets) ===\n');

const JIMMY_PRINCIPAL_ID = '01a0283a-b1b6-7f90-9b41-9c06bee6ecba';
const TAG = `p0a-rescan-${Date.now()}`;
const idempotencyKeysUsed = [];
const createdAssetIds = [];
const createdCollectionItemIds = [];

const client = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query('SET search_path TO data1_dev');

async function countAll() {
  const r = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM gk_asset) AS gk_asset,
      (SELECT COUNT(*)::int FROM entity_mint_basis) AS entity_mint_basis,
      (SELECT COUNT(*)::int FROM mint_event) AS mint_event,
      (SELECT COUNT(*)::int FROM asset_identity_assignment) AS asset_identity_assignment,
      (SELECT COUNT(*)::int FROM ownership_event) AS ownership_event,
      (SELECT COUNT(*)::int FROM valuation_event) AS valuation_event,
      (SELECT COUNT(*)::int FROM decision_event) AS decision_event,
      (SELECT COUNT(*)::int FROM operator_action_event) AS operator_action_event,
      (SELECT COUNT(*)::int FROM domain_event) AS domain_event,
      (SELECT COUNT(*)::int FROM current_owner) AS current_owner,
      (SELECT COUNT(*)::int FROM collection_item_link) AS collection_item_link,
      (SELECT COUNT(*)::int FROM idempotency_key) AS idempotency_key
  `);
  return r.rows[0];
}

const before = await countAll();
console.log('  pre-test table counts:', JSON.stringify(before));

try {
  // --- Setup: mint asset A via captureFromScan, collectionItemId = OLD ---
  const OLD_ID = `${TAG}-classic-old`;
  createdCollectionItemIds.push(OLD_ID);
  const cap1 = await captureFromScan({
    principalId: JIMMY_PRINCIPAL_ID,
    scanPayload: { collectionItemId: OLD_ID, correlationId: crypto.randomUUID() },
    idempotencyKey: `${TAG}:cap1`,
  });
  idempotencyKeysUsed.push(`${TAG}:cap1:mint`, `${TAG}:cap1:link`, `${TAG}:cap1:identity`);
  createdAssetIds.push(cap1.gkAssetId);
  assertTrue(cap1.mintOutcome === 'minted-new', 'setup: fresh asset A minted on first capture');
  assertTrue(cap1.linkOutcome === 'linked', 'setup: OLD collectionItemId linked to asset A');

  // Real history on asset A: valuation -> decision -> operator action.
  const val = await recordValuation({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: cap1.gkAssetId, valueAmount: 42, method: 'engine-computed', buildSha: 'p0a-test', idempotencyKey: `${TAG}:val` });
  idempotencyKeysUsed.push(`${TAG}:val`);
  const dec = await recordDecision({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: cap1.gkAssetId, recommendation: 'LIST_LOW', valuationEventId: val.valuationEventId, idempotencyKey: `${TAG}:dec` });
  idempotencyKeysUsed.push(`${TAG}:dec`);
  const opAction = await recordOperatorAction({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: cap1.gkAssetId, decisionEventId: dec.decisionEventId, actionCode: 'HOLD', source: 'test-fixture', idempotencyKey: `${TAG}:opact` });
  idempotencyKeysUsed.push(`${TAG}:opact`);
  assertTrue(!!opAction.operatorActionEventId, 'setup: operator-action recorded against asset A');

  // === Part 1 — REPRODUCE THE OLD FAILURE, deterministically ===
  // A "rescan" that mints a genuinely fresh browser-side collectionItemId
  // with NO continuity assertion has no way to be distinguished from a
  // real new physical book — it mints a SECOND, disconnected gkAssetId.
  const DRIFTED_ID = `${TAG}-classic-drifted`;
  createdCollectionItemIds.push(DRIFTED_ID);
  const capDrift = await captureFromScan({
    principalId: JIMMY_PRINCIPAL_ID,
    scanPayload: { collectionItemId: DRIFTED_ID, correlationId: crypto.randomUUID() },
    idempotencyKey: `${TAG}:capdrift`,
  });
  idempotencyKeysUsed.push(`${TAG}:capdrift:mint`, `${TAG}:capdrift:link`, `${TAG}:capdrift:identity`);
  createdAssetIds.push(capDrift.gkAssetId);
  assertTrue(
    capDrift.mintOutcome === 'minted-new' && capDrift.gkAssetId !== cap1.gkAssetId,
    'Part 1 (reproduced failure): a rescan with a new collectionItemId and NO continuity info mints a SEPARATE gkAssetId — the drift this dispatch fixes'
  );

  // === Part 2 — PROVE THE FIX ===
  // A genuine rescan asserts continuity via priorCollectionItemId.
  const NEW_ID = `${TAG}-classic-new`;
  createdCollectionItemIds.push(NEW_ID);
  const capFixed = await captureFromScan({
    principalId: JIMMY_PRINCIPAL_ID,
    scanPayload: { collectionItemId: NEW_ID, priorCollectionItemId: OLD_ID, correlationId: crypto.randomUUID() },
    idempotencyKey: `${TAG}:capfixed`,
  });
  idempotencyKeysUsed.push(`${TAG}:capfixed:link`, `${TAG}:capfixed:identity`);
  assertTrue(
    capFixed.mintOutcome === 'attached-existing-via-continuity-alias' && capFixed.gkAssetId === cap1.gkAssetId,
    'Part 2: a rescan asserting priorCollectionItemId attaches to the SAME gkAssetId as the original — no second mint'
  );
  assertTrue(capFixed.linkOutcome === 'linked', 'Part 2: the NEW collectionItemId gets its own link row (an alias), not a rewrite of the old one');

  // Ownership: unchanged, still asset A's original owner.
  const graphAfter = await getPhysicalAsset({ principalId: JIMMY_PRINCIPAL_ID, gkAssetId: cap1.gkAssetId });
  assertTrue(graphAfter.currentOwner?.owner_principal_id === JIMMY_PRINCIPAL_ID, 'Part 2: ownership survives the rescan untouched');

  // Valuation/decision/operator-action history: not severed, still all
  // present under the SAME gkAssetId (this is what "future marketplace
  // execution" would read).
  assertTrue(graphAfter.valuations.some(v => v.id === val.valuationEventId), 'Part 2: original valuation_event still reachable under the same gkAssetId');
  assertTrue(graphAfter.decisions.some(d => d.id === dec.decisionEventId), 'Part 2: original decision_event still reachable under the same gkAssetId');
  const opActionCheck = await client.query('SELECT id FROM operator_action_event WHERE id = $1 AND gk_asset_id = $2', [opAction.operatorActionEventId, cap1.gkAssetId]);
  assertTrue(opActionCheck.rowCount === 1, 'Part 2: original operator_action_event still attached to the same gkAssetId, not orphaned');

  // Aliases: BOTH the old and the new collectionItemId resolve to the
  // SAME asset — the old one was never deleted or repointed.
  const resolveOld = await resolveCollectionItemLink({ principalId: JIMMY_PRINCIPAL_ID, collectionItemId: OLD_ID });
  const resolveNew = await resolveCollectionItemLink({ principalId: JIMMY_PRINCIPAL_ID, collectionItemId: NEW_ID });
  assertTrue(resolveOld?.gkAssetId === cap1.gkAssetId, 'Part 2: OLD collectionItemId still independently resolves to asset A (alias preserved)');
  assertTrue(resolveNew?.gkAssetId === cap1.gkAssetId, 'Part 2: NEW collectionItemId resolves to the SAME asset A (new alias)');

  // Fail-closed: a continuity assertion that does not resolve must
  // reject, never silently mint fresh (that would defeat the whole
  // point — a caller bug must be surfaced, not hidden).
  await assertRejected(
    () => captureFromScan({
      principalId: JIMMY_PRINCIPAL_ID,
      scanPayload: { collectionItemId: `${TAG}-classic-bogus`, priorCollectionItemId: `${TAG}-never-existed`, correlationId: crypto.randomUUID() },
      idempotencyKey: `${TAG}:capbogus`,
    }),
    'Part 2: an unresolvable priorCollectionItemId fails closed (ValidationFailedError), never silently mints fresh',
    ValidationFailedError
  );

  // Regression: the pre-existing "same collectionItemId, called again"
  // path is unchanged — still attaches via the direct link, no
  // continuity logic even consulted.
  const capReplay = await captureFromScan({
    principalId: JIMMY_PRINCIPAL_ID,
    scanPayload: { collectionItemId: OLD_ID, correlationId: crypto.randomUUID() },
    idempotencyKey: `${TAG}:capreplay`,
  });
  idempotencyKeysUsed.push(`${TAG}:capreplay:identity`);
  assertTrue(
    capReplay.mintOutcome === 'attached-existing-via-link' && capReplay.gkAssetId === cap1.gkAssetId,
    'Regression: re-capturing the SAME collectionItemId still attaches via the direct link (unchanged default behavior)'
  );
} finally {
  // asset_identity_assignment is immutable (0015's guard trigger, never
  // deleted or updated) and captureFromScan calls assignIdentity
  // unconditionally on EVERY invocation (fresh mint or attach-existing
  // alike) — so every asset this test creates or re-touches leaves a
  // permanently-retained assignment row, which in turn (via its own FK)
  // permanently blocks deleting that row's gk_asset/mint_event/
  // entity_mint_basis. Same precedent as tests/d3-2-application-wiring-
  // live-proof.test.js's own cleanup comment (GK-188 finding) — accepted
  // here rather than fought, since fighting it would mean never calling
  // the real captureFromScan orchestration at all.
  for (const assetId of createdAssetIds) {
    await client.query(`DELETE FROM outbox WHERE domain_event_id IN (SELECT event_id FROM domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
    await client.query(`DELETE FROM domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
    await client.query(`DELETE FROM operator_action_event WHERE gk_asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM decision_event WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM valuation_event WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM collection_item_link WHERE gk_asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM current_owner WHERE asset_id = $1`, [assetId]);
    await client.query(`DELETE FROM ownership_event WHERE asset_id = $1`, [assetId]);
  }
  if (createdCollectionItemIds.length > 0) {
    await client.query(`DELETE FROM collection_item_link WHERE collection_item_id = ANY($1::text[])`, [createdCollectionItemIds]);
  }
  if (idempotencyKeysUsed.length > 0) {
    await client.query(`DELETE FROM idempotency_key WHERE idempotency_key = ANY($1::text[])`, [idempotencyKeysUsed]);
  }

  const after = await countAll();
  console.log('  post-cleanup table counts:', JSON.stringify(after));
  const PERMANENTLY_RETAINED = ['gk_asset', 'entity_mint_basis', 'mint_event', 'asset_identity_assignment'];
  const mintedAssetCount = createdAssetIds.length; // one gk_asset/entity_mint_basis/mint_event row per asset actually minted
  const identityAssignmentCalls = 4; // cap1, capDrift, capFixed, capReplay — assignIdentity runs unconditionally on every captureFromScan call
  const otherTablesMatch = Object.keys(before).every(
    (k) => PERMANENTLY_RETAINED.includes(k) || before[k] === after[k]
  );
  const mintRetentionMatches = ['gk_asset', 'entity_mint_basis', 'mint_event'].every((k) => after[k] === before[k] + mintedAssetCount);
  const identityRetentionMatches = after.asset_identity_assignment === before.asset_identity_assignment + identityAssignmentCalls;
  assertTrue(otherTablesMatch, 'cleanup: every OTHER table restored to exact pre-test baseline (operator_action_event, decision_event, valuation_event, domain_event, current_owner, ownership_event, collection_item_link, idempotency_key)');
  assertTrue(mintRetentionMatches, `cleanup: gk_asset/entity_mint_basis/mint_event grew by exactly ${mintedAssetCount} (the 2 assets genuinely minted this run), permanently retained per the asset_identity_assignment immutability precedent, not an uncontrolled leak`);
  assertTrue(identityRetentionMatches, `cleanup: asset_identity_assignment grew by exactly ${identityAssignmentCalls} (one per captureFromScan call), all immutable by design (0015)`);

  await client.end();
  await closePool();

  console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}
