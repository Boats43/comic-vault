// tests/gk279-physical-copy-disambiguation.test.js
//
// GK-279 — capture-time PHYSICAL COPY DISAMBIGUATION. PHYSICAL IDENTITY !=
// CATALOGUE SIMILARITY: a capture resembling an owned asset forces an
// explicit operator SAME_COPY / ANOTHER_COPY choice BEFORE any gkAssetId is
// minted. Real api/capture-scan.js handler, real Development Postgres, real
// token, throwaway principals. gk_asset rows are retained (GK-188 policy).
//
// Invoke: node tests/gk279-physical-copy-disambiguation.test.js

import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of readFileSync(path.join(repoRoot, '.env.development.local'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}
process.env.GRAILKEY_CATALOG_ENVIRONMENT = 'development';
if (!process.env.GRAILKEY_SESSION_SECRET) process.env.GRAILKEY_SESSION_SECRET = randomBytes(32).toString('base64url');
delete process.env.MILESTONE_TEN_H8_PASS;

let passed = 0, failed = 0;
const assertTrue = (c, l) => { if (c) { passed++; console.log(`  ✓ ${l}`); } else { failed++; console.log(`  ✗ ${l}`); } };

const route = (await import(pathToFileURL(path.join(repoRoot, 'api', 'capture-scan.js')).href)).default;
const { closePool: closeAssets } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'assets', 'index.js')).href);
const { createCollectionItem, closePool: closeCollection } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
const { closePool: closeAuth } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'auth', 'index.js')).href);
const { isPlausiblePhysicalCopyCandidate } = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'duplicateCopyDetection.js')).href);

function mockRes() {
  const res = { statusCode: null, body: null, headers: {} };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function tokenFor(principalId) {
  const now = Date.now();
  const p = Buffer.from(JSON.stringify({ principalId, iat: now, exp: now + 3600000, epoch: process.env.GRAILKEY_SESSION_EPOCH || '1' })).toString('base64url');
  return `${p}.${createHmac('sha256', process.env.GRAILKEY_SESSION_SECRET).update(p).digest('base64url')}`;
}
const TAG = `gk279-${Date.now()}`;
const keyMemo = {};
// Real clients send crypto.randomUUID() keys (correlation_id is a UUID column).
const K = (name) => (keyMemo[name] ||= randomUUID());
const db = new Client({ connectionString: process.env.GRAILKEY_CATALOG_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const principals = [];
async function newPrincipal(label) {
  const id = randomUUID();
  await db.query(`INSERT INTO data1_dev.gk_principal (id, display_name, kind) VALUES ($1,$2,'user')`, [id, `${TAG}-${label}`]);
  principals.push(id);
  return id;
}
const itemIds = [];
async function newItem(principalId, id, attrs) {
  itemIds.push(id);
  await createCollectionItem({ principalId, id, assetCategory: 'comic', attributes: attrs });
}
async function capture(principalId, { collectionItemId, key, disposition, title = 'x', photo = 'a', extra = {} }) {
  const req = {
    method: 'POST', headers: { authorization: `Bearer ${tokenFor(principalId)}` },
    body: {
      scanPayload: { correlationId: key, collectionItemId, book: { title }, ...extra },
      photos: [{ bytes: Buffer.from(`${TAG}-${photo}-${key}`).toString('base64'), contentType: 'image/jpeg', captureRole: 'capture-photo' }],
      idempotencyKey: key,
      ...(disposition ? { copyDisposition: disposition } : {}),
    },
  };
  const res = mockRes();
  await route(req, res);
  return res;
}
const count = async (sql, args = []) => (await db.query(sql, args)).rows[0].n;
const assetCount = (pid) => count(`SELECT COUNT(*)::int n FROM data1_dev.current_owner WHERE owner_principal_id=$1`, [pid]);
const linkCount = (pid) => count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item_link WHERE linked_by_principal_id=$1`, [pid]);
const mediaCount = (asset) => count(`SELECT COUNT(*)::int n FROM data1_dev.media WHERE asset_id=$1`, [asset]);

console.log(`\n=== GK-279 physical copy disambiguation (tag=${TAG}) ===\n`);
try {
  console.log('--- matcher (pure) ---');
  assertTrue(isPlausiblePhysicalCopyCandidate({ title: 'Old Man Logan Deodato', issue: '25', year: 2017 }, { title: 'old man logan mike deodato', issue: '#25', year: '2017' }), 'real OML title pair + issue/year formatting variants = plausible candidate');
  assertTrue(!isPlausiblePhysicalCopyCandidate({ title: 'Old Man Logan', issue: '26', year: 2017 }, { title: 'Old Man Logan', issue: '25', year: 2017 }), 'different issue number excludes');
  assertTrue(!isPlausiblePhysicalCopyCandidate({ title: 'Old Man Logan', issue: '25', year: 1990 }, { title: 'Old Man Logan', issue: '25', year: 2017 }), 'far-apart years exclude');
  assertTrue(!isPlausiblePhysicalCopyCandidate({ title: 'Batman', issue: '1', year: 1940 }, { title: 'Detective Comics', issue: '1', year: 1940 }), 'unrelated titles exclude');

  const P = await newPrincipal('owner');
  const Q = await newPrincipal('other');

  console.log('\n--- #10 / no-candidate flow: ordinary novel comic mints normally, no prompt, no decision row ---');
  const novel = `${TAG}-novel`;
  await newItem(P, novel, { title: 'Zorro Annual', issue: '3', year: 1965 });
  const rNovel = await capture(P, { collectionItemId: novel, key: K('novel'), title: 'Zorro Annual' });
  assertTrue(rNovel.statusCode === 200 && rNovel.body.mintOutcome === 'minted-new', `novel comic mints (status ${rNovel.statusCode}, ${rNovel.body?.mintOutcome})`);
  assertTrue(!rNovel.body.copyDecision, 'no copyDecision attached on the normal path');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1`, [P]) === 0, 'no decision row for a no-candidate capture');
  const assetA = rNovel.body.gkAssetId;

  console.log('\n--- #1 same catalogue identity, NO operator choice: blocked, nothing minted ---');
  const dup1 = `${TAG}-dup1`;
  await newItem(P, dup1, { title: 'Zorro Annual', issue: '3', year: 1965 });
  const beforeAssets = await assetCount(P), beforeLinks = await linkCount(P);
  const rNone = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual' });
  assertTrue(rNone.statusCode === 409 && rNone.body.error === 'PHYSICAL_COPY_DECISION_REQUIRED', `409 PHYSICAL_COPY_DECISION_REQUIRED (got ${rNone.statusCode} ${rNone.body?.error})`);
  assertTrue(Array.isArray(rNone.body.candidates) && rNone.body.candidates.length === 1 && rNone.body.candidates[0].gkAssetId === assetA, 'response lists the plausible owned candidate');
  assertTrue(await assetCount(P) === beforeAssets && await linkCount(P) === beforeLinks, 'no asset minted, no link created, no automatic merge');

  console.log('\n--- #5/#6 forged / nonexistent / invalid candidate: refused, nothing minted ---');
  const foreignItem = `${TAG}-foreign`;
  await newItem(Q, foreignItem, { title: 'Zorro Annual', issue: '3', year: 1965 });
  const rQ = await capture(Q, { collectionItemId: foreignItem, key: K('q-novel'), title: 'Zorro Annual' });
  assertTrue(rQ.statusCode === 200 && rQ.body.mintOutcome === 'minted-new', "principal Q's own identical-looking book is NOT blocked by P's asset (cross-principal isolation)");
  const rForged = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual', disposition: { choice: 'SAME_COPY', selectedGkAssetId: rQ.body.gkAssetId } });
  assertTrue(rForged.statusCode === 400, `SAME_COPY naming another principal's asset REFUSED (got ${rForged.statusCode})`);
  const rGhost = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual', disposition: { choice: 'SAME_COPY', selectedGkAssetId: randomUUID() } });
  assertTrue(rGhost.statusCode === 400 && rGhost.body.error === rForged.body.error, 'nonexistent candidate REFUSED with the identical response (no existence leak)');
  const rBadChoice = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual', disposition: { choice: 'MERGE' } });
  assertTrue(rBadChoice.statusCode === 400, 'unknown choice REFUSED');
  const rAnotherWithSel = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual', disposition: { choice: 'ANOTHER_COPY', selectedGkAssetId: assetA } });
  assertTrue(rAnotherWithSel.statusCode === 400, 'ANOTHER_COPY carrying a selected asset REFUSED');
  assertTrue(await assetCount(P) === beforeAssets && await linkCount(P) === beforeLinks, 'refusals minted/linked nothing');

  console.log('\n--- #2/#7/#11 SAME COPY: existing gkAsset reused, no second asset/link, media appended, retry idempotent ---');
  const mediaBefore = await mediaCount(assetA);
  const histBefore = {
    own: await count(`SELECT COUNT(*)::int n FROM data1_dev.ownership_event WHERE asset_id=$1`, [assetA]),
    val: await count(`SELECT COUNT(*)::int n FROM data1_dev.valuation_event WHERE asset_id=$1`, [assetA]),
    dec: await count(`SELECT COUNT(*)::int n FROM data1_dev.decision_event WHERE asset_id=$1`, [assetA]),
    acq: await count(`SELECT COUNT(*)::int n FROM data1_dev.acquisition_event WHERE asset_id=$1`, [assetA]),
    ident: await count(`SELECT COUNT(*)::int n FROM data1_dev.asset_identity_assignment WHERE asset_id=$1`, [assetA]),
  };
  const same = { choice: 'SAME_COPY', selectedGkAssetId: assetA };
  const rSame = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual', disposition: same, photo: 'rescan' });
  assertTrue(rSame.statusCode === 200 && rSame.body.gkAssetId === assetA, 'SAME COPY returns the EXISTING gkAssetId');
  assertTrue(rSame.body.mintOutcome === 'same-copy-confirmed-existing' && rSame.body.copyDecision?.choice === 'SAME_COPY', 'explicit SAME COPY CONFIRMED result returned to the client');
  assertTrue(rSame.body.copyDecision?.canonicalCollectionItemId === novel, 'canonical collection item (the existing asset\'s link) is reported');
  assertTrue(await assetCount(P) === beforeAssets, 'no second physical asset');
  assertTrue(await linkCount(P) === beforeLinks, 'no second canonical link for the physical asset');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item_link WHERE collection_item_id=$1`, [dup1]) === 0, 'the incoming catalogue row was NOT linked');
  assertTrue(await mediaCount(assetA) === mediaBefore + 1, 'new photo appended as evidence on the existing asset');
  const histAfter = {
    own: await count(`SELECT COUNT(*)::int n FROM data1_dev.ownership_event WHERE asset_id=$1`, [assetA]),
    val: await count(`SELECT COUNT(*)::int n FROM data1_dev.valuation_event WHERE asset_id=$1`, [assetA]),
    dec: await count(`SELECT COUNT(*)::int n FROM data1_dev.decision_event WHERE asset_id=$1`, [assetA]),
    acq: await count(`SELECT COUNT(*)::int n FROM data1_dev.acquisition_event WHERE asset_id=$1`, [assetA]),
    ident: await count(`SELECT COUNT(*)::int n FROM data1_dev.asset_identity_assignment WHERE asset_id=$1`, [assetA]),
  };
  assertTrue(JSON.stringify(histBefore) === JSON.stringify(histAfter), 'ownership/valuation/decision/acquisition/identity history unchanged (#12)');
  const rSame2 = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual', disposition: same, photo: 'rescan' });
  assertTrue(rSame2.statusCode === 200 && rSame2.body.gkAssetId === assetA, 'SAME COPY retry -> same asset');
  assertTrue(await assetCount(P) === beforeAssets && await mediaCount(assetA) === mediaBefore + 1, 'SAME COPY retry: no duplicate asset, no duplicate media');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, K('dup1')]) === 1, 'exactly one durable SAME_COPY decision row after retry');
  const rConflict = await capture(P, { collectionItemId: dup1, key: K('dup1'), title: 'Zorro Annual', disposition: { choice: 'ANOTHER_COPY' }, photo: 'rescan' });
  assertTrue(rConflict.statusCode === 409, `same key, different choice REFUSED (got ${rConflict.statusCode})`);
  assertTrue(await assetCount(P) === beforeAssets, 'conflicting key reuse minted NO orphan asset (refused before any mutation)');

  console.log('\n--- #3/#4/#8 ANOTHER COPY: new gkAsset, distinct from the identical-catalogue original; retry mints once ---');
  const dup2 = `${TAG}-dup2`;
  await newItem(P, dup2, { title: 'Zorro Annual', issue: '3', year: 1965 });
  const another = { choice: 'ANOTHER_COPY' };
  const rAnother = await capture(P, { collectionItemId: dup2, key: K('dup2'), title: 'Zorro Annual', disposition: another });
  assertTrue(rAnother.statusCode === 200 && rAnother.body.mintOutcome === 'minted-new', 'ANOTHER COPY mints');
  const assetB = rAnother.body.gkAssetId;
  assertTrue(assetB && assetB !== assetA, 'A != B: two distinct physical assets with identical catalogue identity');
  { const n = await assetCount(P); if (n !== beforeAssets + 1) console.log('DEBUG assets', beforeAssets, n, JSON.stringify((await db.query('SELECT co.asset_id, a.asset_class, a.created_at FROM data1_dev.current_owner co JOIN data1_dev.gk_asset a ON a.id=co.asset_id WHERE co.owner_principal_id=$1 ORDER BY a.created_at',[P])).rows), 'A=',assetA,'B=',assetB); assertTrue(n === beforeAssets + 1, 'exactly one new asset'); }
  const linkB = await db.query(`SELECT gk_asset_id FROM data1_dev.collection_item_link WHERE collection_item_id=$1`, [dup2]);
  assertTrue(linkB.rows[0]?.gk_asset_id === assetB, 'new asset linked to the incoming catalogue row');
  const dec = await db.query(`SELECT choice, selected_gk_asset_id, resulting_gk_asset_id, candidate_gk_asset_ids, rule_version FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, K('dup2')]);
  assertTrue(dec.rows.length === 1 && dec.rows[0].choice === 'ANOTHER_COPY' && dec.rows[0].resulting_gk_asset_id === assetB && dec.rows[0].selected_gk_asset_id === null && dec.rows[0].candidate_gk_asset_ids.includes(assetA) && dec.rows[0].rule_version === 'gk279-v1', 'durable ANOTHER_COPY decision recorded (principal-scoped, candidates, result, rule version)');
  const rAnother2 = await capture(P, { collectionItemId: dup2, key: K('dup2'), title: 'Zorro Annual', disposition: another });
  assertTrue(rAnother2.statusCode === 200 && rAnother2.body.gkAssetId === assetB, 'ANOTHER COPY retry -> same new asset');
  assertTrue(await assetCount(P) === beforeAssets + 1, 'ANOTHER COPY retry minted no second asset');

  console.log('\n--- #9 multiple candidates: operator must select; never first-match ---');
  const dup3 = `${TAG}-dup3`;
  await newItem(P, dup3, { title: 'Zorro Annual', issue: '3', year: 1965 });
  const rMulti = await capture(P, { collectionItemId: dup3, key: K('dup3'), title: 'Zorro Annual' });
  assertTrue(rMulti.statusCode === 409 && rMulti.body.candidates.length === 2, 'two owned copies -> both listed, choice required');
  const rMultiSame = await capture(P, { collectionItemId: dup3, key: K('dup3'), title: 'Zorro Annual', disposition: { choice: 'SAME_COPY', selectedGkAssetId: assetB }, photo: 'b' });
  assertTrue(rMultiSame.statusCode === 200 && rMultiSame.body.gkAssetId === assetB && rMultiSame.body.copyDecision.canonicalCollectionItemId === dup2, 'operator-selected candidate (B, not first) is the one reused');

  console.log('\n--- concurrency: identical ANOTHER COPY requests under one key mint exactly one asset ---');
  const dup4 = `${TAG}-dup4`;
  await newItem(P, dup4, { title: 'Zorro Annual', issue: '3', year: 1965 });
  const before4 = await assetCount(P);
  const results = await Promise.all([0, 1, 2].map(() => capture(P, { collectionItemId: dup4, key: K('dup4'), title: 'Zorro Annual', disposition: another })));
  const okIds = new Set(results.filter((r) => r.statusCode === 200).map((r) => r.body.gkAssetId));
  assertTrue(okIds.size <= 1 && results.some((r) => r.statusCode === 200), `concurrent identical requests converge on one asset (statuses ${results.map((r) => r.statusCode).join(',')})`);
  assertTrue(await assetCount(P) === before4 + 1, 'exactly ONE new asset minted across 3 concurrent requests');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, K('dup4')]) === 1, 'exactly one decision row');

  console.log('\n--- decision ledger is append-only ---');
  let updRejected = false, delRejected = false;
  try { await db.query(`UPDATE data1_dev.physical_copy_decision_event SET choice='SAME_COPY' WHERE principal_id=$1`, [P]); } catch { updRejected = true; }
  try { await db.query(`DELETE FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1`, [P]); } catch { delRejected = true; }
  assertTrue(updRejected && delRejected, 'UPDATE and DELETE on the decision ledger are rejected');

  console.log('\n--- UI wiring (static source-text proof — panel is a React component; disclosed, not rendered) ---');
  const panel = readFileSync(path.join(repoRoot, 'src', 'components', 'GrailKeyOperatorPanel.jsx'), 'utf8');
  assertTrue(panel.includes('Is this the same physical copy you already own?'), 'required blocking question text present');
  assertTrue(panel.includes('>SAME COPY</button>') && panel.includes('ANOTHER COPY (a different physical book)'), 'SAME COPY and ANOTHER COPY controls present');
  assertTrue(/PHYSICAL_COPY_DECISION_REQUIRED/.test(panel) && /copyDecision\.candidates\.map/.test(panel), 'the 409 contract drives a per-candidate list (never first-match)');
  assertTrue(/selectedGkAssetId: c\.gkAssetId/.test(panel), 'SAME COPY sends the specific candidate the operator tapped');
  assertTrue(!/choice: "SAME_COPY"[^}]*candidates\[0\]/.test(panel), 'no code path picks candidates[0]');
  assertTrue(/onClick=\{\(\) => captureAsOwnedAsset\(\)\}/.test(panel), 'the ordinary capture button sends NO disposition (never pre-decides)');
  assertTrue(/Matching title, issue and year does not mean the same copy/.test(panel), 'UI does not imply identical metadata means identical copy');
} catch (e) {
  failed++; console.log('  ✗ UNEXPECTED ERROR', e?.stack || e);
} finally {
  try { await db.query(`DELETE FROM data1_dev.collection_item_link WHERE collection_item_id = ANY($1)`, [itemIds]); } catch (e) { console.log('cleanup link:', e.message); }
  try { await db.query(`DELETE FROM data1_dev.collection_item WHERE id = ANY($1)`, [itemIds]); } catch (e) { console.log('cleanup items:', e.message); }
  await db.end();
  await closeAssets(); await closeCollection(); await closeAuth();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
