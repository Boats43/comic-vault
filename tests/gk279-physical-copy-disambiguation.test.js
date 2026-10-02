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
    method: 'POST', headers: { authorization: `Bearer ${tokenFor(principalId)}`, 'x-forwarded-for': `10.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}` },
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
const cardCount = (pid) => count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item WHERE principal_id=$1`, [pid]);
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
  const cardsBeforeDup1 = await cardCount(P);
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
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item_link WHERE collection_item_id=$1`, [dup1]) === 0, 'the incoming catalogue row was never linked');
  assertTrue(rSame.body.copyDecision?.retired === true, 'backstop SAME_COPY reports the transient duplicate row retired');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item WHERE id=$1`, [dup1]) === 0, 'the transient duplicate collection row is gone');
  assertTrue(await cardCount(P) === cardsBeforeDup1, 'visible Collection cards unchanged by SAME COPY (no duplicate card)');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.collection_item WHERE id=$1`, [novel]) === 1, 'the canonical existing card remains');
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
  assertTrue(dec.rows.length === 1 && dec.rows[0].choice === 'ANOTHER_COPY' && dec.rows[0].resulting_gk_asset_id === assetB && dec.rows[0].selected_gk_asset_id === null && dec.rows[0].candidate_gk_asset_ids.includes(assetA) && dec.rows[0].rule_version === 'gk279-v2', 'durable ANOTHER_COPY decision recorded (principal-scoped, candidates, result, rule version)');
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


  // ═══════════════════════════════════════════════════════════════════
  // GK-279 CORRECTION — the ONE server-adjudicated SAVE-TIME prompt.
  // Real api/physical-copy.js + api/capture-scan.js handlers, real Development DB.
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n=== SAVE-TIME adjudication (api/physical-copy.js) ===');
  const physRoute = (await import(pathToFileURL(path.join(repoRoot, 'api', 'physical-copy.js')).href)).default;
  const receipts = await import(pathToFileURL(path.join(repoRoot, 'src', 'lib', 'gradeReceipt.js')).href);
  const kv = new Map();
  receipts.__setReceiptStoreForTests({
    set: async (k, v) => { kv.set(k, JSON.parse(JSON.stringify(v))); },
    get: async (k) => (kv.has(k) ? JSON.parse(JSON.stringify(kv.get(k))) : null),
    getdel: async (k) => { const v = kv.get(k); kv.delete(k); return v ? JSON.parse(JSON.stringify(v)) : null; },
  });
  async function phys(principalId, body) {
    const res = mockRes();
    await physRoute({ method: 'POST', headers: { authorization: `Bearer ${tokenFor(principalId)}`, 'x-forwarded-for': `10.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}` }, body }, res);
    return res;
  }
  async function newPredictionEvent(principalId) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO data1_dev.model_prediction_event (id, principal_id, surface, result_id, prediction, payload_hash, idempotency_key)
       VALUES ($1,$2,'GRADE',$3,$4,$5,$6)`,
      [id, principalId, randomUUID(), JSON.stringify({ grade: 'NM 9.4' }), `hash-${id}`, `idem-${id}`]);
    return id;
  }
  async function newReceipt(principalId, predictionEventId) {
    return receipts.issueGradeReceipt({ principalId, result: { grade: 'NM 9.4', confidence: 'high' }, predictionEventId });
  }
  const sameBook = { title: 'Zorro Annual', issue: '3', year: 1965 };
  const eventState = async (id) => (await db.query(`SELECT payload_hash, prediction FROM data1_dev.model_prediction_event WHERE id=$1`, [id])).rows[0];

  console.log('\n--- candidates are SERVER-supplied, principal-scoped; novel book gets none ---');
  const cand1 = await phys(P, { action: 'candidates', book: sameBook });
  assertTrue(cand1.statusCode === 200 && [assetA, assetB].every((id) => cand1.body.candidates.some((c) => c.gkAssetId === id)), 'owner sees both owned copies (A and B) as server candidates');
  const candNovel = await phys(P, { action: 'candidates', book: { title: 'Totally Different Book', issue: '9', year: 1999 } });
  assertTrue(candNovel.statusCode === 200 && candNovel.body.candidates.length === 0, 'a novel comic gets NO candidates (normal no-prompt path)');
  const candQ = await phys(Q, { action: 'candidates', book: sameBook });
  assertTrue(candQ.body.candidates.every((c) => c.gkAssetId !== assetA && c.gkAssetId !== assetB), "another principal never sees P's assets");
  const candNoAuth = mockRes(); await physRoute({ method: 'POST', headers: {}, body: { action: 'candidates', book: sameBook } }, candNoAuth);
  assertTrue(candNoAuth.statusCode === 401, 'unauthenticated -> 401');

  console.log('\n--- A/E/F/O/P: SAME COPY at save — no row, no asset, photo appended, prediction linked ---');
  const peId = await newPredictionEvent(P);
  const rcpt = await newReceipt(P, peId);
  assertTrue(typeof rcpt === 'string', 'server issued a grade receipt for the new inference');
  const peBefore = await eventState(peId);
  const keyS = randomUUID();
  const cardsB = await cardCount(P), assetsB = await assetCount(P), mediaB = await mediaCount(assetA);
  const econB = {
    val: await count(`SELECT COUNT(*)::int n FROM data1_dev.valuation_event WHERE asset_id=$1`, [assetA]),
    dec: await count(`SELECT COUNT(*)::int n FROM data1_dev.decision_event WHERE asset_id=$1`, [assetA]),
    own: await count(`SELECT COUNT(*)::int n FROM data1_dev.ownership_event WHERE asset_id=$1`, [assetA]),
    ident: await count(`SELECT COUNT(*)::int n FROM data1_dev.asset_identity_assignment WHERE asset_id=$1`, [assetA]),
  };
  const photoB64 = Buffer.from(`${TAG}-save-photo`).toString('base64');
  const sv = await phys(P, { action: 'same', book: sameBook, selectedGkAssetId: assetA, gradeReceiptId: rcpt, photo: { bytes: photoB64, contentType: 'image/jpeg' }, idempotencyKey: keyS });
  assertTrue(sv.statusCode === 200 && sv.body.gkAssetId === assetA && sv.body.canonicalCollectionItemId === novel, 'SAME COPY returns the existing gkAssetId + existing canonical collectionItemId');
  assertTrue(await cardCount(P) === cardsB, 'Collection card count unchanged (no second collection_item was ever created)');
  assertTrue(await assetCount(P) === assetsB, 'physical asset count unchanged');
  assertTrue(await mediaCount(assetA) === mediaB + 1, 'the new scan photo was appended to the existing asset (prior media remains)');
  const dsv = (await db.query(`SELECT surface, choice, incoming_collection_item_id, related_prediction_event_id, canonical_collection_item_id, incoming_retired FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, keyS])).rows;
  assertTrue(dsv.length === 1 && dsv[0].surface === 'SAVE' && dsv[0].choice === 'SAME_COPY' && dsv[0].incoming_collection_item_id === null, 'exactly one durable SAVE-surface SAME_COPY decision, no incoming row');
  assertTrue(dsv[0].related_prediction_event_id === peId && dsv[0].canonical_collection_item_id === novel, 'the new model inference is durably linked to the EXISTING asset context via the SERVER-claimed receipt');
  const peAfter = await eventState(peId);
  assertTrue(peAfter.payload_hash === peBefore.payload_hash && JSON.stringify(peAfter.prediction) === JSON.stringify(peBefore.prediction), 'model_prediction_event itself is unchanged (immutable, not rewritten, not deleted)');
  const econA = {
    val: await count(`SELECT COUNT(*)::int n FROM data1_dev.valuation_event WHERE asset_id=$1`, [assetA]),
    dec: await count(`SELECT COUNT(*)::int n FROM data1_dev.decision_event WHERE asset_id=$1`, [assetA]),
    own: await count(`SELECT COUNT(*)::int n FROM data1_dev.ownership_event WHERE asset_id=$1`, [assetA]),
    ident: await count(`SELECT COUNT(*)::int n FROM data1_dev.asset_identity_assignment WHERE asset_id=$1`, [assetA]),
  };
  assertTrue(JSON.stringify(econB) === JSON.stringify(econA), 'economic/ownership/identity history unchanged after SAME COPY');
  let updRej = false; try { await db.query(`UPDATE data1_dev.physical_copy_decision_event SET choice='ANOTHER_COPY' WHERE principal_id=$1`, [P]); } catch { updRej = true; }
  assertTrue(updRej, 'learning/decision history stays append-only');
  const rcptReplay = await receipts.claimGradeReceipt({ principalId: P, receiptId: rcpt });
  assertTrue(!rcptReplay.ok, 'the receipt was consumed server-side (single use) — a second SAME cannot double-claim');

  console.log('\n--- F: SAME COPY retry replays — zero count change ---');
  const svRetry = await phys(P, { action: 'same', book: sameBook, selectedGkAssetId: assetA, gradeReceiptId: rcpt, photo: { bytes: photoB64, contentType: 'image/jpeg' }, idempotencyKey: keyS });
  assertTrue(svRetry.statusCode === 200 && svRetry.body.replayed === true && svRetry.body.gkAssetId === assetA, 'retry replays the same result');
  assertTrue(await cardCount(P) === cardsB && await assetCount(P) === assetsB && await mediaCount(assetA) === mediaB + 1, 'retry: no new card, asset, or media');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, keyS]) === 1, 'still exactly one decision row');

  console.log('\n--- J: same key + changed choice REFUSED before any write ---');
  const jBefore = await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1`, [P]);
  const jConf = await phys(P, { action: 'another', book: sameBook, collectionItemId: `${TAG}-nonexistent-item`, idempotencyKey: keyS });
  assertTrue(jConf.statusCode === 409, `changed choice under the same key -> 409 (got ${jConf.statusCode} ${JSON.stringify(jConf.body)})`);
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1`, [P]) === jBefore, 'no decision row written by the refused request');

  console.log('\n--- K/L: forged / nonexistent candidate REFUSED ---');
  const kForged = await phys(P, { action: 'same', book: sameBook, selectedGkAssetId: rQ.body.gkAssetId, idempotencyKey: randomUUID() });
  const lGhost = await phys(P, { action: 'same', book: sameBook, selectedGkAssetId: randomUUID(), idempotencyKey: randomUUID() });
  assertTrue(kForged.statusCode === 400 && lGhost.statusCode === 400 && kForged.body.error === lGhost.body.error, 'cross-principal and nonexistent candidates get the identical 400');
  const mNoSel = await phys(P, { action: 'same', book: sameBook, idempotencyKey: randomUUID() });
  assertTrue(mNoSel.statusCode === 400, 'SAME without an explicit selected candidate is refused (multiple candidates: explicit selection required)');
  const qSame = await phys(Q, { action: 'same', book: sameBook, selectedGkAssetId: assetA, idempotencyKey: randomUUID() });
  assertTrue(qSame.statusCode === 400, "another principal naming P's asset is refused");

  console.log('\n--- G: SAME COPY concurrency — one decision, prediction link intact, no dupes ---');
  const peC = await newPredictionEvent(P);
  const rcptC = await newReceipt(P, peC);
  const keyC = randomUUID();
  const cardsC = await cardCount(P), assetsC = await assetCount(P), mediaC = await mediaCount(assetB);
  const par = await Promise.all([0, 1, 2].map(() => phys(P, { action: 'same', book: sameBook, selectedGkAssetId: assetB, gradeReceiptId: rcptC, photo: { bytes: photoB64, contentType: 'image/jpeg' }, idempotencyKey: keyC })));
  assertTrue(par.every((r) => r.statusCode === 200 && r.body.gkAssetId === assetB), `all concurrent requests converge on the same asset, zero 500s (statuses ${par.map((r) => r.statusCode).join(',')})`);
  const dC = (await db.query(`SELECT related_prediction_event_id FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, keyC])).rows;
  assertTrue(dC.length === 1 && dC[0].related_prediction_event_id === peC, 'exactly one decision row, and the prediction link was not lost to the receipt race');
  assertTrue(await cardCount(P) === cardsC && await assetCount(P) === assetsC && await mediaCount(assetB) === mediaC + 1, 'zero duplicate cards/assets, one media row');

  console.log('\n--- H/I/B: ANOTHER COPY at save, then explicit Capture mints once and does NOT ask again ---');
  const anotherItem = `${TAG}-another-item`;
  const keyAn = randomUUID();
  const cardsAn0 = await cardCount(P), assetsAn0 = await assetCount(P);
  await newItem(P, anotherItem, { title: 'Zorro Annual', issue: '3', year: 1965 }); // what the ordinary save+sync creates
  const anRec = await phys(P, { action: 'another', book: sameBook, collectionItemId: anotherItem, idempotencyKey: keyAn });
  assertTrue(anRec.statusCode === 200, 'ANOTHER COPY decision recorded server-side');
  const anRec2 = await phys(P, { action: 'another', book: sameBook, collectionItemId: anotherItem, idempotencyKey: keyAn });
  assertTrue(anRec2.statusCode === 200 && anRec2.body.outcome === 'replayed', 'ANOTHER COPY retry replays — still one decision');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, keyAn]) === 1, 'exactly one SAVE-surface ANOTHER_COPY row');
  assertTrue(await cardCount(P) === cardsAn0 + 1 && await assetCount(P) === assetsAn0, 'after save: cards +1, assets unchanged (mint is the separate explicit Capture)');
  const capAn = await capture(P, { collectionItemId: anotherItem, key: randomUUID(), title: 'Zorro Annual' }); // NO disposition
  assertTrue(capAn.statusCode === 200 && capAn.body.mintOutcome === 'minted-new', `the explicit Capture mints WITHOUT a second prompt (status ${capAn.statusCode})`);
  assertTrue(await assetCount(P) === assetsAn0 + 1 && await cardCount(P) === cardsAn0 + 1, 'ANOTHER COPY end state: assets +1, canonical cards +1');
  assertTrue(capAn.body.gkAssetId !== assetA && capAn.body.gkAssetId !== assetB, 'a third distinct gkAssetId');
  assertTrue(await count(`SELECT COUNT(*)::int n FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND incoming_collection_item_id=$2 AND surface='CAPTURE' AND resulting_gk_asset_id=$3`, [P, anotherItem, capAn.body.gkAssetId]) === 1, 'the Capture records a CAPTURE-surface row naming the minted asset');
  const capAnRetry = await capture(P, { collectionItemId: anotherItem, key: randomUUID(), title: 'Zorro Annual' });
  assertTrue(capAnRetry.statusCode === 200 && capAnRetry.body.gkAssetId === capAn.body.gkAssetId && await assetCount(P) === assetsAn0 + 1, 'a later capture of the now-linked item attaches (no second asset)');

  console.log('\n--- C: client-written sameCopyConfirmations has NO authority ---');
  const forgedItem = `${TAG}-forged-confirm`;
  await newItem(P, forgedItem, { title: 'Zorro Annual', issue: '3', year: 1965, sameCopyConfirmations: [{ at: Date.now(), fromTitle: 'Zorro Annual' }] });
  const forgedCap = await capture(P, { collectionItemId: forgedItem, key: randomUUID(), title: 'Zorro Annual' });
  assertTrue(forgedCap.statusCode === 409 && forgedCap.body.error === 'PHYSICAL_COPY_DECISION_REQUIRED', 'a forged sameCopyConfirmations attribute does not suppress the server decision');

  console.log('\n--- backstop SAME retirement: refused (no writes) when evidence could be lost ---');
  const multiPhoto = `${TAG}-multiphoto`;
  await newItem(P, multiPhoto, { title: 'Zorro Annual', issue: '3', year: 1965, remoteImages: ['/api/collection-image?x=1', '/api/collection-image?x=2'] });
  const mpBefore = { a: await assetCount(P), m: await mediaCount(assetA), c: await cardCount(P) };
  const mpCap = await capture(P, { collectionItemId: multiPhoto, key: randomUUID(), title: 'Zorro Annual', disposition: { choice: 'SAME_COPY', selectedGkAssetId: assetA } });
  assertTrue(mpCap.statusCode === 409 && /SAME_COPY_UNAVAILABLE/.test(mpCap.body.error), 'row with more than the capture photo: SAME_COPY refused (409 SAME_COPY_UNAVAILABLE)');
  assertTrue(await assetCount(P) === mpBefore.a && await mediaCount(assetA) === mpBefore.m && await cardCount(P) === mpBefore.c, 'refusal wrote nothing and deleted nothing');

  console.log('\n--- backstop SAME retirement preserves the prediction link ---');
  const peD = await newPredictionEvent(P);
  const rcptD = await newReceipt(P, peD);
  const seeded = `${TAG}-seeded-prediction`;
  await newItem(P, seeded, { title: 'Zorro Annual', issue: '3', year: 1965 });
  const claimD = await receipts.claimGradeReceipt({ principalId: P, receiptId: rcptD });
  const { claimModelBaseline } = await import(pathToFileURL(path.join(repoRoot, 'src', 'modules', 'collection', 'index.js')).href);
  await claimModelBaseline({ principalId: P, id: seeded, baseline: claimD.baseline });
  const keyD = randomUUID();
  const cardsD = await cardCount(P);
  const capD = await capture(P, { collectionItemId: seeded, key: keyD, title: 'Zorro Annual', disposition: { choice: 'SAME_COPY', selectedGkAssetId: assetA } });
  assertTrue(capD.statusCode === 200 && capD.body.copyDecision?.retired === true, 'backstop SAME retired the seeded transient row');
  assertTrue(await cardCount(P) === cardsD - 1, 'the duplicate card is gone');
  const dD = (await db.query(`SELECT related_prediction_event_id, incoming_retired FROM data1_dev.physical_copy_decision_event WHERE principal_id=$1 AND capture_idempotency_key=$2`, [P, keyD])).rows;
  assertTrue(dD.length === 1 && dD[0].related_prediction_event_id === peD && dD[0].incoming_retired === true, 'the retired row\'s prediction pointer survives on the decision event (history not lost with the row)');
  assertTrue((await eventState(peD)).payload_hash === `hash-${peD}`, 'the prediction event remains intact');
  const capDRetry = await capture(P, { collectionItemId: seeded, key: keyD, title: 'Zorro Annual', disposition: { choice: 'SAME_COPY', selectedGkAssetId: assetA } });
  assertTrue(capDRetry.statusCode === 200 && capDRetry.body.copyDecision?.replayed === true && capDRetry.body.gkAssetId === assetA, 'retry after retirement replays (no 400 on the missing row)');
  const capDConflict = await capture(P, { collectionItemId: seeded, key: keyD, title: 'Zorro Annual', disposition: { choice: 'ANOTHER_COPY' } });
  assertTrue(capDConflict.statusCode === 409, 'changed choice after retirement refused');

  console.log('\n--- UI wiring (static source-text proof — React/App components; disclosed, not rendered) ---');
  const panel = readFileSync(path.join(repoRoot, 'src', 'components', 'GrailKeyOperatorPanel.jsx'), 'utf8');
  const app = readFileSync(path.join(repoRoot, 'src', 'App.jsx'), 'utf8');
  assertTrue(panel.includes('Is this the same physical copy you already own?') && panel.includes('ANOTHER COPY (a different physical book)'), 'capture-time backstop surface keeps the required wording');
  assertTrue(/copyDecision\.candidates\.map/.test(panel) && /selectedGkAssetId: c\.gkAssetId/.test(panel), 'backstop lists per-candidate SAME COPY (never first-match)');
  assertTrue(/onClick=\{\(\) => captureAsOwnedAsset\(\)\}/.test(panel), 'the ordinary capture button sends NO disposition');
  assertTrue(/onSameCopyRetired\(collectionItemId/.test(panel) && /handleSameCopyRetired/.test(app) && /onSameCopyRetired=\{handleSameCopyRetired\}/.test(app), 'backstop retirement is mirrored locally (one final card)');
  const retireFn = app.slice(app.indexOf('const handleSameCopyRetired'), app.indexOf('const handleSameCopyRetired') + 900);
  assertTrue(/deleteComic\(retiredId\)/.test(retireFn) && !/clearAll|deleteDatabase/.test(retireFn), 'local cleanup removes ONE entry — never clears IndexedDB, no cache busting');
  assertTrue(!/sameCopyConfirmations:\s*\[/.test(app), 'App.jsx no longer WRITES sameCopyConfirmations (client attribute is not authority)');
  assertTrue(/action: "candidates"/.test(app) && /action: "same"/.test(app) && /action: "another"/.test(app), 'the save-time prompt is driven by the server endpoint (candidates/same/another)');
  const sameStart = app.indexOf('GK-279 — the SERVER adjudicates SAME COPY');
  const sameEnd = app.indexOf('setPendingDuplicate(null)', sameStart);
  assertTrue(sameStart > -1 && sameEnd > sameStart && !/addToCatalogue\(/.test(app.slice(sameStart, sameEnd)), 'SAME COPY never calls addToCatalogue before server confirmation (no second local/server row)');
  assertTrue(app.indexOf('/api/physical-copy', sameStart) > -1 && app.indexOf('/api/physical-copy', sameStart) < sameEnd, 'prompt stays open until the server confirms SAME COPY');
  assertTrue((app.match(/Is this the SAME copy, or ANOTHER copy\?/g) || []).length === 1, 'exactly ONE save-time prompt exists in App.jsx (single prompt surface)');
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
