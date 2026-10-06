// tests/duplicate-entry-closeout.test.js — DUPLICATE ENTRY CLOSEOUT (bulk + JSON ingestion).
//
// LAW under test: a legitimate second physical copy is NEVER silently discarded.
//   bulk import  : possible duplicate / in-flight match  -> HELD (durable), not skipped, not an error
//   JSON restore : exported id -> idempotent replay; new id restores; no id + match -> HELD
//   resolution   : reuses the existing server authority (/api/physical-copy action:'same'|'another')
//
// METHOD (stated plainly): src/db.js runs for REAL against fake-indexeddb (a spec-compliant IndexedDB,
// same engine the repo's other IndexedDB tests use). The client resolution code in
// src/lib/copyReviewHeld.js runs unmodified. The /api/physical-copy SERVER is a contract-faithful
// in-test stand-in (same validation rules as api/physical-copy.js + src/modules/assets/service.js:
// candidates principal-scoped, SAME COPY validated against the server's own set, ANOTHER COPY carries
// no asset id and needs >0 candidates, idempotency-key replay/conflict). No server file is changed by
// this closeout; the real GK-279 server suites are re-run separately as the regression proof.
//
// Invoke: node tests/duplicate-entry-closeout.test.js

import 'fake-indexeddb/auto';
import { signInTestPrincipal, TEST_PRINCIPAL } from './helpers/installBrowserSession.js';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

let passed = 0, failed = 0;
const failures = [];
const eq = (a, b, label) => {
  if (JSON.stringify(a) === JSON.stringify(b)) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; const m = `  ✗ ${label}\n    expected: ${JSON.stringify(b)}\n    actual:   ${JSON.stringify(a)}`; failures.push(m); console.log(m); }
};
const ok = (c, label) => eq(!!c, true, label);

const lib = await import('../src/lib/copyReviewHeld.js');
const {
  HELD_KIND, HELD_REASON, classifyBulkDuplicate, planJsonRestore, buildHeldRecord,
  resolveAnotherCopy, resolveSameCopy, refreshCandidates, discardHeld, fetchCandidates,
} = lib;
const { isPlausiblePhysicalCopyCandidate } = await import('../src/lib/duplicateCopyDetection.js');
let db = await import('../src/db.js');

// ── contract-faithful /api/physical-copy stand-in ────────────────────────────────────────────
function makeServer() {
  const st = {
    assets: [], // { gkAssetId, collectionItemId, title, issue, year, grade }
    decisions: new Map(), // idempotencyKey -> { choice, selectedGkAssetId, collectionItemId }
    calls: [], failCandidates: false, failAnother: false, failSame: false,
  };
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const authFetch = async (url, init) => {
    const b = JSON.parse(init.body);
    st.calls.push(b.action);
    if (url !== '/api/physical-copy') return json(404, {});
    const cands = () => st.assets.filter((a) => isPlausiblePhysicalCopyCandidate(b.book, a));
    if (b.action === 'candidates') return st.failCandidates ? json(503, {}) : json(200, { candidates: cands() });
    if (st.failCandidates) return json(503, {});
    if (!b.idempotencyKey) return json(400, {});
    if (b.action === 'same') {
      if (st.failSame) return json(500, {});
      const sel = cands().find((c) => c.gkAssetId === b.selectedGkAssetId);
      if (!sel) return json(400, { error: 'selectedGkAssetId is not one of this principal\'s plausible owned candidates' });
      const prior = st.decisions.get(b.idempotencyKey);
      if (prior && (prior.choice !== 'SAME_COPY' || prior.selectedGkAssetId !== sel.gkAssetId)) return json(409, {});
      st.decisions.set(b.idempotencyKey, { choice: 'SAME_COPY', selectedGkAssetId: sel.gkAssetId, collectionItemId: null });
      return json(200, { ok: true });
    }
    if (b.action === 'another') {
      if (st.failAnother) return json(500, {});
      if (cands().length === 0) return json(400, { error: 'no plausible owned physical copy exists — nothing to decide' });
      const prior = st.decisions.get(b.idempotencyKey);
      if (prior && (prior.choice !== 'ANOTHER_COPY' || prior.collectionItemId !== b.collectionItemId)) return json(409, {});
      st.decisions.set(b.idempotencyKey, { choice: 'ANOTHER_COPY', selectedGkAssetId: null, collectionItemId: b.collectionItemId });
      return json(200, { ok: true });
    }
    return json(400, {});
  };
  return { st, authFetch };
}

function makeDeps(server, catalogueSaved = []) {
  return {
    authFetch: server.authFetch,
    getPrincipal: () => TEST_PRINCIPAL,
    putHeld: (r) => db.putCopyReviewHeld(r),
    deleteHeld: (id) => db.deleteCopyReviewHeld(id),
    saveScan: async (data, image, principal) => { catalogueSaved.push({ id: data._presetId, data, image, principal }); return data._presetId; },
    saveEntry: async (entry) => { catalogueSaved.push({ id: entry.id, entry }); return entry.id; },
  };
}

const HOWARD = { title: 'Howard the Duck', issue: '1', year: '1976', publisher: 'Marvel', grade: 'VG 4.0', assetType: 'comic', gradeReceiptId: 'gr_test' };
const IMG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes-for-held-record').toString('base64');
const ASSET_A = { gkAssetId: 'gk-asset-A', collectionItemId: 'cv_existing_A', title: 'Howard the Duck', issue: '1', year: '1976', grade: 'VG 4.0' };
const clean = async () => { for (const r of await db.getAllCopyReviewHeld()) await db.deleteCopyReviewHeld(r.id); };

console.log('\n=== DUPLICATE ENTRY CLOSEOUT ===\n');

// ── 0. classification keeps the OLD triggers, changes only the outcome ───────────────────────
console.log('Classification (old triggers preserved; outcome is HOLD, never skip):');
{
  const catalogue = [{ id: 'cv_existing_A', title: 'Howard the Duck', issue: '1', year: '1976' }];
  const none = classifyBulkDuplicate({ catalogue, title: 'Batman', issue: '1', year: '1940', dupKey: 'batman|1|1940', inFlightKeys: new Set() });
  eq(none, null, 'a genuinely different book is not a duplicate -> proceeds normally');
  const cat = classifyBulkDuplicate({ catalogue, title: 'Howard the Duck', issue: '1', year: '1976', dupKey: 'k', inFlightKeys: new Set() });
  eq([cat.reason, cat.matchIds], [HELD_REASON.CATALOGUE_MATCH, ['cv_existing_A']], 'catalogue match -> CATALOGUE_MATCH carrying the matched ids');
  const inflight = new Set(['howard the duck|1|1976']);
  const fl = classifyBulkDuplicate({ catalogue: [], title: 'Howard the Duck', issue: '1', year: '1976', dupKey: 'howard the duck|1|1976', inFlightKeys: inflight });
  eq(fl.reason, HELD_REASON.IN_FLIGHT_MATCH, 'in-flight key match -> IN_FLIGHT_MATCH (held, not discarded)');
  eq([...inflight], ['howard the duck|1|1976'], 'classification never mutates inFlightKeys (race guard intact)');
}

// ── A. existing copy A + bulk incoming copy B -> held -> ANOTHER COPY ────────────────────────
console.log('\nA. Existing Howard #1 copy A + bulk incoming copy B:');
{
  await clean();
  const server = makeServer(); server.st.assets.push(ASSET_A);
  const saved = [];
  const dup = classifyBulkDuplicate({ catalogue: [{ id: 'cv_existing_A', title: 'Howard the Duck', issue: '1', year: '1976' }], title: HOWARD.title, issue: '1', year: '1976', dupKey: 'k', inFlightKeys: new Set() });
  ok(dup, 'copy B is NOT skipped — classified as a possible duplicate');
  const c = await fetchCandidates({ title: HOWARD.title, issue: '1', year: '1976' }, { authFetch: server.authFetch });
  const rec = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: dup.reason, principal: TEST_PRINCIPAL, fileName: 'copyB.jpg', incoming: HOWARD, image: IMG, matchIds: dup.matchIds, candidates: c.candidates, candidatesVerified: c.ok });
  await db.putCopyReviewHeld(rec);
  eq((await db.getAllCopyReviewHeld()).length, 1, 'copy B is durably HELD (not an error, not discarded)');
  const r = await resolveAnotherCopy(rec, makeDeps(server, saved));
  ok(r.ok, 'ANOTHER COPY succeeds');
  eq(saved.length, 1, 'exactly one new collection item saved');
  ok(saved[0].id && saved[0].id !== 'cv_existing_A', 'the new item has a NEW id (copy A is untouched, nothing overwritten)');
  eq(server.st.decisions.get(saved.length ? [...server.st.decisions.keys()][0] : '')?.collectionItemId, saved[0].id, 'the server recorded action:\'another\' for exactly that new item id');
  eq(server.st.decisions.size, 1, 'one durable decision recorded');
  eq((await db.getAllCopyReviewHeld()).length, 0, 'held record removed only after the save succeeded');
  ok(/^cv_\d+_[a-z0-9]{1,6}$/.test(saved[0].id), '_presetId uses the identical cv_<ms>_<base36> shape the single-scan ANOTHER COPY mints');
  ok(saved[0].data.assetType === 'comic', 'the retained model result (incl. explicit assetType) reaches the save');
}

// ── B. SAME physical copy ────────────────────────────────────────────────────────────────────
console.log('\nB. Same physical copy A scanned again:');
{
  await clean();
  const server = makeServer(); server.st.assets.push(ASSET_A);
  const saved = [];
  const c = await fetchCandidates({ title: HOWARD.title, issue: '1', year: '1976' }, { authFetch: server.authFetch });
  const rec = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: HELD_REASON.CATALOGUE_MATCH, principal: TEST_PRINCIPAL, fileName: 'copyA-again.jpg', incoming: HOWARD, image: IMG, matchIds: ['cv_existing_A'], candidates: c.candidates, candidatesVerified: true });
  await db.putCopyReviewHeld(rec);
  const bad = await resolveSameCopy(rec, 'gk-asset-NOT-MINE', makeDeps(server, saved));
  eq([bad.ok, bad.code], [false, 'SAME_COPY_NOT_CONFIRMED'], 'a candidate the server does not own is refused (server validates)');
  eq((await db.getAllCopyReviewHeld()).length, 1, 'refusal leaves the record held');
  const good = await resolveSameCopy(rec, 'gk-asset-A', makeDeps(server, saved));
  ok(good.ok, 'SAME COPY resolves against the existing asset');
  eq(saved.length, 0, 'NO new collection row saved');
  eq(server.st.assets.length, 1, 'NO second physical asset exists');
  eq([...server.st.decisions.values()][0].choice, 'SAME_COPY', 'the server recorded the SAME_COPY decision');
  eq((await db.getAllCopyReviewHeld()).length, 0, 'held record dropped only after server confirmation');
}

// ── C. two identical copies in the same batch ────────────────────────────────────────────────
console.log('\nC. Two identical copies in the SAME batch (inFlightKeys race guard):');
{
  await clean();
  const server = makeServer();
  const saved = [];
  const inFlightKeys = new Set();
  const dupKey = 'howard the duck|1|1976';
  inFlightKeys.add(dupKey); // worker 1 (copy A) is mid-save
  const dupB = classifyBulkDuplicate({ catalogue: [], title: HOWARD.title, issue: '1', year: '1976', dupKey, inFlightKeys });
  eq(dupB.reason, HELD_REASON.IN_FLIGHT_MATCH, 'copy B hits the in-flight key');
  const rec = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: dupB.reason, principal: TEST_PRINCIPAL, fileName: 'copyB.jpg', incoming: HOWARD, image: IMG, candidatesVerified: true, candidates: [] });
  await db.putCopyReviewHeld(rec);
  ok(inFlightKeys.has(dupKey), 'the race guard still holds the key (copy A is still protected from duplicate execution)');
  eq((await db.getAllCopyReviewHeld()).length, 1, 'copy B is HELD — not lost');
  server.st.assets.push(ASSET_A); // copy A finished, now a physical asset exists
  const r = await resolveAnotherCopy(rec, makeDeps(server, saved));
  ok(r.ok && saved.length === 1, 'copy B resolves as ANOTHER COPY after copy A finishes');
}

// ── D. durability across a restart + the 4->5 additive migration ─────────────────────────────
console.log('\nD. Held durability (restart) and v4->v5 migration:');
{
  await clean();
  const server = makeServer(); server.st.assets.push(ASSET_A);
  const c = await fetchCandidates({ title: HOWARD.title, issue: '1', year: '1976' }, { authFetch: server.authFetch });
  const rec = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: HELD_REASON.CATALOGUE_MATCH, principal: TEST_PRINCIPAL, fileName: 'copyB.jpg', incoming: HOWARD, image: IMG, matchIds: ['cv_existing_A'], candidates: c.candidates, candidatesVerified: true });
  await db.putCopyReviewHeld(rec);
  // "close the app": a genuinely fresh src/db.js module instance (in-memory open promise gone);
  // the IndexedDB data is all that survives, exactly as across a real tab close/refresh.
  db = await import(`../src/db.js?restart=${Date.now()}`);
  const after = await db.getAllCopyReviewHeld();
  eq(after.length, 1, 'held item still present after restart');
  eq(after[0].candidates.map((x) => x.gkAssetId), ['gk-asset-A'], 'candidate ids retained');
  eq(after[0].image, IMG, 'the incoming image bytes survive');
  eq(after[0].incoming.title, 'Howard the Duck', 'the model scan result survives');
  eq(after[0].fileName, 'copyB.jpg', 'source file name retained for display');
  const saved = [];
  const r = await resolveAnotherCopy(after[0], makeDeps(server, saved));
  ok(r.ok && saved.length === 1, 'ANOTHER COPY completes from the reopened held record — no re-import of the source file');
  eq(saved[0].image, IMG, 'the save used the retained image, not a fresh file read');
  await db.getAllCopyReviewHeld(); // keep connection warm

  // v4 -> v5: a principal's existing v4 database gains the store; nothing else is touched.
  const P = 'upgrade-principal';
  const name = db.scopedDbName(P);
  await new Promise((resolve, reject) => {
    const q = indexedDB.open(name, 4);
    q.onupgradeneeded = () => {
      const d = q.result;
      const s = d.createObjectStore('comics', { keyPath: 'id' }); s.createIndex('timestamp', 'timestamp', { unique: false });
      d.createObjectStore('valueSnapshots', { keyPath: 'date' });
      d.createObjectStore('analysisCache', { keyPath: 'key' });
      const fx = d.createObjectStore('fixtureBank', { keyPath: 'traceId' }); fx.createIndex('capturedAt', 'capturedAt', { unique: false });
      d.createObjectStore('genericCaptureDrafts', { keyPath: 'id' });
    };
    q.onsuccess = () => {
      const tx = q.result.transaction('comics', 'readwrite');
      tx.objectStore('comics').put({ id: 'cv_v4_row', title: 'Existing v4 row', timestamp: 1 });
      tx.oncomplete = () => { q.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    q.onerror = () => reject(q.error);
  });
  signInTestPrincipal(P);
  const dbUp = await import(`../src/db.js?upgrade=${Date.now()}`);
  const rows = await dbUp.getAllComics();
  eq(rows.map((x) => x.id), ['cv_v4_row'], 'v4 -> v5: the existing catalogue row is untouched');
  eq(await dbUp.getAllCopyReviewHeld(), [], 'v4 -> v5: the new held store exists and is empty');
  await dbUp.putCopyReviewHeld({ id: 'held_probe', book: {} });
  eq((await dbUp.getAllCopyReviewHeld()).length, 1, 'v4 -> v5: the new store is writable');
  signInTestPrincipal(TEST_PRINCIPAL);
  db = await import(`../src/db.js?back=${Date.now()}`);
}

// ── E/F/G. JSON restore identity order ───────────────────────────────────────────────────────
console.log('\nE. JSON: two DISTINCT exported ids, same catalogue identity:');
{
  const parsed = [
    { id: 'cv_rec_A', title: 'Howard the Duck', issue: '1', year: '1976' },
    { id: 'cv_rec_B', title: 'Howard the Duck', issue: '1', year: '1976' },
  ];
  const plan = planJsonRestore({ parsed, existingItems: [] });
  eq(plan.restore.map((x) => x.id), ['cv_rec_A', 'cv_rec_B'], 'both restore (distinct durable ids)');
  eq([plan.held.length, plan.replayed, plan.invalid], [0, 0, 0], 'nothing held, replayed or dropped');
  const withExisting = planJsonRestore({ parsed, existingItems: [{ id: 'cv_other', title: 'Howard the Duck', issue: '1', year: '1976' }] });
  eq(withExisting.restore.length, 2, 'both still restore when a different copy with the same identity already exists');
}
console.log('\nF. JSON: replay of the same exported record:');
{
  const rec = { id: 'cv_rec_A', title: 'Howard the Duck', issue: '1', year: '1976' };
  const twiceInFile = planJsonRestore({ parsed: [rec, rec], existingItems: [] });
  eq([twiceInFile.restore.length, twiceInFile.replayed], [1, 1], 'same id twice in one file -> restored once, second is a replay');
  const secondImport = planJsonRestore({ parsed: [rec], existingItems: [rec] });
  eq([secondImport.restore.length, secondImport.replayed, secondImport.held.length], [0, 1, 0], 'second import of the same file creates nothing new');
}
console.log('\nG. JSON: legacy export WITHOUT ids:');
{
  const existing = [{ id: 'cv_existing_A', title: 'Howard the Duck', issue: '1', year: '1976' }];
  const parsed = [{ title: 'Howard the Duck', issue: '1', year: '1976' }, { title: 'Batman', issue: '1', year: '1940' }];
  const plan = planJsonRestore({ parsed, existingItems: existing });
  eq(plan.held.length, 1, 'no id + catalogue match -> HELD, not skipped');
  eq(plan.held[0].matchIds, ['cv_existing_A'], 'the held entry carries the matched id');
  eq(plan.restore.map((x) => x.title), ['Batman'], 'no id + no match -> restored normally');
  ok(/^cv_/.test(plan.restore[0].id), 'a fresh durable id is assigned to the restored legacy row');
  const twins = planJsonRestore({ parsed: [{ title: 'Howard the Duck', issue: '1', year: '1976' }, { title: 'Howard the Duck', issue: '1', year: '1976' }], existingItems: [] });
  eq([twins.restore.length, twins.held.length], [1, 1], 'two id-less identical rows in one file: one restores, the other is HELD (neither discarded)');
  // resolving a held JSON entry as ANOTHER COPY
  await clean();
  const server = makeServer(); server.st.assets.push(ASSET_A);
  const saved = [];
  const rec = buildHeldRecord({ kind: HELD_KIND.JSON_RESTORE, reason: HELD_REASON.JSON_NO_ID_MATCH, principal: TEST_PRINCIPAL, entry: plan.held[0].entry, matchIds: plan.held[0].matchIds });
  await db.putCopyReviewHeld(rec);
  const r = await resolveAnotherCopy((await db.getAllCopyReviewHeld())[0], makeDeps(server, saved));
  ok(r.ok && saved.length === 1 && saved[0].id !== 'cv_existing_A', 'a held legacy JSON row completes as ANOTHER COPY under a new id');
}

// ── H. ownership-check failure stays fail-closed ─────────────────────────────────────────────
console.log('\nH. Ownership-check outage (fail-closed, no silent mint):');
{
  await clean();
  const server = makeServer(); server.st.assets.push(ASSET_A); server.st.failCandidates = true;
  const saved = [];
  const down = await fetchCandidates({ title: HOWARD.title, issue: '1', year: '1976' }, { authFetch: server.authFetch });
  eq(down.ok, false, 'a failed check is reported as a failure, NOT as zero candidates');
  const rec = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: HELD_REASON.CATALOGUE_MATCH, principal: TEST_PRINCIPAL, fileName: 'x.jpg', incoming: HOWARD, image: IMG, candidates: [], candidatesVerified: false });
  await db.putCopyReviewHeld(rec);
  const r = await resolveAnotherCopy(rec, makeDeps(server, saved));
  eq([r.ok, r.code], [false, 'CHECK_UNAVAILABLE'], 'ANOTHER COPY refuses while the check is down');
  eq(saved.length, 0, 'nothing minted/saved silently');
  eq((await db.getAllCopyReviewHeld()).length, 1, 'the item is still held');
  const re = await refreshCandidates(rec, makeDeps(server, saved));
  eq([re.ok, re.code], [false, 'CHECK_UNAVAILABLE'], 'Retry ownership check reports unavailable while down');
  const dis = await discardHeld(rec, makeDeps(server, saved));
  eq([dis.ok, dis.code], [false, 'CANDIDATES_EXIST_OR_UNVERIFIED'], 'discard is refused while ownership is unverified');
  server.st.failCandidates = false;
  const re2 = await refreshCandidates(rec, makeDeps(server, saved));
  ok(re2.ok && re2.record.candidatesVerified && re2.record.candidates.length === 1, 'Retry ownership check succeeds once the endpoint recovers and stores the candidates');
}

// ── Idempotency: retry of the SAME attempt vs an intentional second copy ─────────────────────
console.log('\nIdempotency (retry != second copy):');
{
  await clean();
  const server = makeServer(); server.st.assets.push(ASSET_A);
  const rec0 = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: HELD_REASON.CATALOGUE_MATCH, principal: TEST_PRINCIPAL, incoming: HOWARD, image: IMG, candidatesVerified: true, candidates: [ASSET_A] });
  await db.putCopyReviewHeld(rec0);
  const savedA = [];
  const failingDeps = { ...makeDeps(server, savedA), saveScan: async (data) => { savedA.push(data._presetId); return null; } };
  const first = await resolveAnotherCopy(rec0, failingDeps);
  eq([first.ok, first.code], [false, 'SAVE_FAILED'], 'first attempt: decision recorded but the save failed');
  const stored = (await db.getAllCopyReviewHeld())[0];
  ok(stored.presetId && stored.decisionKey, 'the attempt identity (presetId + decisionKey) was persisted BEFORE the server call');
  const retryDeps = { ...makeDeps(server, savedA), saveScan: async (data) => { savedA.push(data._presetId); return data._presetId; } };
  const second = await resolveAnotherCopy(stored, retryDeps);
  ok(second.ok, 'the retry completes');
  eq(savedA[0], savedA[1], 'the retry reuses the SAME item id (replay, not a second row)');
  eq(server.st.decisions.size, 1, 'the server saw ONE decision for the whole attempt (same idempotency key)');
  // an intentional second copy is a different held record -> different ids
  const recB = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: HELD_REASON.CATALOGUE_MATCH, principal: TEST_PRINCIPAL, incoming: HOWARD, image: IMG, candidatesVerified: true, candidates: [ASSET_A] });
  await db.putCopyReviewHeld(recB);
  const savedB = [];
  await resolveAnotherCopy(recB, makeDeps(server, savedB));
  ok(savedB[0].id !== savedA[1], 'an intentional second copy gets its own id');
  eq(server.st.decisions.size, 2, 'and its own decision');
}

// ── I. CROSS-DEVICE: server 409 PHYSICAL_COPY_DECISION_REQUIRED at sync -> durable HELD review ──
console.log('\nI. Cross-device 409 (Device B has no local match; the SERVER owns a candidate):');
{
  const { persistCollectionItem, retryPendingCollectionItems } = await import('../src/lib/collectionPersistence.js');
  const { pushCollectionItem } = await import('../src/lib/collectionSync.js');
  await clean();
  for (const c of await db.getAllComics()) await db.deleteComic(c.id);
  const server = makeServer(); server.st.assets.push(ASSET_A);
  let collectionPosts = 0; const accepted = [];
  const realFetch = globalThis.fetch;
  let mode = 'server'; // 'server' = faithful standing check; 'net500' = outage; 'other409' = unrelated 409
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url === '/api/collection') {
      collectionPosts++;
      const j = (status, b) => ({ ok: status >= 200 && status < 300, status, json: async () => b });
      if (mode === 'net500') return j(500, { error: 'boom' });
      if (mode === 'other409') return j(409, { error: 'SOMETHING_ELSE' });
      const cands = server.st.assets.filter((a) => isPlausiblePhysicalCopyCandidate(body.attributes, a));
      const decided = [...server.st.decisions.values()].some((d) => d.choice === 'ANOTHER_COPY' && d.collectionItemId === body.id);
      if (cands.length > 0 && !decided) return j(409, { error: 'PHYSICAL_COPY_DECISION_REQUIRED', candidates: cands });
      accepted.push(body.id);
      return j(200, { id: body.id });
    }
    return server.authFetch(url, init);
  };
  try {
    const entry = { id: 'cv_B_local', assetCategory: 'comic', title: 'Howard the Duck', issue: '1', year: '1976', images: [IMG], _gradeReceiptId: 'gr_x', timestamp: Date.now() };
    const res = await persistCollectionItem(entry);
    eq(res._syncStatus, 'copy-review', 'the 409 is NOT left as an ordinary "pending" row — it becomes copy-review');
    const row = (await db.getAllComics()).find((c) => c.id === 'cv_B_local');
    eq(row?._syncStatus, 'copy-review', 'the local Collection row is durable (still in IndexedDB) and marked copy-review');
    let held = await db.getAllCopyReviewHeld();
    eq(held.length, 1, 'exactly one durable HELD record exists');
    eq([held[0].id, held[0].kind, held[0].reason], ['held_sync_cv_B_local', HELD_KIND.COLLECTION_SYNC, HELD_REASON.SERVER_DECISION_REQUIRED], 'it reuses the existing copyReviewHeld store (deterministic id, sync-conflict kind)');
    eq(held[0].candidates.map((c) => c.gkAssetId), ['gk-asset-A'], "the server's candidate ids are retained for review");
    eq(held[0].entry.id, 'cv_B_local', 'the full local row is retained (resumable)');
    ok(typeof held[0].image === 'string' && held[0].image.startsWith('data:'), "the row's photo is retained for SAME COPY");
    eq(collectionPosts, 1, 'one push attempt so far');

    const retried = await retryPendingCollectionItems([row]);
    eq([retried.length, collectionPosts], [0, 1], 'NOT retried forever: the pending-retry loop never touches a copy-review row');

    const createdAt = held[0].createdAt;
    await persistCollectionItem({ ...entry, price: '$9.00' }); // e.g. a later enrich persist hits the same 409
    held = await db.getAllCopyReviewHeld();
    eq([held.length, held[0].createdAt], [1, createdAt], 'a repeat 409 for the same row does NOT create a second held record');

    db = await import(`../src/db.js?restart409=${Date.now()}`);
    eq([(await db.getAllCopyReviewHeld()).length, (await db.getAllComics()).find((c) => c.id === 'cv_B_local')?._syncStatus], [1, 'copy-review'], 'refresh/restart preserves BOTH the held record and the row');

    // ordinary failures keep their old behaviour (pending, never held)
    mode = 'net500';
    const r500 = await persistCollectionItem({ id: 'cv_net', assetCategory: 'comic', title: 'Other', issue: '2', year: '1999', images: [] });
    mode = 'other409';
    const r409x = await persistCollectionItem({ id: 'cv_other409', assetCategory: 'comic', title: 'Other', issue: '3', year: '1999', images: [] });
    mode = 'server';
    eq([r500._syncStatus, r409x._syncStatus], ['pending', 'pending'], 'a network/server failure or an unrelated 409 is still an ordinary retryable pending row');
    eq((await db.getAllCopyReviewHeld()).length, 1, '...and neither creates a held record');

    // operator: ANOTHER COPY resolves it through the EXISTING action:'another' + a now-accepted push
    const deps = {
      ...makeDeps(server, []),
      pushEntry: (e) => pushCollectionItem(e),
      markSynced: async (e) => { await db.putComic({ ...e, _syncStatus: 'synced' }); },
      removeLocalRow: (id) => db.deleteComic(id),
    };
    const rec = (await db.getAllCopyReviewHeld())[0];
    const out = await resolveAnotherCopy(rec, deps);
    ok(out.ok && out.savedId === 'cv_B_local', 'ANOTHER COPY resolves the held sync conflict');
    eq([...server.st.decisions.values()].filter((d) => d.collectionItemId === 'cv_B_local').length, 1, "the server recorded action:'another' for exactly the local row id");
    ok(accepted.includes('cv_B_local'), 'the server then ACCEPTED the same row (it keeps its id; nothing overwritten, nothing duplicated)');
    eq((await db.getAllComics()).find((c) => c.id === 'cv_B_local')?._syncStatus, 'synced', 'the row is now synced');
    eq((await db.getAllCopyReviewHeld()).length, 0, 'the held record is gone only after the server accepted the push');

    // operator: SAME COPY on a second conflict removes the local-only duplicate row, adds nothing server-side
    await persistCollectionItem({ id: 'cv_B2_local', assetCategory: 'comic', title: 'Howard the Duck', issue: '1', year: '1976', images: [IMG] });
    const rec2 = (await db.getAllCopyReviewHeld()).find((r) => r.id === 'held_sync_cv_B2_local');
    ok(rec2, 'a second conflicting row is held');
    const acceptedBefore = accepted.length;
    const same = await resolveSameCopy(rec2, 'gk-asset-A', deps);
    ok(same.ok, "SAME COPY resolves via the existing server-validated action:'same'");
    eq((await db.getAllComics()).some((c) => c.id === 'cv_B2_local'), false, 'the local-only duplicate row is removed (it never reached the server)');
    eq(accepted.length, acceptedBefore, 'no second collection row was accepted by the server');
    eq((await db.getAllCopyReviewHeld()).length, 0, 'held record dropped after server confirmation');

    // discard is refused for a conflict that HAS owned candidates
    await persistCollectionItem({ id: 'cv_B3_local', assetCategory: 'comic', title: 'Howard the Duck', issue: '1', year: '1976', images: [IMG] });
    const rec3 = (await db.getAllCopyReviewHeld())[0];
    const d3 = await discardHeld(rec3, deps);
    eq([d3.ok, d3.code], [false, 'CANDIDATES_EXIST_OR_UNVERIFIED'], 'an item the server says matches an owned copy cannot be discarded away — it needs SAME or ANOTHER');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── guardrails: payload completeness, principal, no auto-resolve ─────────────────────────────
console.log('\nGuardrails:');
{
  let threw = 0;
  try { buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: 'X', incoming: HOWARD, image: null }); } catch { threw++; }
  try { buildHeldRecord({ kind: HELD_KIND.JSON_RESTORE, reason: 'X', entry: null }); } catch { threw++; }
  eq(threw, 2, 'a held record that could not be resumed (no image / no entry) is REFUSED at build time — "a held item that cannot be resumed is a lost item"');
  const server = makeServer();
  const rec = buildHeldRecord({ kind: HELD_KIND.BULK_SCAN, reason: HELD_REASON.CATALOGUE_MATCH, principal: 'someone-else', incoming: HOWARD, image: IMG, candidatesVerified: true, candidates: [] });
  const r = await resolveAnotherCopy(rec, makeDeps(server, []));
  eq([r.ok, r.code], [false, 'WRONG_PRINCIPAL'], 'a held record from another account is never resolved here');
}

// ── static wiring proofs (App.jsx) ───────────────────────────────────────────────────────────
console.log('\nWiring (App.jsx source):');
{
  const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  ok(!/duplicate in-flight, skipping|errors\.push\(`\$\{file\.name\}: duplicate/.test(app), 'the silent-skip error pushes for duplicate / in-flight are gone from bulk import');
  ok(/classifyBulkDuplicate\(/.test(app) && /holdForReview\(file, data, bulkIssue, b64, dup\)/.test(app), 'bulk import holds a classified duplicate');
  ok(/inFlightKeys\.add\(dupKey\)/.test(app) && /inFlightKeys\.delete\(dupKey\)/.test(app), 'inFlightKeys add/delete (race guard) preserved');
  ok(/planJsonRestore\(\{ parsed, existingItems: items \}\)/.test(app), 'JSON restore uses the id-first plan');
  ok(!/`\$\{c\.title\}\|\$\{c\.issue\}\|\$\{c\.year\}`/.test(app), 'JSON restore no longer keys on title|issue|year');
  ok(/items\.map\(\(\{ images, \.\.\.rest \}\) => rest\)/.test(app), 'the backup export spreads every field but `images`, so each exported record carries its durable catalogue `id`');
  ok(/<CopyReviewPanel/.test(app), 'the review panel is mounted');
  const panel = readFileSync(new URL('../src/components/CopyReviewPanel.jsx', import.meta.url), 'utf8');
  ok(/Discard this item/.test(panel) && !/Same book/i.test(panel), 'discard control uses neutral wording (never "same book"/SAME COPY)');
  const persist = readFileSync(new URL('../src/lib/collectionPersistence.js', import.meta.url), 'utf8');
  ok(/decisionRequired/.test(persist) && /copy-review/.test(persist), 'the sync layer converts the server 409 into held review');
  // _presetId untouched: the diff against the base must not add/remove any presetId line in App.jsx.
  let diff = '';
  try { diff = execSync('git diff origin/main -- src/App.jsx', { cwd: new URL('..', import.meta.url), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { diff = null; }
  if (diff === null) { console.log('  (skipped: git diff unavailable)'); } else {
    const touched = diff.split('\n').filter((l) => /^[+-][^+-]/.test(l) && /presetId/i.test(l));
    eq(touched, [], '_presetId: no line mentioning it was added, removed or changed in App.jsx');
  }
  const bank = readFileSync(new URL('../tests/gk231-fixture-bank-indexeddb.test.js', import.meta.url), 'utf8');
  ok(/dbVersionOpened, 5/.test(bank), 'the DB-version expectation was advanced 4 -> 5');
}

await clean();
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(failures.join('\n')); process.exit(1); }
process.exit(0);
