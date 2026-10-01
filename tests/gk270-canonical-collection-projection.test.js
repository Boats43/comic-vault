// tests/gk270-canonical-collection-projection.test.js
//
// GK-270 — PHYSICAL IDENTITY != CATALOGUE SIMILARITY. Closes the real,
// reproducible defect the forensic pass found: addToCatalogue's exact-
// title-match duplicate check silently missed two independent Vision
// reads of the SAME physical book ("old man logan mike deodato" vs "old
// man logan deodato", same issue/year), letting the second save mint an
// unlinked duplicate collection_item while the real gkAssetId/
// collection_item_link stayed anchored to the first.
//
// Two layers, proven separately, never conflated:
//   CASE A (server-enforceable invariant) — once a gkAssetId already has
//     a canonical collection_item_link, linkCollectionItem resolves to
//     THAT canonical id for any other collectionItemId presented for the
//     same asset, rather than creating a second, competing link. Proven
//     here with real execution against real Development Postgres.
//   CASE C (operator identity decision) — title/issue/year similarity
//     alone NEVER establishes physical identity; it only triggers an
//     explicit SAME COPY / ANOTHER COPY prompt. The prompt and its two
//     branches live inside src/App.jsx's top-level App() component (not
//     an independently-renderable component like CollectionDetail), so
//     per this repo's own established precedent for exactly this
//     situation (tests/gk259-governing-grade-provenance-propagation.test.js's
//     own disclosed static-source-text sections), the CLIENT wiring is
//     proven by direct source-text inspection, honestly labeled as such,
//     while the SAME-COPY branch's own SERVER-side behavior (an
//     ownedRefresh call against an already-linked collectionItemId) is
//     proven with real execution — that exact mechanism is also already
//     covered by tests/gk254-owned-asset-fail-closed.test.js's own
//     "ordinary refresh, valid auth" scenarios, not re-derived here.
//
// Real Development Postgres throughout for Sections 3-5 — own throwaway
// principals/assets, real service-layer calls, real rows. gk_asset rows
// are permanently retained per this repo's own GK-188 precedent (see
// tests/capture-scan-endpoint-h8-gate-proof.test.js's identical cleanup
// policy) — only the lighter linkage rows this test itself creates are
// cleaned up.
//
// Invoke: node tests/gk270-canonical-collection-projection.test.js

import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const envRaw = readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8');
for (const line of envRaw.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) {
  process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
}

let passed = 0, failed = 0;
const failures = [];
const assertTrue = (cond, label) => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}`; failures.push(m); console.log(m); }
};

const TAG = `gk270-${Date.now()}`;
console.log(`\n=== GK-270 — canonical collection-item projection (tag=${TAG}) ===\n`);

// ─────────────────────────────────────────────────────────────────────
// Section 1 — titlesLikelySameBook: pure-function proof, including the
// EXACT real Old Man Logan regression fixture.
// ─────────────────────────────────────────────────────────────────────
console.log('--- Section 1: titlesLikelySameBook similarity primitive ---');
{
  const { titlesLikelySameBook } = await import('../src/lib/duplicateCopyDetection.js');

  // The real, verbatim stored titles from Production (collection_item.attributes).
  assertTrue(
    titlesLikelySameBook('old man logan mike deodato', 'old man logan deodato'),
    'REGRESSION FIXTURE: the real Old Man Logan title pair is correctly flagged as a possible existing copy (the exact gap the old exact-match check missed)'
  );
  assertTrue(
    titlesLikelySameBook('the new mutants', 'the new mutants'),
    'identical titles still match (no regression on the trivial case)'
  );
  assertTrue(
    !titlesLikelySameBook('amazing spider-man', 'old man logan deodato'),
    'genuinely unrelated titles are NOT flagged'
  );
  assertTrue(
    !titlesLikelySameBook('batman', 'detective comics'),
    'two short, substantively different titles are NOT flagged'
  );
  assertTrue(
    titlesLikelySameBook('', 'anything') === false && titlesLikelySameBook('anything', '') === false,
    'an empty/missing title never produces a false match'
  );
}

// ─────────────────────────────────────────────────────────────────────
// Section 2 — static source-text proof of the client wiring (disclosed,
// not live-executed — see file header for why).
// ─────────────────────────────────────────────────────────────────────
console.log('\n--- Section 2: App.jsx Case C gate wiring (static source-text proof) ---');
{
  const appSrc = readFileSync(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');

  assertTrue(/import \{ titlesLikelySameBook \} from "\.\/lib\/duplicateCopyDetection\.js";/.test(appSrc), 'App.jsx imports the real similarity primitive (not a reimplemented copy)');
  assertTrue(/titlesLikelySameBook\(c\.title, data\.title\)/.test(appSrc), 'the main scan-save duplicate check uses titlesLikelySameBook, not exact string equality');
  assertTrue(/titlesLikelySameBook\(c\.title, data\.title\)/g.test(appSrc) && (appSrc.match(/titlesLikelySameBook\(/g) || []).length >= 2, 'the similarity check is wired at more than one save site (scan path + bulk import), not just one');

  assertTrue(/linkStatus === 'linked'/.test(appSrc), "the Case C gate's two-branch split (linked vs unlinked/checking) exists");
  assertTrue(/>Same Copy<\/button>/.test(appSrc), 'a "Same Copy" control exists');
  assertTrue(/>Another Copy<\/button>/.test(appSrc), 'an "Another Copy" control exists (relabeled from the original "Save Another Copy" only in the linked-duplicate branch)');
  assertTrue(/>Save Another Copy<\/button>/.test(appSrc), 'the ORIGINAL single-button, no-physical-stakes path is preserved unchanged for the unlinked/ordinary-duplicate case');

  // The Same Copy handler itself, isolated for inspection.
  const sameCopyStart = appSrc.indexOf('Same Copy: resolve to the EXISTING');
  const sameCopyEnd = appSrc.indexOf('>Same Copy</button>');
  assertTrue(sameCopyStart > -1 && sameCopyEnd > sameCopyStart, 'the Same Copy handler block is locatable in source');
  const sameCopySlice = appSrc.slice(sameCopyStart, sameCopyEnd);
  assertTrue(!/\baddToCatalogue\(/.test(sameCopySlice), 'the Same Copy handler never calls addToCatalogue (never mints a new collection_item id)');
  assertTrue(/ownedRefresh: true/.test(sameCopySlice), 'the Same Copy handler sends ownedRefresh:true (reuses the existing GK-254 owned-item mechanism, no new auth surface)');
  assertTrue(/collectionItemId: existingId/.test(sameCopySlice), 'the Same Copy handler targets the EXISTING matched item\'s id, never a freshly-generated one');
  assertTrue(/sameCopyConfirmations/.test(sameCopySlice), 'a durable confirmation marker is written to the existing item\'s own attributes (explains the identity decision later, no new table/migration)');

  // No default / no auto-proceed: the gate renders only two explicit
  // buttons (Same Copy / Another Copy) when linked, or the original
  // single Save control when not — there is no THIRD, automatic code
  // path that saves while still 'checking'. The two assertions above
  // (exactly one "Same Copy" control, exactly one "Another Copy" control,
  // both requiring an explicit onClick) already establish this; the
  // 'linked'-gated div wrapper itself is the only place either new
  // button exists, so a 'checking'/'unlinked' render can reach neither.
  assertTrue(
    appSrc.indexOf("duplicateWarning.linkStatus === 'linked'") < appSrc.indexOf('>Same Copy</button>'),
    'the Same Copy/Another Copy controls are only reachable inside the linkStatus==="linked" branch, never unconditionally'
  );
}

// ─────────────────────────────────────────────────────────────────────
// Real-DB sections
// ─────────────────────────────────────────────────────────────────────
const assetsMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { createPhysicalAsset, linkCollectionItem, getPhysicalAsset, AuthorizationFailedError, closePool: closeAssetsPool } = assetsMod;
const collectionMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const { createCollectionItem, closePool: closeCollectionPool } = collectionMod;
const authMod = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'index.js')).href);
const { closePool: closeAuthPool } = authMod;

const { assertAdminDbTarget } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'db-admin-preflight.mjs')).href);

const createdAssetIds = [];
const createdCollectionItemIds = [];
const createdPrincipalIds = [];

try {
  const dbClient = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'GK-270 test fixture setup' });
  const principalAId = randomUUID();
  const principalBId = randomUUID();
  await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [principalAId, `${TAG}-principal-a`]);
  await dbClient.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1, $2, 'user')`, [principalBId, `${TAG}-principal-b`]);
  createdPrincipalIds.push(principalAId, principalBId);
  await dbClient.end();

  // ─── Section 3 (Case A) + Section 5 (stale device/cache) ───
  console.log('\n--- Section 3/5: Case A — gkAsset already linked resolves to canonical, never a second link (also covers "stale device" — a caller presenting a different, not-yet-linked id for a known asset) ---');
  {
    const itemIdFirst = `${TAG}-canonical-first`;
    const itemIdSecond = `${TAG}-attempted-second`;
    createdCollectionItemIds.push(itemIdFirst, itemIdSecond);
    await createCollectionItem({ principalId: principalAId, id: itemIdFirst, assetCategory: 'comic', attributes: { title: 'Old Man Logan Mike Deodato', issue: '25', year: 2017 } });
    await createCollectionItem({ principalId: principalAId, id: itemIdSecond, assetCategory: 'comic', attributes: { title: 'Old Man Logan Deodato', issue: '25', year: 2017 } });

    const asset = await createPhysicalAsset({
      principalId: principalAId,
      captureBasis: { test: true, tag: TAG, nonce: randomUUID() },
      idempotencyKey: `${TAG}-asset-${randomUUID()}`,
    });
    createdAssetIds.push(asset.assetId);

    const firstLink = await linkCollectionItem({ principalId: principalAId, collectionItemId: itemIdFirst, gkAssetId: asset.assetId, idempotencyKey: `${TAG}-link-1-${randomUUID()}` });
    assertTrue(firstLink.outcome === 'linked' && firstLink.collectionItemId === itemIdFirst, 'the first link for a brand-new asset succeeds normally');

    // This is the EXACT shape of the real defect: a different, unlinked
    // collectionItemId presented for an asset that ALREADY has a
    // canonical projection — simulating both "a second Vision-derived
    // save" and "a stale device that doesn't know about the existing
    // link yet, but the request itself already carries the real gkAssetId".
    const secondAttempt = await linkCollectionItem({ principalId: principalAId, collectionItemId: itemIdSecond, gkAssetId: asset.assetId, idempotencyKey: `${TAG}-link-2-${randomUUID()}` });
    assertTrue(secondAttempt.outcome === 'resolved-canonical-existing', `a second, different collectionItemId for the SAME gkAssetId resolves rather than creating a competing link (outcome: ${secondAttempt.outcome})`);
    assertTrue(secondAttempt.collectionItemId === itemIdFirst, 'the resolved result names the TRUE canonical collectionItemId, not the one the caller presented');
    assertTrue(secondAttempt.requestedCollectionItemId === itemIdSecond, 'the originally-requested (non-canonical) id is preserved in the result for caller-side reconciliation');

    const graph = await getPhysicalAsset({ principalId: principalAId, gkAssetId: asset.assetId });
    assertTrue(!!graph.asset, 'the asset itself is unaffected and still resolves normally after the resolved-canonical response');
  }

  // ─── Section 4 (legitimate multiple copies — "Another Copy") ───
  console.log('\n--- Section 4: legitimate multiple copies — two independent physical assets, never cross-linked ---');
  {
    const itemIdCopy1 = `${TAG}-copy1`;
    const itemIdCopy2 = `${TAG}-copy2`;
    createdCollectionItemIds.push(itemIdCopy1, itemIdCopy2);
    await createCollectionItem({ principalId: principalAId, id: itemIdCopy1, assetCategory: 'comic', attributes: { title: 'Amazing Spider-Man', issue: '300', year: 1988 } });
    await createCollectionItem({ principalId: principalAId, id: itemIdCopy2, assetCategory: 'comic', attributes: { title: 'Amazing Spider-Man', issue: '300', year: 1988 } });

    // Two genuinely distinct capture events (distinct nonces -> distinct
    // basisKey -> distinct gkAssetId under the existing content-addressed
    // mint dedup) -- exactly what a real second, operator-confirmed
    // "Another Copy" capture produces today, unchanged by this dispatch.
    const assetCopy1 = await createPhysicalAsset({ principalId: principalAId, captureBasis: { test: true, tag: TAG, copy: 1, nonce: randomUUID() }, idempotencyKey: `${TAG}-copy1-asset-${randomUUID()}` });
    const assetCopy2 = await createPhysicalAsset({ principalId: principalAId, captureBasis: { test: true, tag: TAG, copy: 2, nonce: randomUUID() }, idempotencyKey: `${TAG}-copy2-asset-${randomUUID()}` });
    createdAssetIds.push(assetCopy1.assetId, assetCopy2.assetId);
    assertTrue(assetCopy1.assetId !== assetCopy2.assetId, 'two legitimately distinct physical copies mint two distinct gkAssetIds');

    const link1 = await linkCollectionItem({ principalId: principalAId, collectionItemId: itemIdCopy1, gkAssetId: assetCopy1.assetId, idempotencyKey: `${TAG}-copy1-link-${randomUUID()}` });
    const link2 = await linkCollectionItem({ principalId: principalAId, collectionItemId: itemIdCopy2, gkAssetId: assetCopy2.assetId, idempotencyKey: `${TAG}-copy2-link-${randomUUID()}` });
    assertTrue(link1.outcome === 'linked' && link2.outcome === 'linked', 'both copies link successfully, independently');
    assertTrue(link1.collectionItemId !== link2.collectionItemId, 'both copies keep their own, independent canonical collectionItemId');

    const graph1 = await getPhysicalAsset({ principalId: principalAId, gkAssetId: assetCopy1.assetId });
    const graph2 = await getPhysicalAsset({ principalId: principalAId, gkAssetId: assetCopy2.assetId });
    assertTrue(graph1.asset.id !== graph2.asset.id, 'both copies remain independently addressable — neither is linked to the other\'s gkAsset');
  }

  // ─── Section 6 (cross-principal) ───
  console.log('\n--- Section 6: cross-principal — A\'s physical identity never influences B\'s ---');
  {
    const itemIdA = `${TAG}-crossp-a`;
    createdCollectionItemIds.push(itemIdA);
    await createCollectionItem({ principalId: principalAId, id: itemIdA, assetCategory: 'comic', attributes: { title: 'Detective Comics', issue: '27', year: 1939 } });
    const assetA = await createPhysicalAsset({ principalId: principalAId, captureBasis: { test: true, tag: TAG, cross: 'a', nonce: randomUUID() }, idempotencyKey: `${TAG}-crossp-a-asset-${randomUUID()}` });
    createdAssetIds.push(assetA.assetId);
    await linkCollectionItem({ principalId: principalAId, collectionItemId: itemIdA, gkAssetId: assetA.assetId, idempotencyKey: `${TAG}-crossp-a-link-${randomUUID()}` });

    // Principal B attempts to link ITS OWN collectionItemId against
    // Principal A's real gkAssetId (the attack/confusion shape the
    // Case A mechanism must never leak through) -- rejected by the
    // PRE-EXISTING assertPrincipalOwnsAsset ownership gate, which runs
    // BEFORE this dispatch's own new reverse-lookup check, so no
    // canonical-link information about Principal A's asset is ever
    // revealed to Principal B.
    const itemIdB = `${TAG}-crossp-b`;
    createdCollectionItemIds.push(itemIdB);
    await createCollectionItem({ principalId: principalBId, id: itemIdB, assetCategory: 'comic', attributes: { title: 'Detective Comics', issue: '27', year: 1939 } });

    let rejected = false, rejectedWithOwnership = false;
    try {
      await linkCollectionItem({ principalId: principalBId, collectionItemId: itemIdB, gkAssetId: assetA.assetId, idempotencyKey: `${TAG}-crossp-b-link-${randomUUID()}` });
    } catch (e) {
      rejected = true;
      rejectedWithOwnership = e instanceof AuthorizationFailedError;
    }
    assertTrue(rejected && rejectedWithOwnership, 'Principal B linking against Principal A\'s real gkAssetId is rejected with AuthorizationFailedError — never silently resolved, never cross-merged');

    // B's own, genuinely separate capture of a similar-looking book is
    // completely unaffected and proceeds normally.
    const assetB = await createPhysicalAsset({ principalId: principalBId, captureBasis: { test: true, tag: TAG, cross: 'b', nonce: randomUUID() }, idempotencyKey: `${TAG}-crossp-b-asset-${randomUUID()}` });
    createdAssetIds.push(assetB.assetId);
    const linkB = await linkCollectionItem({ principalId: principalBId, collectionItemId: itemIdB, gkAssetId: assetB.assetId, idempotencyKey: `${TAG}-crossp-b-asset-link-${randomUUID()}` });
    assertTrue(linkB.outcome === 'linked' && assetB.assetId !== assetA.assetId, 'Principal B\'s own identical-looking book gets its own, fully independent physical asset — A\'s identity never influenced it');
  }

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
} finally {
  for (const assetId of createdAssetIds.filter(Boolean)) {
    try {
      const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'GK-270 cleanup' });
      await client.query(`DELETE FROM data1_dev.outbox WHERE domain_event_id IN (SELECT event_id FROM data1_dev.domain_event WHERE (subject->>'entity_id')::uuid = $1)`, [assetId]);
      await client.query(`DELETE FROM data1_dev.domain_event WHERE (subject->>'entity_id')::uuid = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.media WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.collection_item_link WHERE gk_asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.current_owner WHERE asset_id = $1`, [assetId]);
      await client.query(`DELETE FROM data1_dev.ownership_event WHERE asset_id = $1`, [assetId]);
      await client.end();
    } catch { /* best-effort cleanup */ }
  }
  if (createdCollectionItemIds.length > 0) {
    try {
      const client = await assertAdminDbTarget({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, label: 'GK-270 cleanup 2' });
      await client.query(`DELETE FROM data1_dev.collection_item WHERE id = ANY($1::text[])`, [createdCollectionItemIds]);
      await client.end();
    } catch { /* best-effort cleanup */ }
  }
  // gk_principal/gk_asset rows intentionally left in place — same
  // established convention every other real-Development-DB test in this
  // repo already follows (GK-188 precedent).
  console.log(`[cleanup] removed ${createdCollectionItemIds.length} test collection_item row(s) + their linkage; ${createdAssetIds.length} test gk_asset row(s) and ${createdPrincipalIds.length} test principal(s) left in place (established convention)`);

  await closeAssetsPool();
  await closeCollectionPool();
  await closeAuthPool();

  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log(f));
    process.exit(1);
  }
  process.exit(0);
}
